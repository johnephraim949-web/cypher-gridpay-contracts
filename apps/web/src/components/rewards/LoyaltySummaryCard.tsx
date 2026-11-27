/**
 * LoyaltySummaryCard.tsx (issue #355)
 *
 * Customer loyalty summary: point balance, tier multiplier, FIFO expiring
 * point buckets, and redemption eligibility. Handles a `null` balance
 * (no loyalty history) gracefully with an earning-guide empty state.
 */

import React from "react";
import {
  type LoyaltySummary,
  filterNonExpiredBuckets,
  formatCountdown,
  nonExpiredPoints,
  pointsToDiscountValue,
} from "./rewards-types";

export interface LoyaltySummaryCardProps {
  summary: LoyaltySummary;
  /** Ledger timestamp in seconds; wall-clock fallback when absent. */
  nowSeconds: number;
  /** Opens the Redeem Points modal. Disabled when ineligible. */
  onRedeem?: () => void;
  busy?: boolean;
}

const TIER_STYLES: Record<string, string> = {
  Bronze: "bg-orange-100 text-orange-800 border-orange-200",
  Silver: "bg-gray-100 text-gray-700 border-gray-300",
  Gold: "bg-yellow-100 text-yellow-800 border-yellow-300",
  Platinum: "bg-indigo-100 text-indigo-800 border-indigo-200",
};

export const LoyaltySummaryCard: React.FC<LoyaltySummaryCardProps> = ({
  summary,
  nowSeconds,
  onRedeem,
  busy,
}) => {
  const hasHistory = summary.totalPoints !== null;
  const active = filterNonExpiredBuckets(summary.buckets, nowSeconds);
  const available = hasHistory
    ? nonExpiredPoints(summary.buckets, nowSeconds)
    : 0;
  const expiringSoon = active.filter(
    (b) => b.expiresAt - nowSeconds <= 7 * 24 * 60 * 60
  );
  const discountValue = pointsToDiscountValue(
    available,
    summary.pointValue
  );

  return (
    <section
      className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm"
      data-testid="loyalty-summary-card"
      aria-label="Loyalty points summary"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">
            Loyalty Points
          </h2>
          <div className="mt-1 flex items-center gap-2">
            <span
              className={`rounded-full border px-2 py-0.5 text-xs font-medium ${
                TIER_STYLES[summary.tier] ?? TIER_STYLES.Bronze
              }`}
              data-testid="loyalty-tier"
            >
              {summary.tier} tier
            </span>
            <span
              className="text-xs text-gray-500"
              data-testid="loyalty-tier-multiplier"
            >
              {summary.tierMultiplier}&times; earning multiplier
            </span>
          </div>
        </div>
        <button
          type="button"
          className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"
          onClick={onRedeem}
          disabled={
            busy ||
            !summary.redemptionEligible ||
            available <= 0 ||
            !onRedeem
          }
          data-testid="redeem-points-button"
        >
          Redeem points
        </button>
      </div>

      {!hasHistory ? (
        <div
          className="mt-4 rounded-md border border-dashed border-gray-300 bg-gray-50 p-4 text-sm text-gray-600"
          data-testid="loyalty-empty-state"
        >
          <p className="font-medium text-gray-700">
            You haven&apos;t earned any loyalty points yet.
          </p>
          <p className="mt-1">
            Earn points automatically on every completed payment at
            participating GridPay merchants. Points are credited per purchase
            and boosted by your tier multiplier, and can be applied as a
            checkout discount once your balance is at least 1 point.
          </p>
        </div>
      ) : (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 text-sm text-gray-600 sm:grid-cols-3">
            <div>
              <dt className="inline text-gray-500">Available points: </dt>
              <dd
                className="inline font-semibold text-gray-900"
                data-testid="loyalty-available-points"
              >
                {available.toLocaleString()}
              </dd>
            </div>
            <div>
              <dt className="inline text-gray-500">Redeemable value: </dt>
              <dd
                className="inline font-semibold text-gray-900"
                data-testid="loyalty-discount-value"
              >
                {summary.currencySymbol}
                {discountValue.toFixed(2)}
              </dd>
            </div>
            <div>
              <dt className="inline text-gray-500">Redemption: </dt>
              <dd
                className="inline"
                data-testid="loyalty-redemption-eligibility"
              >
                {summary.redemptionEligible ? "Eligible" : "Not enabled"}
              </dd>
            </div>
          </dl>

          {active.length > 0 ? (
            <div className="mt-4">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                Point buckets (earliest expiry first)
              </h3>
              <ul className="mt-2 space-y-1" data-testid="loyalty-bucket-list">
                {active.map((b) => (
                  <li
                    key={b.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-gray-100 bg-gray-50 px-3 py-1.5 text-sm"
                    data-testid={`loyalty-bucket-${b.id}`}
                  >
                    <span className="text-gray-700">
                      {b.merchantName}:{" "}
                      <strong>{b.points.toLocaleString()} pts</strong>
                    </span>
                    <span
                      className={`text-xs ${
                        b.expiresAt - nowSeconds <= 7 * 24 * 60 * 60
                          ? "font-semibold text-red-600"
                          : "text-gray-500"
                      }`}
                      data-testid={`loyalty-bucket-countdown-${b.id}`}
                    >
                      expires in {formatCountdown(b.expiresAt, nowSeconds * 1000)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p
              className="mt-4 text-sm text-gray-500"
              data-testid="loyalty-all-buckets-expired"
            >
              All earned points have expired. Make a new purchase to earn fresh
              points.
            </p>
          )}

          {expiringSoon.length > 0 && (
            <div
              className="mt-4 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700"
              role="alert"
              data-testid="loyalty-expiring-warning"
            >
              {expiringSoon.length === 1
                ? `${expiringSoon[0].points.toLocaleString()} points expire within 7 days — redeem them before they lapse.`
                : `${expiringSoon.length} point buckets expire within 7 days — redeem them before they lapse.`}
            </div>
          )}
        </>
      )}
    </section>
  );
};

export default LoyaltySummaryCard;
