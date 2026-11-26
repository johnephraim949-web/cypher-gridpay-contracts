import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LiveStreamCounter } from '../../components/channels/LiveStreamCounter';
import { useStreamingChannel } from '../../hooks/useStreamingChannel';

/**
 * StreamingChannelsPage
 *
 * Displays active incoming and outgoing streaming payment channels for GridPay
 * kWh micro-payments. Each channel is rendered as a card with a live
 * interpolated counter (see LiveStreamCounter) plus runway depletion warnings
 * and one-click Top-Up / Claim Accrued actions. A second tab exposes the
 * Channel Settlement & Dispute workflow where parties can inspect off-chain
 * signed state sequence numbers and initiate mutual close or challenge
 * settlement.
 */

export type ChannelDirection = 'incoming' | 'outgoing';

export interface StreamingChannelSummary {
  channelId: string;
  counterparty: string;
  direction: ChannelDirection;
  /** Deposit cap in stroops (7-decimal fixed point). */
  depositCap: bigint;
  /** Amount already claimed in stroops. */
  claimedAmount: bigint;
  /** Rate in stroops per second. */
  ratePerSecond: bigint;
  /** Unix timestamp (ms) of the last reconciled ledger. */
  lastLedgerTimestamp: number;
  /** Optional human label (e.g. meter id). */
  label?: string;
  /** Off-chain signed state sequence number, if any. */
  lastSignedSequence?: number;
  /** Whether the channel is currently disputed. */
  disputed?: boolean;
}

export interface StreamingChannelsPageProps {
  /** Optional injected channels (useful for tests / storybook). */
  initialChannels?: StreamingChannelSummary[];
  /** Runway warning threshold in hours. Defaults to 24. */
  runwayWarningHours?: number;
  /** Optional injected action handlers (useful for tests). */
  onTopUp?: (channelId: string, amount: bigint) => Promise<void> | void;
  onClaim?: (channelId: string) => Promise<void> | void;
  onMutualClose?: (channelId: string) => Promise<void> | void;
  onChallenge?: (channelId: string) => Promise<void> | void;
}

const STROOPS_PER_UNIT = 10_000_000n; // 7 decimals
const MS_PER_HOUR = 3_600_000;
const DEFAULT_RUNWAY_WARNING_HOURS = 24;

/** Format stroops as a fixed-point decimal string with `decimals` places. */
export function formatStroops(value: bigint, decimals = 2): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / STROOPS_PER_UNIT;
  const frac = abs % STROOPS_PER_UNIT;
  const fracStr = frac.toString().padStart(7, '0').slice(0, decimals);
  const sign = negative ? '-' : '';
  return decimals > 0 ? `${sign}${whole.toString()}.${fracStr}` : `${sign}${whole.toString()}`;
}

/**
 * Compute remaining funded balance in stroops, clamped at zero.
 * remaining = max(0, depositCap - claimedAmount)
 */
export function computeRemainingFunded(
  depositCap: bigint,
  claimedAmount: bigint,
): bigint {
  const remaining = depositCap - claimedAmount;
  return remaining > 0n ? remaining : 0n;
}

/**
 * Compute runway in milliseconds given remaining funded balance and rate.
 * Returns Infinity when rate is zero (no depletion).
 */
export function computeRunwayMs(remaining: bigint, ratePerSecond: bigint): number {
  if (ratePerSecond <= 0n) return Number.POSITIVE_INFINITY;
  if (remaining <= 0n) return 0;
  // remaining (stroops) / rate (stroops/sec) = seconds; convert to ms.
  const seconds = (remaining * 1000n) / ratePerSecond;
  return Number(seconds);
}

export function isRunwayBelowThreshold(
  remaining: bigint,
  ratePerSecond: bigint,
  thresholdHours: number,
): boolean {
  const runwayMs = computeRunwayMs(remaining, ratePerSecond);
  if (!Number.isFinite(runwayMs)) return false;
  return runwayMs < thresholdHours * MS_PER_HOUR;
}

type TabKey = 'channels' | 'settlement';

interface ActionState {
  pending: boolean;
  error?: string;
  success?: string;
}

const StreamingChannelsPage: React.FC<StreamingChannelsPageProps> = ({
  initialChannels,
  runwayWarningHours = DEFAULT_RUNWAY_WARNING_HOURS,
  onTopUp,
  onClaim,
  onMutualClose,
  onChallenge,
}) => {
  const [activeTab, setActiveTab] = useState<TabKey>('channels');
  const [channels, setChannels] = useState<StreamingChannelSummary[]>(
    initialChannels ?? [],
  );
  const [actionState, setActionState] = useState<Record<string, ActionState>>({});
  const [topUpAmounts, setTopUpAmounts] = useState<Record<string, string>>({});

  const { fetchChannels, topUp, claim, mutualClose, challenge } =
    useStreamingChannel();

  // Load channels from the hook when none were injected.
  useEffect(() => {
    if (initialChannels) return;
    let cancelled = false;
    (async () => {
      try {
        const loaded = await fetchChannels();
        if (!cancelled && Array.isArray(loaded)) {
          setChannels(loaded as StreamingChannelSummary[]);
        }
      } catch {
        // Non-fatal: leave list empty; UI shows empty state.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchChannels, initialChannels]);

  const setChannelAction = useCallback(
    (channelId: string, state: ActionState) => {
      setActionState((prev) => ({ ...prev, [channelId]: state }));
    },
    [],
  );

  const handleTopUp = useCallback(
    async (channelId: string) => {
      const raw = topUpAmounts[channelId] ?? '';
      let amount: bigint;
      try {
        amount = parseAmountToStroops(raw);
      } catch {
        setChannelAction(channelId, { pending: false, error: 'Invalid amount' });
        return;
      }
      if (amount <= 0n) {
        setChannelAction(channelId, { pending: false, error: 'Amount must be > 0' });
        return;
      }
      setChannelAction(channelId, { pending: true });
      try {
        if (onTopUp) {
          await onTopUp(channelId, amount);
        } else {
          await topUp(channelId, amount);
        }
        setChannels((prev) =>
          prev.map((c) =>
            c.channelId === channelId
              ? { ...c, depositCap: c.depositCap + amount }
              : c,
          ),
        );
        setChannelAction(channelId, { pending: false, success: 'Top-up submitted' });
      } catch (err) {
        setChannelAction(channelId, {
          pending: false,
          error: err instanceof Error ? err.message : 'Top-up failed',
        });
      }
    },
    [onTopUp, topUp, topUpAmounts, setChannelAction],
  );

  const handleClaim = useCallback(
    async (channelId: string) => {
      setChannelAction(channelId, { pending: true });
      try {
        if (onClaim) {
          await onClaim(channelId);
        } else {
          await claim(channelId);
        }
        setChannelAction(channelId, { pending: false, success: 'Claim submitted' });
      } catch (err) {
        setChannelAction(channelId, {
          pending: false,
          error: err instanceof Error ? err.message : 'Claim failed',
        });
      }
    },
    [onClaim, claim, setChannelAction],
  );

  const handleMutualClose = useCallback(
    async (channelId: string) => {
      setChannelAction(channelId, { pending: true });
      try {
        if (onMutualClose) {
          await onMutualClose(channelId);
        } else {
          await mutualClose(channelId);
        }
        setChannelAction(channelId, { pending: false, success: 'Mutual close submitted' });
      } catch (err) {
        setChannelAction(channelId, {
          pending: false,
          error: err instanceof Error ? err.message : 'Mutual close failed',
        });
      }
    },
    [onMutualClose, mutualClose, setChannelAction],
  );

  const handleChallenge = useCallback(
    async (channelId: string) => {
      setChannelAction(channelId, { pending: true });
      try {
        if (onChallenge) {
          await onChallenge(channelId);
        } else {
          await challenge(channelId);
        }
        setChannelAction(channelId, { pending: false, success: 'Challenge submitted' });
      } catch (err) {
        setChannelAction(channelId, {
          pending: false,
          error: err instanceof Error ? err.message : 'Challenge failed',
        });
      }
    },
    [onChallenge, challenge, setChannelAction],
  );

  const incoming = useMemo(
    () => channels.filter((c) => c.direction === 'incoming'),
    [channels],
  );
  const outgoing = useMemo(
    () => channels.filter((c) => c.direction === 'outgoing'),
    [channels],
  );

  const renderChannelCard = (channel: StreamingChannelSummary) => {
    const remaining = computeRemainingFunded(
      channel.depositCap,
      channel.claimedAmount,
    );
    const runwayWarning = isRunwayBelowThreshold(
      remaining,
      channel.ratePerSecond,
      runwayWarningHours,
    );
    const state = actionState[channel.channelId];

    return (
      <div
        key={channel.channelId}
        className="channel-card"
        data-testid={`channel-card-${channel.channelId}`}
        data-runway-warning={runwayWarning ? 'true' : 'false'}
      >
        <header className="channel-card__header">
          <h3>{channel.label ?? channel.channelId}</h3>
          <span className="channel-card__direction">{channel.direction}</span>
          <span className="channel-card__counterparty">{channel.counterparty}</span>
        </header>

        <LiveStreamCounter
          channelId={channel.channelId}
          depositCap={channel.depositCap}
          claimedAmount={channel.claimedAmount}
          ratePerSecond={channel.ratePerSecond}
          lastLedgerTimestamp={channel.lastLedgerTimestamp}
        />

        {runwayWarning && (
          <div
            className="channel-card__runway-warning"
            role="alert"
            data-testid={`runway-warning-${channel.channelId}`}
          >
            Low runway: less than {runwayWarningHours}h of flow remaining.
          </div>
        )}

        <dl className="channel-card__stats">
          <dt>Deposit cap</dt>
          <dd>{formatStroops(channel.depositCap)} USDC</dd>
          <dt>Claimed</dt>
          <dd>{formatStroops(channel.claimedAmount)} USDC</dd>
          <dt>Remaining funded</dt>
          <dd>{formatStroops(remaining)} USDC</dd>
        </dl>

        <div className="channel-card__actions">
          <label>
            Top-up amount
            <input
              type="text"
              inputMode="decimal"
              value={topUpAmounts[channel.channelId] ?? ''}
              onChange={(e) =>
                setTopUpAmounts((prev) => ({
                  ...prev,
                  [channel.channelId]: e.target.value,
                }))
              }
              aria-label={`Top-up amount for ${channel.channelId}`}
            />
          </label>
          <button
            type="button"
            disabled={state?.pending}
            onClick={() => handleTopUp(channel.channelId)}
            data-testid={`top-up-${channel.channelId}`}
          >
            Top-Up
          </button>
          <button
            type="button"
            disabled={state?.pending}
            onClick={() => handleClaim(channel.channelId)}
            data-testid={`claim-${channel.channelId}`}
          >
            Claim Accrued
          </button>
        </div>

        {state?.error && (
          <p className="channel-card__error" role="alert">
            {state.error}
          </p>
        )}
        {state?.success && (
          <p className="channel-card__success" role="status">
            {state.success}
          </p>
        )}
      </div>
    );
  };

  const renderSettlementTab = () => (
    <div className="settlement-tab" data-testid="settlement-tab">
      <h2>Channel Settlement &amp; Dispute</h2>
      {channels.length === 0 ? (
        <p>No channels to settle.</p>
      ) : (
        <table className="settlement-table">
          <thead>
            <tr>
              <th>Channel</th>
              <th>Counterparty</th>
              <th>Direction</th>
              <th>Signed sequence</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {channels.map((channel) => {
              const state = actionState[channel.channelId];
              return (
                <tr
                  key={channel.channelId}
                  data-testid={`settlement-row-${channel.channelId}`}
                >
                  <td>{channel.label ?? channel.channelId}</td>
                  <td>{channel.counterparty}</td>
                  <td>{channel.direction}</td>
                  <td data-testid={`signed-seq-${channel.channelId}`}>
                    {channel.lastSignedSequence ?? '—'}
                  </td>
                  <td>{channel.disputed ? 'Disputed' : 'Active'}</td>
                  <td>
                    <button
                      type="button"
                      disabled={state?.pending}
                      onClick={() => handleMutualClose(channel.channelId)}
                      data-testid={`mutual-close-${channel.channelId}`}
                    >
                      Mutual Close
                    </button>
                    <button
                      type="button"
                      disabled={state?.pending}
                      onClick={() => handleChallenge(channel.channelId)}
                      data-testid={`challenge-${channel.channelId}`}
                    >
                      Challenge Settlement
                    </button>
                    {state?.error && (
                      <span className="settlement-table__error" role="alert">
                        {state.error}
                      </span>
                    )}
                    {state?.success && (
                      <span className="settlement-table__success" role="status">
                        {state.success}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );

  return (
    <div className="streaming-channels-page" data-testid="streaming-channels-page">
      <header className="streaming-channels-page__header">
        <h1>Streaming Payment Channels</h1>
        <nav className="streaming-channels-page__tabs" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'channels'}
            onClick={() => setActiveTab('channels')}
            data-testid="tab-channels"
          >
            Channels
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'settlement'}
            onClick={() => setActiveTab('settlement')}
            data-testid="tab-settlement"
          >
            Settlement &amp; Dispute
          </button>
        </nav>
      </header>

      {activeTab === 'channels' ? (
        <div className="streaming-channels-page__content">
          <section aria-labelledby="incoming-heading">
            <h2 id="incoming-heading">Incoming</h2>
            {incoming.length === 0 ? (
              <p>No incoming streaming channels.</p>
            ) : (
              <div className="channel-grid">{incoming.map(renderChannelCard)}</div>
            )}
          </section>

          <section aria-labelledby="outgoing-heading">
            <h2 id="outgoing-heading">Outgoing</h2>
            {outgoing.length === 0 ? (
              <p>No outgoing streaming channels.</p>
            ) : (
              <div className="channel-grid">{outgoing.map(renderChannelCard)}</div>
            )}
          </section>
        </div>
      ) : (
        renderSettlementTab()
      )}
    </div>
  );
};

/**
 * Parse a user-entered decimal amount (e.g. "12.5") into stroops (7 decimals).
 * Throws on malformed input.
 */
export function parseAmountToStroops(input: string): bigint {
  const trimmed = input.trim();
  if (!/^\d+(\.\d{0,7})?$/.test(trimmed)) {
    throw new Error('Invalid amount');
  }
  const [whole, frac = ''] = trimmed.split('.');
  const fracPadded = frac.padEnd(7, '0');
  return BigInt(whole) * STROOPS_PER_UNIT + BigInt(fracPadded);
}

export default StreamingChannelsPage;