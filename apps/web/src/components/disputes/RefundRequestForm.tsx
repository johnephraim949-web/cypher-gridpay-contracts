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