/**
 * VoucherCard.tsx (issue #355)
 *
 * Displays a single RefundVoucher with:
 *   - Remaining value and expiration countdown
 *   - Transferable / non-transferable indicator
 *   - Progress bar showing how much has been redeemed
 *   - Clear expired states: "Expired — awaiting merchant reserve sweep" vs redeemable
 *   - Transfer flow with Stellar address validation before signing
 *   - Split-redemption flow (partial redeem) when voucher config allows it
 */

import React, { useId, useState } from "react";
import {
  type RefundVoucher,
  type VoucherStatus,
  effectiveVoucherStatus,
  formatCountdown,
  isValidStellarAddress,
  unitsToDisplayString,
  voucherRedeemedPercent,
} from "./rewards-types";

export interface VoucherCardProps {
  voucher: RefundVoucher;
  /** Ledger timestamp in seconds (wall-clock fallback when absent). */
  nowSeconds: number;
  /** Currency symbol for display (e.g. "USDC"). */
  currencySymbol?: string;
  /** Display decimals for base-unit conversion. */
  decimals?: number;
  /**
   * Called with the recipient address when transfer is confirmed.
   * If undefined, the transfer button is not rendered even when transferable=true.
   */
  onTransfer?: (voucherId: string, recipient: string) => void | Promise<void>;
  /**
   * Called with the amount in base units when partial redemption is submitted.
   * If undefined, the redeem button is not rendered even when splitRedemptionAllowed=true.
   */
  onRedeem?: (voucherId: string, amount: bigint) => void | Promise<void>;
  busy?: boolean;
}

const STATUS_CONFIG: Record<
  VoucherStatus,
  { label: string; className: string }
> = {
  Active: {
    label: "Active",
    className: "bg-green-100 text-green-800 border-green-200",
  },
  PartiallyRedeemed: {
    label: "Partially redeemed",
    className: "bg-blue-100 text-blue-800 border-blue-200",
  },
  Expired: {
    label: "Expired",
    className: "bg-gray-100 text-gray-500 border-gray-200",
  },
  Redeemed: {
    label: "Fully redeemed",
    className: "bg-gray-100 text-gray-500 border-gray-200",
  },
};

/* ------------------------------------------------------------------ */
/* Transfer sub-form                                                    */
/* ------------------------------------------------------------------ */
interface TransferFormProps {
  voucherId: string;
  onTransfer: VoucherCardProps["onTransfer"];
  onCancel: () => void;
}

const TransferForm: React.FC<TransferFormProps> = ({
  voucherId,
  onTransfer,
  onCancel,
}) => {
  const inputId = useId();
  const [recipient, setRecipient] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = recipient.trim();
    if (!isValidStellarAddress(trimmed)) {
      setError(
        "Enter a valid Stellar address starting with G (56 characters)."
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onTransfer?.(voucherId, trimmed);
      onCancel();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Transfer failed — please retry."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3"
      data-testid="voucher-transfer-form"
      aria-label="Transfer voucher"
    >
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-indigo-800"
      >
        Recipient Stellar address
      </label>
      <input
        id={inputId}
        type="text"
        value={recipient}
        onChange={(e) => setRecipient(e.target.value)}
        placeholder="GABC...XYZ"
        className="mt-1 w-full rounded-md border border-indigo-300 px-3 py-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
        disabled={busy}
        maxLength={56}
        spellCheck={false}
        autoComplete="off"
        data-testid="voucher-transfer-recipient-input"
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-invalid={error ? "true" : "false"}
      />
      {error && (
        <p
          id={`${inputId}-error`}
          className="mt-1 text-xs text-red-600"
          role="alert"
          data-testid="voucher-transfer-error"
        >
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
          disabled={busy}
          data-testid="voucher-transfer-confirm-button"
        >
          {busy ? "Transferring…" : "Confirm transfer"}
        </button>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          onClick={onCancel}
          disabled={busy}
          data-testid="voucher-transfer-cancel-button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

/* ------------------------------------------------------------------ */
/* Split-redemption sub-form                                            */
/* ------------------------------------------------------------------ */
interface SplitRedeemFormProps {
  voucherId: string;
  remainingValue: bigint;
  decimals: number;
  currencySymbol: string;
  onRedeem: VoucherCardProps["onRedeem"];
  onCancel: () => void;
}

const SplitRedeemForm: React.FC<SplitRedeemFormProps> = ({
  voucherId,
  remainingValue,
  decimals,
  currencySymbol,
  onRedeem,
  onCancel,
}) => {
  const inputId = useId();
  const [amount, setAmount] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const maxDisplay = unitsToDisplayString(remainingValue, decimals);
  const base = 10n ** BigInt(decimals);

  const parseAmount = (raw: string): bigint | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const parts = trimmed.split(".");
    if (parts.length > 2) return null;
    const whole = BigInt(parts[0] || "0");
    const fracStr = (parts[1] ?? "").padEnd(decimals, "0").slice(0, decimals);
    const frac = BigInt(fracStr);
    return whole * base + frac;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseAmount(amount);
    if (parsed === null || parsed <= 0n) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (parsed > remainingValue) {
      setError(
        `Amount exceeds remaining value of ${maxDisplay} ${currencySymbol}.`
      );
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onRedeem?.(voucherId, parsed);
      onCancel();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Redemption failed — please retry."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="mt-3 rounded-md border border-green-200 bg-green-50 p-3"
      data-testid="voucher-redeem-form"
      aria-label="Redeem voucher"
    >
      <label
        htmlFor={inputId}
        className="block text-xs font-medium text-green-800"
      >
        Amount to redeem ({currencySymbol})
      </label>
      <input
        id={inputId}
        type="text"
        inputMode="decimal"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        placeholder={maxDisplay}
        className="mt-1 w-full rounded-md border border-green-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 disabled:opacity-50"
        disabled={busy}
        data-testid="voucher-redeem-amount-input"
        aria-describedby={error ? `${inputId}-error` : undefined}
        aria-invalid={error ? "true" : "false"}
      />
      <p className="mt-0.5 text-xs text-green-700">
        Max: {maxDisplay} {currencySymbol}
      </p>
      {error && (
        <p
          id={`${inputId}-error`}
          className="mt-1 text-xs text-red-600"
          role="alert"
          data-testid="voucher-redeem-error"
        >
          {error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <button
          type="submit"
          className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
          disabled={busy}
          data-testid="voucher-redeem-confirm-button"
        >
          {busy ? "Applying…" : "Apply voucher"}
        </button>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-1.5 text-sm font-medium text-gray-700 hover:bg-gray-50"
          onClick={onCancel}
          disabled={busy}
          data-testid="voucher-redeem-cancel-button"
        >
          Cancel
        </button>
      </div>
    </form>
  );
};

/* ------------------------------------------------------------------ */
/* VoucherCard main component                                           */
/* ------------------------------------------------------------------ */
export const VoucherCard: React.FC<VoucherCardProps> = ({
  voucher,
  nowSeconds,
  currencySymbol = "USDC",
  decimals = 6,
  onTransfer,
  onRedeem,
  busy,
}) => {
  const displayStatus = effectiveVoucherStatus(voucher, nowSeconds);
  const { label, className } = STATUS_CONFIG[displayStatus];
  const isExpired =
    displayStatus === "Expired" || displayStatus === "Redeemed";
  const redeemedPct = voucherRedeemedPercent(voucher);
  const remaining = unitsToDisplayString(voucher.remainingValue, decimals);
  const original = unitsToDisplayString(voucher.originalValue, decimals);

  const [showTransfer, setShowTransfer] = useState(false);
  const [showRedeem, setShowRedeem] = useState(false);

  const canTransfer =
    !isExpired && voucher.transferable && Boolean(onTransfer) && !busy;
  const canRedeem =
    !isExpired &&
    voucher.splitRedemptionAllowed &&
    voucher.remainingValue > 0n &&
    Boolean(onRedeem) &&
    !busy;

  return (
    <article
      className={`rounded-lg border p-4 shadow-sm transition-opacity ${
        isExpired ? "border-gray-200 bg-gray-50 opacity-70" : "border-gray-200 bg-white"
      }`}
      data-testid={`voucher-card-${voucher.id}`}
      aria-label={`Refund voucher from ${voucher.merchantName}`}
    >
      {/* Header row */}
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="text-xs text-gray-500">{voucher.merchantName}</p>
          <p
            className="mt-0.5 text-xl font-bold text-gray-900"
            data-testid={`voucher-remaining-${voucher.id}`}
          >
            {remaining}{" "}
            <span className="text-sm font-normal text-gray-500">
              {currencySymbol}
            </span>
          </p>
          <p className="mt-0.5 text-xs text-gray-400">
            of {original} {currencySymbol} original
          </p>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${className}`}
            data-testid={`voucher-status-${voucher.id}`}
          >
            {label}
          </span>
          {/* Transferable badge */}
          <span
            className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
              voucher.transferable
                ? "border-indigo-200 bg-indigo-50 text-indigo-700"
                : "border-gray-200 bg-gray-50 text-gray-500"
            }`}
            data-testid={`voucher-transferable-${voucher.id}`}
            aria-label={
              voucher.transferable ? "Transferable" : "Non-transferable"
            }
          >
            {voucher.transferable ? "Transferable" : "Non-transferable"}
          </span>
        </div>
      </div>

      {/* Progress bar */}
      {redeemedPct > 0 && (
        <div className="mt-3">
          <div className="flex justify-between text-xs text-gray-500">
            <span>Redeemed</span>
            <span data-testid={`voucher-pct-${voucher.id}`}>
              {redeemedPct}%
            </span>
          </div>
          <div
            className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-200"
            role="progressbar"
            aria-valuenow={redeemedPct}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className={`h-full rounded-full ${
                isExpired ? "bg-gray-400" : "bg-indigo-500"
              }`}
              style={{ width: `${redeemedPct}%` }}
            />
          </div>
        </div>
      )}

      {/* Expiry row */}
      <div className="mt-3 flex items-center justify-between text-xs text-gray-500">
        {displayStatus === "Expired" ? (
          <span
            className="font-medium text-gray-500"
            data-testid={`voucher-expired-label-${voucher.id}`}
          >
            {voucher.swept
              ? "Expired — funds returned to merchant reserve"
              : "Expired — awaiting merchant reserve sweep"}
          </span>
        ) : (
          <span data-testid={`voucher-expiry-countdown-${voucher.id}`}>
            Expires in{" "}
            <strong className="text-gray-700">
              {formatCountdown(voucher.expiresAt, nowSeconds * 1000)}
            </strong>
          </span>
        )}
      </div>

      {/* Action buttons */}
      {!isExpired && !showTransfer && !showRedeem && (
        <div className="mt-3 flex flex-wrap gap-2">
          {canRedeem && (
            <button
              type="button"
              className="rounded-md bg-green-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
              onClick={() => setShowRedeem(true)}
              disabled={busy}
              data-testid={`voucher-redeem-button-${voucher.id}`}
            >
              Redeem
            </button>
          )}
          {canTransfer && (
            <button
              type="button"
              className="rounded-md border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-50"
              onClick={() => setShowTransfer(true)}
              disabled={busy}
              data-testid={`voucher-transfer-button-${voucher.id}`}
            >
              Transfer
            </button>
          )}
        </div>
      )}

      {/* Inline transfer form */}
      {showTransfer && (
        <TransferForm
          voucherId={voucher.id}
          onTransfer={onTransfer}
          onCancel={() => setShowTransfer(false)}
        />
      )}

      {/* Inline split-redeem form */}
      {showRedeem && (
        <SplitRedeemForm
          voucherId={voucher.id}
          remainingValue={voucher.remainingValue}
          decimals={decimals}
          currencySymbol={currencySymbol}
          onRedeem={onRedeem}
          onCancel={() => setShowRedeem(false)}
        />
      )}
    </article>
  );
};

export default VoucherCard;
