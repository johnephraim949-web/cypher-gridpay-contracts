import React, { useCallback, useEffect, useMemo, useState } from 'react';
import CommitRevealVoter from '../../components/arbitrator/CommitRevealVoter';
import StakeReputationPanel from '../../components/arbitrator/StakeReputationPanel';

export interface ArbitrationCase {
  caseId: string;
  title: string;
  status: 'open' | 'committing' | 'revealing' | 'closed';
  commitDeadline: number;
  revealDeadline: number;
  panel: string[];
  standbyQueue: string[];
  assignedAt: number;
}

export interface ArbitratorWorkbenchProps {
  walletAddress: string | null;
  cases: ArbitrationCase[];
  loading?: boolean;
  error?: string | null;
  onRecuse?: (caseId: string, reason: string) => Promise<void> | void;
  onRefresh?: () => void;
  now?: number;
}

const RECUSAL_REASONS = [
  'Conflict of interest',
  'Prior involvement with a party',
  'Financial interest in outcome',
  'Personal relationship with a party',
  'Other (specify)',
];

function formatDeadline(ts: number, now: number): string {
  const diff = ts - now;
  if (diff <= 0) return 'Expired';
  const secs = Math.floor(diff / 1000);
  const days = Math.floor(secs / 86400);
  const hours = Math.floor((secs % 86400) / 3600);
  const mins = Math.floor((secs % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

function phaseLabel(status: ArbitrationCase['status']): string {
  switch (status) {
    case 'open':
      return 'Open';
    case 'committing':
      return 'Commit Phase';
    case 'revealing':
      return 'Reveal Phase';
    case 'closed':
      return 'Closed';
    default:
      return status;
  }
}

export function isPanelMember(
  walletAddress: string | null,
  arbitrationCase: ArbitrationCase,
): boolean {
  if (!walletAddress) return false;
  return arbitrationCase.panel.includes(walletAddress);
}

export function isStandbyMember(
  walletAddress: string | null,
  arbitrationCase: ArbitrationCase,
): boolean {
  if (!walletAddress) return false;
  return arbitrationCase.standbyQueue.includes(walletAddress);
}

export function canVote(
  walletAddress: string | null,
  arbitrationCase: ArbitrationCase,
  now: number,
): boolean {
  if (!isPanelMember(walletAddress, arbitrationCase)) return false;
  if (arbitrationCase.status === 'closed') return false;
  if (arbitrationCase.status === 'open') return false;
  if (arbitrationCase.status === 'committing') {
    return now < arbitrationCase.commitDeadline;
  }
  if (arbitrationCase.status === 'revealing') {
    return now >= arbitrationCase.commitDeadline && now < arbitrationCase.revealDeadline;
  }
  return false;
}

interface RecuseDialogProps {
  caseId: string;
  onCancel: () => void;
  onConfirm: (reason: string) => void;
  submitting: boolean;
}

const RecuseDialog: React.FC<RecuseDialogProps> = ({
  caseId,
  onCancel,
  onConfirm,
  submitting,
}) => {
  const [selected, setSelected] = useState(RECUSAL_REASONS[0]);
  const [details, setDetails] = useState('');
  const isOther = selected === 'Other (specify)';
  const reason = isOther ? details.trim() : selected;
  const valid = reason.length >= 5;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`Recuse from case ${caseId}`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">Recuse from Case</h3>
        <p className="mt-1 text-sm text-gray-600">
          Case <span className="font-mono">{caseId}</span>. A reason is required and will be
          logged on-chain.
        </p>
        <div className="mt-4">
          <label htmlFor="recusal-reason" className="block text-sm font-medium text-gray-700">
            Recusal reason
          </label>
          <select
            id="recusal-reason"
            className="mt-1 w-full rounded border border-gray-300 p-2 text-sm"
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            disabled={submitting}
          >
            {RECUSAL_REASONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
          {isOther && (
            <textarea
              className="mt-2 w-full rounded border border-gray-300 p-2 text-sm"
              placeholder="Describe the reason (min 5 characters)"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              disabled={submitting}
              rows={3}
            />
          )}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onCancel}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            onClick={() => onConfirm(reason)}
            disabled={!valid || submitting}
          >
            {submitting ? 'Recusing…' : 'Confirm Recusal'}
          </button>
        </div>
      </div>
    </div>
  );
};

const ArbitratorWorkbench: React.FC<ArbitratorWorkbenchProps> = ({
  walletAddress,
  cases,
  loading = false,
  error = null,
  onRecuse,
  onRefresh,
  now,
}) => {
  const [currentTime, setCurrentTime] = useState<number>(now ?? Date.now());
  const [recuseCaseId, setRecuseCaseId] = useState<string | null>(null);
  const [recusing, setRecusing] = useState(false);
  const [recuseError, setRecuseError] = useState<string | null>(null);
  const [recusedCases, setRecusedCases] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (now !== undefined) {
      setCurrentTime(now);
      return;
    }
    const interval = setInterval(() => setCurrentTime(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [now]);

  const assignedCases = useMemo(() => {
    if (!walletAddress) return [];
    return cases.filter((c) => c.panel.includes(walletAddress));
  }, [cases, walletAddress]);

  const standbyCases = useMemo(() => {
    if (!walletAddress) return [];
    return cases.filter((c) => c.standbyQueue.includes(walletAddress));
  }, [cases, walletAddress]);

  const upcomingDeadlines = useMemo(() => {
    const items: Array<{
      caseId: string;
      title: string;
      kind: 'commit' | 'reveal';
      deadline: number;
    }> = [];
    for (const c of assignedCases) {
      if (c.status === 'committing' && c.commitDeadline > currentTime) {
        items.push({
          caseId: c.caseId,
          title: c.title,
          kind: 'commit',
          deadline: c.commitDeadline,
        });
      }
      if (c.status === 'revealing' && c.revealDeadline > currentTime) {
        items.push({
          caseId: c.caseId,
          title: c.title,
          kind: 'reveal',
          deadline: c.revealDeadline,
        });
      }
    }
    return items.sort((a, b) => a.deadline - b.deadline);
  }, [assignedCases, currentTime]);

  const handleRecuseClick = useCallback((caseId: string) => {
    setRecuseError(null);
    setRecuseCaseId(caseId);
  }, []);

  const handleRecuseConfirm = useCallback(
    async (reason: string) => {
      if (!recuseCaseId) return;
      setRecusing(true);
      setRecuseError(null);
      try {
        if (onRecuse) {
          await onRecuse(recuseCaseId, reason);
        }
        setRecusedCases((prev) => {
          const next = new Set(prev);
          next.add(recuseCaseId);
          return next;
        });
        setRecuseCaseId(null);
      } catch (e) {
        setRecuseError(e instanceof Error ? e.message : 'Failed to recuse');
      } finally {
        setRecusing(false);
      }
    },
    [onRecuse, recuseCaseId],
  );

  const isConnected = Boolean(walletAddress);
  const hasAnyAssignment = assignedCases.length > 0 || standbyCases.length > 0;
  const readOnly = !isConnected || !hasAnyAssignment;

  return (
    <div className="min-h-screen bg-gray-50 p-6" data-testid="arbitrator-workbench">
      <header className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Arbitrator Workbench</h1>
          <p className="mt-1 text-sm text-gray-600">
            {isConnected ? (
              <>
                Connected as <span className="font-mono">{walletAddress}</span>
              </>
            ) : (
              'Connect your wallet to view your assignments.'
            )}
          </p>
        </div>
        {onRefresh && (
          <button
            type="button"
            onClick={onRefresh}
            className="rounded border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Refresh
          </button>
        )}
      </header>

      {readOnly && (
        <div
          role="status"
          data-testid="read-only-banner"
          className="mb-6 rounded border border-yellow-300 bg-yellow-50 p-4 text-sm text-yellow-800"
        >
          {!isConnected
            ? 'Read-only view: connect a wallet to access voting controls.'
            : 'Read-only view: your wallet is not an active member of any arbitration panel or standby queue.'}
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mb-6 rounded border border-red-300 bg-red-50 p-4 text-sm text-red-800"
        >
          {error}
        </div>
      )}

      {loading && (
        <div className="mb-6 text-sm text-gray-500" data-testid="loading-indicator">
          Loading assignments…
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-6">
          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-semibold text-gray-900">Assigned Open Cases</h2>
            {assignedCases.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500" data-testid="no-assigned-cases">
                No active panel assignments.
              </p>
            ) : (
              <ul className="mt-4 space-y-4" data-testid="assigned-cases-list">
                {assignedCases.map((c) => {
                  const isRecused = recusedCases.has(c.caseId);
                  const voteEnabled = canVote(walletAddress, c, currentTime) && !isRecused;
                  return (
                    <li
                      key={c.caseId}
                      className="rounded border border-gray-200 p-4"
                      data-testid={`case-${c.caseId}`}
                    >
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="font-medium text-gray-900">{c.title}</h3>
                          <p className="text-xs text-gray-500">
                            Case <span className="font-mono">{c.caseId}</span> ·{' '}
                            {phaseLabel(c.status)}
                          </p>
                        </div>
                        <div className="flex items-center gap-2">
                          {isRecused ? (
                            <span className="rounded bg-gray-100 px-2 py-1 text-xs font-medium text-gray-600">
                              Recused
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => handleRecuseClick(c.caseId)}
                              className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
                              data-testid={`recuse-${c.caseId}`}
                            >
                              Recuse
                            </button>
                          )}
                        </div>
                      </div>
                      <dl className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-600">
                        <div>
                          <dt className="font-medium text-gray-700">Commit deadline</dt>
                          <dd data-testid={`commit-deadline-${c.caseId}`}>
                            {formatDeadline(c.commitDeadline, currentTime)}
                          </dd>
                        </div>
                        <div>
                          <dt className="font-medium text-gray-700">Reveal deadline</dt>
                          <dd data-testid={`reveal-deadline-${c.caseId}`}>
                            {formatDeadline(c.revealDeadline, currentTime)}
                          </dd>
                        </div>
                      </dl>
                      <div className="mt-4">
                        {isRecused ? (
                          <p className="text-xs text-gray-500">
                            You have recused from this case. Voting controls disabled.
                          </p>
                        ) : voteEnabled ? (
                          <CommitRevealVoter
                            caseId={c.caseId}
                            walletAddress={walletAddress}
                            phase={c.status === 'committing' ? 'commit' : 'reveal'}
                            commitDeadline={c.commitDeadline}
                            revealDeadline={c.revealDeadline}
                            now={currentTime}
                          />
                        ) : (
                          <p
                            className="text-xs text-gray-500"
                            data-testid={`voting-disabled-${c.caseId}`}
                          >
                            Voting controls unavailable in the current phase.
                          </p>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-semibold text-gray-900">Upcoming Voting Deadlines</h2>
            {upcomingDeadlines.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500" data-testid="no-upcoming-deadlines">
                No upcoming deadlines.
              </p>
            ) : (
              <ul className="mt-4 space-y-2" data-testid="upcoming-deadlines-list">
                {upcomingDeadlines.map((d) => (
                  <li
                    key={`${d.caseId}-${d.kind}`}
                    className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium text-gray-900">{d.title}</span>{' '}
                      <span className="text-xs text-gray-500">
                        ({d.kind === 'commit' ? 'commit' : 'reveal'} phase)
                      </span>
                    </span>
                    <span className="font-mono text-xs text-gray-700">
                      {formatDeadline(d.deadline, currentTime)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="rounded-lg bg-white p-6 shadow">
            <h2 className="text-lg font-semibold text-gray-900">Standby Queue</h2>
            {standbyCases.length === 0 ? (
              <p className="mt-2 text-sm text-gray-500" data-testid="no-standby">
                You are not in any standby queue.
              </p>
            ) : (
              <ul className="mt-4 space-y-2" data-testid="standby-list">
                {standbyCases.map((c) => (
                  <li
                    key={c.caseId}
                    className="flex items-center justify-between rounded border border-gray-200 px-3 py-2 text-sm"
                  >
                    <span>
                      <span className="font-medium text-gray-900">{c.title}</span>{' '}
                      <span className="text-xs text-gray-500">
                        (position {c.standbyQueue.indexOf(walletAddress ?? '') + 1})
                      </span>
                    </span>
                    <span className="text-xs text-gray-500">{phaseLabel(c.status)}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>

        <aside className="space-y-6">
          <StakeReputationPanel walletAddress={walletAddress} readOnly={readOnly} />
        </aside>
      </div>

      {recuseError && (
        <div
          role="alert"
          className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800"
        >
          {recuseError}
        </div>
      )}

      {recuseCaseId && (
        <RecuseDialog
          caseId={recuseCaseId}
          onCancel={() => setRecuseCaseId(null)}
          onConfirm={handleRecuseConfirm}
          submitting={recusing}
        />
      )}
    </div>
  );
};

export default ArbitratorWorkbench;