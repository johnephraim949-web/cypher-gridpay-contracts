import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { MeteredUsageCard } from '../../components/subscriptions/MeteredUsageCard';
import { DunningAlertBanner } from '../../components/subscriptions/DunningAlertBanner';

// ---------------------------------------------------------------------------
// Types (mirrors the Payment contract surface used by this page)
// ---------------------------------------------------------------------------

export type SubscriptionStatus =
  | 'Active'
  | 'Trial'
  | 'Paused'
  | 'PastDue'
  | 'Dunning'
  | 'Cancelled';

export interface SubscriptionRecord {
  id: string;
  merchantId: string;
  customerId: string;
  planName: string;
  status: SubscriptionStatus;
  amount: string;
  currency: string;
  interval: 'day' | 'week' | 'month' | 'year';
  isMetered: boolean;
  trialEndsAt?: number; // unix seconds
  currentPeriodStart: number;
  currentPeriodEnd: number;
  nextBillingAt?: number;
  cancelAtPeriodEnd?: boolean;
  pausedAt?: number;
  cancelledAt?: number;
}

export interface DunningState {
  subscriptionId: string;
  inDunning: boolean;
  retryCount: number;
  maxRetries: number;
  nextRetryAt?: number;
  lastFailureReason?: string;
}

export interface BillingCap {
  subscriptionId: string;
  hardCap?: string;
  softCap?: string;
}

export interface CurrentUsage {
  subscriptionId: string;
  periodStart: number;
  periodEnd: number;
  unitsConsumed: string;
  unitPrice: string;
  currency: string;
}

// ---------------------------------------------------------------------------
// Contract client abstraction (injected for testability)
// ---------------------------------------------------------------------------

export interface SubscriptionsContractClient {
  getSubscriptionsByMerchant(merchantId: string): Promise<SubscriptionRecord[]>;
  getDunningState(subscriptionId: string): Promise<DunningState>;
  getCurrentUsage(subscriptionId: string): Promise<CurrentUsage>;
  getBillingCap(subscriptionId: string): Promise<BillingCap>;
  setBillingCap(
    subscriptionId: string,
    hardCap: string,
    softCap: string,
  ): Promise<{ txHash: string }>;
  reportUsage(
    subscriptionId: string,
    units: string,
    reporter: string,
  ): Promise<{ txHash: string }>;
  executeMeteredBilling(subscriptionId: string): Promise<{ txHash: string }>;
  retryFailedPayment(subscriptionId: string): Promise<{ txHash: string }>;
  pauseSubscription(subscriptionId: string): Promise<{ txHash: string }>;
  resumeSubscription(subscriptionId: string): Promise<{ txHash: string }>;
  cancelSubscription(subscriptionId: string): Promise<{ txHash: string }>;
  getLedgerTimestamp(): Promise<number>;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<SubscriptionStatus, { bg: string; fg: string; label: string }> = {
  Active: { bg: '#e6f4ea', fg: '#137333', label: 'Active' },
  Trial: { bg: '#e8f0fe', fg: '#1a73e8', label: 'Trial' },
  Paused: { bg: '#fef7e0', fg: '#b06000', label: 'Paused' },
  PastDue: { bg: '#fce8e6', fg: '#c5221f', label: 'Past Due' },
  Dunning: { bg: '#fce8e6', fg: '#c5221f', label: 'Dunning' },
  Cancelled: { bg: '#f1f3f4', fg: '#5f6368', label: 'Cancelled' },
};

export const StatusBadge: React.FC<{ status: SubscriptionStatus }> = ({ status }) => {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.Cancelled;
  return (
    <span
      data-testid={`status-badge-${status.toLowerCase()}`}
      style={{
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: 12,
        fontSize: 12,
        fontWeight: 600,
        backgroundColor: style.bg,
        color: style.fg,
      }}
    >
      {style.label}
    </span>
  );
};

// ---------------------------------------------------------------------------
// Confirmation dialog
// ---------------------------------------------------------------------------

export interface ConfirmationDialogProps {
  open: boolean;
  title: string;
  impact: string;
  confirmLabel?: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export const ConfirmationDialog: React.FC<ConfirmationDialogProps> = ({
  open,
  title,
  impact,
  confirmLabel = 'Confirm',
  busy = false,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="confirmation-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.4)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff',
          borderRadius: 8,
          padding: 24,
          maxWidth: 480,
          width: '90%',
          boxShadow: '0 8px 24px rgba(0,0,0,0.2)',
        }}
      >
        <h3 style={{ marginTop: 0 }}>{title}</h3>
        <p data-testid="confirmation-impact" style={{ color: '#3c4043', whiteSpace: 'pre-line' }}>
          {impact}
        </p>
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            data-testid="confirmation-cancel"
            style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #dadce0', background: '#fff' }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            data-testid="confirmation-confirm"
            style={{
              padding: '8px 16px',
              borderRadius: 6,
              border: 'none',
              background: '#1a73e8',
              color: '#fff',
              fontWeight: 600,
            }}
          >
            {busy ? 'Submitting…' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const formatAmount = (amount: string, currency: string): string => {
  const num = Number(amount);
  if (Number.isNaN(num)) return `${amount} ${currency}`;
  return `${num.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`;
};

const formatTimestamp = (ts?: number): string => {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString();
};

const isDunningStatus = (s: SubscriptionStatus): boolean => s === 'PastDue' || s === 'Dunning';

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface SubscriptionsPageProps {
  merchantId: string;
  client: SubscriptionsContractClient;
  /** Address of the connected merchant wallet (authorized reporter). */
  reporterAddress?: string;
}

type PendingAction =
  | { kind: 'pause'; sub: SubscriptionRecord }
  | { kind: 'resume'; sub: SubscriptionRecord }
  | { kind: 'cancel'; sub: SubscriptionRecord }
  | { kind: 'executeBilling'; sub: SubscriptionRecord }
  | { kind: 'retryPayment'; sub: SubscriptionRecord }
  | null;

export const SubscriptionsPage: React.FC<SubscriptionsPageProps> = ({
  merchantId,
  client,
  reporterAddress,
}) => {
  const [subscriptions, setSubscriptions] = useState<SubscriptionRecord[]>([]);
  const [dunningBySub, setDunningBySub] = useState<Record<string, DunningState>>({});
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [ledgerNow, setLedgerNow] = useState<number>(0);
  const [pending, setPending] = useState<PendingAction>(null);
  const [busy, setBusy] = useState<boolean>(false);
  const [notice, setNotice] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [subs, now] = await Promise.all([
        client.getSubscriptionsByMerchant(merchantId),
        client.getLedgerTimestamp(),
      ]);
      setSubscriptions(subs);
      setLedgerNow(now);

      const dunningEntries = await Promise.all(
        subs
          .filter((s) => isDunningStatus(s.status))
          .map(async (s) => {
            try {
              const d = await client.getDunningState(s.id);
              return [s.id, d] as const;
            } catch {
              return null;
            }
          }),
      );
      const map: Record<string, DunningState> = {};
      for (const entry of dunningEntries) {
        if (entry) map[entry[0]] = entry[1];
      }
      setDunningBySub(map);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load subscriptions');
    } finally {
      setLoading(false);
    }
  }, [client, merchantId]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const refreshDunning = useCallback(
    async (subscriptionId: string): Promise<DunningState | null> => {
      try {
        const fresh = await client.getDunningState(subscriptionId);
        setDunningBySub((prev) => ({ ...prev, [subscriptionId]: fresh }));
        return fresh;
      } catch {
        return null;
      }
    },
    [client],
  );

  const refreshLedgerTimestamp = useCallback(async (): Promise<number> => {
    try {
      const now = await client.getLedgerTimestamp();
      setLedgerNow(now);
      return now;
    } catch {
      return ledgerNow;
    }
  }, [client, ledgerNow]);

  const executeBillingEligible = useCallback(
    (sub: SubscriptionRecord): boolean => {
      if (!sub.nextBillingAt) return false;
      return ledgerNow >= sub.nextBillingAt;
    },
    [ledgerNow],
  );

  const retryEligible = useCallback(
    (sub: SubscriptionRecord): boolean => {
      const d = dunningBySub[sub.id];
      if (!d || !d.inDunning) return false;
      if (!d.nextRetryAt) return true;
      return ledgerNow >= d.nextRetryAt;
    },
    [dunningBySub, ledgerNow],
  );

  const requestAction = (action: PendingAction) => {
    setNotice(null);
    setPending(action);
  };

  const buildImpactText = (action: PendingAction): string => {
    if (!action) return '';
    const { sub } = action;
    switch (action.kind) {
      case 'pause':
        return `Pausing "${sub.planName}" will stop all billing and usage accrual immediately. The current period will be prorated and no charges will be collected until the subscription is resumed.`;
      case 'resume':
        return `Resuming "${sub.planName}" will restart billing from the current ledger timestamp. Any usage accrued during the pause is not retroactively billed.`;
      case 'cancel':
        return sub.cancelAtPeriodEnd
          ? `Cancelling "${sub.planName}" will end the subscription at the close of the current period (${formatTimestamp(
              sub.currentPeriodEnd,
            )}). No further charges will be collected.`
          : `Cancelling "${sub.planName}" takes effect immediately. Unused time in the current period is prorated and refunded per contract rules; metered usage already reported remains billable.`;
      case 'executeBilling':
        return `Executing metered billing for "${sub.planName}" will charge the customer for all usage reported in the current period. This action cannot be undone.`;
      case 'retryPayment':
        return `Retrying the failed payment for "${sub.planName}" will attempt to collect the outstanding balance. If it fails again, the dunning retry counter will increment.`;
      default:
        return '';
    }
  };

  const confirmPending = async () => {
    if (!pending) return;
    const { sub } = pending;
    setBusy(true);
    setError(null);
    try {
      // Refresh dunning state immediately before transaction construction for
      // any state-mutating call that could race with concurrent dunning changes.
      if (isDunningStatus(sub.status) || pending.kind === 'retryPayment') {
        await refreshDunning(sub.id);
      }
      await refreshLedgerTimestamp();

      switch (pending.kind) {
        case 'pause':
          await client.pauseSubscription(sub.id);
          setNotice(`Paused "${sub.planName}".`);
          break;
        case 'resume':
          await client.resumeSubscription(sub.id);
          setNotice(`Resumed "${sub.planName}".`);
          break;
        case 'cancel':
          await client.cancelSubscription(sub.id);
          setNotice(`Cancelled "${sub.planName}".`);
          break;
        case 'executeBilling':
          await client.executeMeteredBilling(sub.id);
          setNotice(`Metered billing executed for "${sub.planName}".`);
          break;
        case 'retryPayment':
          await client.retryFailedPayment(sub.id);
          setNotice(`Retried failed payment for "${sub.planName}".`);
          break;
      }
      setPending(null);
      await loadAll();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Transaction failed');
    } finally {
      setBusy(false);
    }
  };

  const handleCapUpdate = useCallback(
    async (subscriptionId: string, hardCap: string, softCap: string) => {
      // Refresh dunning state before constructing the transaction.
      await refreshDunning(subscriptionId);
      await refreshLedgerTimestamp();
      await client.setBillingCap(subscriptionId, hardCap, softCap);
      setNotice('Billing cap updated.');
      await loadAll();
    },
    [client, loadAll, refreshDunning, refreshLedgerTimestamp],
  );

  const handleReportUsage = useCallback(
    async (subscriptionId: string, units: string) => {
      if (!reporterAddress) {
        throw new Error('No authorized reporter address connected.');
      }
      await refreshLedgerTimestamp();
      await client.reportUsage(subscriptionId, units, reporterAddress);
      setNotice('Usage reported.');
      await loadAll();
    },
    [client, loadAll, refreshLedgerTimestamp, reporterAddress],
  );

  const handleRetryFromBanner = useCallback(
    async (subscriptionId: string) => {
      const sub = subscriptions.find((s) => s.id === subscriptionId);
      if (!sub) return;
      requestAction({ kind: 'retryPayment', sub });
    },
    [subscriptions],
  );

  const sortedSubscriptions = useMemo(() => {
    const order: Record<SubscriptionStatus, number> = {
      Dunning: 0,
      PastDue: 1,
      Trial: 2,
      Active: 3,
      Paused: 4,
      Cancelled: 5,
    };
    return [...subscriptions].sort((a, b) => order[a.status] - order[b.status]);
  }, [subscriptions]);

  return (
    <div data-testid="merchant-subscriptions-page" style={{ padding: 24, maxWidth: 1080, margin: '0 auto' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h1 style={{ margin: 0 }}>Subscriptions</h1>
          <p style={{ color: '#5f6368', marginTop: 4 }}>
            Manage recurring plans, metered usage, and dunning for merchant {merchantId}.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadAll()}
          disabled={loading}
          data-testid="refresh-subscriptions"
          style={{ padding: '8px 16px', borderRadius: 6, border: '1px solid #dadce0', background: '#fff' }}
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {error && (
        <div
          role="alert"
          data-testid="subscriptions-error"
          style={{ background: '#fce8e6', color: '#c5221f', padding: 12, borderRadius: 6, marginTop: 16 }}
        >
          {error}
        </div>
      )}

      {notice && (
        <div
          role="status"
          data-testid="subscriptions-notice"
          style={{ background: '#e6f4ea', color: '#137333', padding: 12, borderRadius: 6, marginTop: 16 }}
        >
          {notice}
        </div>
      )}

      {loading && subscriptions.length === 0 && (
        <p data-testid="subscriptions-loading" style={{ marginTop: 24 }}>
          Loading subscriptions…
        </p>
      )}

      {!loading && subscriptions.length === 0 && !error && (
        <p data-testid="subscriptions-empty" style={{ marginTop: 24, color: '#5f6368' }}>
          No subscriptions found for this merchant.
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginTop: 24 }}>
        {sortedSubscriptions.map((sub) => {
          const dunning = dunningBySub[sub.id];
          const showDunningBanner = isDunningStatus(sub.status) && dunning?.inDunning;
          const billingEligible = executeBillingEligible(sub);
          const canRetry = retryEligible(sub);
          const isTerminal = sub.status === 'Cancelled';

          return (
            <section
              key={sub.id}
              data-testid={`subscription-card-${sub.id}`}
              style={{ border: '1px solid #dadce0', borderRadius: 8, padding: 16, background: '#fff' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <h2 style={{ margin: 0, fontSize: 18 }}>{sub.planName}</h2>
                    <StatusBadge status={sub.status} />
                    {sub.isMetered && (
                      <span
                        data-testid={`metered-tag-${sub.id}`}
                        style={{
                          fontSize: 11,
                          fontWeight: 600,
                          padding: '2px 8px',
                          borderRadius: 10,
                          background: '#f3e8fd',
                          color: '#681da8',
                        }}
                      >
                        Metered
                      </span>
                    )}
                  </div>
                  <p style={{ margin: '8px 0 0', color: '#5f6368', fontSize: 13 }}>
                    Customer: {sub.customerId} · {formatAmount(sub.amount, sub.currency)} / {sub.interval}
                  </p>
                  <p style={{ margin: '4px 0 0', color: '#5f6368', fontSize: 13 }}>
                    Period: {formatTimestamp(sub.currentPeriodStart)} → {formatTimestamp(sub.currentPeriodEnd)}
                  </p>
                  {sub.status === 'Trial' && sub.trialEndsAt && (
                    <p
                      data-testid={`trial-ends-${sub.id}`}
                      style={{ margin: '4px 0 0', color: '#1a73e8', fontSize: 13, fontWeight: 600 }}
                    >
                      Trial ends {formatTimestamp(sub.trialEndsAt)}
                    </p>
                  )}
                </div>

                <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                  {sub.status === 'Active' && (
                    <button
                      type="button"
                      data-testid={`pause-${sub.id}`}
                      onClick={() => requestAction({ kind: 'pause', sub })}
                      style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #dadce0', background: '#fff' }}
                    >
                      Pause
                    </button>
                  )}
                  {sub.status === 'Paused' && (
                    <button
                      type="button"
                      data-testid={`resume-${sub.id}`}
                      onClick={() => requestAction({ kind: 'resume', sub })}
                      style={{ padding: '6px 12px', borderRadius: 6, border: '1px solid #dadce0', background: '#fff' }}
                    >
                      Resume
                    </button>
                  )}
                  {!isTerminal && (
                    <button
                      type="button"
                      data-testid={`cancel-${sub.id}`}
                      onClick={() => requestAction({ kind: 'cancel', sub })}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: '1px solid #f28b82',
                        background: '#fff',
                        color: '#c5221f',
                      }}
                    >
                      Cancel
                    </button>
                  )}
                  {sub.isMetered && (
                    <button
                      type="button"
                      data-testid={`execute-billing-${sub.id}`}
                      disabled={!billingEligible || isTerminal}
                      title={
                        billingEligible
                          ? 'Execute metered billing'
                          : `Next eligible billing at ${formatTimestamp(sub.nextBillingAt)}`
                      }
                      onClick={() => requestAction({ kind: 'executeBilling', sub })}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: 'none',
                        background: billingEligible && !isTerminal ? '#1a73e8' : '#dadce0',
                        color: billingEligible && !isTerminal ? '#fff' : '#5f6368',
                        cursor: billingEligible && !isTerminal ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Execute Billing
                    </button>
                  )}
                  {isDunningStatus(sub.status) && (
                    <button
                      type="button"
                      data-testid={`retry-payment-${sub.id}`}
                      disabled={!canRetry}
                      title={
                        canRetry
                          ? 'Retry failed payment'
                          : `Next retry eligible at ${formatTimestamp(dunning?.nextRetryAt)}`
                      }
                      onClick={() => requestAction({ kind: 'retryPayment', sub })}
                      style={{
                        padding: '6px 12px',
                        borderRadius: 6,
                        border: 'none',
                        background: canRetry ? '#c5221f' : '#dadce0',
                        color: canRetry ? '#fff' : '#5f6368',
                        cursor: canRetry ? 'pointer' : 'not-allowed',
                      }}
                    >
                      Retry Payment
                    </button>
                  )}
                </div>
              </div>

              {showDunningBanner && dunning && (
                <div style={{ marginTop: 16 }}>
                  <DunningAlertBanner
                    dunning={dunning}
                    ledgerNow={ledgerNow}
                    onRetry={() => void handleRetryFromBanner(sub.id)}
                  />
                </div>
              )}

              {sub.isMetered && (
                <div style={{ marginTop: 16 }}>
                  <MeteredUsageCard
                    subscriptionId={sub.id}
                    currency={sub.currency}
                    client={client}
                    reporterAddress={reporterAddress}
                    onUpdateCap={handleCapUpdate}
                    onReportUsage={handleReportUsage}
                  />
                </div>
              )}
            </section>
          );
        })}
      </div>

      <ConfirmationDialog
        open={pending !== null}
        title={
          pending
            ? {
                pause: 'Pause subscription?',
                resume: 'Resume subscription?',
                cancel: 'Cancel subscription?',
                executeBilling: 'Execute metered billing?',
                retryPayment: 'Retry failed payment?',
              }[pending.kind]
            : ''
        }
        impact={buildImpactText(pending)}
        confirmLabel={
          pending
            ? {
                pause: 'Pause',
                resume: 'Resume',
                cancel: 'Cancel subscription',
                executeBilling: 'Execute billing',
                retryPayment: 'Retry payment',
              }[pending.kind]
            : 'Confirm'
        }
        busy={busy}
        onConfirm={() => void confirmPending()}
        onCancel={() => setPending(null)}
      />
    </div>
  );
};

export default SubscriptionsPage;