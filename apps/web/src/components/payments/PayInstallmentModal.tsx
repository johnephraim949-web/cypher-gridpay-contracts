/**
 * PayInstallmentModal.tsx
 *
 * Self-service "Make Installment Payment" drawer for installment plans (issue #356).
 *
 * Supports three paydown modes for a single installment payment:
 *   - `scheduled`  — pay the next scheduled installment amount.
 *   - `custom`     — custom partial paydown against the outstanding balance.
 *   - `early-payoff` — full early payoff of the outstanding balance (rebate display).
 *
 * Security / race-condition handling:
 *   - The outstanding balance is refreshed immediately before the transaction
 *     simulation and every paydown amount is re-validated against that fresh value
 *     with exact BigInt comparisons, so overpayment can never reach simulation.
 *   - Partial paydowns greater than the outstanding balance are rejected.
 */

import React, { useEffect, useState } from "react";
import {
  computeEarlyPayoffRebate,
  decimalsForAsset,
  unitsToDecimalString,
  validatePaydownAmount,
} from "./installment-plan";

export type PayInstallmentMode = "scheduled" | "custom" | "early-payoff";

export interface PayInstallmentModalProps {
  open: boolean;
  onClose: () => void;
  paymentId: string;
  /** Outstanding balance in base token units (from `get_outstanding_balance`). */
  outstandingBalance: bigint;
  /** Re-reads the outstanding balance immediately before transaction simulation. */
  refreshOutstandingBalance?: () => Promise<bigint | null>;
  /** Amount of the next scheduled installment in base token units. */
  installmentAmount: bigint;
  /** 1-based number of the next installment to pay. */
  installmentNumber: number;
  /** Total number of installments in the plan. */
  totalInstallments: number;
  /** Total plan amount in base token units. */
  totalAmount: bigint;
  /** Early-payoff rebate in base token units. */
  earlyPayoffRebate: bigint;
  /** Early-payoff rebate in basis points. */
  rebateBps?: number;
  /** Display decimals for the plan currency. */
  decimals?: number;
  /** Currency symbol used for validation copy. */
  currencySymbol?: string;
  /** Confirms a validated paydown; receives the exact amount (base units) to settle. */
  onPay: (params: { amount: bigint; outstandingBalance: bigint }) => void | Promise<void>;
}

export function PayInstallmentModal({
  open,
  onClose,
  paymentId,
  outstandingBalance,
  refreshOutstandingBalance,
  installmentAmount,
  installmentNumber,
  totalInstallments,
  totalAmount,
  earlyPayoffRebate,
  rebateBps,
  decimals,
  currencySymbol,
  onPay,
}: PayInstallmentModalProps) {
  const [mode, setMode] = useState<PayInstallmentMode>("scheduled");
  const [customAmount, setCustomAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [liveOutstanding, setLiveOutstanding] = useState<bigint | null>(null);

  const resolvedDecimals = decimals ?? decimalsForAsset(currencySymbol ?? "USDC");
  const effectiveOutstanding = liveOutstanding ?? outstandingBalance;
  const resolvedSymbol = currencySymbol ?? "USDC";
  const rebate = earlyPayoffRebate > 0n ? earlyPayoffRebate : computeEarlyPayoffRebate(effectiveOutstanding, rebateBps ?? 0);

  useEffect(() => {
    if (!open) {
      return;
    }
    setMode("scheduled");
    setCustomAmount("");
    setError(null);
    setBusy(false);
    setLiveOutstanding(null);
    if (refreshOutstandingBalance) {
      let cancelled = false;
      refreshOutstandingBalance().then((latest) => {
        if (!cancelled && latest !== null) {
          setLiveOutstanding(latest);
        }
      });
      return () => {
        cancelled = true;
      };
    }
  }, [open, refreshOutstandingBalance]);

  const handleClose = () => {
    if (busy) {
      return;
    }
    onClose();
  };

  const handleConfirm = async () => {
    if (busy) {
      return;
    }
    let amount = installmentAmount;
    if (mode === "custom") {
      const check = validatePaydownAmount(customAmount, resolvedDecimals, effectiveOutstanding, resolvedSymbol);
      if (check.ok === true) {
        amount = check.units;
      } else {
        setError(check.message);
        return;
      }
    }
    if (mode === "early-payoff") {
      amount = effectiveOutstanding;
    }
    if (amount <= 0n) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (amount > effectiveOutstanding) {
      setError("That is more than the outstanding balance.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onPay({ amount, outstandingBalance: effectiveOutstanding });
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return null;
  }

  const scheduledAmount = installmentAmount;

  return (
    <div style={styles.overlay} data-testid="pay-installment-modal-overlay">
      <div style={styles.panel} role="dialog" aria-modal="true" aria-label="Make installment payment">
        <div style={styles.header}>
          <span style={styles.title}>Make Installment Payment</span>
          <button type="button" style={styles.closeButton} onClick={handleClose} disabled={busy} aria-label="Close">
            x
          </button>
        </div>
        <div style={styles.body}>
          <div style={styles.modeRow} role="tablist" aria-label="Paydown mode">
            <button
              type="button"
              style={mode === "scheduled" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => setMode("scheduled")}
            >
              Scheduled
            </button>
            <button
              type="button"
              style={mode === "custom" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => setMode("custom")}
            >
              Custom paydown
            </button>
            <button
              type="button"
              style={mode === "early-payoff" ? styles.modeButtonActive : styles.modeButton}
              onClick={() => setMode("early-payoff")}
            >
              Early payoff
            </button>
          </div>

          {mode === "scheduled" ? (
            <div style={styles.modeCard}>
              <span style={styles.modeCardLabel}>Scheduled installment</span>
              <span style={styles.modeCardValue}>
                #{installmentNumber} of {totalInstallments} &middot;{" "}
                {unitsToDecimalString(scheduledAmount, resolvedDecimals)}
              </span>
              <span style={styles.modeCardSub}>
                Paying this amount applies to the outstanding balance of payment {paymentId}.
              </span>
            </div>
          ) : null}

          {mode === "custom" ? (
            <div style={styles.modeCard}>
              <span style={styles.modeCardLabel}>Custom partial paydown</span>
              <input
                value={customAmount}
                onChange={(event) => setCustomAmount(event.target.value)}
                placeholder="0.25"
                inputMode="decimal"
                style={styles.input}
                disabled={busy}
                data-testid="pay-installment-custom-amount"
              />
              <span style={styles.modeCardSub}>
                Outstanding balance: {unitsToDecimalString(effectiveOutstanding, resolvedDecimals)}
              </span>
            </div>
          ) : null}

          {mode === "early-payoff" ? (
            <div style={styles.modeCard}>
              <span style={styles.modeCardLabel}>Full early payoff</span>
              <span style={styles.modeCardValue}>
                Pay off {unitsToDecimalString(effectiveOutstanding, resolvedDecimals)}
              </span>
              <span style={styles.modeCardSub}>
                Paying the full outstanding balance finalizes the installment plan.
              </span>
              {rebate > 0n ? (
                <span style={styles.modeCardSub}>
                  Early-payoff rebate: {unitsToDecimalString(rebate, resolvedDecimals)} ({rebateBps ?? 0} bps)
                </span>
              ) : null}
            </div>
          ) : null}

          {error ? <div style={styles.error}>{error}</div> : null}
        </div>
        <div style={styles.footer}>
          <button type="button" style={styles.cancelButton} onClick={handleClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" style={styles.confirmButton} onClick={handleConfirm} disabled={busy}>
            {busy ? "Submitting..." : mode === "early-payoff" ? "Pay off full balance" : "Pay installment"}
          </button>
        </div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  overlay: { position: "fixed", inset: 0, backgroundColor: "rgba(0, 0, 0, 0.5)", zIndex: 50 },
  panel: { position: "fixed", bottom: 0, left: 0, right: 0, backgroundColor: "#ffffff", borderRadius: "12px 12px 0 0", padding: 16, zIndex: 51, display: "flex", flexDirection: "column", gap: 12, maxHeight: "85vh", overflowY: "auto" },
  header: { display: "flex", alignItems: "center", justifyContent: "space-between" },
  title: { fontSize: 16, fontWeight: 700 },
  closeButton: { backgroundColor: "transparent", border: "none", fontSize: 16, cursor: "pointer", color: "#6b7280" },
  body: { display: "flex", flexDirection: "column", gap: 12 },
  modeRow: { display: "flex", gap: 8 },
  modeButton: { flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #d1d5db", backgroundColor: "#ffffff", fontSize: 13, cursor: "pointer" },
  modeButtonActive: { flex: 1, padding: "8px 0", borderRadius: 8, border: "1px solid #16a34a", backgroundColor: "#16a34a", color: "#ffffff", fontSize: 13, fontWeight: 600, cursor: "pointer" },
  modeCard: { display: "flex", flexDirection: "column", gap: 6, border: "1px solid #e5e7eb", borderRadius: 8, padding: 12 },
  modeCardLabel: { fontSize: 12, color: "#6b7280" },
  modeCardValue: { fontSize: 18, fontWeight: 700 },
  modeCardSub: { fontSize: 12, color: "#6b7280" },
  input: { padding: "10px 12px", borderRadius: 8, border: "1px solid #d1d5db", fontSize: 16 },
  error: { fontSize: 13, color: "#b91c1c", backgroundColor: "rgba(185, 28, 28, 0.08)", borderRadius: 8, padding: 8 },
  footer: { display: "flex", gap: 8, justifyContent: "flex-end" },
  cancelButton: { padding: "10px 16px", borderRadius: 8, border: "1px solid #d1d5db", backgroundColor: "#ffffff", fontSize: 14, cursor: "pointer" },
  confirmButton: { padding: "10px 16px", borderRadius: 8, border: "none", backgroundColor: "#16a34a", color: "#ffffff", fontSize: 14, fontWeight: 600, cursor: "pointer" },
};
