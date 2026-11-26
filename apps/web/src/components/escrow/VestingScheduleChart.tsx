import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * VestingScheduleChart
 *
 * Renders the vesting / milestone schedule for an escrow:
 *  - Cliff status (get_cliff_status)
 *  - Linear vesting curve plotted against current ledger time
 *  - Milestone unlocks (get_vesting_schedule / get_pending_milestones)
 *  - Vested vs. releasable amounts (get_vested_amount / get_releasable_amount)
 *  - Deliverable hashes per milestone
 *  - approve_milestone / release_milestone / claim_vested_escrow_tokens actions
 *
 * Mutating actions are re-simulated before signing so the exact post-fee
 * net payout can be displayed to the signer.
 *
 * Actions are disabled when the viewer is an EscrowObserver or when
 * verify_escrow_participant returns false.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Milestone {
  id: number | string;
  /** Ledger timestamp (seconds) at which this milestone unlocks. */
  unlockTimestamp: number;
  /** Amount (in token base units, as string) unlocked at this milestone. */
  amount: string;
  /** Deliverable hash (hex string) associated with the milestone. */
  deliverableHash?: string;
  /** Whether the milestone has already been approved. */
  approved?: boolean;
  /** Whether the milestone has already been released. */
  released?: boolean;
  description?: string;
}

export interface VestingSchedule {
  /** Ledger timestamp (seconds) when vesting begins. */
  startTimestamp: number;
  /** Ledger timestamp (seconds) when vesting ends (fully vested). */
  endTimestamp: number;
  /** Cliff duration in seconds from start. */
  cliffDuration: number;
  /** Total vesting amount in token base units (string). */
  totalAmount: string;
  /** Token symbol for display. */
  tokenSymbol?: string;
  /** Token decimals for display. */
  tokenDecimals?: number;
  /** Milestone unlocks. */
  milestones: Milestone[];
}

export interface CliffStatus {
  /** Whether the cliff has been passed. */
  passed: boolean;
  /** Ledger timestamp (seconds) at which the cliff ends. */
  cliffEndTimestamp: number;
}

export interface EscrowVestingClient {
  getVestingSchedule: (escrowId: string) => Promise<VestingSchedule>;
  getCliffStatus: (escrowId: string) => Promise<CliffStatus>;
  getVestedAmount: (escrowId: string) => Promise<string>;
  getReleasableAmount: (escrowId: string) => Promise<string>;
  getPendingMilestones: (escrowId: string) => Promise<Milestone[]>;
  getObservers: (escrowId: string) => Promise<string[]>;
  verifyEscrowParticipant: (escrowId: string, address: string) => Promise<boolean>;
  /** Simulate a transaction and return the expected net payout (post-fee). */
  simulateReleaseMilestone: (
    escrowId: string,
    milestoneId: number | string,
    signer: string,
  ) => Promise<{ netPayout: string; fee: string }>;
  simulateClaimVested: (
    escrowId: string,
    signer: string,
  ) => Promise<{ netPayout: string; fee: string }>;
  approveMilestone: (escrowId: string, milestoneId: number | string, signer: string) => Promise<string>;
  releaseMilestone: (escrowId: string, milestoneId: number | string, signer: string) => Promise<string>;
  claimVestedEscrowTokens: (escrowId: string, signer: string) => Promise<string>;
}

export interface VestingScheduleChartProps {
  escrowId: string;
  /** Connected wallet address of the viewer (undefined if not connected). */
  viewerAddress?: string;
  /** Data-access client for the escrow contract. */
  client: EscrowVestingClient;
  /** Current ledger time in seconds. Defaults to Date.now()/1000. */
  ledgerTime?: number;
  /** Optional callback fired after a successful mutating action. */
  onActionComplete?: () => void;
  /** Optional callback fired when an action errors. */
  onError?: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_DECIMALS = 7;

function toBigIntSafe(value: string | undefined | null): bigint {
  if (!value) return 0n;
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

function formatAmount(
  raw: string | bigint | undefined | null,
  decimals: number = DEFAULT_DECIMALS,
  symbol?: string,
): string {
  const value = typeof raw === 'bigint' ? raw : toBigIntSafe(raw);
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const result = fracStr ? `${wholeStr}.${fracStr}` : wholeStr;
  return `${negative ? '-' : ''}${result}${symbol ? ` ${symbol}` : ''}`;
}

function formatTimestamp(ts: number): string {
  if (!ts || ts <= 0) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

function shortHash(hash?: string): string {
  if (!hash) return '—';
  if (hash.length <= 14) return hash;
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`;
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/**
 * Compute the linear vested amount at a given ledger time, given the schedule.
 * Cliff must be passed before any linear vesting accrues.
 */
function computeLinearVested(
  schedule: VestingSchedule,
  cliffEnd: number,
  now: number,
): bigint {
  const total = toBigIntSafe(schedule.totalAmount);
  if (now < cliffEnd) return 0n;
  if (now >= schedule.endTimestamp) return total;
  const duration = schedule.endTimestamp - schedule.startTimestamp;
  if (duration <= 0) return total;
  const elapsed = now - schedule.startTimestamp;
  if (elapsed <= 0) return 0n;
  return (total * BigInt(Math.floor(elapsed))) / BigInt(Math.floor(duration));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface ActionState {
  loading: boolean;
  error?: string;
  txHash?: string;
}

export const VestingScheduleChart: React.FC<VestingScheduleChartProps> = ({
  escrowId,
  viewerAddress,
  client,
  ledgerTime,
  onActionComplete,
  onError,
}) => {
  const [schedule, setSchedule] = useState<VestingSchedule | null>(null);
  const [cliffStatus, setCliffStatus] = useState<CliffStatus | null>(null);
  const [vestedAmount, setVestedAmount] = useState<string>('0');
  const [releasableAmount, setReleasableAmount] = useState<string>('0');
  const [pendingMilestones, setPendingMilestones] = useState<Milestone[]>([]);
  const [observers, setObservers] = useState<string[]>([]);
  const [isParticipant, setIsParticipant] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [actionState, setActionState] = useState<Record<string, ActionState>>({});
  const [simulations, setSimulations] = useState<
    Record<string, { netPayout: string; fee: string }>
  >({});

  const now = ledgerTime ?? Math.floor(Date.now() / 1000);

  // -------------------------------------------------------------------------
  // Data loading
  // -------------------------------------------------------------------------

  const loadData = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [sched, cliff, vested, releasable, pending, obs] = await Promise.all([
        client.getVestingSchedule(escrowId),
        client.getCliffStatus(escrowId),
        client.getVestedAmount(escrowId),
        client.getReleasableAmount(escrowId),
        client.getPendingMilestones(escrowId),
        client.getObservers(escrowId).catch(() => [] as string[]),
      ]);
      setSchedule(sched);
      setCliffStatus(cliff);
      setVestedAmount(vested);
      setReleasableAmount(releasable);
      setPendingMilestones(pending);
      setObservers(obs);

      if (viewerAddress) {
        try {
          const ok = await client.verifyEscrowParticipant(escrowId, viewerAddress);
          setIsParticipant(ok);
        } catch {
          setIsParticipant(false);
        }
      } else {
        setIsParticipant(false);
      }
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setLoadError(e.message);
      onError?.(e);
    } finally {
      setLoading(false);
    }
  }, [client, escrowId, viewerAddress, onError]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const isObserver = useMemo(() => {
    if (!viewerAddress) return false;
    return observers.some((o) => o.toLowerCase() === viewerAddress.toLowerCase());
  }, [observers, viewerAddress]);

  const canMutate = Boolean(viewerAddress) && isParticipant && !isObserver;

  const decimals = schedule?.tokenDecimals ?? DEFAULT_DECIMALS;
  const symbol = schedule?.tokenSymbol;

  const cliffEnd = useMemo(() => {
    if (cliffStatus) return cliffStatus.cliffEndTimestamp;
    if (schedule) return schedule.startTimestamp + schedule.cliffDuration;
    return 0;
  }, [cliffStatus, schedule]);

  const cliffPassed = useMemo(() => {
    if (cliffStatus) return cliffStatus.passed;
    return now >= cliffEnd && cliffEnd > 0;
  }, [cliffStatus, cliffEnd, now]);

  const linearVested = useMemo(() => {
    if (!schedule) return 0n;
    return computeLinearVested(schedule, cliffEnd, now);
  }, [schedule, cliffEnd, now]);

  const vestedBig = toBigIntSafe(vestedAmount);
  const releasableBig = toBigIntSafe(releasableAmount);

  const totalBig = toBigIntSafe(schedule?.totalAmount);

  const vestedPct = totalBig > 0n ? Number((vestedBig * 10000n) / totalBig) / 100 : 0;
  const linearPct = totalBig > 0n ? Number((linearVested * 10000n) / totalBig) / 100 : 0;

  const canClaimVested = canMutate && releasableBig > 0n;

  // -------------------------------------------------------------------------
  // Simulation helpers
  // -------------------------------------------------------------------------

  const simulateRelease = useCallback(
    async (milestoneId: number | string) => {
      if (!viewerAddress) return;
      const key = `release-${milestoneId}`;
      try {
        const sim = await client.simulateReleaseMilestone(escrowId, milestoneId, viewerAddress);
        setSimulations((prev) => ({ ...prev, [key]: sim }));
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setActionState((prev) => ({
          ...prev,
          [key]: { loading: false, error: `Simulation failed: ${e.message}` },
        }));
      }
    },
    [client, escrowId, viewerAddress],
  );

  const simulateClaim = useCallback(async () => {
    if (!viewerAddress) return;
    const key = 'claim-vested';
    try {
      const sim = await client.simulateClaimVested(escrowId, viewerAddress);
      setSimulations((prev) => ({ ...prev, [key]: sim }));
    } catch (err) {
      const e = err instanceof Error ? err : new Error(String(err));
      setActionState((prev) => ({
        ...prev,
        [key]: { loading: false, error: `Simulation failed: ${e.message}` },
      }));
    }
  }, [client, escrowId, viewerAddress]);

  // Pre-simulate claim payout when releasable > 0 and viewer can mutate.
  useEffect(() => {
    if (canClaimVested) {
      void simulateClaim();
    }
  }, [canClaimVested, simulateClaim]);

  // -------------------------------------------------------------------------
  // Action handlers
  // -------------------------------------------------------------------------

  const runAction = useCallback(
    async (
      key: string,
      fn: () => Promise<string>,
    ) => {
      setActionState((prev) => ({ ...prev, [key]: { loading: true } }));
      try {
        const txHash = await fn();
        setActionState((prev) => ({ ...prev, [key]: { loading: false, txHash } }));
        onActionComplete?.();
        await loadData();
      } catch (err) {
        const e = err instanceof Error ? err : new Error(String(err));
        setActionState((prev) => ({ ...prev, [key]: { loading: false, error: e.message } }));
        onError?.(e);
      }
    },
    [loadData, onActionComplete, onError],
  );

  const handleApproveMilestone = useCallback(
    (milestoneId: number | string) => {
      if (!viewerAddress || !canMutate) return;
      const key = `approve-${milestoneId}`;
      void runAction(key, () => client.approveMilestone(escrowId, milestoneId, viewerAddress));
    },
    [canMutate, client, escrowId, runAction, viewerAddress],
  );

  const handleReleaseMilestone = useCallback(
    (milestoneId: number | string) => {
      if (!viewerAddress || !canMutate) return;
      const key = `release-${milestoneId}`;
      void runAction(key, () => client.releaseMilestone(escrowId, milestoneId, viewerAddress));
    },
    [canMutate, client, escrowId, runAction, viewerAddress],
  );

  const handleClaimVested = useCallback(() => {
    if (!viewerAddress || !canMutate) return;
    void runAction('claim-vested', () => client.claimVestedEscrowTokens(escrowId, viewerAddress));
  }, [canMutate, client, escrowId, runAction, viewerAddress]);

  // -------------------------------------------------------------------------
  // Chart geometry
  // -------------------------------------------------------------------------

  const chart = useMemo(() => {
    if (!schedule) return null;
    const width = 640;
    const height = 180;
    const padLeft = 8;
    const padRight = 8;
    const padTop = 12;
    const padBottom = 24;
    const innerW = width - padLeft - padRight;
    const innerH = height - padTop - padBottom;

    const start = schedule.startTimestamp;
    const end = schedule.endTimestamp;
    const span = Math.max(1, end - start);

    const xFor = (ts: number) => {
      const t = clamp01((ts - start) / span);
      return padLeft + t * innerW;
    };
    const yFor = (frac: number) => {
      const f = clamp01(frac);
      return padTop + (1 - f) * innerH;
    };

    // Linear vesting curve points (sampled).
    const samples = 40;
    const curvePoints: Array<{ x: number; y: number }> = [];
    for (let i = 0; i <= samples; i++) {
      const ts = start + (span * i) / samples;
      const vested = computeLinearVested(schedule, cliffEnd, ts);
      const frac = totalBig > 0n ? Number((vested * 10000n) / totalBig) / 10000 : 0;
      curvePoints.push({ x: xFor(ts), y: yFor(frac) });
    }

    const curvePath = curvePoints
      .map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(2)} ${p.y.toFixed(2)}`)
      .join(' ');

    const areaPath =
      curvePoints.length > 0
        ? `${curvePath} L ${curvePoints[curvePoints.length - 1].x.toFixed(2)} ${yFor(0).toFixed(
            2,
          )} L ${curvePoints[0].x.toFixed(2)} ${yFor(0).toFixed(2)} Z`
        : '';

    const cliffX = xFor(cliffEnd);
    const nowX = xFor(now);
    const nowFrac = totalBig > 0n ? Number((linearVested * 10000n) / totalBig) / 10000 : 0;
    const nowY = yFor(nowFrac);

    const milestoneMarkers = (schedule.milestones || []).map((m) => {
      const frac = totalBig > 0n ? Number((toBigIntSafe(m.amount) * 10000n) / totalBig) / 10000 : 0;
      return {
        id: m.id,
        x: xFor(m.unlockTimestamp),
        y: yFor(frac),
        unlocked: now >= m.unlockTimestamp,
        released: Boolean(m.released),
      };
    });

    return {
      width,
      height,
      padLeft,
      padTop,
      innerW,
      innerH,
      curvePath,
      areaPath,
      cliffX,
      nowX,
      nowY,
      milestoneMarkers,
      xFor,
      yFor,
    };
  }, [schedule, cliffEnd, now, totalBig, linearVested]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="escrow-vesting-chart escrow-vesting-chart--loading" role="status">
        Loading vesting schedule…
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="escrow-vesting-chart escrow-vesting-chart--error" role="alert">
        Failed to load vesting schedule: {loadError}
        <button type="button" onClick={() => void loadData()}>
          Retry
        </button>
      </div>
    );
  }

  if (!schedule) {
    return (
      <div className="escrow-vesting-chart escrow-vesting-chart--empty">
        This escrow has no vesting schedule.
      </div>
    );
  }

  const claimSim = simulations['claim-vested'];

  return (
    <section className="escrow-vesting-chart" aria-label="Vesting and milestone schedule">
      <header className="escrow-vesting-chart__header">
        <h3>Vesting &amp; Milestone Schedule</h3>
        {isObserver && (
          <span className="escrow-vesting-chart__badge escrow-vesting-chart__badge--observer">
            Read-only observer
          </span>
        )}
        {!isObserver && viewerAddress && !isParticipant && (
          <span className="escrow-vesting-chart__badge escrow-vesting-chart__badge--nonparticipant">
            Not a participant
          </span>
        )}
      </header>

      {/* Summary stats */}
      <dl className="escrow-vesting-chart__stats">
        <div>
          <dt>Total vesting</dt>
          <dd>{formatAmount(schedule.totalAmount, decimals, symbol)}</dd>
        </div>
        <div>
          <dt>Vested</dt>
          <dd>
            {formatAmount(vestedAmount, decimals, symbol)}{' '}
            <span className="escrow-vesting-chart__pct">({vestedPct.toFixed(2)}%)</span>
          </dd>
        </div>
        <div>
          <dt>Releasable</dt>
          <dd>{formatAmount(releasableAmount, decimals, symbol)}</dd>
        </div>
        <div>
          <dt>Cliff</dt>
          <dd>
            {cliffPassed ? (
              <span className="escrow-vesting-chart__cliff--passed">Passed</span>
            ) : (
              <span className="escrow-vesting-chart__cliff--pending">
                Pending until {formatTimestamp(cliffEnd)}
              </span>
            )}
          </dd>
        </div>
        <div>
          <dt>Vesting window</dt>
          <dd>
            {formatTimestamp(schedule.startTimestamp)} → {formatTimestamp(schedule.endTimestamp)}
          </dd>
        </div>
      </dl>

      {/* Chart */}
      {chart && (
        <div className="escrow-vesting-chart__plot">
          <svg
            viewBox={`0 0 ${chart.width} ${chart.height}`}
            role="img"
            aria-label="Linear vesting curve with cliff and milestone unlocks"
            width="100%"
          >
            {/* Baseline */}
            <line
              x1={chart.padLeft}
              y1={chart.height - 24}
              x2={chart.width - 8}
              y2={chart.height - 24}
              className="escrow-vesting-chart__axis"
            />

            {/* Area under curve */}
            <path d={chart.areaPath} className="escrow-vesting-chart__area" />

            {/* Linear vesting curve */}
            <path d={chart.curvePath} className="escrow-vesting-chart__curve" fill="none" />

            {/* Cliff marker */}
            <line
              x1={chart.cliffX}
              y1={chart.padTop}
              x2={chart.cliffX}
              y2={chart.height - 24}
              className={
                cliffPassed
                  ? 'escrow-vesting-chart__cliff-line escrow-vesting-chart__cliff-line--passed'
                  : 'escrow-vesting-chart__cliff-line'
              }
            />
            <text
              x={chart.cliffX}
              y={chart.padTop - 2}
              textAnchor="middle"
              className="escrow-vesting-chart__label"
            >
              Cliff
            </text>

            {/* Milestone markers */}
            {chart.milestoneMarkers.map((m) => (
              <g key={String(m.id)}>
                <circle
                  cx={m.x}
                  cy={m.y}
                  r={4}
                  className={
                    m.released
                      ? 'escrow-vesting-chart__milestone escrow-vesting-chart__milestone--released'
                      : m.unlocked
                        ? 'escrow-vesting-chart__milestone escrow-vesting-chart__milestone--unlocked'
                        : 'escrow-vesting-chart__milestone'
                  }
                />
              </g>
            ))}

            {/* Current ledger time marker */}
            <line
              x1={chart.nowX}
              y1={chart.padTop}
              x2={chart.nowX}
              y2={chart.height - 24}
              className="escrow-vesting-chart__now-line"
            />
            <circle cx={chart.nowX} cy={chart.nowY} r={4} className="escrow-vesting-chart__now-dot" />
            <text
              x={chart.nowX}
              y={chart.height - 8}
              textAnchor="middle"
              className="escrow-vesting-chart__label"
            >
              Now
            </text>
          </svg>
          <div className="escrow-vesting-chart__legend">
            <span className="escrow-vesting-chart__legend-item escrow-vesting-chart__legend-item--curve">
              Linear vesting ({linearPct.toFixed(2)}% at now)
            </span>
            <span className="escrow-vesting-chart__legend-item escrow-vesting-chart__legend-item--cliff">
              Cliff
            </span>
            <span className="escrow-vesting-chart__legend-item escrow-vesting-chart__legend-item--milestone">
              Milestone unlock
            </span>
          </div>
        </div>
      )}

      {/* Claim vested tokens */}
      <div className="escrow-vesting-chart__claim">
        <button
          type="button"
          disabled={!canClaimVested || actionState['claim-vested']?.loading}
          onClick={handleClaimVested}
          title={
            !viewerAddress
              ? 'Connect wallet to claim'
              : isObserver
                ? 'Observers cannot claim'
                : !isParticipant
                  ? 'Only escrow participants can claim'
                  : releasableBig <= 0n
                    ? 'Nothing releasable yet'
                    : undefined
          }
        >
          {actionState['claim-vested']?.loading ? 'Claiming…' : 'Claim vested tokens'}
        </button>
        {claimSim && (
          <span className="escrow-vesting-chart__payout">
            Net payout: {formatAmount(claimSim.netPayout, decimals, symbol)} (fee:{' '}
            {formatAmount(claimSim.fee, decimals, symbol)})
          </span>
        )}
        {actionState['claim-vested']?.error && (
          <span className="escrow-vesting-chart__error" role="alert">
            {actionState['claim-vested'].error}
          </span>
        )}
        {actionState['claim-vested']?.txHash && (
          <span className="escrow-vesting-chart__tx">Tx: {shortHash(actionState['claim-vested'].txHash)}</span>
        )}
      </div>

      {/* Milestones */}
      <div className="escrow-vesting-chart__milestones">
        <h4>Milestones</h4>
        {pendingMilestones.length === 0 && (schedule.milestones || []).length === 0 && (
          <p className="escrow-vesting-chart__empty-milestones">No milestones defined.</p>
        )}
        <ul>
          {(schedule.milestones || []).map((m) => {
            const approveKey = `approve-${m.id}`;
            const releaseKey = `release-${m.id}`;
            const approveState = actionState[approveKey];
            const releaseState = actionState[releaseKey];
            const sim = simulations[releaseKey];
            const unlocked = now >= m.unlockTimestamp;
            const canApprove = canMutate && !m.approved && !m.released;
            const canRelease = canMutate && Boolean(m.approved) && !m.released && unlocked;

            return (
              <li key={String(m.id)} className="escrow-vesting-chart__milestone-row">
                <div className="escrow-vesting-chart__milestone-info">
                  <span className="escrow-vesting-chart__milestone-title">
                    {m.description || `Milestone #${m.id}`}
                  </span>
                  <span className="escrow-vesting-chart__milestone-amount">
                    {formatAmount(m.amount, decimals, symbol)}
                  </span>
                  <span className="escrow-vesting-chart__milestone-time">
                    Unlocks {formatTimestamp(m.unlockTimestamp)}
                    {unlocked ? ' (unlocked)' : ' (locked)'}
                  </span>
                  {m.deliverableHash && (
                    <span
                      className="escrow-vesting-chart__deliverable"
                      title={m.deliverableHash}
                    >
                      Deliverable: <code>{shortHash(m.deliverableHash)}</code>
                    </span>
                  )}
                  <span className="escrow-vesting-chart__milestone-status">
                    {m.released ? 'Released' : m.approved ? 'Approved' : 'Pending approval'}
                  </span>
                </div>

                <div className="escrow-vesting-chart__milestone-actions">
                  <button
                    type="button"
                    disabled={!canApprove || approveState?.loading}
                    onClick={() => handleApproveMilestone(m.id)}
                    title={
                      !viewerAddress
                        ? 'Connect wallet'
                        : isObserver
                          ? 'Observers cannot approve'
                          : !isParticipant
                            ? 'Only participants can approve'
                            : m.approved
                              ? 'Already approved'
                              : m.released
                                ? 'Already released'
                                : undefined
                    }
                  >
                    {approveState?.loading ? 'Approving…' : 'Approve'}
                  </button>

                  <button
                    type="button"
                    disabled={!canRelease || releaseState?.loading}
                    onMouseEnter={() => {
                      if (canRelease) void simulateRelease(m.id);
                    }}
                    onFocus={() => {
                      if (canRelease) void simulateRelease(m.id);
                    }}
                    onClick={() => handleReleaseMilestone(m.id)}
                    title={
                      !viewerAddress
                        ? 'Connect wallet'
                        : isObserver
                          ? 'Observers cannot release'
                          : !isParticipant
                            ? 'Only participants can release'
                            : !m.approved
                              ? 'Milestone must be approved first'
                              : m.released
                                ? 'Already released'
                                : !unlocked
                                  ? 'Milestone not yet unlocked'
                                  : undefined
                    }
                  >
                    {releaseState?.loading ? 'Releasing…' : 'Release'}
                  </button>

                  {sim && (
                    <span className="escrow-vesting-chart__payout">
                      Net: {formatAmount(sim.netPayout, decimals, symbol)} (fee:{' '}
                      {formatAmount(sim.fee, decimals, symbol)})
                    </span>
                  )}
                  {approveState?.error && (
                    <span className="escrow-vesting-chart__error" role="alert">
                      {approveState.error}
                    </span>
                  )}
                  {releaseState?.error && (
                    <span className="escrow-vesting-chart__error" role="alert">
                      {releaseState.error}
                    </span>
                  )}
                  {releaseState?.txHash && (
                    <span className="escrow-vesting-chart__tx">
                      Tx: {shortHash(releaseState.txHash)}
                    </span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
};

export default VestingScheduleChart;