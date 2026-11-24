import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import RefundRequestForm from '../../components/disputes/RefundRequestForm';
import EvidenceUploader from '../../components/disputes/EvidenceUploader';

/**
 * DisputeWorkspace
 *
 * Unified tabbed case management view for escrow disputes and refund appeals.
 *
 * Escrow dispute lifecycle:
 *   dispute_escrow -> file_dispute_appeal -> submit_dispute_recommendation
 *
 * Refund lifecycle:
 *   request_refund -> file_appeal -> escalate_to_arbitration
 *                                  -> escalate_appeal_to_orchestrator
 *
 * All countdown timers are derived from the synchronized Soroban latest ledger
 * timestamp (provided by the backend / RPC sync layer), never from the local
 * OS clock, to avoid ledger-close race conditions.
 */

export type DisputeCaseKind = 'escrow' | 'refund';

export type RefundReasonCode =
  | 'ProductDefect'
  | 'NonDelivery'
  | 'DuplicateCharge'
  | 'Unauthorized'
  | 'CustomerRequest'
  | 'Other';

export const REFUND_REASON_CODES: RefundReasonCode[] = [
  'ProductDefect',
  'NonDelivery',
  'DuplicateCharge',
  'Unauthorized',
  'CustomerRequest',
  'Other',
];

export interface DisputeDeadlines {
  /** Unix seconds (Soroban ledger time) for evidence submission. */
  evidence_deadline?: number;
  /** Unix seconds (Soroban ledger time) for filing an appeal. */
  appeal_deadline?: number;
  /** Unix seconds (Soroban ledger time) for cooling-off window end. */
  cooling_off_until?: number;
  /** Unix seconds (Soroban ledger time) for escalation timeout. */
  escalation_timeout?: number;
}

export interface DisputeCase {
  id: string;
  kind: DisputeCaseKind;
  /** On-chain dispute / refund record identifier. */
  recordId: string;
  /** Payment or escrow identifier the case is attached to. */
  paymentId: string;
  counterparty: string;
  status: string;
  reasonCode?: RefundReasonCode;
  deadlines: DisputeDeadlines;
  /** Evidence commitments already submitted on-chain. */
  evidenceCommitments?: string[];
  /** Whether the current actor may still submit evidence. */
  canSubmitEvidence?: boolean;
  /** Whether the current actor may still file an appeal. */
  canFileAppeal?: boolean;
  /** Whether the current actor may escalate. */
  canEscalate?: boolean;
  createdAt?: number;
  updatedAt?: number;
}

export interface LedgerSyncState {
  /** Latest Soroban ledger close time in Unix seconds. */
  latestLedgerTimestamp: number;
  /** Local monotonic reference captured when the ledger timestamp was synced. */
  syncedAtLocalMs: number;
  /** Ledger sequence number of the synced ledger. */
  ledgerSequence?: number;
  /** Whether the sync is currently healthy. */
  healthy: boolean;
}

export interface DisputeWorkspaceProps {
  /** Cases to display. */
  cases: DisputeCase[];
  /** Synchronized ledger clock state. */
  ledgerSync: LedgerSyncState | null;
  /** Optional initial tab. */
  initialTab?: DisputeCaseKind;
  /** Optional initial selected case id. */
  initialCaseId?: string;
  /** Called when a refund request is submitted. */
  onSubmitRefundRequest?: (payload: {
    paymentId: string;
    reasonCode: RefundReasonCode;
    amount?: string;
    notes?: string;
  }) => Promise<void> | void;
  /** Called when evidence is uploaded and commitment submitted on-chain. */
  onSubmitEvidence?: (payload: {
    caseId: string;
    recordId: string;
    kind: DisputeCaseKind;
    commitments: string[];
  }) => Promise<void> | void;
  /** Called when the user files an appeal. */
  onFileAppeal?: (caseId: string) => Promise<void> | void;
  /** Called when the user escalates to arbitration (refund). */
  onEscalateToArbitration?: (caseId: string) => Promise<void> | void;
  /** Called when the user escalates an appeal to the orchestrator (refund). */
  onEscalateAppealToOrchestrator?: (caseId: string) => Promise<void> | void;
  /** Called when the user submits a dispute recommendation (escrow). */
  onSubmitDisputeRecommendation?: (caseId: string) => Promise<void> | void;
  /** Called to refresh ledger sync. */
  onRefreshLedgerSync?: () => Promise<void> | void;
  /** Optional class name. */
  className?: string;
}

const APPEAL_WARNING_WINDOW_SECONDS = 10 * 60; // final 10 minutes

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  if (days > 0) {
    return `${days}d ${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

/**
 * Derive the current Soroban ledger time from the synchronized state.
 * We anchor to the ledger timestamp and advance using the local monotonic
 * elapsed time since sync. This keeps timers aligned to ledger time rather
 * than the local wall clock (which may be skewed or manually changed).
 */
function deriveLedgerNow(sync: LedgerSyncState | null, syncedAtLocalMs: number): number | null {
  if (!sync || typeof sync.latestLedgerTimestamp !== 'number') return null;
  const elapsedMs = Math.max(0, Date.now() - syncedAtLocalMs);
  return sync.latestLedgerTimestamp + Math.floor(elapsedMs / 1000);
}

interface CountdownProps {
  label: string;
  deadline?: number;
  ledgerNow: number | null;
  warnWithinSeconds?: number;
  expiredLabel?: string;
}

const Countdown: React.FC<CountdownProps> = ({
  label,
  deadline,
  ledgerNow,
  warnWithinSeconds,
  expiredLabel = 'Expired',
}) => {
  if (typeof deadline !== 'number') {
    return (
      <div className="dispute-countdown dispute-countdown--unset">
        <span className="dispute-countdown__label">{label}</span>
        <span className="dispute-countdown__value">—</span>
      </div>
    );
  }

  if (ledgerNow === null) {
    return (
      <div className="dispute-countdown dispute-countdown--unsynced">
        <span className="dispute-countdown__label">{label}</span>
        <span className="dispute-countdown__value">Syncing…</span>
      </div>
    );
  }

  const remaining = deadline - ledgerNow;
  const expired = remaining <= 0;
  const warning =
    !expired &&
    typeof warnWithinSeconds === 'number' &&
    remaining <= warnWithinSeconds;

  return (
    <div
      className={[
        'dispute-countdown',
        expired ? 'dispute-countdown--expired' : '',
        warning ? 'dispute-countdown--warning' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      role="timer"
      aria-live={warning ? 'assertive' : 'off'}
    >
      <span className="dispute-countdown__label">{label}</span>
      <span className="dispute-countdown__value">
        {expired ? expiredLabel : formatDuration(remaining)}
      </span>
    </div>
  );
};

const DisputeWorkspace: React.FC<DisputeWorkspaceProps> = ({
  cases,
  ledgerSync,
  initialTab = 'refund',
  initialCaseId,
  onSubmitRefundRequest,
  onSubmitEvidence,
  onFileAppeal,
  onEscalateToArbitration,
  onEscalateAppealToOrchestrator,
  onSubmitDisputeRecommendation,
  onRefreshLedgerSync,
  className,
}) => {
  const [activeTab, setActiveTab] = useState<DisputeCaseKind>(initialTab);
  const [selectedCaseId, setSelectedCaseId] = useState<string | undefined>(
    initialCaseId,
  );
  const [ledgerNow, setLedgerNow] = useState<number | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [showNewRefundForm, setShowNewRefundForm] = useState(false);

  // Capture the local monotonic reference when the ledger sync changes.
  const syncedAtLocalRef = useRef<number>(Date.now());
  useEffect(() => {
    syncedAtLocalRef.current = ledgerSync?.syncedAtLocalMs ?? Date.now();
  }, [ledgerSync?.syncedAtLocalMs, ledgerSync?.latestLedgerTimestamp]);

  // Tick the ledger clock once per second.
  useEffect(() => {
    const tick = () => {
      setLedgerNow(deriveLedgerNow(ledgerSync, syncedAtLocalRef.current));
    };
    tick();
    const interval = window.setInterval(tick, 1000);
    return () => window.clearInterval(interval);
  }, [ledgerSync]);

  const filteredCases = useMemo(
    () => cases.filter((c) => c.kind === activeTab),
    [cases, activeTab],
  );

  const selectedCase = useMemo(() => {
    if (selectedCaseId) {
      const found = cases.find((c) => c.id === selectedCaseId);
      if (found) return found;
    }
    return filteredCases[0];
  }, [cases, filteredCases, selectedCaseId]);

  // Keep selection valid when switching tabs.
  useEffect(() => {
    if (
      selectedCase &&
      (!selectedCaseId || selectedCase.id !== selectedCaseId)
    ) {
      setSelectedCaseId(selectedCase.id);
    }
  }, [selectedCase, selectedCaseId]);

  const runAction = useCallback(
    async (key: string, fn?: () => Promise<void> | void) => {
      if (!fn) return;
      setActionError(null);
      setBusyAction(key);
      try {
        await fn();
      } catch (err) {
        setActionError(
          err instanceof Error ? err.message : 'Action failed. Please retry.',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [],
  );

  const handleRefreshSync = useCallback(async () => {
    if (!onRefreshLedgerSync) return;
    await runAction('sync', async () => {
      await onRefreshLedgerSync();
    });
  }, [onRefreshLedgerSync, runAction]);

  const handleEvidenceSubmit = useCallback(
    async (commitments: string[]) => {
      if (!selectedCase || !onSubmitEvidence) return;
      await runAction('evidence', async () => {
        await onSubmitEvidence({
          caseId: selectedCase.id,
          recordId: selectedCase.recordId,
          kind: selectedCase.kind,
          commitments,
        });
      });
    },
    [selectedCase, onSubmitEvidence, runAction],
  );

  const appealRemaining =
    selectedCase && ledgerNow !== null && typeof selectedCase.deadlines.appeal_deadline === 'number'
      ? selectedCase.deadlines.appeal_deadline - ledgerNow
      : null;

  const showAppealWarning =
    appealRemaining !== null &&
    appealRemaining > 0 &&
    appealRemaining <= APPEAL_WARNING_WINDOW_SECONDS;

  const evidenceExpired =
    selectedCase &&
    ledgerNow !== null &&
    typeof selectedCase.deadlines.evidence_deadline === 'number' &&
    selectedCase.deadlines.evidence_deadline - ledgerNow <= 0;

  const appealExpired =
    selectedCase &&
    ledgerNow !== null &&
    typeof selectedCase.deadlines.appeal_deadline === 'number' &&
    selectedCase.deadlines.appeal_deadline - ledgerNow <= 0;

  const canSubmitEvidence =
    !!selectedCase &&
    selectedCase.canSubmitEvidence !== false &&
    !evidenceExpired;

  const canFileAppeal =
    !!selectedCase &&
    selectedCase.canFileAppeal !== false &&
    !appealExpired;

  return (
    <div className={['dispute-workspace', className].filter(Boolean).join(' ')}>
      <header className="dispute-workspace__header">
        <div>
          <h1 className="dispute-workspace__title">Dispute Resolution</h1>
          <p className="dispute-workspace__subtitle">
            Manage escrow disputes and refund claims with deadline-aware evidence
            submission and appeals.
          </p>
        </div>
        <div className="dispute-workspace__sync">
          <span
            className={
              ledgerSync?.healthy
                ? 'dispute-workspace__sync-status dispute-workspace__sync-status--ok'
                : 'dispute-workspace__sync-status dispute-workspace__sync-status--stale'
            }
          >
            {ledgerSync?.healthy
              ? `Ledger #${ledgerSync.ledgerSequence ?? '—'} synced`
              : 'Ledger sync stale'}
          </span>
          {onRefreshLedgerSync && (
            <button
              type="button"
              className="dispute-workspace__sync-refresh"
              onClick={handleRefreshSync}
              disabled={busyAction === 'sync'}
            >
              {busyAction === 'sync' ? 'Syncing…' : 'Refresh ledger time'}
            </button>
          )}
        </div>
      </header>

      {ledgerNow === null && (
        <div className="dispute-workspace__banner dispute-workspace__banner--warning" role="alert">
          Waiting for synchronized Soroban ledger timestamp. Countdown timers are
          disabled until the ledger clock is available.
        </div>
      )}

      {showAppealWarning && (
        <div
          className="dispute-workspace__banner dispute-workspace__banner--danger"
          role="alert"
          aria-live="assertive"
        >
          <strong>Appeal deadline approaching:</strong> less than 10 minutes
          remain to file an appeal. Submit now to avoid a ledger-close race
          condition.
        </div>
      )}

      {actionError && (
        <div className="dispute-workspace__banner dispute-workspace__banner--error" role="alert">
          {actionError}
        </div>
      )}

      <nav className="dispute-workspace__tabs" role="tablist" aria-label="Case type">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'refund'}
          className={
            activeTab === 'refund'
              ? 'dispute-workspace__tab dispute-workspace__tab--active'
              : 'dispute-workspace__tab'
          }
          onClick={() => setActiveTab('refund')}
        >
          Refund Claims
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'escrow'}
          className={
            activeTab === 'escrow'
              ? 'dispute-workspace__tab dispute-workspace__tab--active'
              : 'dispute-workspace__tab'
          }
          onClick={() => setActiveTab('escrow')}
        >
          Escrow Disputes
        </button>
      </nav>

      <div className="dispute-workspace__body">
        <aside className="dispute-workspace__cases" aria-label="Cases">
          {activeTab === 'refund' && (
            <button
              type="button"
              className="dispute-workspace__new-case"
              onClick={() => setShowNewRefundForm((v) => !v)}
            >
              {showNewRefundForm ? 'Close refund request' : '+ New refund request'}
            </button>
          )}

          {filteredCases.length === 0 ? (
            <p className="dispute-workspace__empty">
              No {activeTab === 'refund' ? 'refund claims' : 'escrow disputes'} yet.
            </p>
          ) : (
            <ul className="dispute-workspace__case-list">
              {filteredCases.map((c) => {
                const isSelected = selectedCase?.id === c.id;
                return (
                  <li key={c.id}>
                    <button
                      type="button"
                      className={
                        isSelected
                          ? 'dispute-workspace__case dispute-workspace__case--active'
                          : 'dispute-workspace__case'
                      }
                      onClick={() => setSelectedCaseId(c.id)}
                      aria-current={isSelected ? 'true' : undefined}
                    >
                      <span className="dispute-workspace__case-id">{c.recordId}</span>
                      <span className="dispute-workspace__case-status">{c.status}</span>
                      {c.reasonCode && (
                        <span className="dispute-workspace__case-reason">
                          {c.reasonCode}
                        </span>
                      )}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </aside>

        <section className="dispute-workspace__detail" aria-label="Case detail">
          {showNewRefundForm && activeTab === 'refund' && (
            <div className="dispute-workspace__panel">
              <h2 className="dispute-workspace__panel-title">New Refund Request</h2>
              <RefundRequestForm
                onSubmit={async (payload) => {
                  await runAction('refund-request', async () => {
                    if (onSubmitRefundRequest) {
                      await onSubmitRefundRequest(payload);
                    }
                  });
                  setShowNewRefundForm(false);
                }}
                ledgerNow={ledgerNow}
              />
            </div>
          )}

          {!selectedCase ? (
            <p className="dispute-workspace__empty">
              Select a case to view details.
            </p>
          ) : (
            <>
              <div className="dispute-workspace__panel">
                <h2 className="dispute-workspace__panel-title">
                  {selectedCase.kind === 'refund' ? 'Refund Claim' : 'Escrow Dispute'}{' '}
                  <span className="dispute-workspace__record-id">
                    {selectedCase.recordId}
                  </span>
                </h2>
                <dl className="dispute-workspace__meta">
                  <div>
                    <dt>Status</dt>
                    <dd>{selectedCase.status}</dd>
                  </div>
                  <div>
                    <dt>Payment</dt>
                    <dd>{selectedCase.paymentId}</dd>
                  </div>
                  <div>
                    <dt>Counterparty</dt>
                    <dd>{selectedCase.counterparty}</dd>
                  </div>
                  {selectedCase.reasonCode && (
                    <div>
                      <dt>Reason</dt>
                      <dd>{selectedCase.reasonCode}</dd>
                    </div>
                  )}
                </dl>

                <div className="dispute-workspace__countdowns">
                  <Countdown
                    label="Evidence deadline"
                    deadline={selectedCase.deadlines.evidence_deadline}
                    ledgerNow={ledgerNow}
                    expiredLabel="Evidence window closed"
                  />
                  <Countdown
                    label="Appeal deadline"
                    deadline={selectedCase.deadlines.appeal_deadline}
                    ledgerNow={ledgerNow}
                    warnWithinSeconds={APPEAL_WARNING_WINDOW_SECONDS}
                    expiredLabel="Appeal window closed"
                  />
                  <Countdown
                    label="Cooling-off ends"
                    deadline={selectedCase.deadlines.cooling_off_until}
                    ledgerNow={ledgerNow}
                    expiredLabel="Cooling-off complete"
                  />
                  <Countdown
                    label="Escalation timeout"
                    deadline={selectedCase.deadlines.escalation_timeout}
                    ledgerNow={ledgerNow}
                    expiredLabel="Escalation expired"
                  />
                </div>

                <div className="dispute-workspace__actions">
                  {selectedCase.kind === 'refund' && (
                    <>
                      <button
                        type="button"
                        disabled={!canFileAppeal || busyAction === 'appeal'}
                        onClick={() =>
                          runAction('appeal', () =>
                            onFileAppeal ? onFileAppeal(selectedCase.id) : undefined,
                          )
                        }
                      >
                        {busyAction === 'appeal' ? 'Filing…' : 'File appeal'}
                      </button>
                      <button
                        type="button"
                        disabled={
                          selectedCase.canEscalate === false ||
                          busyAction === 'arbitration'
                        }
                        onClick={() =>
                          runAction('arbitration', () =>
                            onEscalateToArbitration
                              ? onEscalateToArbitration(selectedCase.id)
                              : undefined,
                          )
                        }
                      >
                        {busyAction === 'arbitration'
                          ? 'Escalating…'
                          : 'Escalate to arbitration'}
                      </button>
                      <button
                        type="button"
                        disabled={
                          selectedCase.canEscalate === false ||
                          busyAction === 'orchestrator'
                        }
                        onClick={() =>
                          runAction('orchestrator', () =>
                            onEscalateAppealToOrchestrator
                              ? onEscalateAppealToOrchestrator(selectedCase.id)
                              : undefined,
                          )
                        }
                      >
                        {busyAction === 'orchestrator'
                          ? 'Escalating…'
                          : 'Escalate appeal to orchestrator'}
                      </button>
                    </>
                  )}

                  {selectedCase.kind === 'escrow' && (
                    <>
                      <button
                        type="button"
                        disabled={!canFileAppeal || busyAction === 'appeal'}
                        onClick={() =>
                          runAction('appeal', () =>
                            onFileAppeal ? onFileAppeal(selectedCase.id) : undefined,
                          )
                        }
                      >
                        {busyAction === 'appeal' ? 'Filing…' : 'File dispute appeal'}
                      </button>
                      <button
                        type="button"
                        disabled={busyAction === 'recommendation'}
                        onClick={() =>
                          runAction('recommendation', () =>
                            onSubmitDisputeRecommendation
                              ? onSubmitDisputeRecommendation(selectedCase.id)
                              : undefined,
                          )
                        }
                      >
                        {busyAction === 'recommendation'
                          ? 'Submitting…'
                          : 'Submit dispute recommendation'}
                      </button>
                    </>
                  )}
                </div>
              </div>

              <div className="dispute-workspace__panel">
                <h3 className="dispute-workspace__panel-title">Evidence</h3>
                {evidenceExpired && (
                  <div
                    className="dispute-workspace__banner dispute-workspace__banner--warning"
                    role="alert"
                  >
                    The evidence deadline has passed. New evidence can no longer be
                    submitted for this case.
                  </div>
                )}
                <EvidenceUploader
                  caseId={selectedCase.id}
                  recordId={selectedCase.recordId}
                  disabled={!canSubmitEvidence}
                  existingCommitments={selectedCase.evidenceCommitments ?? []}
                  onSubmitCommitments={handleEvidenceSubmit}
                />
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
};

export default DisputeWorkspace;