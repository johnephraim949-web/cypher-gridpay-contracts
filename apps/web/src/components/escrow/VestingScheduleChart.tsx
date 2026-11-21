import { useMemo, useState } from 'react';

export interface VestingMilestone {
  id: string;
  label: string;
  /** ISO date string for the deliverable checkpoint. */
  date: string;
  /** Amount unlocked when this milestone is reached. */
  amount: number;
  completed: boolean;
}

export interface VestingScheduleChartProps {
  /** Total amount subject to vesting. */
  totalAmount: number;
  /** ISO date the schedule starts accruing. */
  startDate: string;
  /** ISO date of the vesting cliff (nothing claimable before this). */
  cliffDate: string;
  /** ISO date the schedule is fully vested. */
  endDate: string;
  /** Amount already claimed by the beneficiary. */
  claimedAmount?: number;
  /** Discrete deliverable checkpoints. */
  milestones?: VestingMilestone[];
  /** Optional token symbol for display. */
  symbol?: string;
  /** Current time override (defaults to now) for deterministic rendering. */
  now?: Date;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function toTime(value: string): number {
  return new Date(value).getTime();
}

function formatAmount(value: number, symbol?: string): string {
  const rounded = Math.round(value * 100) / 100;
  return symbol ? `${rounded.toLocaleString()} ${symbol}` : rounded.toLocaleString();
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Interactive Vesting & Milestone Curve visualizer.
 *
 * Plots the cliff date, a continuous vested-accrual line, discrete milestone
 * deliverable checkpoints, and a clickable "Claimable Now" vs "Locked"
 * breakdown. Collapses to a stacked layout on narrow screens.
 */
export function VestingScheduleChart({
  totalAmount,
  startDate,
  cliffDate,
  endDate,
  claimedAmount = 0,
  milestones = [],
  symbol,
  now,
}: VestingScheduleChartProps) {
  const [activeSegment, setActiveSegment] = useState<'claimable' | 'locked' | null>(null);

  const { vestedAmount, claimableAmount, lockedAmount, progressPct, cliffPct, nowPct, cliffReached } =
    useMemo(() => {
      const start = toTime(startDate);
      const cliff = toTime(cliffDate);
      const end = toTime(endDate);
      const current = (now ?? new Date()).getTime();
      const span = Math.max(end - start, 1);

      const reachedCliff = current >= cliff;
      const elapsed = Math.min(Math.max(current - start, 0), span);
      const vested = reachedCliff ? (elapsed / span) * totalAmount : 0;
      const claimable = Math.max(vested - claimedAmount, 0);
      const locked = Math.max(totalAmount - vested, 0);

      return {
        vestedAmount: vested,
        claimableAmount: claimable,
        lockedAmount: locked,
        progressPct: Math.min((elapsed / span) * 100, 100),
        cliffPct: Math.min(Math.max(((cliff - start) / span) * 100, 0), 100),
        nowPct: Math.min(Math.max(((current - start) / span) * 100, 0), 100),
        cliffReached: reachedCliff,
      };
    }, [startDate, cliffDate, endDate, totalAmount, claimedAmount, now]);

  const daysToCliff = Math.ceil((toTime(cliffDate) - (now ?? new Date()).getTime()) / DAY_MS);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <header className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-baseline sm:justify-between">
        <h3 className="text-base font-semibold text-slate-900">Vesting Schedule</h3>
        <p className="text-xs text-slate-500">
          {cliffReached
            ? 'Cliff reached — accrual is live.'
            : `Cliff unlocks in ${Math.max(daysToCliff, 0)} day(s) on ${formatDate(cliffDate)}.`}
        </p>
      </header>

      {/* Continuous vested accrual line with cliff marker */}
      <div className="relative mb-2 h-3 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className="absolute inset-y-0 left-0 rounded-full bg-emerald-500 transition-all"
          style={{ width: `${progressPct}%` }}
          role="progressbar"
          aria-valuenow={Math.round(progressPct)}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Vested accrual progress"
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-amber-500"
          style={{ left: `${cliffPct}%` }}
          title={`Cliff: ${formatDate(cliffDate)}`}
        />
        <div
          className="absolute -top-1 h-5 w-0.5 bg-slate-900"
          style={{ left: `${nowPct}%` }}
          title="Now"
        />
      </div>
      <div className="mb-5 flex justify-between text-[11px] text-slate-500">
        <span>{formatDate(startDate)}</span>
        <span className="text-amber-600">Cliff {formatDate(cliffDate)}</span>
        <span>{formatDate(endDate)}</span>
      </div>

      {/* Clickable Claimable Now vs Locked breakdown */}
      <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setActiveSegment(activeSegment === 'claimable' ? null : 'claimable')}
          aria-pressed={activeSegment === 'claimable'}
          className={`rounded-lg border p-3 text-left transition ${
            activeSegment === 'claimable'
              ? 'border-emerald-500 bg-emerald-50'
              : 'border-slate-200 hover:border-emerald-300'
          }`}
        >
          <span className="block text-xs font-medium text-emerald-700">Claimable Now</span>
          <span className="block text-lg font-semibold text-slate-900">
            {formatAmount(claimableAmount, symbol)}
          </span>
          {activeSegment === 'claimable' && (
            <span className="mt-1 block text-[11px] text-slate-500">
              Vested {formatAmount(vestedAmount, symbol)} minus claimed{' '}
              {formatAmount(claimedAmount, symbol)}.
            </span>
          )}
        </button>
        <button
          type="button"
          onClick={() => setActiveSegment(activeSegment === 'locked' ? null : 'locked')}
          aria-pressed={activeSegment === 'locked'}
          className={`rounded-lg border p-3 text-left transition ${
            activeSegment === 'locked'
              ? 'border-slate-500 bg-slate-50'
              : 'border-slate-200 hover:border-slate-400'
          }`}
        >
          <span className="block text-xs font-medium text-slate-600">Locked</span>
          <span className="block text-lg font-semibold text-slate-900">
            {formatAmount(lockedAmount, symbol)}
          </span>
          {activeSegment === 'locked' && (
            <span className="mt-1 block text-[11px] text-slate-500">
              {cliffReached
                ? 'Remaining amount not yet vested.'
                : 'Nothing is claimable until the cliff date.'}
            </span>
          )}
        </button>
      </div>

      {/* Discrete milestone deliverable checkpoints */}
      {milestones.length > 0 && (
        <div>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Milestone Checkpoints
          </h4>
          <ol className="space-y-2">
            {milestones.map((milestone) => (
              <li
                key={milestone.id}
                className="flex items-center justify-between gap-3 rounded-lg border border-slate-100 px-3 py-2"
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`inline-block h-2.5 w-2.5 rounded-full ${
                      milestone.completed ? 'bg-emerald-500' : 'bg-slate-300'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="text-sm text-slate-800">{milestone.label}</span>
                </span>
                <span className="text-right text-xs text-slate-500">
                  <span className="block">{formatDate(milestone.date)}</span>
                  <span className="block font-medium text-slate-700">
                    {formatAmount(milestone.amount, symbol)}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      )}
    </section>
  );
}

export default VestingScheduleChart;
