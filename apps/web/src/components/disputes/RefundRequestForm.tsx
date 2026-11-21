import React, { useMemo, useState } from 'react';

export type RefundReasonCode =
  | 'ProductDefect'
  | 'DuplicateCharge'
  | 'NonDelivery'
  | 'WrongItem'
  | 'UnauthorizedTransaction'
  | 'Other';

export interface RefundPolicySnapshot {
  policyId: string;
  windowDays: number;
  restockingFeeBps: number;
  coolingOffHours: number;
  capturedAt: string;
}

export interface NetRefundPreview {
  grossAmount: number;
  restockingFee: number;
  processingFee: number;
  netAmount: number;
  currency: string;
}

export interface RefundEligibility {
  eligible: boolean;
  instantAutoRefund: boolean;
  reason?: 'expired_window' | 'already_refunded' | 'rate_limited' | 'locked_in_escrow';
  message?: string;
}

export interface EvidenceFile {
  id: string;
  name: string;
  sizeBytes: number;
  sha256: string;
}

export interface RefundRequestFormProps {
  paymentId: string;
  policy: RefundPolicySnapshot;
  preview: NetRefundPreview;
  eligibility: RefundEligibility;
  onSubmit?: (payload: {
    paymentId: string;
    reasonCode: RefundReasonCode;
    evidence: EvidenceFile[];
  }) => void;
  onOpenEscrowDispute?: () => void;
}

interface ReasonOption {
  code: RefundReasonCode;
  label: string;
  scenario: string;
  evidence: string[];
}

const REASON_OPTIONS: ReasonOption[] = [
  {
    code: 'ProductDefect',
    label: 'Item arrived damaged or defective',
    scenario: 'The product does not work or arrived broken.',
    evidence: ['Photos of the damage', 'Unboxing video if available', 'Merchant chat confirming the defect'],
  },
  {
    code: 'DuplicateCharge',
    label: 'Charged twice',
    scenario: 'You were billed more than once for the same order.',
    evidence: ['Bank or card statement showing both charges', 'Order confirmation'],
  },
  {
    code: 'NonDelivery',
    label: 'Never received the item',
    scenario: 'The order never arrived and tracking is missing or stale.',
    evidence: ['Tracking number and carrier status', 'Merchant messages about shipping'],
  },
  {
    code: 'WrongItem',
    label: 'Received the wrong item',
    scenario: 'A different product or size arrived.',
    evidence: ['Photo of the item received', 'Original order listing'],
  },
  {
    code: 'UnauthorizedTransaction',
    label: 'I did not authorize this charge',
    scenario: 'The payment was made without your consent.',
    evidence: ['Statement highlighting the charge', 'Any fraud report reference'],
  },
  {
    code: 'Other',
    label: 'Something else',
    scenario: 'Another issue not covered above.',
    evidence: ['A written description of the issue', 'Any supporting screenshots'],
  },
];

const STEPS = ['Select Issue', 'Eligibility & Net Payout', 'Attach Evidence', 'Review & Submit'] as const;

const formatMoney = (amount: number, currency: string) =>
  `${currency} ${amount.toFixed(2)}`;

const INELIGIBLE_NEXT_STEPS: Record<string, string> = {
  expired_window: 'The merchant refund window has closed. You may still open an Escrow Dispute.',
  already_refunded: 'This payment was already fully refunded. No further action is needed.',
  rate_limited: 'Too many recent claims were filed. Please wait before filing again.',
  locked_in_escrow: 'Funds are locked in escrow. Open an Escrow Dispute to resolve this.',
};

export const RefundRequestForm: React.FC<RefundRequestFormProps> = ({
  paymentId,
  policy,
  preview,
  eligibility,
  onSubmit,
  onOpenEscrowDispute,
}) => {
  const [step, setStep] = useState(0);
  const [reasonCode, setReasonCode] = useState<RefundReasonCode | null>(null);
  const [evidence, setEvidence] = useState<EvidenceFile[]>([]);

  const selectedReason = useMemo(
    () => REASON_OPTIONS.find((option) => option.code === reasonCode) ?? null,
    [reasonCode],
  );

  const totalEvidenceBytes = evidence.reduce((sum, file) => sum + file.sizeBytes, 0);

  const canAdvance =
    (step === 0 && reasonCode !== null) ||
    (step === 1 && eligibility.eligible) ||
    step === 2 ||
    step === 3;

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    const next: EvidenceFile[] = Array.from(files).map((file, index) => ({
      id: `${Date.now()}-${index}`,
      name: file.name,
      sizeBytes: file.size,
      sha256: 'pending-local-hash',
    }));
    setEvidence((prev) => [...prev, ...next]);
  };

  const handleSubmit = () => {
    if (!reasonCode || !eligibility.eligible) return;
    onSubmit?.({ paymentId, reasonCode, evidence });
  };

  return (
    <div className="refund-wizard">
      <ol className="refund-wizard__steps">
        {STEPS.map((label, index) => (
          <li
            key={label}
            className={index === step ? 'is-active' : index < step ? 'is-complete' : ''}
          >
            {index + 1}. {label}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <section aria-label="Select issue">
          <h2>What went wrong?</h2>
          <div className="refund-wizard__cards">
            {REASON_OPTIONS.map((option) => (
              <button
                key={option.code}
                type="button"
                className={reasonCode === option.code ? 'is-selected' : ''}
                onClick={() => setReasonCode(option.code)}
              >
                <strong>{option.label}</strong>
                <span>{option.scenario}</span>
              </button>
            ))}
          </div>
          {selectedReason && (
            <aside className="refund-wizard__guidance">
              <h3>Evidence that strengthens this claim</h3>
              <ul>
                {selectedReason.evidence.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </aside>
          )}
        </section>
      )}

      {step === 1 && (
        <section aria-label="Eligibility and net payout preview">
          <h2>Eligibility &amp; Net Payout</h2>
          <dl className="refund-wizard__policy">
            <dt>Merchant policy at time of purchase</dt>
            <dd>
              {policy.policyId} — {policy.windowDays}-day window,{' '}
              {(policy.restockingFeeBps / 100).toFixed(2)}% restocking fee
            </dd>
            <dt>Cooling-off period</dt>
            <dd>{policy.coolingOffHours}h</dd>
          </dl>
          <dl className="refund-wizard__payout">
            <dt>Gross amount</dt>
            <dd>{formatMoney(preview.grossAmount, preview.currency)}</dd>
            <dt>Restocking fee</dt>
            <dd>-{formatMoney(preview.restockingFee, preview.currency)}</dd>
            <dt>Processing fee</dt>
            <dd>-{formatMoney(preview.processingFee, preview.currency)}</dd>
            <dt>Expected net payout</dt>
            <dd>{formatMoney(preview.netAmount, preview.currency)}</dd>
          </dl>
          {eligibility.eligible ? (
            <p className="refund-wizard__qualify">
              {eligibility.instantAutoRefund
                ? 'This claim qualifies for Instant Auto-Refund.'
                : 'This claim will go to Merchant Review.'}
            </p>
          ) : (
            <div className="refund-wizard__ineligible" role="alert">
              <p>{eligibility.message ?? 'This payment is not eligible for a refund.'}</p>
              {eligibility.reason && <p>{INELIGIBLE_NEXT_STEPS[eligibility.reason]}</p>}
              {onOpenEscrowDispute && (
                <button type="button" onClick={onOpenEscrowDispute}>
                  Open Escrow Dispute instead
                </button>
              )}
            </div>
          )}
        </section>
      )}

      {step === 2 && (
        <section aria-label="Attach evidence">
          <h2>Attach Evidence</h2>
          <label className="refund-wizard__dropzone">
            <input
              type="file"
              multiple
              onChange={(event) => handleFiles(event.target.files)}
            />
            Drag and drop files here, or click to browse.
          </label>
          <p className="refund-wizard__privacy">
            EXIF metadata is stripped locally before upload. Only a SHA-256 hash is
            committed on-chain; file contents are stored off-chain.
          </p>
          <ul className="refund-wizard__evidence">
            {evidence.map((file) => (
              <li key={file.id}>
                <span>{file.name}</span>
                <code>{file.sha256}</code>
                <span className="badge">EXIF metadata stripped locally</span>
              </li>
            ))}
          </ul>
          <p className="refund-wizard__meter">
            {evidence.length} file(s) — {(totalEvidenceBytes / 1024).toFixed(1)} KB
          </p>
        </section>
      )}

      {step === 3 && (
        <section aria-label="Review and submit">
          <h2>Review &amp; Submit</h2>
          <p>Reason: {selectedReason?.label ?? '—'}</p>
          <p>Evidence attached: {evidence.length}</p>
          <p className="refund-wizard__timeline">
            Merchant has 48h to respond. If denied, you may appeal after the{' '}
            {policy.coolingOffHours}h cooling-off window.
          </p>
          <button type="button" onClick={handleSubmit} disabled={!eligibility.eligible}>
            Submit Refund Request
          </button>
        </section>
      )}

      <footer className="refund-wizard__nav">
        <button type="button" disabled={step === 0} onClick={() => setStep((s) => s - 1)}>
          Back
        </button>
        {step < STEPS.length - 1 && (
          <button type="button" disabled={!canAdvance} onClick={() => setStep((s) => s + 1)}>
            Next
          </button>
        )}
      </footer>
    </div>
  );
};

export default RefundRequestForm;
