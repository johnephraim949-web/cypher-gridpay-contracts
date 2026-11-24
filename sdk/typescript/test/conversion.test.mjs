// Requires `npm run build` first (imports compiled output), like errors.test.mjs.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  RATE_SCALE, mulDivFloor, mulDivCeil, previewConversion, slippageWarning, percentToBps, oracleFreshness,
} from '../dist/conversion.js';

test('mulDiv floor/ceil parity with fixed_math.rs', () => {
  assert.equal(mulDivFloor(10n, 3n, 4n), 7n);
  assert.equal(mulDivCeil(10n, 3n, 4n), 8n);
  assert.equal(mulDivCeil(8n, 1n, 4n), 2n);
  assert.throws(() => mulDivFloor(-1n, 1n, 1n));
  assert.throws(() => mulDivFloor(1n, 1n, 0n));
  // product exceeds i128 yet quotient fits
  const big = 1n << 100n;
  assert.equal(mulDivFloor(big, big, big), big);
  assert.throws(() => mulDivFloor(1n << 127n, 1n, 1n));
});

test('previewConversion computes min-received and inverse', () => {
  const quote = { rate: 2n * RATE_SCALE, fetchedAt: 1000n, maxStalenessSeconds: 300n, now: 1100n };
  const p = previewConversion(1_000_0000000n, quote, 50);
  assert.equal(p.expectedOut, 2_000_0000000n);
  assert.equal(p.minReceived, 1_990_0000000n);
  assert.equal(p.inverseRate, RATE_SCALE / 2n);
  assert.equal(p.blockSubmission, false);
});

test('stale oracle blocks submission (strictly greater than max staleness)', () => {
  const base = { rate: RATE_SCALE, fetchedAt: 1000n, maxStalenessSeconds: 300n };
  assert.equal(oracleFreshness({ ...base, now: 1300n }).stale, false);
  assert.equal(oracleFreshness({ ...base, now: 1260n }).approachingStale, true);
  const p = previewConversion(5n, { ...base, now: 1301n }, 50);
  assert.equal(p.blockSubmission, true);
  assert.equal(p.refreshable, true);
});

test('slippage warnings', () => {
  assert.equal(slippageWarning(301), 'high');
  assert.equal(slippageWarning(300), null);
  assert.equal(slippageWarning(4), 'low');
  assert.equal(slippageWarning(5), null);
  assert.equal(slippageWarning(-1), 'invalid');
  assert.equal(percentToBps('0.5'), 50);
  assert.equal(percentToBps('3.01'), 301);
  assert.throws(() => percentToBps('abc'));
});
