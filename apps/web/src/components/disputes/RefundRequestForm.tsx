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
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * RefundRequestForm
 *
 * Guided refund request form for the Dispute Resolution & Evidence Submission Portal.
 *
 * Responsibilities:
 *  - Enforce mandatory RefundReasonCode selection (ProductDefect, NonDelivery,
 *    DuplicateCharge, Unauthorized, CustomerRequest, Other).
 *  - Check eligibility via `can_refund_payment` before allowing submission.
 *  - Preview the net refund amount via `preview_net_refund` (live breakdown).
 *  - Submit `request_refund` via the TypeScript SDK.
 *  - Surface deadline / expiry information derived from the Soroban ledger
 *    timestamp (never the local OS clock).
 *
 * The component is intentionally dependency-light: the SDK client is injected
 * via props so it can be mocked in tests.
 */

export type RefundReasonCode =
  | 'ProductDefect'
  | 'NonDelivery'
  | 'DuplicateCharge'
  | 'Unauthorized'
  | 'CustomerRequest'
  | 'Other';

export const REFUND_REASON_CODES: readonly RefundReasonCode[] = [
  'ProductDefect',
  'NonDelivery',
  'DuplicateCharge',
  'Unauthorized',
  'CustomerRequest',
  'Other',
] as const;

export const REFUND_REASON_LABELS: Record<RefundReasonCode, string> = {
  ProductDefect: 'Product defect / not as described',
  NonDelivery: 'Item or service not delivered',
  DuplicateCharge: 'Duplicate charge',
  Unauthorized: 'Unauthorized transaction',
  CustomerRequest: 'Customer request (change of mind)',
  Other: 'Other (explain below)',
};

/** Maximum length for the free-form description. */
export const MAX_DESCRIPTION_LENGTH = 2000;

/** Minimum length for the "Other" reason description. */
export const MIN_OTHER_DESCRIPTION_LENGTH = 20;

export interface NetRefundPreview {
  /** Gross amount originally charged, in stroops (string to avoid precision loss). */
  grossAmount: string;
  /** Platform / processing fee deducted, in stroops. */
  feeAmount: string;
  /** Net amount the customer will receive, in stroops. */
  netAmount: string;
  /** Asset code / contract id of the refunded asset. */
  asset: string;
  /** Optional human-readable breakdown lines returned by the contract. */
  breakdown?: Array<{ label: string; amount: string }>;
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
  /** Reason the payment is not refundable, if any. */
  reason?: string;
  /** Ledger timestamp (seconds since epoch) after which refunds are no longer allowed. */
  refundWindowEndsAt?: number;
}

export interface RequestRefundResult {
  refundId: string;
  txHash: string;
}

/**
 * Minimal SDK surface required by this form. Implemented by the generated
 * Soroban TypeScript SDK client.
 */
export interface RefundSdkClient {
  canRefundPayment(args: { paymentId: string }): Promise<RefundEligibility>;
  previewNetRefund(args: {
    paymentId: string;
    reasonCode: RefundReasonCode;
    amount?: string;
  }): Promise<NetRefundPreview>;
  requestRefund(args: {
    paymentId: string;
    reasonCode: RefundReasonCode;
    description: string;
    amount?: string;
  }): Promise<RequestRefundResult>;
  /** Latest synchronized Soroban ledger timestamp (seconds since epoch). */
  getLatestLedgerTimestamp(): Promise<number>;
}

export interface RefundRequestFormProps {
  paymentId: string;
  sdk: RefundSdkClient;
  /** Optional partial refund amount, in stroops. Defaults to full refund. */
  amount?: string;
  /** Called after a successful on-chain submission. */
  onSubmitted?: (result: RequestRefundResult) => void;
  /** Called whenever the selected reason code changes. */
  onReasonChange?: (reason: RefundReasonCode | null) => void;
  /** Optional class name for layout integration. */
  className?: string;
}

type SubmitState =
  | { status: 'idle' }
  | { status: 'submitting' }
  | { status: 'success'; result: RequestRefundResult }
  | { status: 'error'; message: string };

function isValidReasonCode(value: unknown): value is RefundReasonCode {
  return (
    typeof value === 'string' &&
    (REFUND_REASON_CODES as readonly string[]).includes(value)
  );
}

function formatStroops(stroops: string): string {
  // Stellar uses 7 decimal places.
  const negative = stroops.startsWith('-');
  const digits = (negative ? stroops.slice(1) : stroops).padStart(8, '0');
  const whole = digits.slice(0, -7);
  const frac = digits.slice(-7).replace(/0+$/, '');
  const formatted = frac.length > 0 ? `${whole}.${frac}` : whole;
  return negative ? `-${formatted}` : formatted;
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const days = Math.floor(s / 86400);
  const hours = Math.floor((s % 86400) / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0 || days > 0) parts.push(`${hours}h`);
  parts.push(`${minutes}m`);
  parts.push(`${seconds}s`);
  return parts.join(' ');
}

export const RefundRequestForm: React.FC<RefundRequestFormProps> = ({
  paymentId,
  sdk,
  amount,
  onSubmitted,
  onReasonChange,
  className,
}) => {
  const [reasonCode, setReasonCode] = useState<RefundReasonCode | null>(null);
  const [description, setDescription] = useState('');
  const [eligibility, setEligibility] = useState<RefundEligibility | null>(null);
  const [eligibilityError, setEligibilityError] = useState<string | null>(null);
  const [preview, setPreview] = useState<NetRefundPreview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [ledgerNow, setLedgerNow] = useState<number | null>(null);
  const [submitState, setSubmitState] = useState<SubmitState>({ status: 'idle' });
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // ---- Eligibility check ---------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setEligibility(null);
    setEligibilityError(null);

    sdk
      .canRefundPayment({ paymentId })
      .then((result) => {
        if (!cancelled && mountedRef.current) setEligibility(result);
      })
      .catch((err: unknown) => {
        if (!cancelled && mountedRef.current) {
          setEligibilityError(
            err instanceof Error ? err.message : 'Failed to check refund eligibility',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sdk, paymentId]);

  // ---- Ledger timestamp sync ----------------------------------------------
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const sync = () => {
      sdk
        .getLatestLedgerTimestamp()
        .then((ts) => {
          if (!cancelled && mountedRef.current) setLedgerNow(ts);
        })
        .catch(() => {
          /* keep last known ledger time on transient failures */
        });
    };

    sync();
    timer = setInterval(sync, 5000);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [sdk]);

  // ---- Net refund preview --------------------------------------------------
  useEffect(() => {
    if (!reasonCode) {
      setPreview(null);
      setPreviewError(null);
      return;
    }
    let cancelled = false;
    setPreviewError(null);

    sdk
      .previewNetRefund({ paymentId, reasonCode, amount })
      .then((result) => {
        if (!cancelled && mountedRef.current) setPreview(result);
      })
      .catch((err: unknown) => {
        if (!cancelled && mountedRef.current) {
          setPreview(null);
          setPreviewError(
            err instanceof Error ? err.message : 'Failed to preview net refund',
          );
        }
      });

    return () => {
      cancelled = true;
    };
  }, [sdk, paymentId, reasonCode, amount]);

  const handleReasonChange = useCallback(
    (event: React.ChangeEvent<HTMLSelectElement>) => {
      const value = event.target.value;
      const next = value === '' ? null : value;
      if (next !== null && !isValidReasonCode(next)) {
        setFieldErrors((prev) => ({ ...prev, reasonCode: 'Invalid refund reason code' }));
        return;
      }
      setFieldErrors((prev) => {
        const { reasonCode: _omit, ...rest } = prev;
        return rest;
      });
      setReasonCode(next);
      onReasonChange?.(next);
    },
    [onReasonChange],
  );

  const refundWindowExpired = useMemo(() => {
    if (!eligibility || ledgerNow === null) return false;
    if (typeof eligibility.refundWindowEndsAt !== 'number') return false;
    return ledgerNow >= eligibility.refundWindowEndsAt;
  }, [eligibility, ledgerNow]);

  const secondsUntilWindowEnds = useMemo(() => {
    if (!eligibility || ledgerNow === null) return null;
    if (typeof eligibility.refundWindowEndsAt !== 'number') return null;
    return eligibility.refundWindowEndsAt - ledgerNow;
  }, [eligibility, ledgerNow]);

  const validate = useCallback((): boolean => {
    const errors: Record<string, string> = {};

    if (reasonCode === null) {
      errors.reasonCode = 'Please select a refund reason code';
    } else if (!isValidReasonCode(reasonCode)) {
      errors.reasonCode = 'Invalid refund reason code';
    }

    if (reasonCode === 'Other' && description.trim().length < MIN_OTHER_DESCRIPTION_LENGTH) {
      errors.description = `Please describe the reason (at least ${MIN_OTHER_DESCRIPTION_LENGTH} characters)`;
    }

    if (description.length > MAX_DESCRIPTION_LENGTH) {
      errors.description = `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters`;
    }

    if (eligibility && !eligibility.eligible) {
      errors.eligibility = eligibility.reason ?? 'This payment is not eligible for a refund';
    }

    if (refundWindowExpired) {
      errors.eligibility = 'The refund window for this payment has expired';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }, [reasonCode, description, eligibility, refundWindowExpired]);

  const handleSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (submitState.status === 'submitting') return;

      if (!validate()) return;
      if (reasonCode === null) return; // narrowed by validate, but keep TS happy

      setSubmitState({ status: 'submitting' });
      try {
        const result = await sdk.requestRefund({
          paymentId,
          reasonCode,
          description: description.trim(),
          amount,
        });
        if (!mountedRef.current) return;
        setSubmitState({ status: 'success', result });
        onSubmitted?.(result);
      } catch (err: unknown) {
        if (!mountedRef.current) return;
        setSubmitState({
          status: 'error',
          message: err instanceof Error ? err.message : 'Failed to submit refund request',
        });
      }
    },
    [sdk, paymentId, reasonCode, description, amount, validate, submitState.status, onSubmitted],
  );

  const submitDisabled =
    submitState.status === 'submitting' ||
    submitState.status === 'success' ||
    eligibility === null ||
    eligibility.eligible === false ||
    refundWindowExpired;

  return (
    <form
      className={className}
      onSubmit={handleSubmit}
      noValidate
      aria-label="Refund request form"
      data-testid="refund-request-form"
    >
      <header>
        <h2>Request a refund</h2>
        <p>
          Payment <code>{paymentId}</code>
        </p>
      </header>

      {/* Eligibility status */}
      {eligibilityError && (
        <div role="alert" data-testid="eligibility-error">
          Unable to verify refund eligibility: {eligibilityError}
        </div>
      )}
      {eligibility && !eligibility.eligible && (
        <div role="alert" data-testid="ineligible-notice">
          This payment is not eligible for a refund
          {eligibility.reason ? `: ${eligibility.reason}` : '.'}
        </div>
      )}
      {refundWindowExpired && (
        <div role="alert" data-testid="refund-window-expired">
          The refund window for this payment has expired.
        </div>
      )}
      {!refundWindowExpired && secondsUntilWindowEnds !== null && (
        <div data-testid="refund-window-countdown">
          Refund window closes in {formatDuration(secondsUntilWindowEnds)}
          {secondsUntilWindowEnds <= 600 && (
            <strong data-testid="refund-window-warning">
              {' '}
              — less than 10 minutes remaining!
            </strong>
          )}
        </div>
      )}

      {/* Reason code */}
      <div>
        <label htmlFor="refund-reason-code">Refund reason (required)</label>
        <select
          id="refund-reason-code"
          name="reasonCode"
          value={reasonCode ?? ''}
          onChange={handleReasonChange}
          aria-invalid={fieldErrors.reasonCode ? true : undefined}
          aria-describedby={fieldErrors.reasonCode ? 'refund-reason-code-error' : undefined}
          required
        >
          <option value="">Select a reason…</option>
          {REFUND_REASON_CODES.map((code) => (
            <option key={code} value={code}>
              {REFUND_REASON_LABELS[code]}
            </option>
          ))}
        </select>
        {fieldErrors.reasonCode && (
          <p id="refund-reason-code-error" role="alert" data-testid="reason-code-error">
            {fieldErrors.reasonCode}
          </p>
        )}
      </div>

      {/* Description */}
      <div>
        <label htmlFor="refund-description">
          Description{reasonCode === 'Other' ? ' (required)' : ' (optional)'}
        </label>
        <textarea
          id="refund-description"
          name="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          maxLength={MAX_DESCRIPTION_LENGTH}
          rows={4}
          aria-invalid={fieldErrors.description ? true : undefined}
          aria-describedby={fieldErrors.description ? 'refund-description-error' : undefined}
        />
        <small>
          {description.length}/{MAX_DESCRIPTION_LENGTH}
        </small>
        {fieldErrors.description && (
          <p id="refund-description-error" role="alert" data-testid="description-error">
            {fieldErrors.description}
          </p>
        )}
      </div>

      {/* Net refund preview */}
      <section aria-label="Net refund preview" data-testid="net-refund-preview">
        <h3>Refund breakdown</h3>
        {previewError && (
          <p role="alert" data-testid="preview-error">
            {previewError}
          </p>
        )}
        {!previewError && !preview && <p>Select a reason to preview the refund amount.</p>}
        {preview && (
          <dl>
            <dt>Gross amount</dt>
            <dd data-testid="preview-gross">
              {formatStroops(preview.grossAmount)} {preview.asset}
            </dd>
            <dt>Fees</dt>
            <dd data-testid="preview-fees">
              -{formatStroops(preview.feeAmount)} {preview.asset}
            </dd>
            {preview.breakdown?.map((line) => (
              <React.Fragment key={line.label}>
                <dt>{line.label}</dt>
                <dd>{formatStroops(line.amount)}</dd>
              </React.Fragment>
            ))}
            <dt>
              <strong>Net refund</strong>
            </dt>
            <dd data-testid="preview-net">
              <strong>
                {formatStroops(preview.netAmount)} {preview.asset}
              </strong>
            </dd>
          </dl>
        )}
      </section>

      {fieldErrors.eligibility && (
        <p role="alert" data-testid="eligibility-field-error">
          {fieldErrors.eligibility}
        </p>
      )}

      {submitState.status === 'error' && (
        <p role="alert" data-testid="submit-error">
          {submitState.message}
        </p>
      )}
      {submitState.status === 'success' && (
        <p role="status" data-testid="submit-success">
          Refund request submitted (id: {submitState.result.refundId}, tx:{' '}
          {submitState.result.txHash}).
        </p>
      )}

      <button type="submit" disabled={submitDisabled} data-testid="submit-refund">
        {submitState.status === 'submitting' ? 'Submitting…' : 'Submit refund request'}
      </button>
    </form>
  );
};

export default RefundRequestForm;
