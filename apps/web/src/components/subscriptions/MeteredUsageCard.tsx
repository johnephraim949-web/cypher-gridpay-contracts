import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { decodeGridPayError } from '../../utils/errors';

/**
 * MeteredUsageCard
 *
 * Displays current-period metered consumption, hard/soft billing caps,
 * projected end-of-cycle invoice amount, and provides an interactive
 * form for authorized reporters to submit `report_usage` and update
 * billing caps via `set_billing_cap`.
 *
 * Contract interactions are injected via props so this component stays
 * decoupled from any specific wallet/SDK wiring.
 */

export interface MeteredUsage {
  /** Raw usage amount for the current period (base units). */
  currentUsage: bigint;
  /** Hard cap in base units (0n means no hard cap). */
  hardCap: bigint;
  /** Soft cap in base units (0n means no soft cap). */
  softCap: bigint;
  /** Unit price in base units per usage unit. */
  unitPrice: bigint;
  /** Billing period start (unix seconds). */
  periodStart: number;
  /** Billing period end (unix seconds). */
  periodEnd: number;
  /** Optional currency label for display. */
  currency?: string;
  /** Optional decimals for display formatting. */
  decimals?: number;
}

export interface MeteredUsageCardProps {
  /** Subscription identifier. */
  subscriptionId: string;
  /** Whether the connected account is an authorized usage reporter. */
  isAuthorizedReporter: boolean;
  /** Whether the connected account may edit billing caps (merchant/owner). */
  canEditCaps: boolean;
  /** Loads current usage + cap state from the contract. */
  loadUsage: (subscriptionId: string) => Promise<MeteredUsage>;
  /** Submits a usage report to the contract. */
  reportUsage: (subscriptionId: string, amount: bigint) => Promise<unknown>;
  /** Updates the billing cap on the contract. */
  setBillingCap: (
    subscriptionId: string,
    hardCap: bigint,
    softCap: bigint,
  ) => Promise<unknown>;
  /** Optional callback fired after a successful mutation. */
  onUpdated?: () => void;
  /** Optional current ledger timestamp (unix seconds) for eligibility checks. */
  ledgerTimestamp?: number;
}

const ZERO = BigInt(0);

function formatAmount(
  value: bigint,
  decimals: number = 7,
  currency?: string,
): string {
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const num = fracStr.length > 0 ? `${wholeStr}.${fracStr}` : wholeStr;
  const signed = negative ? `-${num}` : num;
  return currency ? `${signed} ${currency}` : signed;
}

function parseAmount(input: string, decimals: number = 7): bigint | null {
  const trimmed = input.trim();
  if (trimmed === '') return null;
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null;
  const [wholePart, fracPartRaw = ''] = trimmed.split('.');
  if (fracPartRaw.length > decimals) return null;
  const fracPart = fracPartRaw.padEnd(decimals, '0');
  try {
    return BigInt(wholePart) * BigInt(10) ** BigInt(decimals) + BigInt(fracPart);
  } catch {
    return null;
  }
}

function progressPercent(usage: bigint, cap: bigint): number {
  if (cap <= ZERO) return 0;
  const scaled = (usage * BigInt(10000)) / cap;
  const pct = Number(scaled) / 100;
  return Math.max(0, Math.min(100, pct));
}

interface CapProgressBarProps {
  label: string;
  usage: bigint;
  cap: bigint;
  decimals: number;
  currency?: string;
  tone: 'soft' | 'hard';
}

const CapProgressBar: React.FC<CapProgressBarProps> = ({
  label,
  usage,
  cap,
  decimals,
  currency,
  tone,
}) => {
  const hasCap = cap > ZERO;
  const pct = progressPercent(usage, cap);
  const exceeded = hasCap && usage > cap;
  const color = exceeded
    ? '#dc2626'
    : tone === 'hard'
      ? pct >= 90
        ? '#f59e0b'
        : '#2563eb'
      : pct >= 90
        ? '#f59e0b'
        : '#10b981';

  return (
    <div className="metered-cap-bar" data-testid={`cap-bar-${tone}`}>
      <div className="metered-cap-bar__header">
        <span className="metered-cap-bar__label">{label}</span>
        <span className="metered-cap-bar__value">
          {hasCap
            ? `${formatAmount(usage, decimals, currency)} / ${formatAmount(
                cap,
                decimals,
                currency,
              )}`
            : 'No cap set'}
        </span>
      </div>
      <div
        className="metered-cap-bar__track"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pct)}
        aria-label={label}
      >
        <div
          className="metered-cap-bar__fill"
          style={{ width: `${hasCap ? pct : 0}%`, backgroundColor: color }}
        />
      </div>
      {exceeded && (
        <p className="metered-cap-bar__warning" role="alert">
          {tone === 'hard'
            ? 'Hard cap exceeded — further usage may be blocked.'
            : 'Soft cap exceeded — overage billing may apply.'}
        </p>
      )}
    </div>
  );
};

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel,
  onConfirm,
  onCancel,
  busy,
}) => {
  if (!open) return null;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true">
      <div className="modal" data-testid="confirm-dialog">
        <h3 className="modal__title">{title}</h3>
        <div className="modal__body">{message}</div>
        <div className="modal__actions">
          <button
            type="button"
            className="btn btn-outline"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirm-dialog-confirm"
          >
            {busy ? 'Submitting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const MeteredUsageCard: React.FC<MeteredUsageCardProps> = ({
  subscriptionId,
  isAuthorizedReporter,
  canEditCaps,
  loadUsage,
  reportUsage,
  setBillingCap,
  onUpdated,
}) => {
  const [usage, setUsage] = useState<MeteredUsage | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [reportInput, setReportInput] = useState<string>('');
  const [reportError, setReportError] = useState<string | null>(null);
  const [reportBusy, setReportBusy] = useState<boolean>(false);
  const [reportSuccess, setReportSuccess] = useState<string | null>(null);

  const [hardCapInput, setHardCapInput] = useState<string>('');
  const [softCapInput, setSoftCapInput] = useState<string>('');
  const [capError, setCapError] = useState<string | null>(null);
  const [capBusy, setCapBusy] = useState<boolean>(false);
  const [capSuccess, setCapSuccess] = useState<string | null>(null);
  const [confirmCapOpen, setConfirmCapOpen] = useState<boolean>(false);

  const decimals = usage?.decimals ?? 7;
  const currency = usage?.currency;

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const next = await loadUsage(subscriptionId);
      setUsage(next);
      setHardCapInput(
        next.hardCap > ZERO ? formatAmount(next.hardCap, next.decimals ?? 7, undefined) : '',
      );
      setSoftCapInput(
        next.softCap > ZERO ? formatAmount(next.softCap, next.decimals ?? 7, undefined) : '',
      );
    } catch (err) {
      setLoadError(decodeGridPayError(err).message);
    } finally {
      setLoading(false);
    }
  }, [loadUsage, subscriptionId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const projectedInvoice = useMemo<bigint>(() => {
    if (!usage) return ZERO;
    return usage.currentUsage * usage.unitPrice;
  }, [usage]);

  const capState = useMemo<'active' | 'metered-near-cap' | 'metered-capped'>(() => {
    if (!usage || usage.hardCap <= ZERO) return 'active';
    const ratio = (usage.currentUsage * BigInt(10_000)) / usage.hardCap;
    if (ratio >= BigInt(10_000)) return 'metered-capped';
    if (ratio >= BigInt(8_000)) return 'metered-near-cap';
    return 'active';
  }, [usage]);

  const periodLabel = useMemo(() => {
    if (!usage) return '';
    const fmt = (ts: number) =>
      new Date(ts * 1000).toLocaleDateString(undefined, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      });
    return `${fmt(usage.periodStart)} – ${fmt(usage.periodEnd)}`;
  }, [usage]);

  const handleReportSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setReportError(null);
      setReportSuccess(null);

      if (!isAuthorizedReporter) {
        setReportError('You are not an authorized usage reporter for this subscription.');
        return;
      }

      const amount = parseAmount(reportInput, decimals);
      if (amount === null) {
        setReportError('Enter a valid non-negative usage amount.');
        return;
      }
      if (amount <= ZERO) {
        setReportError('Usage amount must be greater than zero.');
        return;
      }

      setReportBusy(true);
      try {
        await reportUsage(subscriptionId, amount);
        setReportSuccess(`Reported ${formatAmount(amount, decimals, currency)} of usage.`);
        setReportInput('');
        await refresh();
        onUpdated?.();
      } catch (err) {
        setReportError(decodeGridPayError(err).message);
      } finally {
        setReportBusy(false);
      }
    },
    [
      isAuthorizedReporter,
      reportInput,
      decimals,
      currency,
      reportUsage,
      subscriptionId,
      refresh,
      onUpdated,
    ],
  );

  const validateCaps = useCallback((): { hard: bigint; soft: bigint } | null => {
    if (!usage) return null;
    const hard = hardCapInput.trim() === '' ? ZERO : parseAmount(hardCapInput, decimals);
    const soft = softCapInput.trim() === '' ? ZERO : parseAmount(softCapInput, decimals);

    if (hard === null) {
      setCapError('Hard cap must be a valid non-negative amount.');
      return null;
    }
    if (soft === null) {
      setCapError('Soft cap must be a valid non-negative amount.');
      return null;
    }
    if (hard > ZERO && hard < usage.currentUsage) {
      setCapError(
        `Hard cap (${formatAmount(hard, decimals, currency)}) cannot be below current usage (${formatAmount(
          usage.currentUsage,
          decimals,
          currency,
        )}).`,
      );
      return null;
    }
    if (soft > ZERO && soft < usage.currentUsage) {
      setCapError(
        `Soft cap (${formatAmount(soft, decimals, currency)}) cannot be below current usage (${formatAmount(
          usage.currentUsage,
          decimals,
          currency,
        )}).`,
      );
      return null;
    }
    if (hard > ZERO && soft > ZERO && soft > hard) {
      setCapError('Soft cap cannot exceed the hard cap.');
      return null;
    }
    return { hard, soft };
  }, [usage, hardCapInput, softCapInput, decimals, currency]);

  const handleCapSubmit = useCallback(
    (e: React.FormEvent) => {
      e.preventDefault();
      setCapError(null);
      setCapSuccess(null);

      if (!canEditCaps) {
        setCapError('You are not authorized to edit billing caps.');
        return;
      }
      const validated = validateCaps();
      if (!validated) return;
      setConfirmCapOpen(true);
    },
    [canEditCaps, validateCaps],
  );

  const handleConfirmCap = useCallback(async () => {
    const validated = validateCaps();
    if (!validated) {
      setConfirmCapOpen(false);
      return;
    }
    setCapBusy(true);
    try {
      await setBillingCap(subscriptionId, validated.hard, validated.soft);
      setCapSuccess('Billing caps updated.');
      setConfirmCapOpen(false);
      await refresh();
      onUpdated?.();
    } catch (err) {
      setCapError(decodeGridPayError(err).message);
      setConfirmCapOpen(false);
    } finally {
      setCapBusy(false);
    }
  }, [validateCaps, setBillingCap, subscriptionId, refresh, onUpdated]);

  const confirmMessage = useMemo(() => {
    if (!usage) return null;
    const validated = validateCaps();
    if (!validated) return null;
    return (
      <div>
        <p>You are about to update the billing caps for this subscription:</p>
        <ul>
          <li>
            Hard cap:{' '}
            <strong>
              {validated.hard > ZERO
                ? formatAmount(validated.hard, decimals, currency)
                : 'None'}
            </strong>
          </li>
          <li>
            Soft cap:{' '}
            <strong>
              {validated.soft > ZERO
                ? formatAmount(validated.soft, decimals, currency)
                : 'None'}
            </strong>
          </li>
        </ul>
        <p>
          Current usage is{' '}
          <strong>{formatAmount(usage.currentUsage, decimals, currency)}</strong>. Cap changes
          take effect immediately and may affect overage billing for the current period.
        </p>
      </div>
    );
  }, [usage, validateCaps, decimals, currency]);

  if (loading && !usage) {
    return (
      <div className="metered-usage-card" data-testid="metered-usage-card" data-state={capState}>
        <p>Loading metered usage…</p>
      </div>
    );
  }

  if (loadError && !usage) {
    return (
      <div className="metered-usage-card" data-testid="metered-usage-card" data-state={capState}>
        <p className="error" role="alert">
          Failed to load usage: {loadError}
        </p>
        <button type="button" className="btn btn-outline" onClick={() => void refresh()}>
          Retry
        </button>
      </div>
    );
  }

  if (!usage) {
    return (
      <div className="metered-usage-card" data-testid="metered-usage-card" data-state={capState}>
        <p>No metered usage data available.</p>
      </div>
    );
  }

  return (
    <div className="metered-usage-card" data-testid="metered-usage-card" data-state={capState}>
      <header className="metered-usage-card__header">
        <h3 className="metered-usage-card__title">Metered Usage</h3>
        <span className="metered-usage-card__period">{periodLabel}</span>
      </header>

      {capState !== 'active' && (
        <div
          className={`gp-usage-alert gp-usage-alert--${capState}`}
          role="alert"
          data-testid="metered-cap-alert"
        >
          <strong>
            {capState === 'metered-capped'
              ? 'Hard cap reached — usage is blocked until the cap is raised.'
              : 'Approaching hard cap — usage may be blocked soon.'}
          </strong>
          <span>
            {capState === 'metered-capped'
              ? 'Contact the merchant to raise the cap or wait for the next billing period.'
              : 'Consider raising the cap before the meter fills.'}
          </span>
        </div>
      )}

      <section className="metered-usage-card__summary">
        <div className="metered-usage-card__stat">
          <span className="metered-usage-card__stat-label">Current usage</span>
          <span className="metered-usage-card__stat-value" data-testid="current-usage">
            {formatAmount(usage.currentUsage, decimals, currency)}
          </span>
        </div>
        <div className="metered-usage-card__stat">
          <span className="metered-usage-card__stat-label">Unit price</span>
          <span className="metered-usage-card__stat-value">
            {formatAmount(usage.unitPrice, decimals, currency)}
          </span>
        </div>
        <div className="metered-usage-card__stat">
          <span className="metered-usage-card__stat-label">Projected invoice</span>
          <span
            className="metered-usage-card__stat-value"
            data-testid="projected-invoice"
          >
            {formatAmount(projectedInvoice, decimals, currency)}
          </span>
        </div>
      </section>

      <section className="metered-usage-card__caps">
        <CapProgressBar
          label="Soft cap"
          usage={usage.currentUsage}
          cap={usage.softCap}
          decimals={decimals}
          currency={currency}
          tone="soft"
        />
        <CapProgressBar
          label="Hard cap"
          usage={usage.currentUsage}
          cap={usage.hardCap}
          decimals={decimals}
          currency={currency}
          tone="hard"
        />
      </section>

      {isAuthorizedReporter && (
        <section className="metered-usage-card__report">
          <h4>Report usage</h4>
          <form onSubmit={handleReportSubmit} className="form">
            <label className="form__label" htmlFor="report-usage-amount">
              Usage amount
            </label>
            <input
              id="report-usage-amount"
              className="form__input"
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={reportInput}
              onChange={(e) => setReportInput(e.target.value)}
              disabled={reportBusy}
              data-testid="report-usage-input"
            />
            {reportError && (
              <p className="error" role="alert" data-testid="report-usage-error">
                {reportError}
              </p>
            )}
            {reportSuccess && (
              <p className="success" role="status" data-testid="report-usage-success">
                {reportSuccess}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={reportBusy || reportInput.trim() === ''}
              data-testid="report-usage-submit"
            >
              {reportBusy ? 'Reporting…' : 'Report usage'}
            </button>
          </form>
        </section>
      )}

      {canEditCaps && (
        <section className="metered-usage-card__cap-editor">
          <h4>Edit billing caps</h4>
          <form onSubmit={handleCapSubmit} className="form">
            <label className="form__label" htmlFor="hard-cap-input">
              Hard cap (leave blank for none)
            </label>
            <input
              id="hard-cap-input"
              className="form__input"
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={hardCapInput}
              onChange={(e) => setHardCapInput(e.target.value)}
              disabled={capBusy}
              data-testid="hard-cap-input"
            />
            <label className="form__label" htmlFor="soft-cap-input">
              Soft cap (leave blank for none)
            </label>
            <input
              id="soft-cap-input"
              className="form__input"
              type="text"
              inputMode="decimal"
              placeholder="0.0"
              value={softCapInput}
              onChange={(e) => setSoftCapInput(e.target.value)}
              disabled={capBusy}
              data-testid="soft-cap-input"
            />
            {capError && (
              <p className="error" role="alert" data-testid="cap-error">
                {capError}
              </p>
            )}
            {capSuccess && (
              <p className="success" role="status" data-testid="cap-success">
                {capSuccess}
              </p>
            )}
            <button
              type="submit"
              className="btn btn-primary"
              disabled={capBusy}
              data-testid="cap-submit"
            >
              Update caps
            </button>
          </form>
        </section>
      )}

      <ConfirmDialog
        open={confirmCapOpen}
        title="Confirm billing cap update"
        message={confirmMessage}
        confirmLabel="Confirm update"
        onConfirm={() => void handleConfirmCap()}
        onCancel={() => setConfirmCapOpen(false)}
        busy={capBusy}
      />
    </div>
  );
};

export default MeteredUsageCard;