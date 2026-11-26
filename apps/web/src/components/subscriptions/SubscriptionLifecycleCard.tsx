import React from 'react';

export type SubscriptionLifecycleState =
  | {
      kind: 'active';
      subscriptionId: string;
      nextBillingAt?: number | null;
      amount?: string;
    }
  | {
      kind: 'trial-ending';
      subscriptionId: string;
      daysRemaining: number;
      conversionAmount?: string;
    }
  | {
      kind: 'metered-near-cap';
      subscriptionId: string;
      used: string;
      cap: string;
      percent: number;
    }
  | {
      kind: 'metered-capped';
      subscriptionId: string;
      used: string;
      cap: string;
    }
  | {
      kind: 'dunning-retry';
      subscriptionId: string;
      retryNumber: number;
      maxRetries?: number;
      nextRetryAt?: number | null;
      amountDue?: string;
      reason?: string;
    }
  | {
      kind: 'paused';
      subscriptionId: string;
      pausedAt?: number | null;
      reason?: string;
    }
  | {
      kind: 'cancelled';
      subscriptionId: string;
      cancelledAt?: number | null;
      canReactivate?: boolean;
    };

export interface SubscriptionLifecycleCardProps {
  state: SubscriptionLifecycleState;
  onConvertTrial?: (subscriptionId: string) => void;
  onRetryPayment?: (subscriptionId: string, retryNumber: number) => void;
  onResume?: (subscriptionId: string) => void;
  onReactivate?: (subscriptionId: string) => void;
  className?: string;
}

function formatTimestamp(timestamp?: number | null): string {
  if (timestamp === null || timestamp === undefined || !Number.isFinite(timestamp)) {
    return '—';
  }
  return new Date(timestamp * 1000).toLocaleString();
}

function boundedPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export const SubscriptionLifecycleCard: React.FC<SubscriptionLifecycleCardProps> = ({
  state,
  onConvertTrial,
  onRetryPayment,
  onResume,
  onReactivate,
  className,
}) => {
  const classes = ['gp-lifecycle-card', `gp-lifecycle-card--${state.kind}`, className]
    .filter(Boolean)
    .join(' ');

  return (
    <section
      className={classes}
      data-testid="subscription-lifecycle-card"
      data-state={state.kind}
      data-subscription-id={state.subscriptionId}
    >
      <span className="gp-lifecycle-card__eyebrow">Subscription status</span>

      {state.kind === 'active' && (
        <>
          <h3 className="gp-lifecycle-card__title">Subscription active</h3>
          <p className="gp-lifecycle-card__body">
            Your plan is current. Next charge
            {state.nextBillingAt ? ` on ${formatTimestamp(state.nextBillingAt)}` : ' is scheduled'}.
          </p>
          {state.amount && (
            <p className="gp-lifecycle-card__meta">Amount: {state.amount}</p>
          )}
        </>
      )}

      {state.kind === 'trial-ending' && (
        <>
          <h3 className="gp-lifecycle-card__title">Trial ending soon</h3>
          <p className="gp-lifecycle-card__body">
            Your trial ends in {Math.max(0, Math.floor(state.daysRemaining))} day(s).
          </p>
          {state.conversionAmount && (
            <p className="gp-lifecycle-card__meta">
              Conversion charge: {state.conversionAmount}
            </p>
          )}
          <button
            type="button"
            className="gp-lifecycle-card__action"
            onClick={() => onConvertTrial?.(state.subscriptionId)}
          >
            Confirm trial conversion
          </button>
        </>
      )}

      {state.kind === 'metered-near-cap' && (
        <>
          <h3 className="gp-lifecycle-card__title">Metered cap nearly reached</h3>
          <p className="gp-lifecycle-card__body">
            {state.used} of {state.cap} used ({boundedPercent(state.percent)}%).
          </p>
          <div
            className="gp-lifecycle-card__meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={boundedPercent(state.percent)}
          >
            <div
              className="gp-lifecycle-card__meter-fill"
              style={{ width: `${boundedPercent(state.percent)}%` }}
            />
          </div>
          <p className="gp-lifecycle-card__meta">
            Usage will stop when the hard cap is reached.
          </p>
        </>
      )}

      {state.kind === 'metered-capped' && (
        <>
          <h3 className="gp-lifecycle-card__title">Metered cap reached</h3>
          <p className="gp-lifecycle-card__body">
            {state.used} of {state.cap} used. Further usage is blocked.
          </p>
          <p className="gp-lifecycle-card__meta">
            Contact the merchant to raise the cap or wait for the next billing period.
          </p>
        </>
      )}

      {state.kind === 'dunning-retry' && (
        <>
          <h3 className="gp-lifecycle-card__title">
            Payment failed — retry {Math.max(1, Math.floor(state.retryNumber))}
            {state.maxRetries ? ` of ${state.maxRetries}` : ''}
          </h3>
          <p className="gp-lifecycle-card__body">
            {state.reason ?? 'The scheduled charge could not be collected.'}
          </p>
          {state.amountDue && (
            <p className="gp-lifecycle-card__meta">Amount due: {state.amountDue}</p>
          )}
          <p className="gp-lifecycle-card__meta">
            {state.nextRetryAt
              ? `Next retry: ${formatTimestamp(state.nextRetryAt)}`
              : 'Retry is available now.'}
          </p>
          <button
            type="button"
            className="gp-lifecycle-card__action"
            data-testid="lifecycle-retry-button"
            onClick={() =>
              onRetryPayment?.(state.subscriptionId, Math.max(1, Math.floor(state.retryNumber)))
            }
          >
            Retry payment
          </button>
        </>
      )}

      {state.kind === 'paused' && (
        <>
          <h3 className="gp-lifecycle-card__title">Subscription paused</h3>
          <p className="gp-lifecycle-card__body">
            {state.reason ?? 'Billing is temporarily suspended.'}
          </p>
          {state.pausedAt && (
            <p className="gp-lifecycle-card__meta">Paused at {formatTimestamp(state.pausedAt)}</p>
          )}
          <button
            type="button"
            className="gp-lifecycle-card__action"
            data-testid="lifecycle-resume-button"
            onClick={() => onResume?.(state.subscriptionId)}
          >
            Resume subscription
          </button>
        </>
      )}

      {state.kind === 'cancelled' && (
        <>
          <h3 className="gp-lifecycle-card__title">Subscription cancelled</h3>
          <p className="gp-lifecycle-card__body">No further charges will be made.</p>
          {state.cancelledAt && (
            <p className="gp-lifecycle-card__meta">
              Cancelled at {formatTimestamp(state.cancelledAt)}
            </p>
          )}
          {state.canReactivate && (
            <button
              type="button"
              className="gp-lifecycle-card__action"
              data-testid="lifecycle-reactivate-button"
              onClick={() => onReactivate?.(state.subscriptionId)}
            >
              Reactivate subscription
            </button>
          )}
        </>
      )}
    </section>
  );
};

export default SubscriptionLifecycleCard;
