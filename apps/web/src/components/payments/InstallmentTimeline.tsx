/**
 * InstallmentTimeline.tsx
 *
 * Chronological installment payment history for a single installment plan.
 *
 * Renders the installment records surfaced by the payment contract entrypoints
 * (`get_installment_history`, paginated, newest first) in chronological order with
 * per-installment status, amount paid, running remaining balance and the on-chain
 * transaction hash emitted by `pay_installment` (`InstallmentPaid`).
 *
 * Design notes:
 *   - Refunded installments are rendered distinctly from paid ones so a partial or
 *     multi-installment refund never reads as an unpaid balance.
 *   - The timeline is read-only; paydown actions live in the PayInstallmentModal.
 */

import React from "react";
import {
  computePaidTotal,
  computeRefundedTotal,
  unitsToDecimalString,
  type InstallmentEntry,
} from "./installment-plan";

export interface InstallmentTimelineProps {
  /** Installment records for the plan, ordered by installment number. */
  installments: InstallmentEntry[];
  /** Total plan amount in base token units. */
  totalAmount: bigint;
  /** Display decimals for the plan currency. */
  decimals?: number;
}

const STATUS_STYLES: Record<string, { backgroundColor: string; color: string; label: string }> = {
  PAID: { backgroundColor: "rgba(22, 163, 74, 0.12)", color: "#15803d", label: "Paid" },
  REFUNDED: { backgroundColor: "rgba(217, 119, 6, 0.12)", color: "#b45309", label: "Refunded" },
};

function shortHash(hash: string): string {
  if (hash.length <= 16) {
    return hash;
  }
  return `${hash.slice(0, 8)}...${hash.slice(hash.length - 6)}`;
}

export function InstallmentTimeline({ installments, totalAmount, decimals = 6 }: InstallmentTimelineProps) {
  const sorted = [...installments].sort((a, b) => a.installmentNumber - b.installmentNumber);
  const paidTotal = computePaidTotal(installments);
  const refundedTotal = computeRefundedTotal(installments);
  const paidPercent = Math.round(Number((paidTotal * 100n) / (totalAmount || 1n)));

  if (sorted.length === 0) {
    return (
      <div style={styles.emptyState} data-testid="installment-timeline-empty">
        No installments have been recorded for this plan yet.
      </div>
    );
  }

  return (
    <div style={styles.container} data-testid="installment-timeline">
      <div style={styles.headerRow}>
        <span style={styles.headerLabel}>Installment history</span>
        <span style={styles.headerMeta}>
          {unitsToDecimalString(paidTotal, decimals)} paid of {unitsToDecimalString(totalAmount, decimals)} (
          {paidPercent}%)
        </span>
      </div>
      <div style={styles.rows}>
        {sorted.map((entry) => {
          const statusStyle = STATUS_STYLES[entry.status] ?? STATUS_STYLES.PAID;
          const transactionHash = entry.transactionHash ?? null;
          return (
            <div key={entry.installmentNumber} style={styles.row} data-testid="installment-row">
              <div style={styles.rowCell}>
                <span style={styles.rowTitle}>Installment #{entry.installmentNumber}</span>
                <span style={styles.rowSub}>
                  Paid at {new Date(entry.paidAt * 1000).toLocaleString()}
                </span>
              </div>
              <div style={styles.rowCell}>
                <span style={styles.rowAmount}>{unitsToDecimalString(entry.amountPaid, decimals)}</span>
                <span style={styles.rowSub}>remaining {unitsToDecimalString(entry.remaining, decimals)}</span>
              </div>
              <div style={styles.rowCell}>
                <span style={{ ...styles.chip, backgroundColor: statusStyle.backgroundColor, color: statusStyle.color }}>
                  {statusStyle.label}
                </span>
              </div>
              <div style={styles.rowCell}>
                <span style={styles.rowHash}>{transactionHash ? shortHash(transactionHash) : "Pending"}</span>
              </div>
            </div>
          );
        })}
      </div>
      {refundedTotal > 0n ? (
        <div style={styles.refundedBanner} data-testid="installment-refunded-banner">
          {unitsToDecimalString(refundedTotal, decimals)} of this plan was refunded. Refunded installments are
          excluded from the paid progress and do not count as outstanding balances.
        </div>
      ) : null}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { display: "flex", flexDirection: "column", gap: 12 },
  headerRow: { display: "flex", justifyContent: "space-between", alignItems: "baseline" },
  headerLabel: { fontSize: 14, fontWeight: 600 },
  headerMeta: { fontSize: 12, color: "#6b7280" },
  rows: { display: "flex", flexDirection: "column" },
  row: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, padding: "10px 0", borderTop: "1px solid #e5e7eb" },
  rowCell: { display: "flex", flexDirection: "column", gap: 2 },
  rowTitle: { fontSize: 14, fontWeight: 600 },
  rowSub: { fontSize: 12, color: "#6b7280" },
  rowAmount: { fontSize: 14, fontWeight: 600 },
  chip: { fontSize: 12, fontWeight: 600, padding: "2px 8px", borderRadius: 999, alignSelf: "flex-start" },
  rowHash: { fontSize: 12, fontFamily: "monospace", color: "#374151" },
  refundedBanner: { fontSize: 12, color: "#b45309", backgroundColor: "rgba(217, 119, 6, 0.08)", borderRadius: 8, padding: "8px 10px" },
  emptyState: { fontSize: 14, color: "#6b7280", padding: 12, border: "1px dashed #d1d5db", borderRadius: 8 },
};
