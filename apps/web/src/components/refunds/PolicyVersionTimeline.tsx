import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * PolicyVersionTimeline
 *
 * Renders the immutable refund policy version history for a merchant
 * (sourced from `get_refund_policy_history`) and provides a lookup control
 * that calls `get_refund_policy_at_time` so support agents can verify which
 * policy governed an older payment.
 */

export interface RefundPolicy {
  /** Refund window in seconds. */
  refundWindowSeconds: number;
  /** Restocking fee in basis points (0..=10000). */
  restockingFeeBps: number;
  /** Cooldown duration in seconds between refunds. */
  cooldownSeconds: number;
  /** Whether auto-refund is enabled. */
  autoRefundEnabled: boolean;
  /** Optional maximum auto-refund amount (in stroops / smallest unit). */
  autoRefundMaxAmount?: string | number | null;
  /** Optional human-readable label / template name. */
  label?: string | null;
}

export interface PolicyVersion {
  /** Monotonic version identifier. */
  version: number;
  /** Unix timestamp (seconds) when this policy became effective. */
  effectiveAt: number;
  /** Unix timestamp (seconds) when this policy was superseded, if any. */
  supersededAt?: number | null;
  /** The policy snapshot that was effective during this window. */
  policy: RefundPolicy;
  /** Optional actor / address that authored the change. */
  author?: string | null;
  /** Optional transaction hash for the on-chain change. */
  txHash?: string | null;
}

export interface PolicyVersionTimelineProps {
  /** Merchant identifier whose history is being displayed. */
  merchantId: string;
  /** Loads the full version history via `get_refund_policy_history`. */
  loadHistory: (merchantId: string) => Promise<PolicyVersion[]>;
  /**
   * Resolves the policy that was effective at a given unix timestamp (seconds)
   * via `get_refund_policy_at_time`.
   */
  loadPolicyAtTime: (merchantId: string, timestamp: number) => Promise<PolicyVersion | null>;
  /** Optional class name for the outer container. */
  className?: string;
}

function formatTimestamp(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    return '—';
  }
  try {
    return new Date(seconds * 1000).toISOString().replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
  } catch {
    return String(seconds);
  }
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '—';
  }
  if (seconds === 0) {
    return '0s';
  }
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);
  if (secs > 0 && days === 0) parts.push(`${secs}s`);
  return parts.length > 0 ? parts.join(' ') : '0s';
}

function formatBps(bps: number): string {
  if (!Number.isFinite(bps)) {
    return '—';
  }
  const pct = bps / 100;
  return `${bps} bps (${pct.toFixed(2)}%)`;
}

function PolicySummary({ policy }: { policy: RefundPolicy }) {
  return (
    <dl className="policy-summary">
      <div>
        <dt>Refund window</dt>
        <dd>{formatDuration(policy.refundWindowSeconds)}</dd>
      </div>
      <div>
        <dt>Restocking fee</dt>
        <dd>{formatBps(policy.restockingFeeBps)}</dd>
      </div>
      <div>
        <dt>Cooldown</dt>
        <dd>{formatDuration(policy.cooldownSeconds)}</dd>
      </div>
      <div>
        <dt>Auto-refund</dt>
        <dd>
          {policy.autoRefundEnabled ? 'Enabled' : 'Disabled'}
          {policy.autoRefundEnabled && policy.autoRefundMaxAmount != null
            ? ` (max ${policy.autoRefundMaxAmount})`
            : ''}
        </dd>
      </div>
      {policy.label ? (
        <div>
          <dt>Label</dt>
          <dd>{policy.label}</dd>
        </div>
      ) : null}
    </dl>
  );
}

export const PolicyVersionTimeline: React.FC<PolicyVersionTimelineProps> = ({
  merchantId,
  loadHistory,
  loadPolicyAtTime,
  className,
}) => {
  const [versions, setVersions] = useState<PolicyVersion[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const [lookupInput, setLookupInput] = useState<string>('');
  const [lookupLoading, setLookupLoading] = useState<boolean>(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [lookupResult, setLookupResult] = useState<PolicyVersion | null>(null);
  const [lookupSearched, setLookupSearched] = useState<boolean>(false);

  const fetchHistory = useCallback(async () => {
    if (!merchantId) {
      setVersions([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const history = await loadHistory(merchantId);
      const sorted = [...(history ?? [])].sort((a, b) => b.effectiveAt - a.effectiveAt);
      setVersions(sorted);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load policy history.');
      setVersions([]);
    } finally {
      setLoading(false);
    }
  }, [merchantId, loadHistory]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  const handleLookup = useCallback(
    async (event: React.FormEvent) => {
      event.preventDefault();
      setLookupError(null);
      setLookupResult(null);
      setLookupSearched(false);

      const trimmed = lookupInput.trim();
      if (!trimmed) {
        setLookupError('Enter a date/time or unix timestamp to look up.');
        return;
      }

      let timestamp: number;
      if (/^\d+$/.test(trimmed)) {
        timestamp = Number(trimmed);
      } else {
        const parsed = Date.parse(trimmed);
        if (Number.isNaN(parsed)) {
          setLookupError('Could not parse the provided date/time.');
          return;
        }
        timestamp = Math.floor(parsed / 1000);
      }

      if (!Number.isFinite(timestamp) || timestamp < 0) {
        setLookupError('Timestamp must be a non-negative number.');
        return;
      }

      setLookupLoading(true);
      try {
        const result = await loadPolicyAtTime(merchantId, timestamp);
        setLookupResult(result);
        setLookupSearched(true);
      } catch (err) {
        setLookupError(
          err instanceof Error ? err.message : 'Failed to resolve policy at the given time.',
        );
      } finally {
        setLookupLoading(false);
      }
    },
    [lookupInput, loadPolicyAtTime, merchantId],
  );

  const handleClearLookup = useCallback(() => {
    setLookupInput('');
    setLookupResult(null);
    setLookupError(null);
    setLookupSearched(false);
  }, []);

  const hasVersions = versions.length > 0;

  const latestVersion = useMemo(() => (hasVersions ? versions[0] : null), [hasVersions, versions]);

  return (
    <section
      className={['policy-version-timeline', className].filter(Boolean).join(' ')}
      aria-labelledby="policy-version-timeline-heading"
    >
      <header className="policy-version-timeline__header">
        <h2 id="policy-version-timeline-heading">Policy Version Timeline</h2>
        <p className="policy-version-timeline__subtitle">
          Immutable history of refund policy changes. Each version is effective from its
          timestamp until superseded by the next version.
        </p>
        <button
          type="button"
          className="policy-version-timeline__refresh"
          onClick={() => void fetchHistory()}
          disabled={loading}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error ? (
        <div className="policy-version-timeline__error" role="alert">
          {error}
        </div>
      ) : null}

      {loading && !hasVersions ? (
        <div className="policy-version-timeline__loading" role="status">
          Loading policy history…
        </div>
      ) : null}

      {!loading && !error && !hasVersions ? (
        <div className="policy-version-timeline__empty" role="status">
          No policy versions recorded for this merchant yet.
        </div>
      ) : null}

      {hasVersions ? (
        <ol className="policy-version-timeline__list">
          {versions.map((version, index) => {
            const isLatest = index === 0;
            return (
              <li
                key={`${version.version}-${version.effectiveAt}`}
                className={
                  isLatest
                    ? 'policy-version-timeline__item policy-version-timeline__item--latest'
                    : 'policy-version-timeline__item'
                }
              >
                <div className="policy-version-timeline__marker" aria-hidden="true" />
                <div className="policy-version-timeline__content">
                  <div className="policy-version-timeline__meta">
                    <span className="policy-version-timeline__version">
                      Version {version.version}
                    </span>
                    {isLatest ? (
                      <span className="policy-version-timeline__badge">Current</span>
                    ) : null}
                  </div>
                  <div className="policy-version-timeline__timestamps">
                    <span>
                      <strong>Effective:</strong> {formatTimestamp(version.effectiveAt)}
                    </span>
                    <span>
                      <strong>Superseded:</strong>{' '}
                      {version.supersededAt != null
                        ? formatTimestamp(version.supersededAt)
                        : 'Still active'}
                    </span>
                  </div>
                  <PolicySummary policy={version.policy} />
                  {version.author || version.txHash ? (
                    <div className="policy-version-timeline__provenance">
                      {version.author ? (
                        <span>
                          <strong>Author:</strong> {version.author}
                        </span>
                      ) : null}
                      {version.txHash ? (
                        <span>
                          <strong>Tx:</strong> <code>{version.txHash}</code>
                        </span>
                      ) : null}
                    </div>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ol>
      ) : null}

      <div className="policy-version-timeline__lookup">
        <h3>Verify policy for an older payment</h3>
        <p className="policy-version-timeline__lookup-hint">
          Enter the payment date/time or a unix timestamp (seconds) to resolve which policy was
          effective at that moment via <code>get_refund_policy_at_time</code>.
        </p>
        <form className="policy-version-timeline__lookup-form" onSubmit={handleLookup}>
          <label htmlFor="policy-lookup-input" className="policy-version-timeline__lookup-label">
            Payment timestamp
          </label>
          <input
            id="policy-lookup-input"
            type="text"
            className="policy-version-timeline__lookup-input"
            placeholder="e.g. 2024-05-01T12:00:00Z or 1714564800"
            value={lookupInput}
            onChange={(e) => setLookupInput(e.target.value)}
            disabled={lookupLoading}
          />
          <button
            type="submit"
            className="policy-version-timeline__lookup-submit"
            disabled={lookupLoading}
          >
            {lookupLoading ? 'Looking up…' : 'Look up policy'}
          </button>
          {lookupInput || lookupSearched ? (
            <button
              type="button"
              className="policy-version-timeline__lookup-clear"
              onClick={handleClearLookup}
              disabled={lookupLoading}
            >
              Clear
            </button>
          ) : null}
        </form>

        {lookupError ? (
          <div className="policy-version-timeline__lookup-error" role="alert">
            {lookupError}
          </div>
        ) : null}

        {lookupSearched && !lookupError ? (
          lookupResult ? (
            <div className="policy-version-timeline__lookup-result" role="status">
              <div className="policy-version-timeline__lookup-result-header">
                <span className="policy-version-timeline__version">
                  Version {lookupResult.version}
                </span>
                <span>
                  Effective: {formatTimestamp(lookupResult.effectiveAt)}
                  {lookupResult.supersededAt != null
                    ? ` → ${formatTimestamp(lookupResult.supersededAt)}`
                    : ' (still active)'}
                </span>
              </div>
              <PolicySummary policy={lookupResult.policy} />
            </div>
          ) : (
            <div className="policy-version-timeline__lookup-empty" role="status">
              No policy was in effect at the requested time.
            </div>
          )
        ) : null}
      </div>

      {latestVersion ? (
        <footer className="policy-version-timeline__footer">
          <small>
            Showing {versions.length} version{versions.length === 1 ? '' : 's'}. Latest effective{' '}
            {formatTimestamp(latestVersion.effectiveAt)}.
          </small>
        </footer>
      ) : null}
    </section>
  );
};

export default PolicyVersionTimeline;
