import React, { useMemo, useState } from 'react';

export interface RefundPolicyRule {
  key: string;
  label: string;
  value: string | number | boolean;
  unit?: string;
}

export interface RefundPolicySnapshot {
  versionId: string;
  effectiveAt: string;
  rules: RefundPolicyRule[];
}

export interface PolicyDiffViewerProps {
  previous: RefundPolicySnapshot | null;
  proposed: RefundPolicySnapshot;
  onConfirm?: () => void;
  onCancel?: () => void;
}

interface RuleDiff {
  key: string;
  label: string;
  previousValue: string | null;
  proposedValue: string;
  changed: boolean;
  impact: string;
}

function formatValue(rule: RefundPolicyRule): string {
  if (typeof rule.value === 'boolean') {
    return rule.value ? 'Enabled' : 'Disabled';
  }
  return rule.unit ? `${rule.value} ${rule.unit}` : String(rule.value);
}

function buildImpact(rule: RefundPolicyRule, previousValue: string | null, proposedValue: string): string {
  if (previousValue === null) {
    return `${rule.label} will be set to ${proposedValue}.`;
  }
  return `${rule.label} will now be ${proposedValue} instead of ${previousValue}.`;
}

function buildDiffs(previous: RefundPolicySnapshot | null, proposed: RefundPolicySnapshot): RuleDiff[] {
  const previousMap = new Map<string, RefundPolicyRule>();
  previous?.rules.forEach((rule) => previousMap.set(rule.key, rule));

  return proposed.rules.map((rule) => {
    const prevRule = previousMap.get(rule.key);
    const previousValue = prevRule ? formatValue(prevRule) : null;
    const proposedValue = formatValue(rule);
    const changed = previousValue !== proposedValue;
    return {
      key: rule.key,
      label: rule.label,
      previousValue,
      proposedValue,
      changed,
      impact: changed ? buildImpact(rule, previousValue, proposedValue) : `${rule.label} stays the same.`,
    };
  });
}

export const PolicyDiffViewer: React.FC<PolicyDiffViewerProps> = ({ previous, proposed, onConfirm, onCancel }) => {
  const [showUnchanged, setShowUnchanged] = useState(false);
  const diffs = useMemo(() => buildDiffs(previous, proposed), [previous, proposed]);
  const visibleDiffs = showUnchanged ? diffs : diffs.filter((diff) => diff.changed);
  const changedCount = diffs.filter((diff) => diff.changed).length;

  return (
    <section className="policy-diff-viewer" aria-label="Refund policy diff review">
      <header className="policy-diff-viewer__header">
        <h2>Review refund policy changes</h2>
        <p className="policy-diff-viewer__scope">
          Changes apply only to payments created after confirmation; existing payments remain governed by their
          original purchase-time policy.
        </p>
      </header>

      <div className="policy-diff-viewer__summary" role="status">
        {changedCount === 0
          ? 'No rule changes detected.'
          : `${changedCount} rule${changedCount === 1 ? '' : 's'} will change.`}
      </div>

      <div className="policy-diff-viewer__columns" aria-hidden="true">
        <span>Previous policy</span>
        <span>Proposed policy</span>
      </div>

      <ul className="policy-diff-viewer__rules">
        {visibleDiffs.map((diff) => (
          <li
            key={diff.key}
            className={`policy-diff-viewer__rule ${diff.changed ? 'is-changed' : 'is-unchanged'}`}
          >
            <div className="policy-diff-viewer__rule-label">{diff.label}</div>
            <div className="policy-diff-viewer__rule-values">
              <div className="policy-diff-viewer__previous">
                <span className="policy-diff-viewer__marker" aria-hidden="true">
                  {diff.changed ? '\u2212' : '='}
                </span>
                <span className="policy-diff-viewer__sr-only">Previous:</span>
                <span className={diff.changed ? 'policy-diff-viewer__strike' : ''}>
                  {diff.previousValue ?? 'Not set'}
                </span>
              </div>
              <div className="policy-diff-viewer__proposed">
                <span className="policy-diff-viewer__marker" aria-hidden="true">
                  {diff.changed ? '+' : '='}
                </span>
                <span className="policy-diff-viewer__sr-only">Proposed:</span>
                <span className={diff.changed ? 'policy-diff-viewer__badge' : ''}>{diff.proposedValue}</span>
              </div>
            </div>
            {diff.changed && <p className="policy-diff-viewer__impact">{diff.impact}</p>}
          </li>
        ))}
      </ul>

      <label className="policy-diff-viewer__toggle">
        <input type="checkbox" checked={showUnchanged} onChange={(event) => setShowUnchanged(event.target.checked)} />
        Show unchanged rules
      </label>

      <footer className="policy-diff-viewer__actions">
        {onCancel && (
          <button type="button" className="policy-diff-viewer__cancel" onClick={onCancel}>
            Cancel
          </button>
        )}
        {onConfirm && (
          <button type="button" className="policy-diff-viewer__confirm" onClick={onConfirm}>
            Confirm policy changes
          </button>
        )}
      </footer>
    </section>
  );
};

export default PolicyDiffViewer;
