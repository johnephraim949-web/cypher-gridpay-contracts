/**
 * LiveStreamCounter
 *
 * Real-time streaming micro-payment channel card.
 *
 * i18n / RTL changes (issue #424):
 *   - Physical margin/padding → logical equivalents (marginInlineStart/End,
 *     paddingInlineStart/End, paddingBlock, insetInlineStart/End).
 *   - Flow direction arrow ⟶ is a directional icon — mirrored in RTL.
 *   - Channel ID and USDC amounts wrapped in dir="ltr" bidi-isolate spans.
 *   - formatFlowRate, formatKwhRate, formatRunwayHours from formatAmount.ts.
 *   - textAlign: 'start'/'end' replaces 'left'/'right'.
 *
 * Spec: docs/ux/streaming-channels-ux.md
 * Issue: #416 / #424
 */

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  formatFlowRate,
  formatKwhRate,
  formatPaymentAmount,
  formatRunwayHours,
} from '../../utils/formatAmount';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const REDUCED_MOTION_TICK_MS = 1500;

/** Interval at which the interpolated value is reconciled with on-chain state. */
const RECONCILE_INTERVAL_MS = 15_000;

/** Fixed-point scale for BigInt interpolation (7 decimal places, Stellar stroop-like). */
const FIXED_POINT_SCALE = 10_000_000n;
const FIXED_POINT_SCALE_NUM = 10_000_000;

/** Channel accent palette (color-blind safe Okabe-Ito). */
const COLOR = {
  accent:    '#0072B2',
  accrued:   '#56B4E9',
  remaining: '#A9C7E0',
  amberStart:'#F0E442',
  amberEnd:  '#E69F00',
  red:       '#D55E00',
  amberText: '#5A4400',
  axis:      '#5A6478',
  empty:     '#8A93A6',
  cardBg:    '#FFFFFF',
  border:    'rgba(0,0,0,0.1)',
  divider:   'rgba(0,0,0,0.08)',
} as const;

const MONO_STACK = 'ui-monospace, "SF Mono", "Cascadia Mono", "Roboto Mono", Menlo, Consolas, monospace';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ChannelStatus = 'live' | 'paused' | 'depleted' | 'closed';

export interface LiveStreamCounterProps {
  channelId: string;
  channelLabel: string;
  flowRateUsdcPerMin: number;
  kwhPerUsdc?: number;
  totalDeposit: number;
  claimed: number;
  accrued: number;
  /**
   * Ledger timestamp (ms since epoch) at which `accrued` was last observed
   * on-chain. Used as the interpolation anchor. Defaults to mount time.
   */
  lastLedgerTimestamp?: number;
  /**
   * Optional explicit per-second rate (USDC). When omitted it is derived from
   * `flowRateUsdcPerMin`. Prefer passing the on-chain rate for accuracy.
   */
  ratePerSecond?: number;
  /**
   * Maximum funded deposit (USDC) used to clamp interpolated display values.
   * Defaults to `totalDeposit`.
   */
  depositCap?: number;
  /**
   * Called every 15s to fetch fresh on-chain state for reconciliation.
   * Should resolve to the latest observed values.
   */
  onReconcile?: () => Promise<{
    accrued: number;
    claimed: number;
    lastLedgerTimestamp: number;
  }> | void;
  /** Current channel status */
  status?: ChannelStatus;
  onTopUp?: (amountUsdc: number) => void | Promise<void>;
  onMutualClose?: () => void;
  onUnilateralClose?: () => void;
  counterpartyResponsive?: boolean;
  forceReducedMotion?: boolean;
  /** BCP 47 locale for number formatting */
  locale?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type RunwayState = 'neutral' | 'amber' | 'red' | 'depleted' | 'paused';

function computeRunwayHours(remaining: number, flowRatePerMin: number): number {
  if (flowRatePerMin <= 0) return Infinity;
  return remaining / (flowRatePerMin * 60);
}

function runwayStateInfo(hours: number, status: ChannelStatus): { state: RunwayState; label: string; color: string; textColor: string } {
  if (status === 'paused' && hours === Infinity) return { state: 'paused',   label: 'Paused — no depletion while idle', color: COLOR.axis,       textColor: '#fff' };
  if (hours <= 0 || status === 'depleted')       return { state: 'depleted', label: 'Depleted — Top up to resume',      color: COLOR.red,        textColor: '#fff' };
  if (hours <= 4)  return { state: 'red',    label: 'red < 4h',    color: COLOR.red,        textColor: '#fff' };
  if (hours <= 24) return { state: 'amber',  label: 'amber < 24h', color: COLOR.amberStart, textColor: COLOR.amberText };
  return { state: 'neutral', label: 'Healthy', color: COLOR.accent, textColor: '#fff' };
}

// ---------------------------------------------------------------------------
// BigInt fixed-point interpolation
// ---------------------------------------------------------------------------

/** Convert a USDC number to scaled BigInt fixed-point. */
export function toFixedPoint(usdc: number): bigint {
  if (!Number.isFinite(usdc) || usdc <= 0) return 0n;
  return BigInt(Math.round(usdc * FIXED_POINT_SCALE_NUM));
}

/** Convert scaled BigInt fixed-point back to a USDC number. */
export function fromFixedPoint(fp: bigint): number {
  return Number(fp) / FIXED_POINT_SCALE_NUM;
}

/**
 * Compute the interpolated accrued amount in scaled fixed-point.
 *
 * accrued = anchorAccrued + ratePerSecond * elapsedSeconds
 * clamped to [0, depositCap].
 *
 * All arithmetic is BigInt to avoid floating-point drift on long streams.
 */
export function interpolateAccruedFixedPoint(params: {
  anchorAccrued: number;
  ratePerSecond: number;
  elapsedMs: number;
  depositCap: number;
}): bigint {
  const { anchorAccrued, ratePerSecond, elapsedMs, depositCap } = params;
  const anchorFp = toFixedPoint(anchorAccrued);
  const rateFp = toFixedPoint(ratePerSecond);
  const capFp = toFixedPoint(depositCap);

  if (elapsedMs <= 0 || rateFp <= 0n) {
    return anchorFp > capFp ? capFp : anchorFp;
  }

  // elapsedMs is integer ms; multiply rate (per second) by ms then divide by 1000.
  const elapsedMsBig = BigInt(Math.max(0, Math.floor(elapsedMs)));
  const deltaFp = (rateFp * elapsedMsBig) / 1000n;
  const raw = anchorFp + deltaFp;

  if (raw < 0n) return 0n;
  if (raw > capFp) return capFp;
  return raw;
}

/** Clamp a scaled fixed-point value to [0, depositCap]. */
export function clampToDeposit(valueFp: bigint, depositCap: number): bigint {
  const capFp = toFixedPoint(depositCap);
  if (valueFp < 0n) return 0n;
  if (valueFp > capFp) return capFp;
  return valueFp;
}

// ---------------------------------------------------------------------------
// Live ticker hook
// ---------------------------------------------------------------------------

function useLiveAccrual(baseAccrued: number, flowRatePerMin: number, status: ChannelStatus, reducedMotion: boolean): number {
/**
 * Continuously advances the `accrued` value based on the flow rate.
 *
 * Interpolation is anchored to `(lastLedgerTimestamp, anchorAccrued)` and
 * computed with BigInt fixed-point math, then clamped to `depositCap`.
 *
 * - Uses requestAnimationFrame when motion is allowed.
 * - Uses a 1.5s setInterval when reduced motion is active.
 * - Pauses the loop entirely when `document.visibilityState === 'hidden'`.
 * - Reconciles with on-chain state every 15s via `onReconcile`.
 */
function useLiveAccrual(
  baseAccrued: number,
  ratePerSecond: number,
  status: ChannelStatus,
  reducedMotion: boolean,
  depositCap: number,
  lastLedgerTimestamp: number,
  onReconcile?: LiveStreamCounterProps['onReconcile'],
): number {
  const [accrued, setAccrued] = useState(baseAccrued);

  useEffect(() => { setAccrued(baseAccrued); lastTsRef.current = null; }, [baseAccrued]);
  // Anchor state — mutated by reconciliation and prop changes.
  const anchorAccruedRef = useRef<number>(baseAccrued);
  const anchorTsRef = useRef<number>(lastLedgerTimestamp);
  const depositCapRef = useRef<number>(depositCap);
  const rateRef = useRef<number>(ratePerSecond);
  const onReconcileRef = useRef(onReconcile);

  useEffect(() => {
    onReconcileRef.current = onReconcile;
  }, [onReconcile]);

  // Re-anchor when the on-chain base value / timestamp changes.
  useEffect(() => {
    anchorAccruedRef.current = baseAccrued;
    anchorTsRef.current = lastLedgerTimestamp;
    depositCapRef.current = depositCap;
    rateRef.current = ratePerSecond;
    setAccrued(baseAccrued);
  }, [baseAccrued, lastLedgerTimestamp, depositCap, ratePerSecond]);

  // Visibility tracking — pause animation when tab is hidden.
  const [hidden, setHidden] = useState<boolean>(
    typeof document !== 'undefined' && document.visibilityState === 'hidden',
  );
  useEffect(() => {
    if (status !== 'live' || flowRatePerMin <= 0) return;
    if (reducedMotion) {
      const id = setInterval(() => { setAccrued((prev) => prev + (flowRatePerMin / 60) * (REDUCED_MOTION_TICK_MS / 1000)); }, REDUCED_MOTION_TICK_MS);
    if (typeof document === 'undefined') return;
    const handler = () => {
      const isHidden = document.visibilityState === 'hidden';
      setHidden(isHidden);
      if (!isHidden) {
        // Re-anchor to now so we don't "catch up" for the hidden period.
        anchorAccruedRef.current = fromFixedPoint(
          clampToDeposit(
            interpolateAccruedFixedPoint({
              anchorAccrued: anchorAccruedRef.current,
              ratePerSecond: rateRef.current,
              elapsedMs: Date.now() - anchorTsRef.current,
              depositCap: depositCapRef.current,
            }),
            depositCapRef.current,
          ),
        );
        anchorTsRef.current = Date.now();
      }
    };
    document.addEventListener('visibilitychange', handler);
    return () => document.removeEventListener('visibilitychange', handler);
  }, []);

  // Animation loop.
  useEffect(() => {
    if (status !== 'live' || ratePerSecond <= 0 || hidden) return;

    const compute = () => {
      const elapsedMs = Date.now() - anchorTsRef.current;
      const fp = interpolateAccruedFixedPoint({
        anchorAccrued: anchorAccruedRef.current,
        ratePerSecond: rateRef.current,
        elapsedMs,
        depositCap: depositCapRef.current,
      });
      return fromFixedPoint(clampToDeposit(fp, depositCapRef.current));
    };

    if (reducedMotion) {
      const id = setInterval(() => {
        setAccrued(compute());
      }, REDUCED_MOTION_TICK_MS);
      return () => clearInterval(id);
    }
    let raf = 0;
    const step = (ts: number) => {
      if (lastTsRef.current === null) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      setAccrued((prev) => prev + (flowRatePerMin / 60) * dt);
    const step = () => {
      setAccrued(compute());
      raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [ratePerSecond, status, reducedMotion, hidden]);

  // Reconcile with on-chain state every 15s.
  useEffect(() => {
    if (!onReconcileRef.current) return;
    const id = setInterval(async () => {
      try {
        const next = await onReconcileRef.current?.();
        if (!next) return;
        anchorAccruedRef.current = next.accrued;
        anchorTsRef.current = next.lastLedgerTimestamp;
        setAccrued(next.accrued);
      } catch {
        // Reconciliation failures are non-fatal; keep interpolating.
      }
    }, RECONCILE_INTERVAL_MS);
    return () => clearInterval(id);
  }, []);

  return accrued;
}

// ---------------------------------------------------------------------------
// Flow rate badge
// ---------------------------------------------------------------------------

interface FlowRateBadgeProps {
  flowRateUsdcPerMin: number;
  kwhPerUsdc: number;
  status: ChannelStatus;
  reducedMotion: boolean;
  locale: string;
  /** dir of the surrounding document — flow arrow mirrors in RTL */
  dir?: 'ltr' | 'rtl';
}

function FlowRateBadge({ flowRateUsdcPerMin, kwhPerUsdc, status, reducedMotion, locale, dir = 'ltr' }: FlowRateBadgeProps) {
  const isLive     = status === 'live';
  const isPaused   = status === 'paused';
  const isDepleted = status === 'depleted';

  const rateText = isPaused   ? '⏸ Paused'
    : isDepleted ? '0.0000 USDC/min'
    : formatFlowRate(flowRateUsdcPerMin, locale);

  const kwhText = (isPaused || isDepleted)
    ? '0.0 kWh/hr'
    : formatKwhRate(flowRateUsdcPerMin * 60 * kwhPerUsdc, locale);

  return (
    <div role="status"
      aria-label={isLive
        ? `Streaming at ${formatFlowRate(flowRateUsdcPerMin, locale)}, approximately ${formatKwhRate(flowRateUsdcPerMin * 60 * kwhPerUsdc, locale)}.`
        : isPaused ? 'Stream paused.' : 'Stream depleted.'}
      style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 14 }}>
      {/* ⟶ is a directional flow arrow — mirrored in RTL */}
      <span aria-hidden="true" style={{ fontSize: 16, color: isLive ? COLOR.accent : COLOR.empty, display: 'inline-block', transform: dir === 'rtl' ? 'scaleX(-1)' : undefined }}>
        ⟶
      </span>

      <span dir="ltr" style={{ unicodeBidi: 'isolate', fontFamily: MONO_STACK, fontVariantNumeric: 'tabular-nums', textAlign: 'end', minWidth: '12ch', display: 'inline-block', whiteSpace: 'pre', color: isLive ? '#1C2333' : COLOR.empty, fontWeight: 600 }}>
        {rateText}
      </span>
      <span style={{ color: COLOR.axis }}>·</span>
      <span dir="ltr" style={{ unicodeBidi: 'isolate', fontFamily: MONO_STACK, fontVariantNumeric: 'tabular-nums', textAlign: 'end', minWidth: '10ch', display: 'inline-block', whiteSpace: 'pre', color: isLive ? '#1C2333' : COLOR.empty }}>
        {kwhText}
      </span>

      <span aria-hidden="true" style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginInlineStart: 'auto', fontSize: 12, fontWeight: 600, color: isLive ? COLOR.accent : isPaused ? COLOR.empty : COLOR.red }}>
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: isLive ? COLOR.accent : isPaused ? COLOR.empty : COLOR.red, display: 'inline-block', ...(isLive && !reducedMotion ? { animation: 'ls-pulse 1.6s ease-in-out infinite' } : {}) }} />
        {isLive ? 'Live' : isPaused ? 'Paused' : 'Depleted'}
      </span>
      <style>{`@keyframes ls-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Progress bar
// ---------------------------------------------------------------------------

interface ProgressBarProps { totalDeposit: number; claimed: number; accrued: number; reducedMotion: boolean; locale: string; }

function ProgressBar({ totalDeposit, claimed, accrued, reducedMotion, locale }: ProgressBarProps) {
  const safeTotal   = totalDeposit > 0 ? totalDeposit : 1;
  const claimedPct  = Math.min(100, (claimed  / safeTotal) * 100);
  const accruedPct  = Math.min(100 - claimedPct, (accrued / safeTotal) * 100);
  const remainingPct = Math.max(0, 100 - claimedPct - accruedPct);
  const remaining   = Math.max(0, totalDeposit - claimed - accrued);

  return (
    <div>
      <div role="progressbar" aria-valuenow={Math.round(accruedPct + claimedPct)} aria-valuemin={0} aria-valuemax={100}
        aria-label={`Streaming progress: claimed ${formatPaymentAmount(claimed, 'USDC', locale)}, accrued claimable now ${formatPaymentAmount(accrued, 'USDC', locale)}, remaining buffer ${formatPaymentAmount(remaining, 'USDC', locale)}.`}
        style={{ position: 'relative', height: 22, borderRadius: 4, background: '#EEF0F4', overflow: 'hidden', marginBlockEnd: 4 }}>
        <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, height: '100%', width: `${claimedPct}%`, background: COLOR.accent, transition: reducedMotion ? 'width 200ms ease' : 'width 100ms linear' }} />
        <div style={{ position: 'absolute', insetInlineStart: `${claimedPct}%`, top: 0, height: '100%', width: `${accruedPct}%`, background: `repeating-linear-gradient(135deg, ${COLOR.accrued}, ${COLOR.accrued} 4px, ${COLOR.accent} 4px, ${COLOR.accent} 6px)`, opacity: 0.85, transition: reducedMotion ? 'width 200ms ease, left 200ms ease' : 'width 100ms linear, left 100ms linear' }} />
      </div>

      <div aria-hidden="true" style={{ position: 'relative', height: 8, borderRadius: 3, background: '#EEF0F4', overflow: 'hidden', marginBlockStart: 2 }}>
        <div style={{ position: 'absolute', insetInlineStart: 0, top: 0, height: '100%', width: `${remainingPct}%`, background: `repeating-linear-gradient(90deg, ${COLOR.remaining}, ${COLOR.remaining} 3px, transparent 3px, transparent 6px)`, transition: reducedMotion ? 'width 200ms ease' : 'width 100ms linear' }} />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginBlockStart: 6, fontSize: 12, color: COLOR.axis }}>
        <SegmentLabel color={COLOR.accent}    label="Claimed"       value={formatPaymentAmount(claimed,   'USDC', locale)} />
        <SegmentLabel color={COLOR.accrued}   label="Accrued (now)" value={formatPaymentAmount(accrued,   'USDC', locale)} />
        <SegmentLabel color={COLOR.remaining} label="Remaining"     value={formatPaymentAmount(remaining, 'USDC', locale)} />
      </div>
    </div>
  );
}

function SegmentLabel({ color, label, value }: { color: string; label: string; value: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5 }}>
      <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 2, background: color, display: 'inline-block' }} />
      <span>{label}</span>
      {/* Amount is always LTR numeric */}
      <span dir="ltr" style={{ unicodeBidi: 'isolate', fontFamily: MONO_STACK, fontVariantNumeric: 'tabular-nums', textAlign: 'end', minWidth: '7ch', display: 'inline-block', whiteSpace: 'pre', color: '#1C2333', fontWeight: 600 }}>
        {value}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Runway indicator
// ---------------------------------------------------------------------------

interface RunwayIndicatorProps { runwayHours: number; state: RunwayState; label: string; color: string; textColor: string; reducedMotion: boolean; }

function RunwayIndicator({ runwayHours, state, label, color, textColor, reducedMotion }: RunwayIndicatorProps) {
  const showPulse = state === 'red' && !reducedMotion;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBlockStart: 14 }}>
      <span aria-hidden="true" style={{ fontSize: 15, color: COLOR.axis }}>⏱</span>
      <span style={{ fontSize: 13, color: COLOR.axis }}>Runway:</span>
      <span aria-live="polite" role="img" aria-label={`Runway ${formatRunwayHours(runwayHours)}, state ${label}`}
        dir="ltr" style={{ unicodeBidi: 'isolate', fontFamily: MONO_STACK, fontVariantNumeric: 'tabular-nums', textAlign: 'end', minWidth: '9ch', display: 'inline-block', whiteSpace: 'pre', fontWeight: 600, color: state === 'neutral' || state === 'paused' ? '#1C2333' : color }}>
        {formatRunwayHours(runwayHours)}
      </span>
      <span role="img" aria-label={label}
        style={{ fontSize: 12, fontWeight: 600, paddingBlock: 2, paddingInline: 8, borderRadius: 999, background: color, color: textColor, transition: 'background 400ms ease, color 400ms ease', ...(showPulse ? { animation: 'ls-runway-pulse 2s ease-in-out infinite' } : {}) }}>
        {label}
      </span>
      {showPulse && <style>{`@keyframes ls-runway-pulse { 0%, 100% { box-shadow: 0 0 0 0 rgba(213, 94, 0, 0.4); } 50% { box-shadow: 0 0 0 4px rgba(213, 94, 0, 0); } }`}</style>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quick top-up pill
// ---------------------------------------------------------------------------

const PRESETS = [10, 50];

interface TopUpPillProps { onTopUp: (amount: number) => void; reducedMotion: boolean; emphasized: boolean; locale: string; }

function TopUpPill({ onTopUp, reducedMotion, emphasized, locale }: TopUpPillProps) {
  const [customOpen, setCustomOpen] = useState(false);
  const [customVal, setCustomVal]   = useState('');
  const [successKey, setSuccessKey] = useState<number | null>(null);
  const [error, setError]           = useState<string | null>(null);
  const [shake, setShake]           = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!customOpen) return;
    const onClick = (e: MouseEvent) => { if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) setCustomOpen(false); };
    const onKey   = (e: KeyboardEvent) => { if (e.key === 'Escape') setCustomOpen(false); };
    document.addEventListener('mousedown', onClick);
    document.addEventListener('keydown',   onKey);
    return () => { document.removeEventListener('mousedown', onClick); document.removeEventListener('keydown', onKey); };
  }, [customOpen]);

  const handlePreset = async (amount: number) => {
    try {
      await onTopUp(amount);
      setError(null); setSuccessKey(amount);
      setTimeout(() => setSuccessKey(null), reducedMotion ? 1500 : 1200);
    } catch {
      setError('Insufficient balance for top-up.');
      if (!reducedMotion) { setShake(true); setTimeout(() => setShake(false), 200); }
    }
  };

  const handleCustomConfirm = async () => {
    const amount = parseFloat(customVal);
    if (Number.isNaN(amount) || amount <= 0) { setError('Enter a valid amount.'); return; }
    try {
      await onTopUp(amount);
      setError(null); setSuccessKey(amount);
      setTimeout(() => setSuccessKey(null), reducedMotion ? 1500 : 1200);
      setCustomOpen(false); setCustomVal('');
    } catch {
      setError('Insufficient balance for top-up.');
      if (!reducedMotion) { setShake(true); setTimeout(() => setShake(false), 200); }
    }
  };

  const pillStyle = (isPrimary: boolean): React.CSSProperties => ({ paddingBlock: 4, paddingInline: 12, fontSize: 12, fontWeight: 600, border: `1px solid ${isPrimary ? COLOR.accent : 'rgba(0,0,0,0.18)'}`, borderRadius: 999, background: isPrimary ? COLOR.accent : '#f5f5f5', color: isPrimary ? '#fff' : '#333', cursor: 'pointer', transition: 'background 150ms ease' });

  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
      {PRESETS.map((amount) => (
        <button key={amount} aria-label={`Top up ${formatPaymentAmount(amount, 'USDC', locale)}`}
          onClick={() => handlePreset(amount)}
          style={{ ...pillStyle(emphasized), display: 'inline-flex', alignItems: 'center', gap: 4, animation: shake && !reducedMotion ? 'ls-shake 200ms ease' : undefined }}>
          {successKey === amount ? '✓' : `+${amount} USDC`}
        </button>
      ))}

      <div ref={popoverRef} style={{ position: 'relative', display: 'inline-block' }}>
        <button aria-label="Custom top-up amount" aria-expanded={customOpen} onClick={() => setCustomOpen((v) => !v)}
          style={{ ...pillStyle(false), display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          Custom ▾
        </button>
        {customOpen && (
          <div role="dialog" aria-label="Custom top-up"
            style={{ position: 'absolute', top: '100%', insetInlineStart: 0, marginBlockStart: 4, background: '#fff', border: `1px solid ${COLOR.border}`, borderRadius: 6, paddingBlock: 10, paddingInline: 10, boxShadow: '0 4px 16px rgba(0,0,0,0.16)', zIndex: 20, display: 'flex', flexDirection: 'column', gap: 8, minWidth: 160 }}>
            <label style={{ fontSize: 12, color: COLOR.axis }}>Amount</label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input type="number" inputMode="decimal" autoFocus value={customVal} onChange={(e) => setCustomVal(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') handleCustomConfirm(); }} placeholder="0.00"
                style={{ fontFamily: MONO_STACK, fontVariantNumeric: 'tabular-nums', textAlign: 'end', minWidth: '7ch', paddingBlock: 4, paddingInline: 8, border: `1px solid ${COLOR.border}`, borderRadius: 4, fontSize: 13 }} />
              <span style={{ fontSize: 12, color: COLOR.axis }}>USDC</span>
            </div>
            <button onClick={handleCustomConfirm} style={{ paddingBlock: 4, paddingInline: 12, fontSize: 12, fontWeight: 600, border: `1px solid ${COLOR.accent}`, borderRadius: 4, background: COLOR.accent, color: '#fff', cursor: 'pointer' }}>
              Confirm Top-Up
            </button>
          </div>
        )}
      </div>

      {error && <span role="alert" style={{ fontSize: 12, color: COLOR.red, marginInlineStart: 4 }}>{error}</span>}
      {!reducedMotion && shake && <style>{`@keyframes ls-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }`}</style>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Flow animation divider
// ---------------------------------------------------------------------------

function FlowDivider({ status, reducedMotion }: { status: ChannelStatus; reducedMotion: boolean }) {
  if (reducedMotion || status !== 'live') {
    return <div aria-hidden="true" style={{ height: 2, background: `linear-gradient(90deg, transparent, ${COLOR.accent}, transparent)`, opacity: 0.4 }} />;
  }
  return (
    <div aria-hidden="true" style={{ position: 'relative', height: 2, background: COLOR.divider, overflow: 'hidden' }}>
      <div style={{ position: 'absolute', top: 0, insetInlineStart: '-40%', width: '40%', height: '100%', background: `linear-gradient(90deg, transparent, ${COLOR.accent}, transparent)`, animation: 'ls-flow 2.4s linear infinite' }} />
      <style>{`@keyframes ls-flow { from { inset-inline-start: -40%; } to { inset-inline-start: 100%; } }`}</style>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Close comparison sheet
// ---------------------------------------------------------------------------

interface CloseComparisonProps { onMutualClose?: () => void; onUnilateralClose?: () => void; counterpartyResponsive: boolean; }

function CloseComparison({ onMutualClose, onUnilateralClose, counterpartyResponsive }: CloseComparisonProps) {
  const rows = [
    { mutual: '✓ Instant settlement',    unilateral: '⏳ Challenge window delay' },
    { mutual: '✓ Both parties sign',      unilateral: '◐ One party initiates' },
    { mutual: '✓ No on-chain dispute',    unilateral: '▲ Dispute may be raised' },
    { mutual: '✓ Lowest gas',            unilateral: '⚠ Higher gas + timeout' },
  ];
  const thStyle: React.CSSProperties = { paddingBlock: 8, paddingInline: 12, textAlign: 'start', borderBlockEnd: '2px solid rgba(0,0,0,0.12)', fontSize: 13, fontWeight: 700, width: '50%' };
  const tdStyle: React.CSSProperties = { paddingBlock: 6, paddingInline: 12, verticalAlign: 'top' };

  return (
    <div style={{ marginBlockStart: 18 }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, tableLayout: 'fixed' }}>
        <caption style={{ textAlign: 'start', fontWeight: 600, marginBlockEnd: 8, fontSize: 14 }}>Close Path Comparison</caption>
        <thead>
          <tr>
            <th scope="col" style={{ ...thStyle, color: COLOR.accent }}>Mutual Close</th>
            <th scope="col" style={{ ...thStyle, color: COLOR.red }}>Unilateral Dispute Close</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} style={{ borderBlockEnd: '1px solid rgba(0,0,0,0.06)' }}>
              <td style={{ ...tdStyle, color: '#1C2333' }}>{r.mutual}</td>
              <td style={{ ...tdStyle, color: '#1C2333' }}>{r.unilateral}</td>
            </tr>
          ))}
          <tr>
            <td style={{ ...tdStyle, fontSize: 12, color: COLOR.axis }}>Result: funds settle in the next block.</td>
            <td style={{ ...tdStyle, fontSize: 12, color: COLOR.axis }}>Result: funds held in escrow until the challenge window (default 48h) ends.</td>
          </tr>
        </tbody>
      </table>

      <p style={{ fontSize: 12, color: COLOR.axis, margin: '8px 0 12px' }}>
        Mutual signatures settle instantly. Unilateral close enters a challenge window so the other party can dispute the final balance.
      </p>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button onClick={onMutualClose} disabled={!counterpartyResponsive}
          title={counterpartyResponsive ? 'Initiate mutual close with counterparty signature' : 'Counterparty signature pending'}
          style={{ paddingBlock: 8, paddingInline: 16, fontSize: 13, fontWeight: 600, border: `1px solid ${COLOR.accent}`, borderRadius: 6, background: counterpartyResponsive ? COLOR.accent : '#E5E9F0', color: counterpartyResponsive ? '#fff' : COLOR.empty, cursor: counterpartyResponsive ? 'pointer' : 'not-allowed' }}>
          Initiate Mutual Close
        </button>
        <button onClick={onUnilateralClose}
          style={{ paddingBlock: 8, paddingInline: 16, fontSize: 13, fontWeight: 600, border: `1px solid ${COLOR.red}`, borderRadius: 6, background: 'transparent', color: COLOR.red, cursor: 'pointer' }}>
          Initiate Unilateral →
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function LiveStreamCounter({
  channelId, channelLabel, flowRateUsdcPerMin, kwhPerUsdc = 4.96,
  totalDeposit, claimed, accrued: accruedProp, status = 'live',
  onTopUp, onMutualClose, onUnilateralClose, counterpartyResponsive = true,
  channelId,
  channelLabel,
  flowRateUsdcPerMin,
  kwhPerUsdc = 4.96, // example: ~5 kWh per USDC at standard tariff
  totalDeposit,
  claimed,
  accrued: accruedProp,
  lastLedgerTimestamp,
  ratePerSecond,
  depositCap,
  onReconcile,
  status = 'live',
  onTopUp,
  onMutualClose,
  onUnilateralClose,
  counterpartyResponsive = true,
  forceReducedMotion,
  locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US',
}: LiveStreamCounterProps) {
  const [mqReduced, setMqReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setMqReduced(mq.matches);
    const handler = (e: MediaQueryListEvent) => setMqReduced(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);
  const reducedMotion = forceReducedMotion ?? mqReduced;

  // Detect document direction for mirroring directional icons
  const [docDir, setDocDir] = useState<'ltr' | 'rtl'>('ltr');
  useEffect(() => {
    const dir = document.documentElement.getAttribute('dir') ?? 'ltr';
    setDocDir(dir === 'rtl' ? 'rtl' : 'ltr');
  }, []);

  const liveAccrued = useLiveAccrual(accruedProp, flowRateUsdcPerMin, status, reducedMotion);
  // Resolve interpolation inputs.
  const mountTsRef = useRef<number>(Date.now());
  const anchorTs = lastLedgerTimestamp ?? mountTsRef.current;
  const effectiveRatePerSecond =
    ratePerSecond !== undefined ? ratePerSecond : flowRateUsdcPerMin / 60;
  const effectiveDepositCap =
    depositCap !== undefined ? depositCap : totalDeposit;

  // Live accrued value (BigInt fixed-point interpolation, clamped to deposit cap)
  const liveAccrued = useLiveAccrual(
    accruedProp,
    effectiveRatePerSecond,
    status,
    reducedMotion,
    effectiveDepositCap,
    anchorTs,
    onReconcile,
  );

  // Clamp accrued so it never exceeds remaining buffer (min(accrued, deposit))
  const cappedAccrued = Math.min(liveAccrued, Math.max(0, totalDeposit - claimed));
  const remaining     = Math.max(0, totalDeposit - claimed - cappedAccrued);

  const runwayHours  = useMemo(() => computeRunwayHours(remaining, flowRateUsdcPerMin), [remaining, flowRateUsdcPerMin]);
  const runway       = runwayStateInfo(runwayHours, status);

  const isDepleted      = status === 'depleted' || (totalDeposit > 0 && claimed + cappedAccrued >= totalDeposit);
  const effectiveStatus: ChannelStatus = isDepleted ? 'depleted' : status;
  const showTopUp       = effectiveStatus !== 'closed';

  return (
    <div style={{ background: COLOR.cardBg, border: `1px solid ${COLOR.border}`, borderRadius: 10, overflow: 'hidden', fontFamily: 'system-ui, sans-serif', maxWidth: 640 }}>
      {/* Header */}
      <div style={{ paddingBlockStart: 12, paddingInline: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBlockEnd: 10 }}>
          <h2 style={{ margin: 0, fontSize: 15, fontWeight: 600 }}>
            <span aria-hidden="true" style={{ color: COLOR.accent, marginInlineEnd: 6 }}>◌</span>
            {/* Channel ID always LTR */}
            Channel{' '}
            <span dir="ltr" style={{ unicodeBidi: 'isolate' }}>#{channelId}</span>
            {' '}·{' '}{channelLabel}
          </h2>
          <button aria-label="Channel actions menu" style={{ background: 'none', border: 'none', fontSize: 16, cursor: 'pointer', color: COLOR.axis, paddingBlock: 2, paddingInline: 6 }}>⋯</button>
        </div>

        <FlowDivider status={effectiveStatus} reducedMotion={reducedMotion} />

        <div style={{ paddingBlock: 12 }}>
          <FlowRateBadge flowRateUsdcPerMin={flowRateUsdcPerMin} kwhPerUsdc={kwhPerUsdc} status={effectiveStatus} reducedMotion={reducedMotion} locale={locale} dir={docDir} />
        </div>
      </div>

      {/* Body */}
      <div style={{ paddingBlockEnd: 16, paddingInline: 16 }}>
        <ProgressBar totalDeposit={totalDeposit} claimed={claimed} accrued={cappedAccrued} reducedMotion={reducedMotion} locale={locale} />

        {isDepleted && (
          <div role="alert" style={{ marginBlockStart: 12, paddingBlock: 6, paddingInline: 12, background: 'rgba(213, 94, 0, 0.12)', border: `1px solid ${COLOR.red}`, borderRadius: 4, fontSize: 13, fontWeight: 600, color: COLOR.red }}>
            ⚠ Depleted — accrued value reached 100% of deposited funds. Top up to resume.
          </div>
        )}

        <RunwayIndicator runwayHours={runwayHours} state={runway.state} label={runway.label} color={runway.color} textColor={runway.textColor} reducedMotion={reducedMotion} />

        {showTopUp && onTopUp && (
          <div style={{ marginBlockStart: 10 }}>
            <TopUpPill onTopUp={onTopUp} reducedMotion={reducedMotion} emphasized={isDepleted || runway.state === 'red'} locale={locale} />
          </div>
        )}

        <CloseComparison onMutualClose={onMutualClose} onUnilateralClose={onUnilateralClose} counterpartyResponsive={counterpartyResponsive} />
      </div>
    </div>
  );
}

export default LiveStreamCounter;

// ---------------------------------------------------------------------------
// Test-only exports (used by LiveStreamCounter.test.tsx)
// ---------------------------------------------------------------------------

export const __test__ = {
  interpolateAccruedFixedPoint,
  clampToDeposit,
  toFixedPoint,
  fromFixedPoint,
  RECONCILE_INTERVAL_MS,
  FIXED_POINT_SCALE_NUM,
};
