import React, { useCallback, useEffect, useMemo, useState } from 'react';

/**
 * DunningAlertBanner
 *
 * Surfaces the on-chain dunning state for a subscription and provides a
 * one-click `retry_failed_payment` flow.
 *
 * Operational invariants implemented here:
 *  - `get_dunning_state` is refreshed immediately before transaction
 *    construction so concurrent dunning changes are respected.
 *  - The retry control is disabled until the current ledger timestamp has
 *    reached the next eligible retry timestamp.
 *  - Failures are surfaced via `decodeGridPayError` recovery messaging.
 */

export interface DunningState {
  /** Whether the subscription is currently in dunning. */
  inDunning: boolean;
  /** Number of retry attempts already performed. */
  retryCount: number;
  /** Ledger timestamp (seconds) of the next eligible retry, if any. */
  nextRetryAt?: number | null;
  /** Ledger timestamp (seconds) of the most recent failed attempt, if any. */
  lastAttemptAt?: number | null;
  /** Optional human-readable reason for the failure. */
  reason?: string | null;
  /** Optional amount outstanding, in the contract's base unit. */
  amountDue?: string | number | bigint | null;
  /** Optional asset/currency symbol for the amount due. */
  assetCode?: string | null;
}

export interface DecodedGridPayError {
  code?: string;
  message: string;
  recovery?: string;
}

export interface DunningAlertBannerProps {
  /** Subscription identifier being inspected. */
  subscriptionId: string;
  /**
   * Fetches the latest dunning state from the contract
   * (`get_dunning_state`). Must always hit the network — no caching.
   */
  fetchDunningState: (subscriptionId: string) => Promise<DunningState>;
  /**
   * Builds and submits the `retry_failed_payment` transaction. Called only
   * after a fresh `get_dunning_state` refresh.
   */
  retryFailedPayment: (
    subscriptionId: string,
    freshState: DunningState
  ) => Promise<{ txHash?: string } | void>;
  /**
   * Returns the current ledger timestamp in seconds. Used to gate the retry
   * control against `nextRetryAt`.
   */
  getLedgerTimestamp: () => Promise<number> | number;
  /** Decodes a thrown error into a structured GridPay error. */
  decodeGridPayError: (error: unknown) => DecodedGridPayError;
  /** Optional callback fired after a successful retry submission. */
  onRetrySubmitted?: (txHash?: string) => void;
  /** Optional callback fired whenever the dunning state is refreshed. */
  onStateRefreshed?: (state: DunningState) => void;
  /** Optional externally-provided initial state to avoid a flash of empty UI. */
  initialState?: DunningState | null;
  /** Optional class name for layout integration. */
  className?: string;
}

type Phase = 'idle' | 'refreshing' | 'submitting' | 'success' | 'error';

const DEFAULT_POLL_INTERVAL_MS = 30_000;

function formatTimestamp(ts?: number | null): string {
  if (ts === null || ts === undefined || !Number.isFinite(ts)) {
    return '—';
  }
  // Ledger timestamps are in seconds; render as a locale date/time.
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

function formatAmount(
  amount?: string | number | bigint | null,
  assetCode?: string | null
): string | null {
  if (amount === null || amount === undefined || amount === '') {
    return null;
  }
  let rendered: string;
  if (typeof amount === 'bigint') {
    rendered = amount.toString();
  } else {
    rendered = String(amount);
  }
  return assetCode ? `${rendered} ${assetCode}` : rendered;
}

function formatCountdown(secondsRemaining: number): string {
  if (secondsRemaining <= 0) {
    return 'now';
  }
  const total = Math.floor(secondsRemaining);
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3_600);
  const minutes = Math.floor((total % 3_600) / 60);
  const seconds = total % 60;

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

export const DunningAlertBanner: React.FC<DunningAlertBannerProps> = ({
  subscriptionId,
  fetchDunningState,
  retryFailedPayment,
  getLedgerTimestamp,
  decodeGridPayError,
  onRetrySubmitted,
  onStateRefreshed,
  initialState = null,
  className,
}) => {
  const [state, setState] = useState<DunningState | null>(initialState);
  const [ledgerNow, setLedgerNow] = useState<number | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [error, setError] = useState<DecodedGridPayError | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const refresh = useCallback(async (): Promise<DunningState | null> => {
    setPhase((prev) => (prev === 'submitting' ? prev : 'refreshing'));
    try {
      const [freshState, now] = await Promise.all([
        fetchDunningState(subscriptionId),
        Promise.resolve(getLedgerTimestamp()),
      ]);
      setState(freshState);
      setLedgerNow(typeof now === 'number' && Number.isFinite(now) ? now : null);
      onStateRefreshed?.(freshState);
      setPhase((prev) => (prev === 'submitting' ? prev : 'idle'));
      return freshState;
    } catch (err) {
      setError(decodeGridPayError(err));
      setPhase('error');
      return null;
    }
  }, [
    subscriptionId,
    fetchDunningState,
    getLedgerTimestamp,
    decodeGridPayError,
    onStateRefreshed,
  ]);

  // Initial load + periodic refresh so the banner tracks concurrent changes.
  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      if (cancelled) return;
      await refresh();
    };

    void run();
    const interval = setInterval(() => {
      void run();
    }, DEFAULT_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [refresh]);

  // Keep the countdown live between refreshes.
  useEffect(() => {
    if (ledgerNow === null) return;
    const tick = setInterval(() => {
      setLedgerNow((prev) => (prev === null ? prev : prev + 1));
    }, 1_000);
    return () => clearInterval(tick);
  }, [ledgerNow]);

  const nextRetryAt = state?.nextRetryAt ?? null;
  const secondsUntilRetry = useMemo(() => {
    if (nextRetryAt === null || ledgerNow === null) return null;
    return nextRetryAt - ledgerNow;
  }, [nextRetryAt, ledgerNow]);

  const retryEligible =
    secondsUntilRetry === null ? nextRetryAt === null : secondsUntilRetry <= 0;

  const isBusy = phase === 'refreshing' || phase === 'submitting';
  const canRetry =
    !!state &&
    state.inDunning &&
    retryEligible &&
    !isBusy &&
    phase !== 'success';

  const handleOpenConfirm = useCallback(async () => {
    setError(null);
    setSuccessMessage(null);
    // Refresh immediately before constructing the transaction so we act on
    // the latest dunning state (handles concurrent state changes).
    const fresh = await refresh();
    if (!fresh || !fresh.inDunning) {
      return;
    }
    const now = await Promise.resolve(getLedgerTimestamp());
    const eligible =
      fresh.nextRetryAt === null ||
      fresh.nextRetryAt === undefined ||
      now >= fresh.nextRetryAt;
    if (!eligible) {
      setLedgerNow(typeof now === 'number' && Number.isFinite(now) ? now : null);
      return;
    }
    setConfirmOpen(true);
  }, [refresh, getLedgerTimestamp]);

  const handleConfirmRetry = useCallback(async () => {
    setConfirmOpen(false);
    setError(null);
    setSuccessMessage(null);
    setPhase('submitting');

    try {
      // Final refresh right before transaction construction.
      const fresh = await fetchDunningState(subscriptionId);
      setState(fresh);
      onStateRefreshed?.(fresh);

      if (!fresh.inDunning) {
        setPhase('idle');
        setSuccessMessage('Subscription is no longer in dunning.');
        return;
      }

      const now = await Promise.resolve(getLedgerTimestamp());
      setLedgerNow(typeof now === 'number' && Number.isFinite(now) ? now : null);

      if (
        fresh.nextRetryAt !== null &&
        fresh.nextRetryAt !== undefined &&
        now < fresh.nextRetryAt
      ) {
        setPhase('idle');
        setError({
          code: 'RETRY_NOT_ELIGIBLE',
          message: 'The next retry window has not been reached yet.',
          recovery:
            'Wait until the next eligible retry timestamp, then try again.',
        });
        return;
      }

      const result = await retryFailedPayment(subscriptionId, fresh);
      const txHash =
        result && typeof result === 'object' ? result.txHash : undefined;

      setPhase('success');
      setSuccessMessage(
        txHash
          ? `Retry submitted (tx ${txHash.slice(0, 10)}…).`
          : 'Retry submitted successfully.'
      );
      onRetrySubmitted?.(txHash);

      // Re-sync state after submission to reflect any on-chain changes.
      await refresh();
    } catch (err) {
      setError(decodeGridPayError(err));
      setPhase('error');
    }
  }, [
    subscriptionId,
    fetchDunningState,
    getLedgerTimestamp,
    retryFailedPayment,
    decodeGridPayError,
    onRetrySubmitted,
    onStateRefreshed,
    refresh,
  ]);

  const handleCancelConfirm = useCallback(() => {
    setConfirmOpen(false);
  }, []);

  if (!state) {
    if (phase === 'error' && error) {
      return (
        <div
          className={className}
          role="alert"
          data-testid="dunning-alert-banner"
        >
          <div className="rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-800">
            <p className="font-semibold">Unable to load dunning state</p>
            <p className="mt-1">{error.message}</p>
            {error.recovery && (
              <p className="mt-1 text-red-700">{error.recovery}</p>
            )}
            <button
              type="button"
              className="mt-3 rounded-md border border-red-400 bg-white px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-100"
              onClick={() => void refresh()}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }
    return null;
  }

  if (!state.inDunning && phase !== 'success') {
    return null;
  }

  const amountLabel = formatAmount(state.amountDue, state.assetCode);

  return (
    <div
      className={className}
      role="alert"
      aria-live="polite"
      data-testid="dunning-alert-banner"
    >
      <div className="rounded-lg border border-amber-300 bg-amber-50 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <span
                aria-hidden="true"
                className="inline-block h-2 w-2 rounded-full bg-amber-500"
              />
              Payment failed — subscription in dunning
            </p>
            {state.reason && (
              <p className="mt-1 text-sm text-amber-800">{state.reason}</p>
            )}
            {amountLabel && (
              <p className="mt-1 text-sm text-amber-800">
                Amount due: <span className="font-medium">{amountLabel}</span>
              </p>
            )}
          </div>

          <div className="flex flex-col items-end gap-1 text-right text-xs text-amber-800">
            <span data-testid="dunning-retry-count">
              Retry attempts: <span className="font-semibold">{state.retryCount}</span>
            </span>
            <span data-testid="dunning-next-retry">
              Next retry:{' '}
              <span className="font-semibold">
                {nextRetryAt === null
                  ? 'available now'
                  : secondsUntilRetry !== null && secondsUntilRetry > 0
                    ? `in ${formatCountdown(secondsUntilRetry)}`
                    : 'available now'}
              </span>
            </span>
            {nextRetryAt !== null && (
              <span className="text-amber-700">
                Eligible at {formatTimestamp(nextRetryAt)}
              </span>
            )}
            {state.lastAttemptAt !== null &&
              state.lastAttemptAt !== undefined && (
                <span className="text-amber-700">
                  Last attempt {formatTimestamp(state.lastAttemptAt)}
                </span>
              )}
          </div>
        </div>

        {error && (
          <div
            className="mt-3 rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-800"
            role="alert"
            data-testid="dunning-error"
          >
            <p className="font-semibold">{error.message}</p>
            {error.recovery && <p className="mt-1">{error.recovery}</p>}
            {error.code && (
              <p className="mt-1 text-xs text-red-600">Code: {error.code}</p>
            )}
          </div>
        )}

        {successMessage && (
          <div
            className="mt-3 rounded-md border border-green-300 bg-green-50 p-3 text-sm text-green-800"
            data-testid="dunning-success"
          >
            {successMessage}
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void handleOpenConfirm()}
            disabled={!canRetry}
            aria-disabled={!canRetry}
            data-testid="dunning-retry-button"
            title={
              !retryEligible
                ? 'The next retry window has not been reached yet.'
                : undefined
            }
          >
            {phase === 'submitting' ? 'Retrying…' : 'Retry payment'}
          </button>

          <button
            type="button"
            className="rounded-md border border-amber-400 bg-white px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void refresh()}
            disabled={isBusy}
            data-testid="dunning-refresh-button"
          >
            {phase === 'refreshing' ? 'Refreshing…' : 'Refresh status'}
          </button>

          {!retryEligible && (
            <span className="text-xs text-amber-700">
              Retry unlocks{' '}
              {secondsUntilRetry !== null
                ? `in ${formatCountdown(secondsUntilRetry)}`
                : 'soon'}
              .
            </span>
          )}
        </div>
      </div>

      {confirmOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="dunning-confirm-title"
          data-testid="dunning-confirm-dialog"
        >
          <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
            <h2
              id="dunning-confirm-title"
              className="text-base font-semibold text-gray-900"
            >
              Retry failed payment?
            </h2>
            <p className="mt-2 text-sm text-gray-700">
              This will attempt to collect the outstanding balance for
              subscription <span className="font-mono">{subscriptionId}</span>.
            </p>
            <ul className="mt-3 list-disc space-y-1 pl-5 text-sm text-gray-700">
              <li>
                Retry attempt:{' '}
                <span className="font-semibold">{state.retryCount + 1}</span>
              </li>
              {amountLabel && (
                <li>
                  Amount to collect:{' '}
                  <span className="font-semibold">{amountLabel}</span>
                </li>
              )}
              <li>
                If the payment fails again, the subscription may be cancelled
                per the merchant&apos;s dunning policy.
              </li>
            </ul>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                className="rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
                onClick={handleCancelConfirm}
                data-testid="dunning-confirm-cancel"
              >
                Cancel
              </button>
              <button
                type="button"
                className="rounded-md bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700"
                onClick={() => void handleConfirmRetry()}
                data-testid="dunning-confirm-retry"
              >
                Confirm retry
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DunningAlertBanner;