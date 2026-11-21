import { useMemo, useState } from 'react';
import type { RefundPolicyVersion } from '../../types/refunds';

interface PolicyVersionTimelineProps {
  versions: RefundPolicyVersion[];
  onSelectVersion?: (version: RefundPolicyVersion) => void;
  selectedVersionId?: string | null;
}

interface HistoricalLookupResult {
  version: RefundPolicyVersion | null;
  message: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function isWithinRange(
  version: RefundPolicyVersion,
  at: Date,
): boolean {
  const effectiveFrom = version.effective_from
    ? new Date(version.effective_from)
    : null;
  const effectiveTo = version.effective_to
    ? new Date(version.effective_to)
    : null;

  if (effectiveFrom && !Number.isNaN(effectiveFrom.getTime()) && at < effectiveFrom) {
    return false;
  }
  if (effectiveTo && !Number.isNaN(effectiveTo.getTime()) && at >= effectiveTo) {
    return false;
  }
  return true;
}

function findVersionAtTime(
  versions: RefundPolicyVersion[],
  at: Date,
): RefundPolicyVersion | null {
  const matches = versions.filter((version) => isWithinRange(version, at));
  if (matches.length === 0) return null;
  return matches.reduce((latest, current) => {
    const latestFrom = latest.effective_from
      ? new Date(latest.effective_from).getTime()
      : -Infinity;
    const currentFrom = current.effective_from
      ? new Date(current.effective_from).getTime()
      : -Infinity;
    return currentFrom > latestFrom ? current : latest;
  });
}

export function PolicyVersionTimeline({
  versions,
  onSelectVersion,
  selectedVersionId,
}: PolicyVersionTimelineProps) {
  const [lookupDate, setLookupDate] = useState('');
  const [lookupResult, setLookupResult] = useState<HistoricalLookupResult | null>(
    null,
  );

  const sortedVersions = useMemo(() => {
    return [...versions].sort((a, b) => {
      const aFrom = a.effective_from ? new Date(a.effective_from).getTime() : 0;
      const bFrom = b.effective_from ? new Date(b.effective_from).getTime() : 0;
      return bFrom - aFrom;
    });
  }, [versions]);

  const handleLookup = () => {
    if (!lookupDate) {
      setLookupResult({
        version: null,
        message: 'Choose a date to check which policy applied.',
      });
      return;
    }

    const at = new Date(lookupDate);
    if (Number.isNaN(at.getTime())) {
      setLookupResult({
        version: null,
        message: 'That date could not be understood. Try again.',
      });
      return;
    }

    const match = findVersionAtTime(sortedVersions, at);
    if (!match) {
      setLookupResult({
        version: null,
        message: `No policy version was active on ${formatDate(lookupDate)}.`,
      });
      return;
    }

    setLookupResult({
      version: match,
      message: `Policy version ${match.version_label ?? match.id} applied on ${formatDate(
        lookupDate,
      )}.`,
    });
    onSelectVersion?.(match);
  };

  return (
    <section className="policy-version-timeline" aria-label="Refund policy history">
      <header className="policy-version-timeline__header">
        <h2 className="policy-version-timeline__title">Policy history</h2>
        <p className="policy-version-timeline__subtitle">
          Check which policy applied to a payment on a given date, or review past
          versions of your refund policy.
        </p>
      </header>

      <div className="policy-version-timeline__lookup" role="search">
        <label
          className="policy-version-timeline__lookup-label"
          htmlFor="policy-history-lookup-date"
        >
          Check which policy applied on a specific date
        </label>
        <div className="policy-version-timeline__lookup-controls">
          <input
            id="policy-history-lookup-date"
            type="date"
            className="policy-version-timeline__lookup-input"
            value={lookupDate}
            onChange={(event) => setLookupDate(event.target.value)}
          />
          <button
            type="button"
            className="policy-version-timeline__lookup-button"
            onClick={handleLookup}
          >
            Look up policy
          </button>
        </div>
        {lookupResult && (
          <p
            className={
              lookupResult.version
                ? 'policy-version-timeline__lookup-result policy-version-timeline__lookup-result--found'
                : 'policy-version-timeline__lookup-result policy-version-timeline__lookup-result--empty'
            }
            role="status"
          >
            {lookupResult.version ? '✓ ' : 'ⓘ '}
            {lookupResult.message}
          </p>
        )}
      </div>

      {sortedVersions.length === 0 ? (
        <p className="policy-version-timeline__empty">
          No policy versions have been recorded yet.
        </p>
      ) : (
        <ol className="policy-version-timeline__list">
          {sortedVersions.map((version) => {
            const isSelected = selectedVersionId === version.id;
            const isLookupMatch = lookupResult?.version?.id === version.id;
            return (
              <li
                key={version.id}
                className={[
                  'policy-version-timeline__item',
                  isSelected ? 'policy-version-timeline__item--selected' : '',
                  isLookupMatch ? 'policy-version-timeline__item--highlighted' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <button
                  type="button"
                  className="policy-version-timeline__item-button"
                  onClick={() => onSelectVersion?.(version)}
                  aria-pressed={isSelected}
                >
                  <span className="policy-version-timeline__item-marker" aria-hidden="true">
                    {isLookupMatch ? '★' : '•'}
                  </span>
                  <span className="policy-version-timeline__item-body">
                    <span className="policy-version-timeline__item-label">
                      {version.version_label ?? version.id}
                      {isLookupMatch && (
                        <span className="policy-version-timeline__item-badge">
                          Matches lookup
                        </span>
                      )}
                    </span>
                    <span className="policy-version-timeline__item-meta">
                      Effective {formatDateTime(version.effective_from)}
                      {version.effective_to
                        ? ` → ${formatDateTime(version.effective_to)}`
                        : ' → present'}
                    </span>
                    {version.change_summary && (
                      <span className="policy-version-timeline__item-summary">
                        {version.change_summary}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export default PolicyVersionTimeline;
