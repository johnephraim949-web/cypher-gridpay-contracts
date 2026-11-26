/**
 * InstallmentPlanPage.tsx
 *
 * Installment Payment Plan Schedule & Self-Service Paydown page (issue #356).
 *
 * Composes the customer-facing payment schedule for an installment plan:
 *   - amortization progress bar (paid / total, refunded installments distinguished),
 *   - outstanding balance (`get_outstanding_balance`),
 *   - installment count (`get_installment_count`),
 *   - delinquency / grace-period status,
 *   - chronological installment history with transaction hashes (`get_installment_history`).
 *
 * Self-service paydown surface:
 *   - "Make Installment Payment" opens the PayInstallmentModal drawer supporting the
 *     scheduled installment, a custom partial paydown, or a full early payoff (with the
 *     early-payoff rebate).
 *   - "Finalize Installment Plan" calls `finalize_installment_payment` once the
 *     outstanding balance reaches zero.
 */

import React, { useCallback, useEffect, useState } from "react";
import { InstallmentTimeline } from "../../components/payments/InstallmentTimeline";
import { PayInstallmentModal } from "../../components/payments/PayInstallmentModal";
import {
  computeEarlyPayoffRebate,
  computePaidTotal,
  computeProgressPercent,
  computeRefundedTotal,
  deriveInstallmentPlanStatus,
  unitsToDecimalString,
  type InstallmentEntry,
  type InstallmentPaymentStatus,
} from "../../components/payments/installment-plan";

export type InstallmentPlanViewer = {
  kind: "customer" | "merchant";
  address?: string;
};

export interface InstallmentPlanPageProps {
  /** On-chain payment identifier. */
  paymentId: string;
  /** Who is viewing the plan. Customers self-serve; merchants monitor payouts. */
  viewer: InstallmentPlanViewer;
  /** Contract lifecycle status of the payment. */
  status: InstallmentPaymentStatus;
  /** Total plan amount in base token units. */
  amount: bigint;
  /** Outstanding balance in base token units (refreshed before any transaction simulation). */
  outstandingBalance: bigint;
  /** Installment count from `get_installment_count`. */
  installmentCount: number;
  /** Scheduled installment amount in base token units (per installment slice). */
  installmentAmount: bigint;
  /** Installment history records from `get_installment_history`. */
  installments: InstallmentEntry[];
  /** Currency symbol used for display / validation. */
  currencySymbol?: string;
  /** Display decimals for the plan currency. */
  decimals?: number;
  /** Early-payoff rebate in base token units. */
  earlyPayoffRebate: bigint;
  /** Early-payoff rebate in basis points. */
  rebateBps?: number;
  /** Grace period (seconds) before an installment plan is considered delinquent. */
  gracePeriodSeconds?: number;
  /** Re-reads the outstanding balance immediately before transaction simulation. */
  refreshOutstandingBalance?: () => Promise<bigint | null>;
  /** Confirms a validated installment paydown. */
  onPayInstallment?: (params: { amount: bigint; outstandingBalance: bigint }) => void | Promise<void>;
  /** Confirms finalization of a fully paid installment plan. */
  onFinalizeInstallmentPlan?: () => void | Promise<void>;
}

const STATUS_STYLES: Record<InstallmentPaymentStatus, { backgroundColor: string; color: string; label: string }> = {
  PENDING: { backgroundColor: "rgba(59, 130, 246, 0.12)", color: "#1d4ed8", label: "In progress" },
  COMPLETED: { backgroundColor: "rgba(22, 163, 74, 0.12)", color: "#15803d", label: "Completed" },
  REFUNDED: { backgroundColor: "rgba(217, 119, 6, 0.12)", color: "#b45309", label: "Refunded" },
  PARTIAL_REFUNDED: { backgroundColor: "rgba(217, 119, 6, 0.12)", color: "#b45309", label: "Partially refunded" },
  CANCELLED: { backgroundColor: "rgba(107, 114, 128, 0.12)", color: "#4b5563", label: "Cancelled" },
};

const styles: Record<string, React.CSSProperties> = {
  page: { maxWidth: 720, margin: "0 auto", padding: 16, display: "flex", flexDirection: "column", gap: 16 },
  header: { display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 },
  title: { fontSize: 20, fontWeight: 700 },
  subtitle: { fontSize: 13, color: "#6b7280", marginTop: 4 },
  statusBadge: { fontSize: 12, fontWeight: 700, padding: "4px 10px", borderRadius: 999 },
  banner: { fontSize: 13, borderRadius: 8, padding: 10 },
  bannerInfo: { backgroundColor: "rgba(59, 130, 246, 0.08)", color: "#1d4ed8" },
  bannerWarning: { backgroundColor: "rgba(217, 119, 6, 0.08)", color: "#b45309" },
  grid: { display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 },
  card: { border: "1px solid #e5e7eb", borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 4 },
  cardLabel: { fontSize: 12, color: "#6b7280" },
  cardValue: { fontSize: 18, fontWeight: 700 },
  cardValueSmall: { fontSize: 14, fontWeight: 600 },
  progressTrack: { height: 8, backgroundColor: "#e5e7eb", borderRadius: 999, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: "#16a34a", borderRadius: 999 },
  progressLabels: { display: "flex", justifyContent: "space-between", fontSize: 12, color: "#374151" },
  actions: { display: "flex", gap: 8, justifyContent: "flex-end" },
  primaryButton: { padding: "10px 16px", borderRadius: 8, border: "none", backgroundColor: "#16a34a", color: "#ffffff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
  primaryButtonDisabled: { padding: "10px 16px", borderRadius: 8, border: "none", backgroundColor: "#86efac", color: "#ffffff", fontSize: 14, fontWeight: 600, cursor: "not-allowed" },
  secondaryButton: { padding: "10px 16px", borderRadius: 8, border: "1px solid #d1d5db", backgroundColor: "#ffffff", fontSize: 14, cursor: "pointer" },
  timeline: { display: "flex", flexDirection: "column" },
};

export function InstallmentPlanPage({
  paymentId,
  viewer,
  status,
  amount,
  outstandingBalance,
  installmentCount,
  installmentAmount,
  installments,
  currencySymbol,
  decimals,
  earlyPayoffRebate,
  rebateBps,
  gracePeriodSeconds,
  refreshOutstandingBalance,
  onPayInstallment,
  onFinalizeInstallmentPlan,
}: InstallmentPlanPageProps) {
  const [balance, setBalance] = useState<bigint>(outstandingBalance);
  const [payOpen, setPayOpen] = useState(false);
  const [finalizing, setFinalizing] = useState(false);
  const [finalizeError, setFinalizeError] = useState<string | null>(null);
  const [payError, setPayError] = useState<string | null>(null);

  useEffect(() => {
    setBalance(outstandingBalance);
  }, [outstandingBalance]);

  const refreshBalance = useCallback(async (): Promise<bigint | null> => {
    const latest = await refreshOutstandingBalance?.();
    if (latest !== null) {
      setBalance(latest);
    }
    return latest ?? outstandingBalance;
  }, [refreshOutstandingBalance, outstandingBalance]);

  const handlePay = useCallback(
    async (params: { amount: bigint; outstandingBalance: bigint }) => {
      const latest = (await refreshBalance()) ?? params.outstandingBalance;
      setBalance(latest);
      if (params.amount > latest) {
        setPayError("That is more than the outstanding balance.");
        return;
      }
      return onPayInstallment?.({ amount: params.amount, outstandingBalance: latest });
    },
    [refreshBalance, onPayInstallment],
  );

  const handleFinalize = async () => {
    if (finalizing) {
      return;
    }
    setFinalizing(true);
    setFinalizeError(null);
    try {
      await onFinalizeInstallmentPlan?.();
    } finally {
      setFinalizing(false);
    }
  };

  const paidTotal = computePaidTotal(installments);
  const refundedTotal = computeRefundedTotal(installments);
  const progressPercent = computeProgressPercent(paidTotal, amount);
  const planStatus = deriveInstallmentPlanStatus({
    status,
    outstandingBalance: balance,
    lastPaidAtSeconds: installments.reduce(
      (acc, entry) => (entry.status === "PAID" ? Math.max(acc, entry.paidAt) : acc),
      0,
    ),
    gracePeriodSeconds,
  });
  const statusStyle = STATUS_STYLES[planStatus.status];

  const resolvedDecimals = decimals ?? 6;

  return (
    <section style={styles.page} data-testid="installment-plan-page">
      <div style={styles.header}>
        <div>
          <div style={styles.title}>Installment Payment Plan</div>
          <div style={styles.subtitle}>Payment #{paymentId}</div>
        </div>
        <span style={{ ...styles.statusBadge, backgroundColor: statusStyle.backgroundColor, color: statusStyle.color }}>
          {statusStyle.label}
        </span>
      </div>

      {planStatus.delinquent ? (
        <div style={{ ...styles.banner, ...styles.bannerWarning }} data-testid="installment-delinquent-banner">
          This installment plan is past the grace period. No further installments were scheduled until the
          outstanding balance is reduced.
        </div>
      ) : null}

      {planStatus.awaitingFinalization ? (
        <div style={{ ...styles.banner, ...styles.bannerInfo }} data-testid="installment-finalize-banner">
          The outstanding balance is zero. Finalize the installment plan to release the collected funds to the
          merchant.
        </div>
      ) : null}

      {finalizeError ? <div style={{ ...styles.banner, ...styles.bannerWarning }}>{finalizeError}</div> : null}
      {payError ? <div style={{ ...styles.banner, ...styles.bannerWarning }}>{payError}</div> : null}

      <div style={styles.grid}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Outstanding balance</span>
          <span style={styles.cardValue}>{unitsToDecimalString(balance, resolvedDecimals)}</span>
          <span style={styles.cardLabel}>Currency: {currencySymbol ?? "USDC"}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Paid so far</span>
          <span style={styles.cardValue}>{unitsToDecimalString(paidTotal, resolvedDecimals)}</span>
          <span style={styles.cardLabel}>{progressPercent}% of {unitsToDecimalString(amount, resolvedDecimals)}</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Installments</span>
          <span style={styles.cardValueSmall}>{installmentCount}</span>
          <span style={styles.cardLabel}>Recorded via get_installment_count</span>
        </div>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Early-payoff rebate</span>
          <span style={styles.cardValueSmall}>{unitsToDecimalString(computeEarlyPayoffRebate(balance, rebateBps ?? 0), resolvedDecimals)}</span>
          <span style={styles.cardLabel}>{rebateBps ?? 0} bps</span>
        </div>
      </div>

      <div style={styles.timeline}>
        <div style={styles.card}>
          <span style={styles.cardLabel}>Amortization progress</span>
          <div style={styles.progressTrack} data-testid="installment-progress-track">
            <div style={{ ...styles.progressFill, width: `${progressPercent}%` }} />
          </div>
          <div style={styles.progressLabels}>
            <span>{unitsToDecimalString(paidTotal, resolvedDecimals)} paid</span>
            <span>{progressPercent}% of {unitsToDecimalString(amount, resolvedDecimals)}</span>
            <span>{unitsToDecimalString(refundedTotal, resolvedDecimals)} refunded</span>
          </div>
        </div>
      </div>

      <div style={styles.timeline}>
        <InstallmentTimeline installments={installments} totalAmount={amount} decimals={resolvedDecimals} />
      </div>

      {viewer.kind === "customer" ? (
        <div style={styles.actions}>
          {planStatus.isActive ? (
            <button type="button" style={styles.primaryButton} onClick={() => setPayOpen(true)} data-testid="open-pay-installment-modal">
              Make Installment Payment
            </button>
          ) : null}
          {planStatus.awaitingFinalization ? (
            <button
              type="button"
              style={styles.primaryButton}
              onClick={handleFinalize}
              disabled={finalizing}
              data-testid="finalize-installment-plan"
            >
              {finalizing ? "Finalizing..." : "Finalize Installment Plan"}
            </button>
          ) : null}
        </div>
      ) : null}

      <PayInstallmentModal
        open={payOpen}
        onClose={() => setPayOpen(false)}
        paymentId={paymentId}
        outstandingBalance={balance}
        refreshOutstandingBalance={refreshOutstandingBalance}
        installmentAmount={installmentAmount}
        installmentNumber={installmentCount + 1}
        totalInstallments={installmentCount}
        totalAmount={amount}
        earlyPayoffRebate={earlyPayoffRebate}
        rebateBps={rebateBps}
        decimals={decimals}
        currencySymbol={currencySymbol}
        onPay={handlePay}
      />
    </section>
  );
}
