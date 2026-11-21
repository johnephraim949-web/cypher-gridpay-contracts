import React, { useEffect, useMemo, useState } from 'react';

export type LedgerCountdownSize = 'sm' | 'md' | 'lg';

export interface LedgerCountdownProps {
  /** Exact target ledger sequence, e.g. 54102400. */
  targetLedger: number;
  /** Current ledger sequence, if known. */
  currentLedger?: number;
  /** Average ledger close time in seconds (Stellar ~5s). */
  secondsPerLedger?: number;
  /** Optional explicit remaining seconds override (e.g. from a server clock). */
  remainingSeconds?: number;
  size?: LedgerCountdownSize;
  className?: string;
}

const DEFAULT_SECONDS_PER_LEDGER = 5;
const AMBER_THRESHOLD_SECONDS = 60 * 60; // < 1h
const RED_THRESHOLD_SECONDS = 10 * 60; // < 10m

type Urgency = 'normal' | 'amber' | 'critical' | 'expired';

function formatHumanTime(totalSeconds: number): string {
  if (totalSeconds <= 0) return 'Expired';
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (days > 0) return `${days}d ${hours}h remaining`;
  if (hours > 0) return `${hours}h ${minutes}m remaining`;
  if (minutes > 0) return `${minutes}m ${seconds}s remaining`;
  return `${seconds}s remaining`;
}

function formatLedger(ledger: number): string {
  return ledger.toLocaleString('en-US');
}

function getUrgency(remainingSeconds: number): Urgency {
  if (remainingSeconds <= 0) return 'expired';
  if (remainingSeconds < RED_THRESHOLD_SECONDS) return 'critical';
  if (remainingSeconds < AMBER_THRESHOLD_SECONDS) return 'amber';
  return 'normal';
}

const urgencyStyles: Record<Urgency, string> = {
  normal: 'text-slate-700 dark:text-slate-200',
  amber: 'text-amber-600 dark:text-amber-400',
  critical: 'text-red-600 dark:text-red-400',
  expired: 'text-slate-500 dark:text-slate-400',
};

const urgencyIcons: Record<Urgency, string> = {
  normal: '\u23F1',
  amber: '\u26A0',
  critical: '\u26A0',
  expired: '\u2716',
};

const sizeStyles: Record<LedgerCountdownSize, { human: string; ledger: string }> = {
  sm: { human: 'text-sm', ledger: 'text-xs' },
  md: { human: 'text-base', ledger: 'text-sm' },
  lg: { human: 'text-lg', ledger: 'text-base' },
};

export const LedgerCountdown: React.FC<LedgerCountdownProps> = ({
  targetLedger,
  currentLedger,
  secondsPerLedger = DEFAULT_SECONDS_PER_LEDGER,
  remainingSeconds,
  size = 'md',
  className = '',
}) => {
  const [now, setNow] = useState<number>(() => Date.now());

  useEffect(() => {
    if (remainingSeconds !== undefined) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [remainingSeconds]);

  const computedRemaining = useMemo(() => {
    if (remainingSeconds !== undefined) return Math.max(0, Math.floor(remainingSeconds));
    if (currentLedger !== undefined) {
      const ledgersLeft = Math.max(0, targetLedger - currentLedger);
      return ledgersLeft * secondsPerLedger;
    }
    return 0;
  }, [remainingSeconds, currentLedger, targetLedger, secondsPerLedger]);

  // Keep `now` referenced so the interval re-render is meaningful for live clocks.
  void now;

  const urgency = getUrgency(computedRemaining);
  const human = formatHumanTime(computedRemaining);
  const ledgerLabel = `Ledger #${formatLedger(targetLedger)}`;
  const styles = sizeStyles[size];

  return (
    <div
      className={`inline-flex flex-col gap-0.5 ${className}`}
      role="timer"
      aria-live="polite"
      aria-label={`${human}. Target ${ledgerLabel}.`}
    >
      <span
        className={`inline-flex items-center gap-1.5 font-medium tabular-nums ${styles.human} ${urgencyStyles[urgency]}`}
      >
        <span aria-hidden="true">{urgencyIcons[urgency]}</span>
        <span>{human}</span>
      </span>
      <span className={`tabular-nums text-slate-500 dark:text-slate-400 ${styles.ledger}`}>
        {ledgerLabel}
      </span>
    </div>
  );
};

export default LedgerCountdown;
