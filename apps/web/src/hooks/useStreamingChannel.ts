import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Fixed-point scale used for all interpolation arithmetic.
 * 7 decimal places matches Stellar/Soroban token precision (stroops).
 */
export const FIXED_POINT_SCALE = 10_000_000n; // 1e7
export const FIXED_POINT_DECIMALS = 7;

/** Reconciliation interval against Soroban ledger state (ms). */
export const RECONCILE_INTERVAL_MS = 15_000;

/** Default runway warning threshold: 24 hours of flow (ms). */
export const DEFAULT_RUNWAY_WARNING_MS = 24 * 60 * 60 * 1000;

/** Default animation frame interval target (ms) — ~30fps to keep CPU low. */
const FRAME_INTERVAL_MS = 33;

export type StreamingChannelDirection = 'incoming' | 'outgoing';

export type StreamingChannelStatus =
  | 'active'
  | 'closing'
  | 'disputed'
  | 'closed';

/**
 * Raw on-chain streaming channel state as returned by the Soroban contract.
 * All amounts are expressed in the token's smallest unit (stroops).
 */
export interface StreamingChannelState {
  channelId: string;
  direction: StreamingChannelDirection;
  counterparty: string;
  /** Unix timestamp (seconds) of the last reconciled ledger. */
  lastLedgerTimestamp: number;
  /** Flow rate in stroops per second. */
  ratePerSecond: bigint;
  /** Amount already claimed/settled by the counterparty. */
  claimedAmount: bigint;
  /** Maximum funded deposit backing this channel. */
  depositCap: bigint;
  /** Off-chain signed state sequence number (latest known). */
  sequenceNumber: bigint;
  status: StreamingChannelStatus;
  /** Optional human-readable asset symbol (e.g. "USDC", "kWh"). */
  assetSymbol?: string;
}

export interface StreamingChannelSnapshot {
  channelId: string;
  /** Accrued amount at the moment of the snapshot (clamped to deposit). */
  accrued: bigint;
  /** Remaining funded balance (deposit - accrued), never negative. */
  remaining: bigint;
  /** Milliseconds of runway left at the current rate. */
  runwayMs: number;
  /** Whether remaining runway is below the configured warning threshold. */
  isRunwayLow: boolean;
  /** Whether the channel has fully depleted its funded deposit. */
  isDepleted: boolean;
  /** Wall-clock timestamp (ms) used for this snapshot. */
  atMs: number;
}

export interface UseStreamingChannelOptions {
  /** Override the reconciliation interval (ms). Defaults to 15s. */
  reconcileIntervalMs?: number;
  /** Runway warning threshold in ms. Defaults to 24h. */
  runwayWarningMs?: number;
  /** Optional fetcher used to reconcile against Soroban ledger state. */
  fetchChannelState?: (
    channelId: string,
  ) => Promise<StreamingChannelState | null>;
  /** Whether the hook should actively reconcile. Defaults to true. */
  enabled?: boolean;
}

export interface UseStreamingChannelResult {
  /** Latest reconciled on-chain state (null until first fetch). */
  state: StreamingChannelState | null;
  /** Live snapshot recomputed on each animation frame. */
  snapshot: StreamingChannelSnapshot | null;
  /** True while a reconciliation fetch is in flight. */
  isReconciling: boolean;
  /** Last reconciliation error, if any. */
  error: Error | null;
  /** True when the animation loop is paused due to tab visibility. */
  isPaused: boolean;
  /** Manually trigger a reconciliation against the ledger. */
  reconcile: () => Promise<void>;
  /** Force a synchronous snapshot recompute (useful after mutations). */
  refreshSnapshot: () => void;
}

/**
 * Clamp an accrued amount strictly to the channel's funded deposit.
 * Returns `min(accrued, deposit)` and never a negative value.
 */
export function clampAccrued(accrued: bigint, depositCap: bigint): bigint {
  if (accrued < 0n) return 0n;
  if (depositCap < 0n) return 0n;
  return accrued > depositCap ? depositCap : accrued;
}

/**
 * Compute the accrued amount at a given wall-clock time using BigInt
 * fixed-point arithmetic.
 *
 * accrued = claimed + floor(rate * elapsedSeconds)
 *
 * The result is clamped to `min(accrued, depositCap)` so the UI never
 * displays unbacked funds.
 */
export function computeAccruedAt(
  state: Pick<
    StreamingChannelState,
    'lastLedgerTimestamp' | 'ratePerSecond' | 'claimedAmount' | 'depositCap'
  >,
  nowMs: number,
): bigint {
  const { lastLedgerTimestamp, ratePerSecond, claimedAmount, depositCap } =
    state;

  const nowSeconds = Math.floor(nowMs / 1000);
  const elapsedSeconds = Math.max(0, nowSeconds - lastLedgerTimestamp);

  // BigInt fixed-point: rate is stroops/second, elapsed is whole seconds.
  // Multiply in fixed-point space to keep precision on long streams.
  const elapsedFixed = BigInt(elapsedSeconds) * FIXED_POINT_SCALE;
  const streamedFixed = (ratePerSecond * elapsedFixed) / FIXED_POINT_SCALE;

  const accrued = claimedAmount + streamedFixed;
  return clampAccrued(accrued, depositCap);
}

/**
 * Compute the remaining runway in milliseconds given a state and the
 * current accrued amount. Returns `Number.POSITIVE_INFINITY` when the
 * rate is zero (no depletion) and `0` when already depleted.
 */
export function computeRunwayMs(
  state: Pick<StreamingChannelState, 'ratePerSecond' | 'depositCap'>,
  accrued: bigint,
): number {
  const { ratePerSecond, depositCap } = state;
  if (ratePerSecond <= 0n) return Number.POSITIVE_INFINITY;

  const remaining = depositCap > accrued ? depositCap - accrued : 0n;
  if (remaining === 0n) return 0;

  // remaining (stroops) / rate (stroops/sec) = seconds, scaled to ms.
  const remainingMsFixed =
    (remaining * FIXED_POINT_SCALE * 1000n) / ratePerSecond;
  const remainingMs = Number(remainingMsFixed / FIXED_POINT_SCALE);

  return Number.isFinite(remainingMs) ? remainingMs : Number.POSITIVE_INFINITY;
}

/**
 * Build a full snapshot from a state and a wall-clock timestamp.
 */
export function buildSnapshot(
  state: StreamingChannelState,
  nowMs: number,
  runwayWarningMs: number,
): StreamingChannelSnapshot {
  const accrued = computeAccruedAt(state, nowMs);
  const remaining = state.depositCap > accrued ? state.depositCap - accrued : 0n;
  const runwayMs = computeRunwayMs(state, accrued);
  const isDepleted = remaining === 0n;
  const isRunwayLow = !isDepleted && runwayMs < runwayWarningMs;

  return {
    channelId: state.channelId,
    accrued,
    remaining,
    runwayMs,
    isRunwayLow,
    isDepleted,
    atMs: nowMs,
  };
}

function isDocumentHidden(): boolean {
  if (typeof document === 'undefined') return false;
  return document.visibilityState === 'hidden';
}

/**
 * Hook that tracks a single streaming payment channel, interpolating the
 * accrued amount smoothly via requestAnimationFrame and reconciling against
 * the actual Soroban ledger state every 15 seconds.
 *
 * - All interpolation uses BigInt fixed-point math.
 * - Displayed values are clamped to `min(accrued, depositCap)`.
 * - The animation loop pauses when the tab is hidden.
 */
export function useStreamingChannel(
  channelId: string | null | undefined,
  options: UseStreamingChannelOptions = {},
): UseStreamingChannelResult {
  const {
    reconcileIntervalMs = RECONCILE_INTERVAL_MS,
    runwayWarningMs = DEFAULT_RUNWAY_WARNING_MS,
    fetchChannelState,
    enabled = true,
  } = options;

  const [state, setState] = useState<StreamingChannelState | null>(null);
  const [snapshot, setSnapshot] = useState<StreamingChannelSnapshot | null>(
    null,
  );
  const [isReconciling, setIsReconciling] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [isPaused, setIsPaused] = useState<boolean>(() => isDocumentHidden());

  const stateRef = useRef<StreamingChannelState | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameRef = useRef<number>(0);
  const mountedRef = useRef<boolean>(true);

  // Keep the ref in sync with the latest reconciled state.
  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const recomputeSnapshot = useCallback(() => {
    const current = stateRef.current;
    if (!current) {
      setSnapshot(null);
      return;
    }
    setSnapshot(buildSnapshot(current, Date.now(), runwayWarningMs));
  }, [runwayWarningMs]);

  const reconcile = useCallback(async () => {
    if (!channelId || !fetchChannelState) return;
    setIsReconciling(true);
    setError(null);
    try {
      const next = await fetchChannelState(channelId);
      if (!mountedRef.current) return;
      if (next) {
        stateRef.current = next;
        setState(next);
        setSnapshot(buildSnapshot(next, Date.now(), runwayWarningMs));
      }
    } catch (err) {
      if (!mountedRef.current) return;
      setError(err instanceof Error ? err : new Error(String(err)));
    } finally {
      if (mountedRef.current) setIsReconciling(false);
    }
  }, [channelId, fetchChannelState, runwayWarningMs]);

  // Initial fetch + periodic reconciliation against the ledger.
  useEffect(() => {
    if (!enabled || !channelId) return;

    void reconcile();
    const interval = setInterval(() => {
      void reconcile();
    }, reconcileIntervalMs);

    return () => clearInterval(interval);
  }, [enabled, channelId, reconcile, reconcileIntervalMs]);

  // Tab visibility handling: pause the animation loop when hidden.
  useEffect(() => {
    if (typeof document === 'undefined') return;

    const handleVisibility = () => {
      const hidden = isDocumentHidden();
      setIsPaused(hidden);
      if (!hidden) {
        // Recompute immediately on resume so the display snaps forward.
        recomputeSnapshot();
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [recomputeSnapshot]);

  // requestAnimationFrame-driven interpolation loop.
  useEffect(() => {
    mountedRef.current = true;

    const tick = (now: number) => {
      if (!mountedRef.current) return;

      const current = stateRef.current;
      if (current && !isPaused) {
        if (now - lastFrameRef.current >= FRAME_INTERVAL_MS) {
          lastFrameRef.current = now;
          setSnapshot(buildSnapshot(current, Date.now(), runwayWarningMs));
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };

    if (typeof requestAnimationFrame !== 'undefined' && !isPaused) {
      rafRef.current = requestAnimationFrame(tick);
    }

    return () => {
      mountedRef.current = false;
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
  }, [isPaused, runwayWarningMs]);

  const refreshSnapshot = useCallback(() => {
    recomputeSnapshot();
  }, [recomputeSnapshot]);

  return useMemo(
    () => ({
      state,
      snapshot,
      isReconciling,
      error,
      isPaused,
      reconcile,
      refreshSnapshot,
    }),
    [state, snapshot, isReconciling, error, isPaused, reconcile, refreshSnapshot],
  );
}

export default useStreamingChannel;