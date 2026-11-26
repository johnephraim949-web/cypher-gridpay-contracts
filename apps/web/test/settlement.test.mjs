import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateSettlement,
  formatStroops,
  usdcToStroops,
} from "../dist/utils/settlement.js";
import { G_A, G_B, G_C } from "./helpers.mjs";

test("converts USDC decimal strings to stroops without float drift", () => {
  assert.equal(usdcToStroops("100"), 1_000_000_000n);
  assert.equal(usdcToStroops("0.0000001"), 1n);
  assert.equal(usdcToStroops(1.25), 12_500_000n);
  assert.throws(() => usdcToStroops("0.00000001"), RangeError);
  assert.throws(() => usdcToStroops("abc"), TypeError);
});

test("formats stroops with two decimals", () => {
  assert.equal(formatStroops(1_000_000_000n), "100.00");
  assert.equal(formatStroops(1n), "0.00");
  assert.equal(formatStroops(12_340_000n), "1.23");
});

test("BigInt split conserves every stroop at 100 USDC with a 50 bps fee", () => {
  const result = calculateSettlement({
    amountStroops: usdcToStroops("100"),
    protocolFeeBps: 50,
    recipients: [
      { address: G_A, share_bps: 3333 },
      { address: G_B, share_bps: 3333 },
      { address: G_C, share_bps: 3334, isDustSink: true },
    ],
  });

  assert.equal(result.protocolFeeStroops, 5_000_000n);
  assert.equal(result.distributableStroops, 995_000_000n);
  const paid = result.payouts.reduce((sum, p) => sum + p.netStroops, 0n);
  assert.equal(paid + result.protocolFeeStroops, result.totalStroops);
  assert.equal(result.dustSinkAddress, G_C);
  assert.equal(result.payouts[2].isDustSink, true);
});

test("assigns sub-stroop rounding remainder to the dust sink", () => {
  const result = calculateSettlement({
    amountStroops: 100n,
    protocolFeeBps: 0,
    recipients: [
      { address: G_A, share_bps: 3333 },
      { address: G_B, share_bps: 3333 },
      { address: G_C, share_bps: 3334, isDustSink: true },
    ],
  });

  assert.equal(result.hasSubStroopRemainder, true);
  assert.equal(result.dustRemainderStroops, 1n);
  assert.equal(result.payouts[2].netStroops, 34n);
  assert.equal(
    result.payouts.reduce((sum, p) => sum + p.netStroops, 0n),
    result.totalStroops
  );
});

test("rejects out-of-range fee and negative amounts", () => {
  assert.throws(
    () => calculateSettlement({ amountStroops: 1n, protocolFeeBps: 10001, recipients: [] }),
    RangeError
  );
  assert.throws(
    () => calculateSettlement({ amountStroops: -1n, protocolFeeBps: 0, recipients: [] }),
    RangeError
  );
});
