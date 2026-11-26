import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useWallet } from "../../hooks/useWallet";
import { useContract } from "../../hooks/useContract";
import { DunningAlertBanner } from "../../components/subscriptions/DunningAlertBanner";

type SubscriptionStatus =
  | "Active"
  | "Trial"
  | "Paused"
  | "PastDue"
  | "Cancelled";

interface Subscription {
  id: string;
  planName: string;
  status: SubscriptionStatus;
  amount: string;
  interval: string;
  trialEndsAt?: number;
  currentPeriodEnd?: number;
  nextBillingAt?: number;
  pausedAt?: number;
  cancelledAt?: number;
  metered?: boolean;
}

interface DunningState {
  inDunning: boolean;
  retryCount: number;
  nextRetryAt?: number;
  lastFailureAt?: number;
  outstandingAmount?: string;
}

interface TrialNotice {
  active: boolean;
  endsAt?: number;
  conversionAmount?: string;
  authorized?: boolean;
}

const STATUS_STYLES: Record<SubscriptionStatus, string> = {
  Active: "bg-green-100 text-green-800 border-green-200",
  Trial: "bg-blue-100 text-blue-800 border-blue-200",
  Paused: "bg-yellow-100 text-yellow-800 border-yellow-200",
  PastDue: "bg-red-100 text-red-800 border-red-200",
  Cancelled: "bg-gray-100 text-gray-700 border-gray-200",
};

function formatDate(ts?: number): string {
  if (!ts) return "—";
  return new Date(ts * 1000).toLocaleString();
}

function formatCountdown(endsAt?: number, now: number = Date.now()): string {
  if (!endsAt) return "—";
  const diff = endsAt * 1000 - now;
  if (diff <= 0) return "expired";
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));
  const hours = Math.floor((diff % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: React.ReactNode;
  confirmLabel: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  message,
  confirmLabel,
  danger,
  busy,
  onConfirm,
  onCancel,
}) => {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">{title}</h3>
        <div className="mt-3 text-sm text-gray-700">{message}</div>
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            onClick={onCancel}
            disabled={busy}
          >
            Cancel
          </button>
          <button
            type="button"
            className={`rounded-md px-4 py-2 text-sm font-medium text-white ${
              danger
                ? "bg-red-600 hover:bg-red-700"
                : "bg-indigo-600 hover:bg-indigo-700"
            } disabled:opacity-50`}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? "Processing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

const MySubscriptions: React.FC = () => {
  const { address, connected } = useWallet();
  const { contract, ledgerTimestamp } = useContract();

  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [dunningBySub, setDunningBySub] = useState<Record<string, DunningState>>(
    {}
  );
  const [trialNotices, setTrialNotices] = useState<Record<string, TrialNotice>>(
    {}
  );
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [now, setNow] = useState<number>(Date.now());

  const [confirm, setConfirm] = useState<{
    open: boolean;
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    danger?: boolean;
    action?: () => Promise<void>;
  }>({ open: false, title: "", message: null, confirmLabel: "Confirm" });

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const loadSubscriptions = useCallback(async () => {
    if (!contract || !address) return;
    setLoading(true);
    setError(null);
    try {
      const raw = await contract.get_subscriptions_by_customer(address);
      const subs: Subscription[] = (raw || []).map((s: any) => ({
        id: String(s.id ?? s.subscription_id ?? ""),
        planName: s.plan_name ?? s.planName ?? "Subscription",
        status: (s.status ?? "Active") as SubscriptionStatus,
        amount: String(s.amount ?? "0"),
        interval: s.interval ?? "monthly",
        trialEndsAt: s.trial_ends_at ?? s.trialEndsAt,
        currentPeriodEnd: s.current_period_end ?? s.currentPeriodEnd,
        nextBillingAt: s.next_billing_at ?? s.nextBillingAt,
        pausedAt: s.paused_at ?? s.pausedAt,
        cancelledAt: s.cancelled_at ?? s.cancelledAt,
        metered: Boolean(s.metered ?? s.is_metered),
      }));
      setSubscriptions(subs);

      const dunningEntries: Record<string, DunningState> = {};
      const trialEntries: Record<string, TrialNotice> = {};
      await Promise.all(
        subs.map(async (sub) => {
          try {
            const d = await contract.get_dunning_state(sub.id);
            dunningEntries[sub.id] = {
              inDunning: Boolean(d?.in_dunning ?? d?.inDunning),
              retryCount: Number(d?.retry_count ?? d?.retryCount ?? 0),
              nextRetryAt: d?.next_retry_at ?? d?.nextRetryAt,
              lastFailureAt: d?.last_failure_at ?? d?.lastFailureAt,
              outstandingAmount: d?.outstanding_amount ?? d?.outstandingAmount,
            };
          } catch {
            dunningEntries[sub.id] = { inDunning: false, retryCount: 0 };
          }
          if (sub.status === "Trial") {
            try {
              const notice = await contract.emit_trial_conversion_notice(sub.id);
              trialEntries[sub.id] = {
                active: Boolean(notice?.active ?? notice?.emit),
                endsAt: notice?.ends_at ?? notice?.endsAt ?? sub.trialEndsAt,
                conversionAmount:
                  notice?.conversion_amount ?? notice?.conversionAmount,
                authorized: Boolean(
                  notice?.authorized ?? notice?.conversion_authorized
                ),
              };
            } catch {
              trialEntries[sub.id] = {
                active: Boolean(sub.trialEndsAt),
                endsAt: sub.trialEndsAt,
              };
            }
          }
        })
      );
      setDunningBySub(dunningEntries);
      setTrialNotices(trialEntries);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load subscriptions");
    } finally {
      setLoading(false);
    }
  }, [contract, address]);

  useEffect(() => {
    loadSubscriptions();
  }, [loadSubscriptions]);

  const runAction = async (id: string, fn: () => Promise<void>) => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await loadSubscriptions();
    } catch (e: any) {
      setError(e?.message ?? "Transaction failed");
    } finally {
      setBusyId(null);
    }
  };

  const openConfirm = (
    title: string,
    message: React.ReactNode,
    confirmLabel: string,
    action: () => Promise<void>,
    danger = false
  ) => {
    setConfirm({ open: true, title, message, confirmLabel, action, danger });
  };

  const closeConfirm = () =>
    setConfirm((c) => ({ ...c, open: false, action: undefined }));

  const handleConfirm = async () => {
    const action = confirm.action;
    if (!action) return;
    try {
      await action();
    } finally {
      closeConfirm();
    }
  };

  const authorizeTrial = (sub: Subscription) => {
    const notice = trialNotices[sub.id];
    const amount = notice?.conversionAmount ?? sub.amount;
    openConfirm(
      "Authorize trial conversion",
      <div className="space-y-2">
        <p>
          Your trial for <strong>{sub.planName}</strong> will convert to a paid
          subscription.
        </p>
        <p>
          You will be charged{" "}
          <strong data-testid="trial-conversion-amount">{amount}</strong> per{" "}
          {sub.interval} starting{" "}
          {formatDate(notice?.endsAt ?? sub.trialEndsAt)}.
        </p>
        <p className="text-xs text-gray-500">
          By authorizing, you consent to the recurring charge shown above.
        </p>
      </div>,
      "Authorize conversion",
      async () => {
        if (!contract) return;
        await runAction(sub.id, async () => {
          await contract.authorize_trial_conversion_amount(sub.id, amount);
        });
      }
    );
  };

  const pauseSubscription = (sub: Subscription) => {
    openConfirm(
      "Pause subscription",
      <div className="space-y-2">
        <p>
          Pausing <strong>{sub.planName}</strong> will suspend billing and access
          until you resume.
        </p>
        <p className="text-xs text-gray-500">
          Any unused time in the current period is preserved and resumes when you
          reactivate.
        </p>
      </div>,
      "Pause subscription",
      async () => {
        if (!contract) return;
        await runAction(sub.id, async () => {
          await contract.pause_subscription(sub.id);
        });
      }
    );
  };

  const resumeSubscription = (sub: Subscription) => {
    openConfirm(
      "Resume subscription",
      <div className="space-y-2">
        <p>
          Resuming <strong>{sub.planName}</strong> will restart billing on your
          next cycle.
        </p>
        <p className="text-xs text-gray-500">
          Billing resumes at {formatDate(sub.nextBillingAt)}.
        </p>
      </div>,
      "Resume subscription",
      async () => {
        if (!contract) return;
        await runAction(sub.id, async () => {
          await contract.resume_subscription(sub.id);
        });
      }
    );
  };

  const cancelSubscription = (sub: Subscription) => {
    openConfirm(
      "Cancel subscription",
      <div className="space-y-2">
        <p>
          Cancelling <strong>{sub.planName}</strong> is immediate and cannot be
          undone.
        </p>
        <p>
          You will lose access at the end of the current period (
          {formatDate(sub.currentPeriodEnd)}).
        </p>
        <p className="text-xs text-gray-500">
          No proration refund is issued for the remaining time in this period.
        </p>
      </div>,
      "Cancel subscription",
      async () => {
        if (!contract) return;
        await runAction(sub.id, async () => {
          await contract.cancel_subscription(sub.id);
        });
      },
      true
    );
  };

  const retryFailedPayment = (sub: Subscription) => {
    const dunning = dunningBySub[sub.id];
    openConfirm(
      "Retry failed payment",
      <div className="space-y-2">
        <p>
          We will attempt to charge the outstanding balance for{" "}
          <strong>{sub.planName}</strong>.
        </p>
        {dunning?.outstandingAmount && (
          <p>
            Outstanding amount:{" "}
            <strong>{dunning.outstandingAmount}</strong>
          </p>
        )}
        <p className="text-xs text-gray-500">
          Retry attempt #{((dunning?.retryCount ?? 0) + 1).toString()}.
        </p>
      </div>,
      "Retry payment",
      async () => {
        if (!contract) return;
        await runAction(sub.id, async () => {
          // Refresh dunning state immediately before constructing the tx to
          // avoid acting on stale concurrent state changes.
          const fresh = await contract.get_dunning_state(sub.id);
          const freshDunning: DunningState = {
            inDunning: Boolean(fresh?.in_dunning ?? fresh?.inDunning),
            retryCount: Number(fresh?.retry_count ?? fresh?.retryCount ?? 0),
            nextRetryAt: fresh?.next_retry_at ?? fresh?.nextRetryAt,
            lastFailureAt: fresh?.last_failure_at ?? fresh?.lastFailureAt,
            outstandingAmount:
              fresh?.outstanding_amount ?? fresh?.outstandingAmount,
          };
          setDunningBySub((prev) => ({ ...prev, [sub.id]: freshDunning }));

          if (!freshDunning.inDunning) {
            throw new Error(
              "Dunning state changed — payment is no longer in dunning."
            );
          }
          if (
            freshDunning.nextRetryAt &&
            ledgerTimestamp !== undefined &&
            ledgerTimestamp < freshDunning.nextRetryAt
          ) {
            throw new Error(
              `Retry not yet eligible until ${formatDate(
                freshDunning.nextRetryAt
              )}.`
            );
          }
          await contract.retry_failed_payment(sub.id);
        });
      }
    );
  };

  const retryEligible = (sub: Subscription): boolean => {
    const d = dunningBySub[sub.id];
    if (!d?.inDunning) return false;
    if (d.nextRetryAt && ledgerTimestamp !== undefined) {
      return ledgerTimestamp >= d.nextRetryAt;
    }
    return true;
  };

  const activeTrialBanners = useMemo(
    () =>
      subscriptions.filter(
        (s) =>
          s.status === "Trial" &&
          trialNotices[s.id]?.active &&
          !trialNotices[s.id]?.authorized
      ),
    [subscriptions, trialNotices]
  );

  if (!connected) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">My Subscriptions</h1>
          <p className="mt-2 text-sm text-gray-600">
            Connect your wallet to manage your subscriptions.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl p-6" data-testid="my-subscriptions-page">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Subscriptions</h1>
          <p className="text-sm text-gray-600">
            Manage your plans, trials, and billing.
          </p>
        </div>
        <button
          type="button"
          onClick={loadSubscriptions}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          disabled={loading}
        >
          {loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {error && (
        <div
          className="mb-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
          role="alert"
        >
          {error}
        </div>
      )}

      {activeTrialBanners.map((sub) => {
        const notice = trialNotices[sub.id];
        return (
          <div
            key={`trial-${sub.id}`}
            className="mb-4 rounded-lg border border-blue-200 bg-blue-50 p-4"
            data-testid="trial-ending-banner"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-semibold text-blue-900">
                  Your trial for {sub.planName} ends in{" "}
                  <span data-testid="trial-countdown">
                    {formatCountdown(notice?.endsAt ?? sub.trialEndsAt, now)}
                  </span>
                </p>
                <p className="text-sm text-blue-800">
                  Authorize conversion to keep access. You'll be charged{" "}
                  {notice?.conversionAmount ?? sub.amount} per {sub.interval}.
                </p>
              </div>
              <button
                type="button"
                className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                onClick={() => authorizeTrial(sub)}
                disabled={busyId === sub.id}
                data-testid={`authorize-trial-${sub.id}`}
              >
                Authorize conversion
              </button>
            </div>
          </div>
        );
      })}

      {loading && subscriptions.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          Loading subscriptions…
        </div>
      ) : subscriptions.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500">
          You have no active subscriptions.
        </div>
      ) : (
        <div className="space-y-4">
          {subscriptions.map((sub) => {
            const dunning = dunningBySub[sub.id];
            const notice = trialNotices[sub.id];
            const isBusy = busyId === sub.id;
            return (
              <div
                key={sub.id}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
                data-testid={`subscription-${sub.id}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h2 className="text-lg font-semibold text-gray-900">
                        {sub.planName}
                      </h2>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                          STATUS_STYLES[sub.status]
                        }`}
                        data-testid={`status-${sub.id}`}
                      >
                        {sub.status === "PastDue" ? "Past Due / Dunning" : sub.status}
                      </span>
                      {sub.metered && (
                        <span className="rounded-full border border-purple-200 bg-purple-100 px-2 py-0.5 text-xs font-medium text-purple-800">
                          Metered
                        </span>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-gray-600">
                      {sub.amount} / {sub.interval}
                    </p>
                    <dl className="mt-3 grid grid-cols-2 gap-x-6 gap-y-1 text-sm text-gray-600">
                      <div>
                        <dt className="inline text-gray-500">Next billing: </dt>
                        <dd className="inline">{formatDate(sub.nextBillingAt)}</dd>
                      </div>
                      <div>
                        <dt className="inline text-gray-500">Period ends: </dt>
                        <dd className="inline">
                          {formatDate(sub.currentPeriodEnd)}
                        </dd>
                      </div>
                      {sub.status === "Trial" && (
                        <div>
                          <dt className="inline text-gray-500">Trial ends: </dt>
                          <dd className="inline">
                            {formatDate(sub.trialEndsAt)}
                          </dd>
                        </div>
                      )}
                    </dl>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    {sub.status === "Trial" && !notice?.authorized && (
                      <button
                        type="button"
                        className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                        onClick={() => authorizeTrial(sub)}
                        disabled={isBusy}
                        data-testid={`authorize-trial-inline-${sub.id}`}
                      >
                        Authorize conversion
                      </button>
                    )}
                    {sub.status === "Active" && (
                      <button
                        type="button"
                        className="rounded-md border border-yellow-300 bg-yellow-50 px-3 py-2 text-sm font-medium text-yellow-800 hover:bg-yellow-100 disabled:opacity-50"
                        onClick={() => pauseSubscription(sub)}
                        disabled={isBusy}
                        data-testid={`pause-${sub.id}`}
                      >
                        Pause
                      </button>
                    )}
                    {sub.status === "Paused" && (
                      <button
                        type="button"
                        className="rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm font-medium text-green-800 hover:bg-green-100 disabled:opacity-50"
                        onClick={() => resumeSubscription(sub)}
                        disabled={isBusy}
                        data-testid={`resume-${sub.id}`}
                      >
                        Resume
                      </button>
                    )}
                    {sub.status !== "Cancelled" && (
                      <button
                        type="button"
                        className="rounded-md border border-red-300 bg-red-50 px-3 py-2 text-sm font-medium text-red-700 hover:bg-red-100 disabled:opacity-50"
                        onClick={() => cancelSubscription(sub)}
                        disabled={isBusy}
                        data-testid={`cancel-${sub.id}`}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </div>

                {dunning?.inDunning && (
                  <div className="mt-4">
                    <DunningAlertBanner
                      subscriptionId={sub.id}
                      retryCount={dunning.retryCount}
                      nextRetryAt={dunning.nextRetryAt}
                      lastFailureAt={dunning.lastFailureAt}
                      outstandingAmount={dunning.outstandingAmount}
                      ledgerTimestamp={ledgerTimestamp}
                      retryEligible={retryEligible(sub)}
                      busy={isBusy}
                      onRetry={() => retryFailedPayment(sub)}
                    />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirm.open}
        title={confirm.title}
        message={confirm.message}
        confirmLabel={confirm.confirmLabel}
        danger={confirm.danger}
        busy={busyId !== null}
        onConfirm={handleConfirm}
        onCancel={closeConfirm}
      />
    </div>
  );
};

export default MySubscriptions;