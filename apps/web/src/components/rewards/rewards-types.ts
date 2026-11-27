/**
 * rewards-types.ts
 *
 * Shared types and pure helpers for the Rewards & Vouchers wallet (issue #355).
 * All point/voucher math is done here so it can be unit-tested without React.
 */

/** One FIFO loyalty point bucket earned from a specific merchant. */
export interface LoyaltyBucket {
  id: string;
  merchantId: string;
  merchantName: string;
  points: number;
  /** Ledger (unix seconds) when this bucket expires. */
  expiresAt: number;
}

export type LoyaltyTier = "Bronze" | "Silver" | "Gold" | "Platinum";

/** Multipliers applied to earned points per tier. */
export const TIER_MULTIPLIERS: Record<LoyaltyTier, number> = {
  Bronze: 1.0,
  Silver: 1.25,
  Gold: 1.5,
  Platinum: 2.0,
};

export interface LoyaltySummary {
  /** Total non-expired points (null when the customer has no loyalty history). */
  totalPoints: number | null;
  tier: LoyaltyTier;
  tierMultiplier: number;
  /** Points-value conversion rate in merchant currency per point (e.g. 0.01). */
  pointValue: number;
  currencySymbol: string;
  /** Whether the current merchant accepts point redemption. */
  redemptionEligible: boolean;
  buckets: LoyaltyBucket[];
}

export type VoucherStatus =
  | "Active"
  | "PartiallyRedeemed"
  | "Expired"
  | "Redeemed";

export interface RefundVoucher {
  id: string;
  merchantName: string;
  /** Original face value in base token units. */
  originalValue: bigint;
  /** Remaining value in base token units. */
  remainingValue: bigint;
  /** Ledger (unix seconds) when the voucher expires. */
  expiresAt: number;
  transferable: boolean;
  /** Voucher configuration permits split (partial) redemption. */
  splitRedemptionAllowed: boolean;
  status: VoucherStatus;
  /** Set when status is Expired: merchant sweep pending. */
  swept: boolean;
}

/**
 * Filter buckets strictly by non-expired (ledger-relative) timestamps.
 * FIFO ordering (earliest expiry first) is preserved.
 */
export function filterNonExpiredBuckets(
  buckets: LoyaltyBucket[],
  nowSeconds: number
): LoyaltyBucket[] {
  return (buckets ?? [])
    .filter((b) => b && b.expiresAt > nowSeconds && b.points > 0)
    .sort((a, b) => a.expiresAt - b.expiresAt);
}

/** Sum of non-expired points; 0 when no history (totalPoints null). */
export function nonExpiredPoints(
  buckets: LoyaltyBucket[],
  nowSeconds: number
): number {
  return filterNonExpiredBuckets(buckets, nowSeconds).reduce(
    (sum, b) => sum + b.points,
    0
  );
}

/** Points -> checkout discount value preview (accounts for tier multiplier). */
export function pointsToDiscountValue(
  points: number,
  pointValue: number
): number {
  if (!Number.isFinite(points) || !Number.isFinite(pointValue)) return 0;
  return Math.max(0, points) * Math.max(0, pointValue);
}

/** Validates a redemption amount against the non-expired balance. */
export function validateRedemptionAmount(
  requested: number,
  available: number
): { ok: boolean; message?: string } {
  if (!Number.isFinite(requested) || requested <= 0) {
    return { ok: false, message: "Enter a number of points greater than zero." };
  }
  if (!Number.isInteger(requested)) {
    return { ok: false, message: "Points must be a whole number." };
  }
  if (requested > available) {
    return {
      ok: false,
      message: `You only have ${available} non-expired points available.`,
    };
  }
  return { ok: true };
}

/**
 * Validates a Stellar public key (G... 56 chars, base32).
 * Uses the same character set as StrKey encoding.
 */
const STELLAR_G_PATTERN = /^G[A-Z2-7]{55}$/;

export function isValidStellarAddress(address: string): boolean {
  return typeof address === "string" && STELLAR_G_PATTERN.test(address.trim());
}

/** Percentage of voucher redeemed, 0-100. */
export function voucherRedeemedPercent(v: RefundVoucher): number {
  if (v.originalValue <= 0n) return 0;
  const used = v.originalValue - v.remainingValue;
  // Safe downcast for display only; voucher values are small.
  const pct =
    (Number(used) / Number(v.originalValue)) * 100;
  return Math.min(100, Math.max(0, Math.round(pct)));
}

/** Current display status of a voucher relative to `now`. */
export function effectiveVoucherStatus(
  v: RefundVoucher,
  nowSeconds: number
): VoucherStatus {
  if (v.status === "Redeemed") return "Redeemed";
  if (v.expiresAt <= nowSeconds) return "Expired";
  if (v.remainingValue < v.originalValue) return "PartiallyRedeemed";
  return "Active";
}

/** Units -> decimal display string, e.g. 2500000n (6 dp) -> "2.5". */
export function unitsToDisplayString(
  units: bigint,
  decimals = 6
): string {
  const neg = units < 0n;
  const abs = neg ? -units : units;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toString()}${fracStr ? `.${fracStr}` : ""}`;
}

/** Ledger timestamp or wall-clock fallback (seconds). */
export function nowSeconds(
  ledgerTimestamp: number | undefined | null
): number {
  if (
    typeof ledgerTimestamp === "number" &&
    Number.isFinite(ledgerTimestamp) &&
    ledgerTimestamp > 0
  ) {
    return ledgerTimestamp;
  }
  return Math.floor(Date.now() / 1000);
}

/** Human countdown like "3d 4h" / "expired". */
export function formatCountdown(
  endsAt: number,
  nowMs: number = Date.now()
): string {
  const diff = endsAt * 1000 - nowMs;
  if (diff <= 0) return "expired";
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}
