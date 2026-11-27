/**
 * rewards.test.ts (issue #355)
 *
 * Unit tests for the pure helpers in rewards-types.ts that back the
 * Rewards & Vouchers wallet UI.
 *
 * Covers all acceptance-criteria cases from the issue:
 *   ✓ None (null) loyalty balance handled without throwing
 *   ✓ Partial voucher balances (voucherRedeemedPercent, effectiveVoucherStatus)
 *   ✓ Expired-bucket filtering (filterNonExpiredBuckets, nonExpiredPoints)
 *   ✓ Redemption validation: over-balance, non-integer, zero, negative
 *   ✓ Stellar address validation
 *   ✓ Points → discount value conversion
 *   ✓ Units ↔ display string round-trips
 *   ✓ Countdown formatting
 *   ✓ nowSeconds fallback to wall-clock when ledgerTimestamp absent
 */

import { describe, it, expect } from "vitest";
import {
  type LoyaltyBucket,
  type RefundVoucher,
  effectiveVoucherStatus,
  filterNonExpiredBuckets,
  formatCountdown,
  isValidStellarAddress,
  nonExpiredPoints,
  nowSeconds,
  pointsToDiscountValue,
  unitsToDisplayString,
  validateRedemptionAmount,
  voucherRedeemedPercent,
} from "./rewards-types";

/* ------------------------------------------------------------------ */
/* Test fixtures                                                        */
/* ------------------------------------------------------------------ */
const NOW_SEC = 1_750_000_000; // fixed reference second

function bucket(
  id: string,
  points: number,
  expiresAt: number
): LoyaltyBucket {
  return {
    id,
    merchantId: "merch-1",
    merchantName: "GridPay Store",
    points,
    expiresAt,
  };
}

function voucher(overrides: Partial<RefundVoucher> = {}): RefundVoucher {
  return {
    id: "v-1",
    merchantName: "GridPay Store",
    originalValue: 10_000_000n,  // 10 USDC (6 dp)
    remainingValue: 10_000_000n,
    expiresAt: NOW_SEC + 86_400,  // expires tomorrow
    transferable: true,
    splitRedemptionAllowed: true,
    status: "Active",
    swept: false,
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/* filterNonExpiredBuckets                                              */
/* ------------------------------------------------------------------ */
describe("filterNonExpiredBuckets", () => {
  it("keeps buckets whose expiresAt is strictly after nowSeconds", () => {
    const b = bucket("b1", 100, NOW_SEC + 1);
    expect(filterNonExpiredBuckets([b], NOW_SEC)).toHaveLength(1);
  });

  it("filters out buckets that expire exactly at nowSeconds", () => {
    const b = bucket("b1", 100, NOW_SEC);
    expect(filterNonExpiredBuckets([b], NOW_SEC)).toHaveLength(0);
  });

  it("filters out buckets that expired in the past", () => {
    const b = bucket("b1", 100, NOW_SEC - 1);
    expect(filterNonExpiredBuckets([b], NOW_SEC)).toHaveLength(0);
  });

  it("filters out buckets with zero points", () => {
    const b = bucket("b1", 0, NOW_SEC + 1000);
    expect(filterNonExpiredBuckets([b], NOW_SEC)).toHaveLength(0);
  });

  it("sorts remaining buckets by earliest expiry first (FIFO)", () => {
    const b1 = bucket("b1", 50, NOW_SEC + 200);
    const b2 = bucket("b2", 75, NOW_SEC + 100); // earlier
    const b3 = bucket("b3", 25, NOW_SEC + 300);
    const result = filterNonExpiredBuckets([b1, b3, b2], NOW_SEC);
    expect(result.map((b) => b.id)).toEqual(["b2", "b1", "b3"]);
  });

  it("returns empty array when passed null/undefined gracefully", () => {
    // @ts-expect-error intentional null guard test
    expect(filterNonExpiredBuckets(null, NOW_SEC)).toHaveLength(0);
  });
});

/* ------------------------------------------------------------------ */
/* nonExpiredPoints                                                     */
/* ------------------------------------------------------------------ */
describe("nonExpiredPoints", () => {
  it("sums points only from non-expired buckets", () => {
    const buckets = [
      bucket("b1", 100, NOW_SEC + 1000),   // valid
      bucket("b2", 50, NOW_SEC - 1),        // expired
      bucket("b3", 200, NOW_SEC + 5000),    // valid
    ];
    expect(nonExpiredPoints(buckets, NOW_SEC)).toBe(300);
  });

  it("returns 0 when all buckets are expired", () => {
    const buckets = [
      bucket("b1", 100, NOW_SEC - 100),
      bucket("b2", 200, NOW_SEC - 50),
    ];
    expect(nonExpiredPoints(buckets, NOW_SEC)).toBe(0);
  });

  it("returns 0 for an empty bucket list (no loyalty history)", () => {
    // Simulates get_loyalty_balance returning None
    expect(nonExpiredPoints([], NOW_SEC)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* pointsToDiscountValue                                                */
/* ------------------------------------------------------------------ */
describe("pointsToDiscountValue", () => {
  it("converts points to discount using point value", () => {
    expect(pointsToDiscountValue(500, 0.01)).toBeCloseTo(5.0);
  });

  it("returns 0 for zero points", () => {
    expect(pointsToDiscountValue(0, 0.01)).toBe(0);
  });

  it("returns 0 for non-finite inputs without throwing (None-balance guard)", () => {
    expect(pointsToDiscountValue(NaN, 0.01)).toBe(0);
    expect(pointsToDiscountValue(500, NaN)).toBe(0);
    expect(pointsToDiscountValue(Infinity, 0.01)).toBe(0);
  });

  it("clamps negative values to 0", () => {
    expect(pointsToDiscountValue(-100, 0.01)).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* validateRedemptionAmount                                             */
/* ------------------------------------------------------------------ */
describe("validateRedemptionAmount", () => {
  it("accepts a valid whole-number within available balance", () => {
    const result = validateRedemptionAmount(100, 500);
    expect(result.ok).toBe(true);
  });

  it("accepts redemption of the full available balance", () => {
    expect(validateRedemptionAmount(500, 500).ok).toBe(true);
  });

  it("rejects amounts exceeding the available balance", () => {
    const result = validateRedemptionAmount(501, 500);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/500/);
  });

  it("rejects zero and negative amounts", () => {
    expect(validateRedemptionAmount(0, 500).ok).toBe(false);
    expect(validateRedemptionAmount(-10, 500).ok).toBe(false);
  });

  it("rejects non-integer (fractional) point amounts", () => {
    const result = validateRedemptionAmount(50.5, 500);
    expect(result.ok).toBe(false);
    expect(result.message).toMatch(/whole number/i);
  });

  it("rejects NaN without throwing", () => {
    expect(validateRedemptionAmount(NaN, 500).ok).toBe(false);
  });

  it("handles zero available balance (None-balance guard: cannot redeem)", () => {
    expect(validateRedemptionAmount(1, 0).ok).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* isValidStellarAddress                                                */
/* ------------------------------------------------------------------ */
describe("isValidStellarAddress", () => {
  // Valid 56-character Stellar G... public key (ed25519, base32-encoded)
  const VALID = "GADUQ6WQYT6ASZNNWFJOCPQ66TV4OMMALOJPL4APFJALZW43BLQTGXPZ";

  it("accepts a valid G... address", () => {
    expect(isValidStellarAddress(VALID)).toBe(true);
  });

  it("trims surrounding whitespace before validating", () => {
    expect(isValidStellarAddress(`  ${VALID}  `)).toBe(true);
  });

  it("rejects empty strings", () => {
    expect(isValidStellarAddress("")).toBe(false);
  });

  it("rejects addresses shorter than 56 characters", () => {
    expect(isValidStellarAddress(VALID.slice(0, 55))).toBe(false);
  });

  it("rejects addresses longer than 56 characters", () => {
    expect(isValidStellarAddress(VALID + "A")).toBe(false);
  });

  it("rejects lowercase input", () => {
    expect(isValidStellarAddress(VALID.toLowerCase())).toBe(false);
  });

  it("rejects addresses that don't start with G", () => {
    expect(isValidStellarAddress("S" + VALID.slice(1))).toBe(false);
  });

  it("rejects non-string input without throwing", () => {
    // @ts-expect-error intentional type guard test
    expect(isValidStellarAddress(null)).toBe(false);
    // @ts-expect-error intentional type guard test
    expect(isValidStellarAddress(12345)).toBe(false);
  });
});

/* ------------------------------------------------------------------ */
/* voucherRedeemedPercent                                               */
/* ------------------------------------------------------------------ */
describe("voucherRedeemedPercent", () => {
  it("returns 0 for a fully intact voucher", () => {
    expect(voucherRedeemedPercent(voucher())).toBe(0);
  });

  it("returns 100 for a fully redeemed voucher", () => {
    expect(
      voucherRedeemedPercent(voucher({ remainingValue: 0n }))
    ).toBe(100);
  });

  it("returns ~50 for a half-redeemed voucher", () => {
    expect(
      voucherRedeemedPercent(voucher({ remainingValue: 5_000_000n }))
    ).toBe(50);
  });

  it("returns 0 for a zero-value voucher without throwing", () => {
    expect(
      voucherRedeemedPercent(voucher({ originalValue: 0n, remainingValue: 0n }))
    ).toBe(0);
  });
});

/* ------------------------------------------------------------------ */
/* effectiveVoucherStatus                                               */
/* ------------------------------------------------------------------ */
describe("effectiveVoucherStatus", () => {
  it("returns Active for a non-expired fully intact voucher", () => {
    expect(effectiveVoucherStatus(voucher(), NOW_SEC)).toBe("Active");
  });

  it("returns PartiallyRedeemed when remainingValue < originalValue and not expired", () => {
    const v = voucher({ remainingValue: 6_000_000n });
    expect(effectiveVoucherStatus(v, NOW_SEC)).toBe("PartiallyRedeemed");
  });

  it("returns Expired when expiresAt <= nowSeconds regardless of remaining value", () => {
    const v = voucher({ expiresAt: NOW_SEC - 1 });
    expect(effectiveVoucherStatus(v, NOW_SEC)).toBe("Expired");
  });

  it("returns Expired exactly at the expiry second", () => {
    const v = voucher({ expiresAt: NOW_SEC });
    expect(effectiveVoucherStatus(v, NOW_SEC)).toBe("Expired");
  });

  it("returns Redeemed when status field is Redeemed regardless of time", () => {
    const v = voucher({ status: "Redeemed", remainingValue: 0n });
    expect(effectiveVoucherStatus(v, NOW_SEC)).toBe("Redeemed");
  });

  it("distinguishes expired from fully-intact active (edge: expiresAt = nowSeconds + 1)", () => {
    const v = voucher({ expiresAt: NOW_SEC + 1 });
    expect(effectiveVoucherStatus(v, NOW_SEC)).toBe("Active");
  });
});

/* ------------------------------------------------------------------ */
/* unitsToDisplayString                                                 */
/* ------------------------------------------------------------------ */
describe("unitsToDisplayString", () => {
  it("converts whole units correctly", () => {
    expect(unitsToDisplayString(10_000_000n, 6)).toBe("10");
  });

  it("strips trailing zeros from fractional part", () => {
    expect(unitsToDisplayString(10_500_000n, 6)).toBe("10.5");
  });

  it("handles zero", () => {
    expect(unitsToDisplayString(0n, 6)).toBe("0");
  });

  it("handles sub-unit amounts (less than 1 token)", () => {
    expect(unitsToDisplayString(500_000n, 6)).toBe("0.5");
  });

  it("preserves full precision for non-trailing fractions", () => {
    expect(unitsToDisplayString(1_000_001n, 6)).toBe("1.000001");
  });

  it("handles negative values", () => {
    expect(unitsToDisplayString(-5_000_000n, 6)).toBe("-5");
  });
});

/* ------------------------------------------------------------------ */
/* formatCountdown                                                      */
/* ------------------------------------------------------------------ */
describe("formatCountdown", () => {
  const BASE_MS = NOW_SEC * 1000;

  it("returns 'expired' when time has passed", () => {
    expect(formatCountdown(NOW_SEC - 1, BASE_MS)).toBe("expired");
  });

  it("formats days and hours", () => {
    // 2 days + 3 hours in the future
    const future = NOW_SEC + 2 * 86_400 + 3 * 3_600;
    expect(formatCountdown(future, BASE_MS)).toBe("2d 3h");
  });

  it("formats hours and minutes when less than a day", () => {
    const future = NOW_SEC + 5 * 3_600 + 30 * 60;
    expect(formatCountdown(future, BASE_MS)).toBe("5h 30m");
  });

  it("formats minutes only when less than an hour", () => {
    const future = NOW_SEC + 45 * 60;
    expect(formatCountdown(future, BASE_MS)).toBe("45m");
  });
});

/* ------------------------------------------------------------------ */
/* nowSeconds fallback                                                  */
/* ------------------------------------------------------------------ */
describe("nowSeconds", () => {
  it("returns the ledger timestamp when it is a valid positive number", () => {
    expect(nowSeconds(NOW_SEC)).toBe(NOW_SEC);
  });

  it("falls back to wall-clock when ledgerTimestamp is undefined", () => {
    const before = Math.floor(Date.now() / 1000);
    const result = nowSeconds(undefined);
    const after = Math.floor(Date.now() / 1000);
    expect(result).toBeGreaterThanOrEqual(before);
    expect(result).toBeLessThanOrEqual(after);
  });

  it("falls back to wall-clock when ledgerTimestamp is null", () => {
    const result = nowSeconds(null);
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("falls back to wall-clock when ledgerTimestamp is 0 or negative", () => {
    const result0 = nowSeconds(0);
    const resultNeg = nowSeconds(-1);
    expect(result0).toBeGreaterThan(0);
    expect(resultNeg).toBeGreaterThan(0);
  });
});
