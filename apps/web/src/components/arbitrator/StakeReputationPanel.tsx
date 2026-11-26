import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * StakeReputationPanel
 *
 * Sidebar for the Arbitrator Workbench showing:
 *  - Active staked tokens (get_arbitrator_stake)
 *  - Slashing risk warnings
 *  - Reputation decay countdown (get_reputation_decay_config)
 *  - Wilson-score reputation (get_arbitrator_reputation)
 *  - Top-arbitrator ranking (get_top_arbitrators)
 *  - Historical ruling coherence metrics
 *  - deposit_arbitrator_stake action
 */

export interface ArbitratorStake {
  /** Raw staked amount in stroops (or token base units) as a string. */
  amount: string;
  /** Token symbol, e.g. "USDC". */
  token: string;
  /** Token decimals for display formatting. */
  decimals: number;
  /** Unix timestamp (seconds) when the stake was last updated. */
  updatedAt: number;
  /** Whether the arbitrator is currently eligible to be drawn into panels. */
  active: boolean;
}

export interface ReputationDecayConfig {
  /** Decay rate per period, expressed in basis points (e.g. 50 = 0.5%). */
  decayRateBps: number;
  /** Length of a decay period in seconds. */
  periodSeconds: number;
  /** Unix timestamp (seconds) of the last decay application. */
  lastDecayAt: number;
  /** Minimum reputation floor (0-10000 scale). */
  floor: number;
}

export interface ArbitratorReputation {
  /** Wilson lower-bound score scaled to 0-10000. */
  wilsonScore: number;
  /** Total number of rulings cast. */
  totalRulings: number;
  /** Number of rulings that were coherent with the panel majority. */
  coherentRulings: number;
  /** Number of rulings overturned on appeal. */
  overturnedRulings: number;
  /** Number of recusals logged. */
  recusals: number;
}

export interface TopArbitrator {
  address: string;
  wilsonScore: number;
  totalRulings: number;
}

export interface CoherenceMetrics {
  /** Fraction (0-1) of rulings matching panel majority. */
  majorityAlignment: number;
  /** Fraction (0-1) of rulings upheld on appeal. */
  appealUpheld: number;
  /** Average time-to-vote in seconds. */
  avgVoteLatencySeconds: number;
  /** Number of rulings in the trailing window. */
  windowRulings: number;
}

export interface StakeReputationPanelProps {
  /** Connected wallet address. */
  walletAddress: string | null;
  /** Whether the connected wallet is a registered arbitrator. */
  isArbitrator: boolean;
  /** Current stake info, or null if none. */
  stake: ArbitratorStake | null;
  /** Reputation decay configuration. */
  decayConfig: ReputationDecayConfig | null;
  /** Current reputation snapshot. */
  reputation: ArbitratorReputation | null;
  /** Top arbitrators leaderboard. */
  topArbitrators: TopArbitrator[];
  /** Historical ruling coherence metrics. */
  coherence: CoherenceMetrics | null;
  /** Whether the panel is in a loading state. */
  loading?: boolean;
  /** Error message to display, if any. */
  error?: string | null;
  /** Deposit handler; resolves when the deposit transaction is submitted. */
  onDepositStake?: (amount: string) => Promise<void>;
  /** Refresh handler. */
  onRefresh?: () => void;
}

const BPS_DENOMINATOR = 10000;

function formatTokenAmount(amount: string, decimals: number): string {
  try {
    const raw = BigInt(amount);
    if (decimals <= 0) return raw.toString();
    const divisor = BigInt(10) ** BigInt(decimals);
    const whole = raw / divisor;
    const frac = raw % divisor;
    const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
    return fracStr.length > 0 ? `${whole.toString()}.${fracStr}` : whole.toString();
  } catch {
    return amount;
  }
}

function formatDuration(totalSeconds: number): string {
  if (totalSeconds <= 0) return '0s';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = Math.floor(totalSeconds % 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (parts.length === 0) parts.push(`${seconds}s`);
  return parts.join(' ');
}

function formatPercent(value: number, digits = 1): string {
  if (!Number.isFinite(value)) return '—';
  return `${(value * 100).toFixed(digits)}%`;
}

function shortenAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

function computeDecayCountdown(config: ReputationDecayConfig | null, now: number): number {
  if (!config) return 0;
  const nextDecayAt = config.lastDecayAt + config.periodSeconds;
  return Math.max(0, nextDecayAt - now);
}

function computeProjectedDecay(
  reputation: ArbitratorReputation | null,
  config: ReputationDecayConfig | null,
): number {
  if (!reputation || !config) return 0;
  const decay = Math.floor((reputation.wilsonScore * config.decayRateBps) / BPS_DENOMINATOR);
  const projected = reputation.wilsonScore - decay;
  return Math.max(config.floor, projected);
}

export const StakeReputationPanel: React.FC<StakeReputationPanelProps> = ({
  walletAddress,
  isArbitrator,
  stake,
  decayConfig,
  reputation,
  topArbitrators,
  coherence,
  loading = false,
  error = null,
  onDepositStake,
  onRefresh,
}) => {
  const [now, setNow] = useState<number>(() => Math.floor(Date.now() / 1000));
  const [depositAmount, setDepositAmount] = useState<string>('');
  const [depositing, setDepositing] = useState<boolean>(false);
  const [depositError, setDepositError] = useState<string | null>(null);
  const [depositSuccess, setDepositSuccess] = useState<string | null>(null);

  // Tick the clock so the decay countdown stays fresh.
  useEffect(() => {
    const interval = setInterval(() => {
      setNow(Math.floor(Date.now() / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  const decayCountdown = useMemo(
    () => computeDecayCountdown(decayConfig, now),
    [decayConfig, now],
  );

  const projectedScore = useMemo(
    () => computeProjectedDecay(reputation, decayConfig),
    [reputation, decayConfig],
  );

  const slashingRisk = useMemo(() => {
    if (!stake || !stake.active) return 'none' as const;
    if (!reputation) return 'unknown' as const;
    if (reputation.overturnedRulings > 0) return 'high' as const;
    if (reputation.recusals > reputation.totalRulings) return 'medium' as const;
    return 'low' as const;
  }, [stake, reputation]);

  const ranking = useMemo(() => {
    if (!walletAddress) return null;
    const idx = topArbitrators.findIndex(
      (a) => a.address.toLowerCase() === walletAddress.toLowerCase(),
    );
    return idx >= 0 ? idx + 1 : null;
  }, [topArbitrators, walletAddress]);

  const handleDeposit = useCallback(async () => {
    setDepositError(null);
    setDepositSuccess(null);
    if (!onDepositStake) {
      setDepositError('Deposit is not available.');
      return;
    }
    const trimmed = depositAmount.trim();
    if (!/^\d+$/.test(trimmed) || BigInt(trimmed) <= BigInt(0)) {
      setDepositError('Enter a positive integer amount in base units.');
      return;
    }
    setDepositing(true);
    try {
      await onDepositStake(trimmed);
      setDepositSuccess('Deposit submitted.');
      setDepositAmount('');
    } catch (err) {
      setDepositError(err instanceof Error ? err.message : 'Deposit failed.');
    } finally {
      setDepositing(false);
    }
  }, [depositAmount, onDepositStake]);

  const canDeposit = Boolean(isArbitrator && walletAddress && onDepositStake && !depositing);

  const slashingRiskLabel: Record<typeof slashingRisk, string> = {
    none: 'No active stake',
    unknown: 'Unknown',
    low: 'Low',
    medium: 'Medium',
    high: 'High',
  };

  const slashingRiskClass: Record<typeof slashingRisk, string> = {
    none: 'srp-risk-none',
    unknown: 'srp-risk-unknown',
    low: 'srp-risk-low',
    medium: 'srp-risk-medium',
    high: 'srp-risk-high',
  };

  return (
    <aside className="srp-panel" aria-label="Stake and reputation">
      <style>{`
        .srp-panel {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
          border: 1px solid #e2e8f0;
          border-radius: 12px;
          background: #ffffff;
          font-size: 14px;
          color: #1e293b;
          max-width: 360px;
        }
        .srp-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }
        .srp-title {
          font-size: 16px;
          font-weight: 600;
          margin: 0;
        }
        .srp-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding-top: 12px;
          border-top: 1px solid #f1f5f9;
        }
        .srp-section-title {
          font-size: 12px;
          font-weight: 600;
          text-transform: uppercase;
          letter-spacing: 0.04em;
          color: #64748b;
          margin: 0;
        }
        .srp-row {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .srp-label { color: #64748b; }
        .srp-value { font-weight: 600; font-variant-numeric: tabular-nums; }
        .srp-badge {
          display: inline-block;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 12px;
          font-weight: 600;
        }
        .srp-risk-none { background: #f1f5f9; color: #475569; }
        .srp-risk-unknown { background: #f1f5f9; color: #475569; }
        .srp-risk-low { background: #dcfce7; color: #166534; }
        .srp-risk-medium { background: #fef9c3; color: #854d0e; }
        .srp-risk-high { background: #fee2e2; color: #991b1b; }
        .srp-warning {
          padding: 8px 10px;
          border-radius: 8px;
          background: #fef2f2;
          color: #991b1b;
          font-size: 13px;
        }
        .srp-muted { color: #94a3b8; font-size: 13px; }
        .srp-input {
          flex: 1;
          padding: 6px 8px;
          border: 1px solid #cbd5e1;
          border-radius: 6px;
          font-size: 13px;
        }
        .srp-button {
          padding: 6px 12px;
          border: none;
          border-radius: 6px;
          background: #2563eb;
          color: #ffffff;
          font-weight: 600;
          font-size: 13px;
          cursor: pointer;
        }
        .srp-button:disabled {
          background: #cbd5e1;
          cursor: not-allowed;
        }
        .srp-button-secondary {
          background: transparent;
          color: #2563eb;
          border: 1px solid #cbd5e1;
        }
        .srp-error { color: #b91c1c; font-size: 13px; }
        .srp-success { color: #15803d; font-size: 13px; }
        .srp-list {
          list-style: none;
          margin: 0;
          padding: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .srp-list-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          font-size: 13px;
        }
        .srp-rank {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 20px;
          height: 20px;
          border-radius: 999px;
          background: #eff6ff;
          color: #1d4ed8;
          font-size: 11px;
          font-weight: 700;
        }
      `}</style>

      <div className="srp-header">
        <h2 className="srp-title">Stake &amp; Reputation</h2>
        {onRefresh && (
          <button
            type="button"
            className="srp-button srp-button-secondary"
            onClick={onRefresh}
            disabled={loading}
            aria-label="Refresh stake and reputation"
          >
            {loading ? 'Loading…' : 'Refresh'}
          </button>
        )}
      </div>

      {error && <div className="srp-error" role="alert">{error}</div>}

      {!walletAddress && (
        <div className="srp-muted">Connect a wallet to view stake and reputation.</div>
      )}

      {walletAddress && !isArbitrator && (
        <div className="srp-warning">
          This wallet is not a registered arbitrator. Stake and reputation data is read-only.
        </div>
      )}

      {/* Active stake */}
      <section className="srp-section" aria-label="Active stake">
        <h3 className="srp-section-title">Active Stake</h3>
        {stake ? (
          <>
            <div className="srp-row">
              <span className="srp-label">Staked</span>
              <span className="srp-value">
                {formatTokenAmount(stake.amount, stake.decimals)} {stake.token}
              </span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Status</span>
              <span className="srp-value">{stake.active ? 'Active' : 'Inactive'}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Last updated</span>
              <span className="srp-value">
                {new Date(stake.updatedAt * 1000).toLocaleString()}
              </span>
            </div>
          </>
        ) : (
          <div className="srp-muted">No active stake on record.</div>
        )}

        <div className="srp-row">
          <span className="srp-label">Slashing risk</span>
          <span className={`srp-badge ${slashingRiskClass[slashingRisk]}`}>
            {slashingRiskLabel[slashingRisk]}
          </span>
        </div>

        {slashingRisk === 'high' && (
          <div className="srp-warning" role="alert">
            High slashing risk: overturned rulings detected. Review your ruling coherence before
            accepting new panels.
          </div>
        )}
        {slashingRisk === 'medium' && (
          <div className="srp-warning" role="alert">
            Elevated slashing risk: recusal rate is high relative to rulings. Consider reviewing
            conflict-of-interest checks.
          </div>
        )}
      </section>

      {/* Deposit */}
      <section className="srp-section" aria-label="Deposit stake">
        <h3 className="srp-section-title">Deposit Stake</h3>
        <div className="srp-row">
          <input
            className="srp-input"
            type="text"
            inputMode="numeric"
            placeholder="Amount (base units)"
            value={depositAmount}
            onChange={(e) => setDepositAmount(e.target.value)}
            disabled={!canDeposit}
            aria-label="Deposit amount in base units"
          />
          <button
            type="button"
            className="srp-button"
            onClick={handleDeposit}
            disabled={!canDeposit || depositAmount.trim().length === 0}
          >
            {depositing ? 'Depositing…' : 'Deposit'}
          </button>
        </div>
        {depositError && <div className="srp-error" role="alert">{depositError}</div>}
        {depositSuccess && <div className="srp-success">{depositSuccess}</div>}
        {!isArbitrator && (
          <div className="srp-muted">Only registered arbitrators can deposit stake.</div>
        )}
      </section>

      {/* Reputation */}
      <section className="srp-section" aria-label="Reputation">
        <h3 className="srp-section-title">Reputation</h3>
        {reputation ? (
          <>
            <div className="srp-row">
              <span className="srp-label">Wilson score</span>
              <span className="srp-value">{(reputation.wilsonScore / 100).toFixed(2)}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Total rulings</span>
              <span className="srp-value">{reputation.totalRulings}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Coherent rulings</span>
              <span className="srp-value">{reputation.coherentRulings}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Overturned</span>
              <span className="srp-value">{reputation.overturnedRulings}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Recusals</span>
              <span className="srp-value">{reputation.recusals}</span>
            </div>
            {ranking !== null && (
              <div className="srp-row">
                <span className="srp-label">Leaderboard rank</span>
                <span className="srp-value">#{ranking}</span>
              </div>
            )}
          </>
        ) : (
          <div className="srp-muted">No reputation data available.</div>
        )}
      </section>

      {/* Decay countdown */}
      <section className="srp-section" aria-label="Reputation decay">
        <h3 className="srp-section-title">Reputation Decay</h3>
        {decayConfig ? (
          <>
            <div className="srp-row">
              <span className="srp-label">Next decay in</span>
              <span className="srp-value">{formatDuration(decayCountdown)}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Decay rate</span>
              <span className="srp-value">
                {(decayConfig.decayRateBps / 100).toFixed(2)}% /{' '}
                {formatDuration(decayConfig.periodSeconds)}
              </span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Floor</span>
              <span className="srp-value">{(decayConfig.floor / 100).toFixed(2)}</span>
            </div>
            {reputation && (
              <div className="srp-row">
                <span className="srp-label">Projected after decay</span>
                <span className="srp-value">{(projectedScore / 100).toFixed(2)}</span>
              </div>
            )}
          </>
        ) : (
          <div className="srp-muted">Decay configuration unavailable.</div>
        )}
      </section>

      {/* Coherence metrics */}
      <section className="srp-section" aria-label="Ruling coherence">
        <h3 className="srp-section-title">Ruling Coherence</h3>
        {coherence ? (
          <>
            <div className="srp-row">
              <span className="srp-label">Majority alignment</span>
              <span className="srp-value">{formatPercent(coherence.majorityAlignment)}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Upheld on appeal</span>
              <span className="srp-value">{formatPercent(coherence.appealUpheld)}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Avg vote latency</span>
              <span className="srp-value">{formatDuration(coherence.avgVoteLatencySeconds)}</span>
            </div>
            <div className="srp-row">
              <span className="srp-label">Window rulings</span>
              <span className="srp-value">{coherence.windowRulings}</span>
            </div>
          </>
        ) : (
          <div className="srp-muted">No coherence metrics available.</div>
        )}
      </section>

      {/* Leaderboard */}
      <section className="srp-section" aria-label="Top arbitrators">
        <h3 className="srp-section-title">Top Arbitrators</h3>
        {topArbitrators.length > 0 ? (
          <ol className="srp-list">
            {topArbitrators.slice(0, 5).map((a, idx) => {
              const isSelf =
                walletAddress !== null &&
                a.address.toLowerCase() === walletAddress.toLowerCase();
              return (
                <li key={a.address} className="srp-list-item">
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="srp-rank">{idx + 1}</span>
                    <span style={{ fontWeight: isSelf ? 700 : 400 }}>
                      {shortenAddress(a.address)}
                      {isSelf ? ' (you)' : ''}
                    </span>
                  </span>
                  <span className="srp-value">{(a.wilsonScore / 100).toFixed(2)}</span>
                </li>
              );
            })}
          </ol>
        ) : (
          <div className="srp-muted">Leaderboard unavailable.</div>
        )}
      </section>
    </aside>
  );
};

export default StakeReputationPanel;