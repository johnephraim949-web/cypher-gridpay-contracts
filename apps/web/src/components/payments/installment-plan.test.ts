/**
 * installment-plan.test.ts
 *
 * Integration tests for the Installment Payment Plan Schedule & Self-Service Paydown
 * flows (issue #356):
 *   - partial paydown with overpayment prevention,
 *   - full payoff of the outstanding balance,
 *   - installment finalization once the balance reaches zero.
 *
 * Run with:
 *   node --experimental-strip-types --no-warnings --test "apps/web/src/components/payments/installment-plan.test.ts"
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeEarlyPayoffRebate,
  computePaidTotal,
  computeProgressPercent,
  computeRefundedTotal,
  canFinalizeInstallmentPayment,
  deriveInstallmentPlanStatus,
  decimalStringToUnits,
  unitsToDecimalString,
  validatePaydownAmount,
  type InstallmentEntry,
} from "./installment-plan.ts";

// 300 USDC plan, 3 installments of 100 USDC (base units: 1 USDC = 10^6 stroops).
const PLAN_AMOUNT = 300_000_000n;
const INSTALLMENT_AMOUNT = 100_000_000n;
const USDC_DECIMALS = 6;

function installment(
  number: number,
  amountPaid: bigint,
  remaining: bigint,
  status: "PAID" | "REFUNDED",
  transactionHash?: string,
): InstallmentEntry {
  return {
    installmentNumber: number,
    amountPaid,
    totalAmount: PLAN_AMOUNT,
    remaining,
    paidAt: 1_700_000_000 + number * 86_400,
    status,
    transactionHash: transactionHash ?? null,
  };
}

test("partial paydown accepts an installment-sized amount against the outstanding balance", () => {
  const check = validatePaydownAmount("100", USDC_DECIMALS, PLAN_AMOUNT, "USDC");
  assert.equal(check.ok, true);
  if (check.ok) {
    assert.equal(check.units, 100_000_000n);
  }
});

test("partial paydown rejects an amount greater than the outstanding balance (overpayment)", () => {
  const check = validatePaydownAmount("300", USDC_DECIMALS, INSTALLMENT_AMOUNT, "USDC");
  assert.equal(check.ok, false);
  if (check.ok === false) {
    assert.match(check.message, /outstanding balance/i);
  }
});

test("partial paydown rejects malformed, non-positive and over-limit amounts", () => {
  assert.equal(validatePaydownAmount("", USDC_DECIMALS, PLAN_AMOUNT, "USDC").ok, false);
  assert.equal(validatePaydownAmount("0", USDC_DECIMALS, PLAN_AMOUNT, "USDC").ok, false);
  assert.equal(validatePaydownAmount("abc", USDC_DECIMALS, PLAN_AMOUNT, "USDC").ok, false);
  assert.equal(validatePaydownAmount("100.1234567", USDC_DECIMALS, PLAN_AMOUNT, "USDC").ok, false);
  assert.equal(validatePaydownAmount("999999", USDC_DECIMALS, PLAN_AMOUNT, "USDC").ok, false);
});

test("full payoff of the outstanding balance is accepted once the balance is zeroed", () => {
  const remaining = PLAN_AMOUNT - INSTALLMENT_AMOUNT; // 200 USDC outstanding after one installment
  const check = validatePaydownAmount("200", USDC_DECIMALS, remaining, "USDC");
  assert.equal(check.ok, true);
  if (check.ok) {
    assert.equal(check.units, 200_000_000n);
  }

  const zeroed = validatePaydownAmount("0", USDC_DECIMALS, 0n, "USDC");
  assert.equal(zeroed.ok, false);
});

test("full early payoff settles the outstanding balance and unlocks finalization", () => {
  const outstanding = 275_000_000n; // two installments of 100 paid, one outstanding
  const check = validatePaydownAmount("275", USDC_DECIMALS, outstanding, "USDC");
  assert.equal(check.ok, true);

  const planStatus = deriveInstallmentPlanStatus({
    status: "PENDING",
    outstandingBalance: 0n,
    lastPaidAtSeconds: 1_700_000_100,
  });
  assert.equal(planStatus.awaitingFinalization, true);
  assert.equal(planStatus.fullyPaid, true);
  assert.equal(canFinalizeInstallmentPayment("PENDING", 0n), true);
});

test("finalization is blocked while installments remain unpaid", () => {
  assert.equal(canFinalizeInstallmentPayment("PENDING", PLAN_AMOUNT), false);
  assert.equal(canFinalizeInstallmentPayment("PENDING", 100_000_000n), false);
});

test("finalization completes once the outstanding balance reaches zero", () => {
  const completed = deriveInstallmentPlanStatus({
    status: "COMPLETED",
    outstandingBalance: 0n,
    lastPaidAtSeconds: 1_700_000_300,
  });
  assert.equal(completed.fullyPaid, true);
  assert.equal(completed.awaitingFinalization, false);
  assert.equal(canFinalizeInstallmentPayment("COMPLETED", 0n), false);
});

test("amortization progress counts paid installments and excludes refunded ones", () => {
  const installments: InstallmentEntry[] = [
    installment(1, 100_000_000n, 200_000_000n, "PAID", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c"),
    installment(2, 100_000_000n, 100_000_000n, "REFUNDED", "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c"),
  ];

  const paidTotal = computePaidTotal(installments);
  const refundedTotal = computeRefundedTotal(installments);
  assert.equal(paidTotal, 100_000_000n);
  assert.equal(refundedTotal, 100_000_000n);
  assert.equal(computeProgressPercent(paidTotal, PLAN_AMOUNT), 33);
});

test("delinquency is derived from the grace period after the last installment payment", () => {
  const inGrace = deriveInstallmentPlanStatus({
    status: "PENDING",
    outstandingBalance: INSTALLMENT_AMOUNT,
    lastPaidAtSeconds: 900,
    gracePeriodSeconds: 200,
    nowSeconds: 1_000,
  });
  assert.equal(inGrace.delinquent, false);

  const pastGrace = deriveInstallmentPlanStatus({
    status: "PENDING",
    outstandingBalance: INSTALLMENT_AMOUNT,
    lastPaidAtSeconds: 900,
    gracePeriodSeconds: 200,
    nowSeconds: 2_000,
  });
  assert.equal(pastGrace.delinquent, true);
});

test("base unit formatting round-trips through decimal strings", () => {
  assert.equal(unitsToDecimalString(25_000_000n, USDC_DECIMALS), "25");
  assert.equal(unitsToDecimalString(25_500_000n, USDC_DECIMALS), "25.5");
  assert.equal(decimalStringToUnits("25", USDC_DECIMALS), 25_000_000n);
  assert.equal(decimalStringToUnits("25.5", USDC_DECIMALS), 25_500_000n);
});

test("early payoff rebate is computed from basis points", () => {
  assert.equal(computeEarlyPayoffRebate(100_000_000n, 500), 5_000_000n);
  assert.equal(computeEarlyPayoffRebate(0n, 500), 0n);
  assert.equal(computeEarlyPayoffRebate(100_000_000n, 0), 0n);
});
