import React, { useCallback, useMemo, useState } from 'react';

/**
 * QuorumTracker
 * ------------------------------------------------------------------
 * Multi-party escrow approval quorum widget.
 *
 * Renders each participant's weight, the accumulated approval weight
 * against the escrow threshold (bps), and each participant's initiation
 * (acceptance) status. Provides one-click `accept_multi_party_escrow`
 * and `approve_release` actions for eligible signers, and enables
 * `release_multi_party_escrow` precisely when the weighted threshold
 * is met.
 *
 * Mutating actions are hidden/disabled when:
 *  - `verify_escrow_participant` returns false for the connected viewer
 *  - the viewer is only an `EscrowObserver`
 */

export type EscrowParticipantRole =
  | 'Customer'
  | 'Merchant'
  | 'Arbiter'
  | 'Observer'
  | string;

export interface EscrowParticipant {
  /** Stellar address of the participant */
  address: string;
  /** Human-readable label (optional) */
  label?: string;
  /** Role within the escrow */
  role: EscrowParticipantRole;
  /** Weight in basis points (e.g. 5000 = 50%) */
  weightBps: number;
  /** Whether the participant has accepted/initiated the escrow */
  accepted: boolean;
  /** Whether the participant has approved release */
  approvedRelease?: boolean;
}

export interface QuorumTrackerProps {
  /** All participants of the multi-party escrow */
  participants: EscrowParticipant[];
  /** Required approval threshold in basis points (0-10000) */
  thresholdBps: number;
  /** Connected viewer address (may be undefined when disconnected) */
  viewerAddress?: string;
  /**
   * Result of `verify_escrow_participant` for the connected viewer.
   * When false, all mutating actions are hidden.
   */
  isVerifiedParticipant: boolean;
  /** True when the viewer is only an EscrowObserver (read-only) */
  isObserver?: boolean;
  /** Whether the escrow is still open for acceptance */
  isInitiationOpen?: boolean;
  /** Whether the escrow is currently in the release-approval phase */
  isReleasePhase?: boolean;
  /** Whether the escrow has already been released/finalized */
  isFinalized?: boolean;
  /** Optional: disable all actions (e.g. while a tx is pending) */
  disabled?: boolean;
  /** Callback: accept_multi_party_escrow */
  onAcceptEscrow?: () => Promise<void> | void;
  /** Callback: approve_release */
  onApproveRelease?: () => Promise<void> | void;
  /** Callback: release_multi_party_escrow */
  onReleaseEscrow?: () => Promise<void> | void;
  /** Optional error message to display */
  errorMessage?: string;
}

const BPS_DENOMINATOR = 10_000;

function clampBps(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(BPS_DENOMINATOR, Math.round(value)));
}

function formatBps(bps: number): string {
  return `${(clampBps(bps) / 100).toFixed(2)}%`;
}

function shortAddress(address: string): string {
  if (!address) return '';
  if (address.length <= 12) return address;
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export const QuorumTracker: React.FC<QuorumTrackerProps> = ({
  participants,
  thresholdBps,
  viewerAddress,
  isVerifiedParticipant,
  isObserver = false,
  isInitiationOpen = false,
  isReleasePhase = false,
  isFinalized = false,
  disabled = false,
  onAcceptEscrow,
  onApproveRelease,
  onReleaseEscrow,
  errorMessage,
}) => {
  const [pendingAction, setPendingAction] = useState<
    'accept' | 'approve' | 'release' | null
  >(null);
  const [localError, setLocalError] = useState<string | null>(null);

  const normalizedThreshold = clampBps(thresholdBps);

  const { accumulatedWeightBps, acceptedWeightBps } = useMemo(() => {
    let approved = 0;
    let accepted = 0;
    for (const p of participants) {
      const w = clampBps(p.weightBps);
      if (p.approvedRelease) approved += w;
      if (p.accepted) accepted += w;
    }
    return {
      accumulatedWeightBps: Math.min(approved, BPS_DENOMINATOR),
      acceptedWeightBps: Math.min(accepted, BPS_DENOMINATOR),
    };
  }, [participants]);

  const thresholdMet = accumulatedWeightBps >= normalizedThreshold;
  const progressPct =
    normalizedThreshold > 0
      ? Math.min(100, (accumulatedWeightBps / normalizedThreshold) * 100)
      : 0;

  const viewerParticipant = useMemo(() => {
    if (!viewerAddress) return undefined;
    return participants.find(
      (p) => p.address.toLowerCase() === viewerAddress.toLowerCase(),
    );
  }, [participants, viewerAddress]);

  const viewerIsObserverRole =
    isObserver || viewerParticipant?.role === 'Observer';

  const canMutate =
    Boolean(viewerAddress) &&
    isVerifiedParticipant &&
    !viewerIsObserverRole &&
    !isFinalized &&
    !disabled;

  const canAccept =
    canMutate &&
    isInitiationOpen &&
    Boolean(viewerParticipant) &&
    !viewerParticipant?.accepted &&
    typeof onAcceptEscrow === 'function';

  const canApproveRelease =
    canMutate &&
    isReleasePhase &&
    Boolean(viewerParticipant) &&
    viewerParticipant?.accepted === true &&
    !viewerParticipant?.approvedRelease &&
    typeof onApproveRelease === 'function';

  const canRelease =
    canMutate &&
    isReleasePhase &&
    thresholdMet &&
    typeof onReleaseEscrow === 'function';

  const runAction = useCallback(
    async (
      kind: 'accept' | 'approve' | 'release',
      fn?: () => Promise<void> | void,
    ) => {
      if (!fn) return;
      setLocalError(null);
      setPendingAction(kind);
      try {
        await fn();
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Transaction failed';
        setLocalError(message);
      } finally {
        setPendingAction(null);
      }
    },
    [],
  );

  const displayError = errorMessage ?? localError;

  return (
    <section
      className="quorum-tracker"
      aria-label="Multi-party approval quorum"
      data-testid="quorum-tracker"
    >
      <header className="quorum-tracker__header">
        <h3 className="quorum-tracker__title">Approval Quorum</h3>
        {viewerIsObserverRole && (
          <span
            className="quorum-tracker__badge quorum-tracker__badge--observer"
            data-testid="observer-badge"
            title="You are a read-only observer for this escrow"
          >
            Observer (read-only)
          </span>
        )}
        {!isVerifiedParticipant && viewerAddress && !viewerIsObserverRole && (
          <span
            className="quorum-tracker__badge quorum-tracker__badge--unverified"
            data-testid="unverified-badge"
            title="verify_escrow_participant returned false for your address"
          >
            Not a verified participant
          </span>
        )}
      </header>

      <div className="quorum-tracker__summary">
        <div className="quorum-tracker__metric">
          <span className="quorum-tracker__metric-label">Approved weight</span>
          <span
            className="quorum-tracker__metric-value"
            data-testid="accumulated-weight"
          >
            {formatBps(accumulatedWeightBps)}
          </span>
        </div>
        <div className="quorum-tracker__metric">
          <span className="quorum-tracker__metric-label">Threshold</span>
          <span
            className="quorum-tracker__metric-value"
            data-testid="threshold-weight"
          >
            {formatBps(normalizedThreshold)}
          </span>
        </div>
        <div className="quorum-tracker__metric">
          <span className="quorum-tracker__metric-label">Accepted weight</span>
          <span
            className="quorum-tracker__metric-value"
            data-testid="accepted-weight"
          >
            {formatBps(acceptedWeightBps)}
          </span>
        </div>
      </div>

      <div
        className="quorum-tracker__progress"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(progressPct)}
        aria-label="Weighted approval progress"
        data-testid="quorum-progress"
        data-threshold-met={thresholdMet ? 'true' : 'false'}
      >
        <div
          className={
            'quorum-tracker__progress-fill' +
            (thresholdMet ? ' quorum-tracker__progress-fill--met' : '')
          }
          style={{ width: `${progressPct}%` }}
        />
      </div>
      <p className="quorum-tracker__progress-caption">
        {thresholdMet
          ? 'Threshold met — release is available.'
          : `${formatBps(
              Math.max(0, normalizedThreshold - accumulatedWeightBps),
            )} more approval weight required.`}
      </p>

      <ul className="quorum-tracker__participants">
        {participants.map((p) => {
          const isViewer =
            Boolean(viewerAddress) &&
            p.address.toLowerCase() === viewerAddress!.toLowerCase();
          return (
            <li
              key={p.address}
              className={
                'quorum-tracker__participant' +
                (isViewer ? ' quorum-tracker__participant--viewer' : '')
              }
              data-testid={`participant-${p.address}`}
            >
              <div className="quorum-tracker__participant-main">
                <span className="quorum-tracker__participant-label">
                  {p.label ?? shortAddress(p.address)}
                  {isViewer && (
                    <span className="quorum-tracker__you"> (you)</span>
                  )}
                </span>
                <span className="quorum-tracker__participant-role">
                  {p.role}
                </span>
              </div>
              <div className="quorum-tracker__participant-meta">
                <span
                  className="quorum-tracker__participant-weight"
                  title="Approval weight"
                >
                  {formatBps(p.weightBps)}
                </span>
                <span
                  className={
                    'quorum-tracker__status' +
                    (p.accepted
                      ? ' quorum-tracker__status--accepted'
                      : ' quorum-tracker__status--pending')
                  }
                  data-testid={`acceptance-${p.address}`}
                >
                  {p.accepted ? 'Accepted' : 'Pending acceptance'}
                </span>
                {isReleasePhase && (
                  <span
                    className={
                      'quorum-tracker__status' +
                      (p.approvedRelease
                        ? ' quorum-tracker__status--accepted'
                        : ' quorum-tracker__status--pending')
                    }
                    data-testid={`approval-${p.address}`}
                  >
                    {p.approvedRelease ? 'Release approved' : 'Release pending'}
                  </span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

      {displayError && (
        <p
          className="quorum-tracker__error"
          role="alert"
          data-testid="quorum-error"
        >
          {displayError}
        </p>
      )}

      <div className="quorum-tracker__actions">
        {canAccept && (
          <button
            type="button"
            className="quorum-tracker__button quorum-tracker__button--primary"
            onClick={() => runAction('accept', onAcceptEscrow)}
            disabled={pendingAction !== null}
            data-testid="accept-escrow-button"
          >
            {pendingAction === 'accept'
              ? 'Accepting…'
              : 'Accept multi-party escrow'}
          </button>
        )}

        {canApproveRelease && (
          <button
            type="button"
            className="quorum-tracker__button quorum-tracker__button--primary"
            onClick={() => runAction('approve', onApproveRelease)}
            disabled={pendingAction !== null}
            data-testid="approve-release-button"
          >
            {pendingAction === 'approve' ? 'Approving…' : 'Approve release'}
          </button>
        )}

        {canRelease && (
          <button
            type="button"
            className="quorum-tracker__button quorum-tracker__button--release"
            onClick={() => runAction('release', onReleaseEscrow)}
            disabled={pendingAction !== null}
            data-testid="release-escrow-button"
          >
            {pendingAction === 'release'
              ? 'Releasing…'
              : 'Release multi-party escrow'}
          </button>
        )}

        {!canMutate && !isFinalized && (
          <p
            className="quorum-tracker__hint"
            data-testid="quorum-readonly-hint"
          >
            {viewerIsObserverRole
              ? 'Observers cannot sign or release this escrow.'
              : !viewerAddress
                ? 'Connect a wallet to participate.'
                : !isVerifiedParticipant
                  ? 'Your address is not a verified participant of this escrow.'
                  : 'Actions are currently unavailable.'}
          </p>
        )}

        {isFinalized && (
          <p className="quorum-tracker__hint" data-testid="quorum-finalized">
            This escrow has been finalized.
          </p>
        )}
      </div>
    </section>
  );
};

export default QuorumTracker;