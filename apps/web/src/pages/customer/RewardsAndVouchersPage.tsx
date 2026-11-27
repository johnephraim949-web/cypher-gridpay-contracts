/**
 * RewardsAndVouchersPage.tsx (issue #355)
 *
 * Unified "Rewards & Credits" wallet for customers.
 *
 * Displays:
 *   - Loyalty point balance, tier, FIFO expiry buckets, and merchant eligibility
 *   - Active, partially-redeemed, and expired RefundVoucher cards
 *   - Redeem Points modal with live conversion preview
 *   - Voucher transfer / split-redemption flow (delegated to VoucherCard)
 *
 * Contract calls:
 *   - get_loyalty_balance(address)       → LoyaltyBalance | null
 *   - get_loyalty_buckets(address)       → LoyaltyBucket[]
 *   - redeem_points(address, points)     → void
 *   - get_refund_vouchers(address)       → RefundVoucher[]
 *   - transfer_voucher(id, recipient)    → void
 *   - redeem_voucher_partial(id, amount) → void
 *
 * Edge-case handling:
 *   - null loyalty balance → empty-state card via LoyaltySummaryCard
 *   - all points expired   → bucket list shows "all expired" copy
 *   - zero vouchers        → empty-state guidance
 *   - expired vouchers     → visually muted, non-interactive
 *   - over-redemption guarded at ledger timestamp before form submit
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
} from "react";
import { useWallet } from "../../hooks/useWallet";
import { useContract } from "../../hooks/useContract";
import {
  type LoyaltyBucket,
  type LoyaltySummary,
  type LoyaltyTier,
  type RefundVoucher,
  type VoucherStatus,
  TIER_MULTIPLIERS,
  effectiveVoucherStatus,
  nonExpiredPoints,
  nowSeconds as resolveNowSeconds,
  pointsToDiscountValue,
  validateRedemptionAmount,
} from "../../components/rewards/rewards-types";
import { LoyaltySummaryCard } from "../../components/rewards/LoyaltySummaryCard";
import { VoucherCard } from "../../components/rewards/VoucherCard";

/* ------------------------------------------------------------------ */
/* Redeem Points Modal                                                  */
/* ------------------------------------------------------------------ */
interface RedeemModalProps {
  open: boolean;
  summary: LoyaltySummary;
  availablePoints: number;
  onClose: () => void;
  onConfirm: (points: number) => Promise<void>;
}

const RedeemModal: React.FC<RedeemModalProps> = ({
  open,
  summary,
  availablePoints,
  onClose,
  onConfirm,
}) => {
  const inputId = useId();
  const [raw, setRaw] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) {
      setRaw("");
      setError(null);
      setBusy(false);
    }
  }, [open]);

  if (!open) return null;

  const parsed = parseInt(raw, 10);
  const isValidNumber = raw.trim() !== "" && Number.isFinite(parsed) && parsed > 0;
  const previewDiscount = isValidNumber
    ? pointsToDiscountValue(parsed, summary.pointValue)
    : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = validateRedemptionAmount(parsed, availablePoints);
    if (!result.ok) {
      setError(result.message ?? "Invalid amount.");
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onConfirm(parsed);
      onClose();
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Redemption failed — please retry."
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      role="dialog"
      aria-modal="true"
      aria-label="Redeem loyalty points"
      data-testid="redeem-points-modal"
    >
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h3 className="text-lg font-semibold text-gray-900">
          Redeem Loyalty Points
        </h3>
        <p className="mt-1 text-sm text-gray-600">
          Available:{" "}
          <strong data-testid="modal-available-points">
            {availablePoints.toLocaleString()} pts
          </strong>{" "}
          · Value: {summary.currencySymbol}
          {pointsToDiscountValue(availablePoints, summary.pointValue).toFixed(2)}
        </p>
        <form onSubmit={handleSubmit} className="mt-4 space-y-3">
          <div>
            <label
              htmlFor={inputId}
              className="block text-sm font-medium text-gray-700"
            >
              Points to redeem
            </label>
            <input
              id={inputId}
              type="number"
              min={1}
              max={availablePoints}
              step={1}
              value={raw}
              onChange={(e) => setRaw(e.target.value)}
              placeholder="e.g. 500"
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-50"
              disabled={busy}
              data-testid="redeem-points-input"
            />
          </div>
          {/* Live conversion preview */}
          <div
            className="rounded-md border border-indigo-100 bg-indigo-50 px-4 py-3 text-sm"
            data-testid="redeem-preview"
          >
            <span className="text-indigo-700">Checkout discount: </span>
            <strong className="text-indigo-900" data-testid="redeem-preview-value">
              {summary.currencySymbol}
              {previewDiscount.toFixed(2)}
            </strong>
            {isValidNumber && (
              <span className="ml-2 text-xs text-indigo-500">
                ({parsed.toLocaleString()} pts × {summary.currencySymbol}
                {summary.pointValue}/pt)
              </span>
            )}
          </div>
          {error && (
            <p
              className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-600"
              role="alert"
              data-testid="redeem-error"
            >
              {error}
            </p>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
              onClick={onClose}
              disabled={busy}
              data-testid="redeem-cancel-button"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              disabled={busy || availablePoints <= 0}
              data-testid="redeem-confirm-button"
            >
              {busy ? "Applying…" : "Apply discount"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Voucher section tab filters                                          */
/* ------------------------------------------------------------------ */
type VoucherTab = "active" | "expired";

/* ------------------------------------------------------------------ */
/* RewardsAndVouchersPage                                               */
/* ------------------------------------------------------------------ */
const RewardsAndVouchersPage: React.FC = () => {
  const { address, connected } = useWallet();
  const { contract, ledgerTimestamp } = useContract();

  const nsec = resolveNowSeconds(ledgerTimestamp);

  /* -- Loyalty state ----------------------------------------------- */
  const [loyaltySummary, setLoyaltySummary] = useState<LoyaltySummary | null>(
    null
  );
  const [loyaltyLoading, setLoyaltyLoading] = useState(false);
  const [loyaltyError, setLoyaltyError] = useState<string | null>(null);

  /* -- Voucher state ------------------------------------------------ */
  const [vouchers, setVouchers] = useState<RefundVoucher[]>([]);
  const [vouchersLoading, setVouchersLoading] = useState(false);
  const [vouchersError, setVouchersError] = useState<string | null>(null);

  /* -- UI state ----------------------------------------------------- */
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [voucherTab, setVoucherTab] = useState<VoucherTab>("active");
  const [busyVoucherId, setBusyVoucherId] = useState<string | null>(null);

  /* ---------------------------------------------------------------- */
  /* Data loaders                                                       */
  /* ---------------------------------------------------------------- */
  const loadLoyalty = useCallback(async () => {
    if (!contract || !address) return;
    setLoyaltyLoading(true);
    setLoyaltyError(null);
    try {
      // get_loyalty_balance returns null when the customer has no history
      const raw = await contract.get_loyalty_balance(address);
      const bucketRaw: unknown[] = (await contract.get_loyalty_buckets(address)) ?? [];

      const buckets: LoyaltyBucket[] = bucketRaw.map((b: any) => ({
        id: String(b.id ?? b.bucket_id ?? ""),
        merchantId: String(b.merchant_id ?? b.merchantId ?? ""),
        merchantName: String(b.merchant_name ?? b.merchantName ?? "Merchant"),
        points: Number(b.points ?? 0),
        expiresAt: Number(b.expires_at ?? b.expiresAt ?? 0),
      }));

      const tier: LoyaltyTier = (raw?.tier ?? "Bronze") as LoyaltyTier;

      setLoyaltySummary({
        totalPoints: raw !== null && raw !== undefined ? Number(raw.total_points ?? raw.totalPoints ?? 0) : null,
        tier,
        tierMultiplier: TIER_MULTIPLIERS[tier] ?? 1.0,
        pointValue: Number(raw?.point_value ?? raw?.pointValue ?? 0.01),
        currencySymbol: String(raw?.currency_symbol ?? raw?.currencySymbol ?? "USDC"),
        redemptionEligible: Boolean(raw?.redemption_eligible ?? raw?.redemptionEligible ?? false),
        buckets,
      });
    } catch (e: unknown) {
      setLoyaltyError(
        e instanceof Error ? e.message : "Failed to load loyalty balance."
      );
    } finally {
      setLoyaltyLoading(false);
    }
  }, [contract, address]);

  const loadVouchers = useCallback(async () => {
    if (!contract || !address) return;
    setVouchersLoading(true);
    setVouchersError(null);
    try {
      const raw: unknown[] = (await contract.get_refund_vouchers(address)) ?? [];
      const mapped: RefundVoucher[] = raw.map((v: any) => ({
        id: String(v.id ?? v.voucher_id ?? ""),
        merchantName: String(v.merchant_name ?? v.merchantName ?? "Merchant"),
        originalValue: BigInt(v.original_value ?? v.originalValue ?? 0),
        remainingValue: BigInt(v.remaining_value ?? v.remainingValue ?? 0),
        expiresAt: Number(v.expires_at ?? v.expiresAt ?? 0),
        transferable: Boolean(v.transferable ?? false),
        splitRedemptionAllowed: Boolean(
          v.split_redemption_allowed ?? v.splitRedemptionAllowed ?? false
        ),
        status: (v.status ?? "Active") as VoucherStatus,
        swept: Boolean(v.swept ?? false),
      }));
      setVouchers(mapped);
    } catch (e: unknown) {
      setVouchersError(
        e instanceof Error ? e.message : "Failed to load refund vouchers."
      );
    } finally {
      setVouchersLoading(false);
    }
  }, [contract, address]);

  useEffect(() => {
    loadLoyalty();
    loadVouchers();
  }, [loadLoyalty, loadVouchers]);

  /* ---------------------------------------------------------------- */
  /* Actions                                                            */
  /* ---------------------------------------------------------------- */
  const handleRedeemPoints = async (points: number) => {
    if (!contract || !address) return;
    // Sync ledger timestamp before submission to prevent over-redemption
    const freshLoyalty = await contract.get_loyalty_balance(address);
    const freshBuckets: unknown[] =
      (await contract.get_loyalty_buckets(address)) ?? [];
    const freshMapped: LoyaltyBucket[] = (freshBuckets as any[]).map((b: any) => ({
      id: String(b.id ?? b.bucket_id ?? ""),
      merchantId: String(b.merchant_id ?? b.merchantId ?? ""),
      merchantName: String(b.merchant_name ?? b.merchantName ?? "Merchant"),
      points: Number(b.points ?? 0),
      expiresAt: Number(b.expires_at ?? b.expiresAt ?? 0),
    }));
    const freshAvailable = nonExpiredPoints(freshMapped, nsec);
    const guardResult = validateRedemptionAmount(points, freshAvailable);
    if (!guardResult.ok) throw new Error(guardResult.message);

    await contract.redeem_points(address, points);
    // Refresh after success
    const tier: LoyaltyTier = (freshLoyalty?.tier ?? "Bronze") as LoyaltyTier;
    setLoyaltySummary({
      totalPoints:
        freshLoyalty !== null
          ? Number(
              freshLoyalty.total_points ?? freshLoyalty.totalPoints ?? 0
            )
          : null,
      tier,
      tierMultiplier: TIER_MULTIPLIERS[tier] ?? 1.0,
      pointValue: Number(
        freshLoyalty?.point_value ?? freshLoyalty?.pointValue ?? 0.01
      ),
      currencySymbol: String(
        freshLoyalty?.currency_symbol ??
          freshLoyalty?.currencySymbol ??
          "USDC"
      ),
      redemptionEligible: Boolean(
        freshLoyalty?.redemption_eligible ??
          freshLoyalty?.redemptionEligible ??
          false
      ),
      buckets: freshMapped,
    });
  };

  const handleVoucherTransfer = async (
    voucherId: string,
    recipient: string
  ) => {
    if (!contract) return;
    setBusyVoucherId(voucherId);
    try {
      await contract.transfer_voucher(voucherId, recipient);
      await loadVouchers();
    } finally {
      setBusyVoucherId(null);
    }
  };

  const handleVoucherRedeem = async (voucherId: string, amount: bigint) => {
    if (!contract) return;
    setBusyVoucherId(voucherId);
    try {
      await contract.redeem_voucher_partial(voucherId, amount);
      await loadVouchers();
    } finally {
      setBusyVoucherId(null);
    }
  };

  /* ---------------------------------------------------------------- */
  /* Derived state                                                      */
  /* ---------------------------------------------------------------- */
  const availablePoints = useMemo(() => {
    if (!loyaltySummary || loyaltySummary.totalPoints === null) return 0;
    return nonExpiredPoints(loyaltySummary.buckets, nsec);
  }, [loyaltySummary, nsec]);

  const activeVouchers = useMemo(
    () =>
      vouchers.filter((v) => {
        const s = effectiveVoucherStatus(v, nsec);
        return s === "Active" || s === "PartiallyRedeemed";
      }),
    [vouchers, nsec]
  );

  const expiredVouchers = useMemo(
    () =>
      vouchers.filter((v) => {
        const s = effectiveVoucherStatus(v, nsec);
        return s === "Expired" || s === "Redeemed";
      }),
    [vouchers, nsec]
  );

  const displayedVouchers =
    voucherTab === "active" ? activeVouchers : expiredVouchers;

  /* ---------------------------------------------------------------- */
  /* Render: not connected                                              */
  /* ---------------------------------------------------------------- */
  if (!connected) {
    return (
      <div className="mx-auto max-w-4xl p-6">
        <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">
            Rewards &amp; Credits
          </h1>
          <p className="mt-2 text-sm text-gray-600">
            Connect your wallet to view your loyalty points and refund vouchers.
          </p>
        </div>
      </div>
    );
  }

  /* ---------------------------------------------------------------- */
  /* Render: main                                                       */
  /* ---------------------------------------------------------------- */
  return (
    <div
      className="mx-auto max-w-4xl p-6"
      data-testid="rewards-and-vouchers-page"
    >
      {/* Page header */}
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">
            Rewards &amp; Credits
          </h1>
          <p className="text-sm text-gray-600">
            Your loyalty points and refund vouchers in one place.
          </p>
        </div>
        <button
          type="button"
          className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          onClick={() => {
            loadLoyalty();
            loadVouchers();
          }}
          disabled={loyaltyLoading || vouchersLoading}
          data-testid="rewards-refresh-button"
        >
          {loyaltyLoading || vouchersLoading ? "Refreshing…" : "Refresh"}
        </button>
      </div>

      {/* ---- Loyalty section -------------------------------------- */}
      <section className="mb-8">
        {loyaltyError && (
          <div
            className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
            data-testid="loyalty-error-banner"
          >
            {loyaltyError}
          </div>
        )}

        {loyaltyLoading && !loyaltySummary ? (
          <div
            className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500"
            data-testid="loyalty-loading"
          >
            Loading loyalty points…
          </div>
        ) : loyaltySummary ? (
          <LoyaltySummaryCard
            summary={loyaltySummary}
            nowSeconds={nsec}
            onRedeem={() => setRedeemOpen(true)}
            busy={loyaltyLoading}
          />
        ) : null}
      </section>

      {/* ---- Vouchers section ------------------------------------- */}
      <section>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Refund Vouchers
          </h2>
          {/* Tab switcher */}
          <div
            className="flex rounded-md border border-gray-200 text-sm font-medium overflow-hidden"
            role="tablist"
            aria-label="Voucher filter"
          >
            <button
              type="button"
              role="tab"
              aria-selected={voucherTab === "active"}
              className={`px-4 py-1.5 ${
                voucherTab === "active"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setVoucherTab("active")}
              data-testid="voucher-tab-active"
            >
              Active ({activeVouchers.length})
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={voucherTab === "expired"}
              className={`px-4 py-1.5 ${
                voucherTab === "expired"
                  ? "bg-indigo-600 text-white"
                  : "bg-white text-gray-600 hover:bg-gray-50"
              }`}
              onClick={() => setVoucherTab("expired")}
              data-testid="voucher-tab-expired"
            >
              Expired / Used ({expiredVouchers.length})
            </button>
          </div>
        </div>

        {vouchersError && (
          <div
            className="mb-3 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
            role="alert"
            data-testid="vouchers-error-banner"
          >
            {vouchersError}
          </div>
        )}

        {vouchersLoading && vouchers.length === 0 ? (
          <div
            className="rounded-lg border border-gray-200 bg-white p-8 text-center text-sm text-gray-500"
            data-testid="vouchers-loading"
          >
            Loading vouchers…
          </div>
        ) : displayedVouchers.length === 0 && voucherTab === "active" ? (
          /* Empty state — first-time user guide */
          <div
            className="rounded-lg border border-dashed border-gray-300 bg-gray-50 p-6 text-sm text-gray-600"
            data-testid="vouchers-empty-state"
          >
            <p className="font-medium text-gray-700">
              No active refund vouchers
            </p>
            <p className="mt-1">
              Refund vouchers are issued automatically when a merchant processes
              a store-credit refund. They appear here as soon as the on-chain
              settlement is confirmed, and can be applied as a full or partial
              payment at the same merchant.
            </p>
          </div>
        ) : displayedVouchers.length === 0 ? (
          <div
            className="rounded-lg border border-gray-200 bg-white p-6 text-center text-sm text-gray-500"
            data-testid="vouchers-expired-empty"
          >
            No expired or fully redeemed vouchers.
          </div>
        ) : (
          <div
            className="grid gap-4 sm:grid-cols-2"
            data-testid="voucher-list"
          >
            {displayedVouchers.map((v) => (
              <VoucherCard
                key={v.id}
                voucher={v}
                nowSeconds={nsec}
                onTransfer={handleVoucherTransfer}
                onRedeem={handleVoucherRedeem}
                busy={busyVoucherId === v.id}
              />
            ))}
          </div>
        )}
      </section>

      {/* ---- Redeem Points modal ---------------------------------- */}
      {loyaltySummary && (
        <RedeemModal
          open={redeemOpen}
          summary={loyaltySummary}
          availablePoints={availablePoints}
          onClose={() => setRedeemOpen(false)}
          onConfirm={handleRedeemPoints}
        />
      )}
    </div>
  );
};

export default RewardsAndVouchersPage;
