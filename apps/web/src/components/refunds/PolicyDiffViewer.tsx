import React, { useMemo } from 'react';

export interface RefundPolicyTier {
  minAmount: string;
  maxAmount: string;
  windowSeconds: number;
  restockingFeeBps: number;
  autoApprove: boolean;
}

export interface RefundPolicy {
  refundWindowSeconds: number;
  restockingFeeBps: number;
  autoApproveThreshold: string;
  autoRefundEnabled: boolean;
  cooldownSeconds: number;
  tiers: RefundPolicyTier[];
}

export type PolicyFieldChange = 'added' | 'removed' | 'changed' | 'unchanged';

export interface PolicyDiffRow {
  key: string;
  label: string;
  currentValue: string;
  proposedValue: string;
  change: PolicyFieldChange;
}

export interface PolicyDiffViewerProps {
  current: RefundPolicy | null;
  proposed: RefundPolicy | null;
  className?: string;
  title?: string;
}

const formatBps = (bps: number): string => `${bps} bps (${(bps / 100).toFixed(2)}%)`;

const formatDuration = (seconds: number): string => {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0s';
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days) parts.push(`${days}d`);
  if (hours) parts.push(`${hours}h`);
  if (minutes) parts.push(`${minutes}m`);
  if (secs) parts.push(`${secs}s`);
  return parts.join(' ') || '0s';
};

const formatAmount = (amount: string | undefined): string => {
  if (amount === undefined || amount === null || amount === '') return '—';
  return amount;
};

const formatBool = (value: boolean | undefined): string => {
  if (value === undefined) return '—';
  return value ? 'Enabled' : 'Disabled';
};

const compareValues = (
  currentValue: string,
  proposedValue: string,
  hasCurrent: boolean,
  hasProposed: boolean,
): PolicyFieldChange => {
  if (!hasCurrent && hasProposed) return 'added';
  if (hasCurrent && !hasProposed) return 'removed';
  if (currentValue !== proposedValue) return 'changed';
  return 'unchanged';
};

const buildTopLevelRows = (
  current: RefundPolicy | null,
  proposed: RefundPolicy | null,
): PolicyDiffRow[] => {
  const rows: PolicyDiffRow[] = [];

  const push = (
    key: string,
    label: string,
    currentValue: string,
    proposedValue: string,
    hasCurrent: boolean,
    hasProposed: boolean,
  ) => {
    rows.push({
      key,
      label,
      currentValue: hasCurrent ? currentValue : '—',
      proposedValue: hasProposed ? proposedValue : '—',
      change: compareValues(currentValue, proposedValue, hasCurrent, hasProposed),
    });
  };

  push(
    'refundWindowSeconds',
    'Refund Window',
    current ? formatDuration(current.refundWindowSeconds) : '',
    proposed ? formatDuration(proposed.refundWindowSeconds) : '',
    !!current,
    !!proposed,
  );

  push(
    'restockingFeeBps',
    'Restocking Fee',
    current ? formatBps(current.restockingFeeBps) : '',
    proposed ? formatBps(proposed.restockingFeeBps) : '',
    !!current,
    !!proposed,
  );

  push(
    'autoApproveThreshold',
    'Auto-Approve Threshold',
    current ? formatAmount(current.autoApproveThreshold) : '',
    proposed ? formatAmount(proposed.autoApproveThreshold) : '',
    !!current,
    !!proposed,
  );

  push(
    'autoRefundEnabled',
    'Auto-Refund',
    current ? formatBool(current.autoRefundEnabled) : '',
    proposed ? formatBool(proposed.autoRefundEnabled) : '',
    !!current,
    !!proposed,
  );

  push(
    'cooldownSeconds',
    'Cooldown Duration',
    current ? formatDuration(current.cooldownSeconds) : '',
    proposed ? formatDuration(proposed.cooldownSeconds) : '',
    !!current,
    !!proposed,
  );

  return rows;
};

const buildTierRows = (
  current: RefundPolicy | null,
  proposed: RefundPolicy | null,
): PolicyDiffRow[] => {
  const rows: PolicyDiffRow[] = [];
  const currentTiers = current?.tiers ?? [];
  const proposedTiers = proposed?.tiers ?? [];
  const maxLen = Math.max(currentTiers.length, proposedTiers.length);

  for (let i = 0; i < maxLen; i += 1) {
    const cur = currentTiers[i];
    const prop = proposedTiers[i];
    const tierLabel = `Tier ${i + 1}`;

    const curRange = cur ? `${formatAmount(cur.minAmount)} – ${formatAmount(cur.maxAmount)}` : '';
    const propRange = prop ? `${formatAmount(prop.minAmount)} – ${formatAmount(prop.maxAmount)}` : '';
    rows.push({
      key: `tier-${i}-range`,
      label: `${tierLabel} · Amount Range`,
      currentValue: cur ? curRange : '—',
      proposedValue: prop ? propRange : '—',
      change: compareValues(curRange, propRange, !!cur, !!prop),
    });

    const curWindow = cur ? formatDuration(cur.windowSeconds) : '';
    const propWindow = prop ? formatDuration(prop.windowSeconds) : '';
    rows.push({
      key: `tier-${i}-window`,
      label: `${tierLabel} · Window`,
      currentValue: cur ? curWindow : '—',
      proposedValue: prop ? propWindow : '—',
      change: compareValues(curWindow, propWindow, !!cur, !!prop),
    });

    const curFee = cur ? formatBps(cur.restockingFeeBps) : '';
    const propFee = prop ? formatBps(prop.restockingFeeBps) : '';
    rows.push({
      key: `tier-${i}-fee`,
      label: `${tierLabel} · Restocking Fee`,
      currentValue: cur ? curFee : '—',
      proposedValue: prop ? propFee : '—',
      change: compareValues(curFee, propFee, !!cur, !!prop),
    });

    const curAuto = cur ? formatBool(cur.autoApprove) : '';
    const propAuto = prop ? formatBool(prop.autoApprove) : '';
    rows.push({
      key: `tier-${i}-auto`,
      label: `${tierLabel} · Auto-Approve`,
      currentValue: cur ? curAuto : '—',
      proposedValue: prop ? propAuto : '—',
      change: compareValues(curAuto, propAuto, !!cur, !!prop),
    });
  }

  return rows;
};

const changeStyles: Record<PolicyFieldChange, { row: string; badge: string; label: string }> = {
  added: {
    row: 'bg-emerald-50',
    badge: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    label: 'Added',
  },
  removed: {
    row: 'bg-rose-50',
    badge: 'bg-rose-100 text-rose-800 border-rose-300',
    label: 'Removed',
  },
  changed: {
    row: 'bg-amber-50',
    badge: 'bg-amber-100 text-amber-800 border-amber-300',
    label: 'Changed',
  },
  unchanged: {
    row: '',
    badge: 'bg-slate-100 text-slate-600 border-slate-300',
    label: 'Unchanged',
  },
};

const ChangeBadge: React.FC<{ change: PolicyFieldChange }> = ({ change }) => {
  const styles = changeStyles[change];
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${styles.badge}`}
    >
      {styles.label}
    </span>
  );
};

export const PolicyDiffViewer: React.FC<PolicyDiffViewerProps> = ({
  current,
  proposed,
  className = '',
  title = 'Policy Diff',
}) => {
  const rows = useMemo<PolicyDiffRow[]>(() => {
    return [...buildTopLevelRows(current, proposed), ...buildTierRows(current, proposed)];
  }, [current, proposed]);

  const summary = useMemo(() => {
    return rows.reduce(
      (acc, row) => {
        acc[row.change] += 1;
        return acc;
      },
      { added: 0, removed: 0, changed: 0, unchanged: 0 } as Record<PolicyFieldChange, number>,
    );
  }, [rows]);

  const hasChanges = summary.added + summary.removed + summary.changed > 0;

  return (
    <section
      className={`rounded-lg border border-slate-200 bg-white shadow-sm ${className}`}
      aria-labelledby="policy-diff-viewer-title"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 px-4 py-3">
        <div>
          <h2 id="policy-diff-viewer-title" className="text-base font-semibold text-slate-900">
            {title}
          </h2>
          <p className="text-xs text-slate-500">
            Compare the current on-chain policy against your proposed draft before signing.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs" aria-live="polite">
          <span className="rounded-full border border-emerald-300 bg-emerald-100 px-2 py-0.5 font-medium text-emerald-800">
            {summary.added} added
          </span>
          <span className="rounded-full border border-rose-300 bg-rose-100 px-2 py-0.5 font-medium text-rose-800">
            {summary.removed} removed
          </span>
          <span className="rounded-full border border-amber-300 bg-amber-100 px-2 py-0.5 font-medium text-amber-800">
            {summary.changed} changed
          </span>
        </div>
      </header>

      {!hasChanges && (
        <div className="border-b border-slate-200 bg-slate-50 px-4 py-2 text-sm text-slate-600">
          No differences detected between the current policy and your draft.
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-slate-200 text-sm" role="table">
          <caption className="sr-only">
            Side-by-side comparison of current on-chain refund policy and proposed draft.
          </caption>
          <thead className="bg-slate-50">
            <tr>
              <th scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                Field
              </th>
              <th scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                Current (On-Chain)
              </th>
              <th scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                Proposed (Draft)
              </th>
              <th scope="col" className="px-4 py-2 text-left font-semibold text-slate-700">
                Change
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row) => {
              const styles = changeStyles[row.change];
              return (
                <tr
                  key={row.key}
                  className={styles.row}
                  data-change={row.change}
                  data-testid={`policy-diff-row-${row.key}`}
                >
                  <th scope="row" className="px-4 py-2 text-left font-medium text-slate-800">
                    {row.label}
                  </th>
                  <td className="px-4 py-2 text-slate-700">{row.currentValue}</td>
                  <td className="px-4 py-2 text-slate-700">{row.proposedValue}</td>
                  <td className="px-4 py-2">
                    <ChangeBadge change={row.change} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
};

export default PolicyDiffViewer;
