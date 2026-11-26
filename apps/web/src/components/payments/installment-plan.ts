/**
 * installment-plan.ts
 *
 * Pure computation helpers for the Installment Payment Plan Schedule & Self-Service
 * Paydown UI (issue #356).
 *
 * Mirrors the Cypher GridPay payment contract installment surface:
 *   - `pay_installment`
 *   - `finalize_installment_payment`
 *   - `get_installment_history`
 *   - `get_installment_count`
 *   - `get_outstanding_balance`
 *
 * All monetary math is performed in base token units (BigInt stroops) end to end and
 * never crosses a floating point boundary, so overpayment checks against the outstanding
 * balance are exact.
 */

// ---------------------------------------------------------------------------
// Asset / amount helpers
// ---------------------------------------------------------------------------

/** Display decimals for known assets; defaults to the widest supported precision. */
export const ASSET_DECIMALS: Record<string, number> = {
  USDC: 6,
  XLM: 7,
  ETH: 18,
  BTC: 8,
};

export const DEFAULT_DECIMALS = 18;

export function decimalsForAsset(symbol: string): number {
  return ASSET_DECIMALS[symbol] ?? DEFAULT_DECIMALS;
}

export type AmountCheck = { ok: true; units: bigint } | { ok: false; message: string };

/**
 * Validates a user-entered (or full-payoff) paydown amount against the outstanding
 * balance using exact BigInt comparisons. Rejects malformed, non-positive and
 * over-limit amounts before any transaction simulation happens.
 */
export function validatePaydownAmount(
  amount: string,
  decimals: number,
  outstandingUnits: bigint,
  symbol: string = "USDC",
): AmountCheck {
  const text = amount.trim();
  if (!/^\d*\.?\d*$/.test(text) || !/\d/.test(text)) {
    return { ok: false, message: "Enter the amount as a plain number, such as 0.25." };
  }
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? "" : text.slice(dot + 1);
  if (fraction.length > decimals) {
    return { ok: false, message: `${symbol} supports at most ${decimals} decimal places.` };
  }
  const units = BigInt((whole || "0") + fraction.padEnd(decimals, "0"));
  if (units <= 0n) {
    return { ok: false, message: "Enter an amount greater than zero." };
  }
  if (units > outstandingUnits) {
    return { ok: false, message: "That is more than the outstanding balance." };
  }
  return { ok: true, units };
}

/** Converts a decimal string (e.g. "25.5") into base token units (BigInt stroops). */
export function decimalStringToUnits(value: string, decimals: number): bigint {
  const text = value.trim();
  const dot = text.indexOf(".");
  const whole = dot === -1 ? text : text.slice(0, dot);
  const fraction = dot === -1 ? "" : text.slice(dot + 1);
  return BigInt((whole || "0") + fraction.padEnd(decimals, "0"));
}

/** Formats base token units (BigInt stroops) into a decimal string display value. */
export function unitsToDecimalString(units: bigint, decimals: number): string {
  const negative = units < 0n;
  const abs = negative ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const fraction = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  const text = fraction.length > 0 ? `${whole}.${fraction}` : `${whole}`;
  return negative ? `-${text}` : text;
}

// ---------------------------------------------------------------------------
// Installment plan state
// ---------------------------------------------------------------------------

export type InstallmentEntryStatus = "PAID" | "REFUNDED";

export interface InstallmentEntry {
  installmentNumber: number;
  amountPaid: bigint;
  totalAmount: bigint;
  remaining: bigint;
  paidAt: number;
  status: InstallmentEntryStatus;
  transactionHash?: string | null;
}

export type InstallmentPaymentStatus =
  | "PENDING"
  | "COMPLETED"
  | "REFUNDED"
  | "PARTIAL_REFUNDED"
  | "CANCELLED";

export interface InstallmentPlanStatusView {
  status: InstallmentPaymentStatus;
  outstandingBalance: bigint;
  isActive: boolean;
  awaitingFinalization: boolean;
  fullyPaid: boolean;
  isRefunded: boolean;
  delinquent: boolean;
}

export interface InstallmentPlanStatusArgs {
  status: InstallmentPaymentStatus;
  outstandingBalance: bigint;
  nowSeconds?: number;
  lastPaidAtSeconds?: number | null;
  createdAtSeconds?: number;
  gracePeriodSeconds?: number;
}

/** Default grace period (seconds) before an installment plan is considered delinquent. */
export const DEFAULT_GRACE_PERIOD_SECONDS = 7 * 24 * 60 * 60;

/**
 * Derives the display status of an installment plan from the contract status and the
 * current outstanding balance (`get_outstanding_balance`).
 *
 * - `awaitingFinalization` — outstanding balance is zero but the payment is still `Pending`;
 *   the "Finalize Installment Plan" action becomes available.
 * - `fullyPaid` — the outstanding balance is zero (auto-finalization normally already ran).
 * - `delinquent` — plan still awaiting installments past the configured grace period.
 */
export function deriveInstallmentPlanStatus(args: InstallmentPlanStatusArgs): InstallmentPlanStatusView {
  const gracePeriodSeconds = args.gracePeriodSeconds ?? DEFAULT_GRACE_PERIOD_SECONDS;
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1000);
  const outstandingBalance = args.outstandingBalance;

  const fullyPaid = outstandingBalance === 0n;
  const awaitingFinalization = fullyPaid && args.status === "PENDING";
  const isActive = args.status === "PENDING" && outstandingBalance > 0n;
  const isRefunded = args.status === "REFUNDED" || args.status === "PARTIAL_REFUNDED";
  const anchorSeconds = args.lastPaidAtSeconds ?? args.createdAtSeconds ?? nowSeconds;
  const delinquent =
    args.status === "PENDING" &&
    outstandingBalance > 0n &&
    nowSeconds - anchorSeconds > gracePeriodSeconds;

  return {
    status: args.status,
    outstandingBalance,
    isActive,
    awaitingFinalization,
    fullyPaid,
    isRefunded,
    delinquent,
  };
}

// ---------------------------------------------------------------------------
// Installment math
// ---------------------------------------------------------------------------

/** Sums the amounts of installments that were actually paid (refunds excluded). */
export function computePaidTotal(installments: InstallmentEntry[]): bigint {
  let total = 0n;
  for (const entry of installments) {
    if (entry.status === "PAID") {
      total += entry.amountPaid;
    }
  }
  return total;
}

/** Sums the amounts of installments that were refunded. */
export function computeRefundedTotal(installments: InstallmentEntry[]): bigint {
  let total = 0n;
  for (const entry of installments) {
    if (entry.status === "REFUNDED") {
      total += entry.amountPaid;
    }
  }
  return total;
}

/** Amortization progress in whole percent (0-100) of the plan that is paid. */
export function computeProgressPercent(paid: bigint, total: bigint): number {
  if (total <= 0n) {
    return 0;
  }
  const percent = Number((paid * 100n) / total);
  return Math.min(100, Math.max(0, percent));
}

/** Finalization is only valid once the outstanding balance is zero and the plan awaits it. */
export function canFinalizeInstallmentPayment(
  status: InstallmentPaymentStatus,
  outstandingBalance: bigint,
): boolean {
  return outstandingBalance === 0n && status === "PENDING";
}

/** Early-payoff rebate for a full payoff, expressed in base token units. */
export function computeEarlyPayoffRebate(outstanding: bigint, rebateBps: number): bigint {
  if (outstanding <= 0n || rebateBps <= 0) {
    return 0n;
  }
  return (outstanding * BigInt(rebateBps)) / 10000n;
}
