import test from 'node:test';
import assert from 'node:assert/strict';
import {
  decodeGridPayError,
  extractErrorCode,
  isContractError,
  isRetryableError,
  formatDiagnosticError,
  formatResourceFee,
  formatInclusionFee,
  formatFeeBreakdown,
  computeRetryDelay,
  runWithRetryBackoff,
  redactDiagnostics,
  PAYMENT_ERRORS,
  ESCROW_ERRORS,
  REFUND_ERRORS,
  ADMIN_ERRORS,
} from '../dist/index.js';

test('Error Maps Completeness', (t) => {
  assert.ok(PAYMENT_ERRORS.size > 50, `Payment errors should be populated (got ${PAYMENT_ERRORS.size})`);
  assert.ok(ESCROW_ERRORS.size > 20, `Escrow errors should be populated (got ${ESCROW_ERRORS.size})`);
  assert.ok(REFUND_ERRORS.size > 20, `Refund errors should be populated (got ${REFUND_ERRORS.size})`);
  assert.ok(ADMIN_ERRORS.size >= 3, `Admin errors should be populated (got ${ADMIN_ERRORS.size})`);
});

test('extractErrorCode handles multiple error representations', (t) => {
  // Pure numbers
  assert.equal(extractErrorCode(106), 106);
  assert.equal(extractErrorCode('106'), 106);

  // Soroban HostError / Contract formats
  assert.equal(extractErrorCode('HostError: Error(Contract, #106)'), 106);
  assert.equal(extractErrorCode('Error(Contract, 106)'), 106);
  assert.equal(extractErrorCode('Transaction failed with contract error: 106'), 106);

  // Objects
  assert.equal(extractErrorCode({ code: 106 }), 106);
  assert.equal(extractErrorCode({ error: 'Error(Contract, #106)' }), 106);
  assert.equal(extractErrorCode({ message: 'HostError: Error(Contract, #106)' }), 106);
  assert.equal(extractErrorCode({ result: { error: 'Error(Contract, #106)' } }), 106);

  // Non-errors
  assert.equal(extractErrorCode('Regular network timeout'), null);
  assert.equal(extractErrorCode({}), null);
  assert.equal(extractErrorCode(null), null);
  assert.equal(extractErrorCode(undefined), null);
});

test('decodeGridPayError decodes payment errors accurately', (t) => {
  // Payment BasicError: RateLimitExceeded (106)
  const decoded = decodeGridPayError('HostError: Error(Contract, #106)');
  assert.ok(decoded);
  assert.equal(decoded.contract, 'payment');
  assert.equal(decoded.code, 106);
  assert.equal(decoded.name, 'RateLimitExceeded');
  assert.equal(decoded.retryable, true);
  assert.ok(decoded.resolution.includes('rate limit'));
});

test('decodeGridPayError decodes escrow errors with hint', (t) => {
  // Escrow NotFound (200)
  const decoded = decodeGridPayError(200, 'escrow');
  assert.ok(decoded);
  assert.equal(decoded.contract, 'escrow');
  assert.equal(decoded.code, 200);
  assert.equal(decoded.name, 'NotFound');
});

test('decodeGridPayError decodes refund errors', (t) => {
  // Refund CircuitBreakerTripped (29)
  const decoded = decodeGridPayError(29, 'refund');
  assert.ok(decoded);
  assert.equal(decoded.contract, 'refund');
  assert.equal(decoded.code, 29);
  assert.equal(decoded.name, 'CircuitBreakerTripped');
  assert.equal(decoded.retryable, true);
});

test('decodeGridPayError decodes admin errors', (t) => {
  // Admin Unauthorized (3)
  const decoded = decodeGridPayError(3, 'admin');
  assert.ok(decoded);
  assert.equal(decoded.contract, 'admin');
  assert.equal(decoded.code, 3);
  assert.equal(decoded.name, 'Unauthorized');
  assert.equal(decoded.retryable, false);
});

test('isContractError & isRetryableError helpers', (t) => {
  assert.equal(isContractError('Error(Contract, #106)'), true);
  assert.equal(isContractError('Network disconnected'), false);

  assert.equal(isRetryableError('Error(Contract, #106)'), true); // RateLimitExceeded
  assert.equal(isRetryableError('Error(Contract, #100)'), false); // Unauthorized
});

test('formatDiagnosticError outputs clean actionable diagnostics', (t) => {
  const formatted = formatDiagnosticError('Error(Contract, #106)');
  assert.ok(formatted.includes('[PAYMENT::RateLimitExceeded (#106)]'));
  assert.ok(formatted.includes('Remediation:'));

  const rawFallback = formatDiagnosticError('Standard HTTP 500');
  assert.equal(rawFallback, 'Standard HTTP 500');
});

test('decodeGridPayError exposes structured category/message/resolution/action', (t) => {
  const cases = [
    { code: 106, hint: 'payment', contract: 'payment', name: 'RateLimitExceeded' },
    { code: 200, hint: 'escrow', contract: 'escrow', name: 'NotFound' },
    { code: 29, hint: 'refund', contract: 'refund', name: 'CircuitBreakerTripped' },
    { code: 3, hint: 'admin', contract: 'admin', name: 'Unauthorized' },
  ];

  for (const c of cases) {
    const decoded = decodeGridPayError(c.code, c.hint);
    assert.ok(decoded, `expected decode for ${c.hint} #${c.code}`);
    assert.equal(decoded.contract, c.contract);
    assert.equal(decoded.code, c.code);
    assert.equal(decoded.name, c.name);
    assert.equal(typeof decoded.category, 'string');
    assert.ok(decoded.category.length > 0);
    assert.equal(typeof decoded.message, 'string');
    assert.ok(decoded.message.length > 0);
    assert.equal(typeof decoded.resolution, 'string');
    assert.ok(decoded.resolution.length > 0);
    assert.equal(typeof decoded.action, 'string');
    assert.ok(decoded.action.length > 0, `action should be present for ${c.name}`);
    assert.equal(typeof decoded.retryable, 'boolean');
  }
});

test('decodeGridPayError action maps to contextual remediation buttons', (t) => {
  const rateLimit = decodeGridPayError(106, 'payment');
  assert.equal(rateLimit.action, 'Retry with Higher Fee');

  const escrowNotFound = decodeGridPayError(200, 'escrow');
  assert.ok(escrowNotFound.action.length > 0);

  const circuitBreaker = decodeGridPayError(29, 'refund');
  assert.ok(circuitBreaker.action.length > 0);

  const unauthorized = decodeGridPayError(3, 'admin');
  assert.ok(unauthorized.action.length > 0);
});

test('formatResourceFee formats stroop resource fees', (t) => {
  assert.equal(formatResourceFee(0), '0.0000000 XLM');
  assert.equal(formatResourceFee(1), '0.0000001 XLM');
  assert.equal(formatResourceFee(10_000_000), '1.0000000 XLM');
  assert.equal(formatResourceFee(12_345_678), '1.2345678 XLM');
});

test('formatInclusionFee formats stroop inclusion fees', (t) => {
  assert.equal(formatInclusionFee(0), '0.0000000 XLM');
  assert.equal(formatInclusionFee(100), '0.0000100 XLM');
  assert.equal(formatInclusionFee(50_000_000), '5.0000000 XLM');
});

test('formatFeeBreakdown combines resource + inclusion fees', (t) => {
  const breakdown = formatFeeBreakdown({ resourceFee: 12_345_678, inclusionFee: 100 });
  assert.equal(breakdown.resourceFee, '1.2345678 XLM');
  assert.equal(breakdown.inclusionFee, '0.0000100 XLM');
  assert.equal(breakdown.totalFee, '1.2345778 XLM');
  assert.equal(breakdown.totalStroops, 12_345_778);
});

test('computeRetryDelay follows bounded exponential backoff', (t) => {
  const base = 500;
  const max = 8_000;
  assert.equal(computeRetryDelay(0, base, max), 500);
  assert.equal(computeRetryDelay(1, base, max), 1_000);
  assert.equal(computeRetryDelay(2, base, max), 2_000);
  assert.equal(computeRetryDelay(3, base, max), 4_000);
  assert.equal(computeRetryDelay(4, base, max), 8_000);
  // Bounded: never exceeds max
  assert.equal(computeRetryDelay(10, base, max), 8_000);
});

test('runWithRetryBackoff retries TRY_AGAIN_LATER with fake sleep', async (t) => {
  const delays = [];
  const fakeSleep = async (ms) => { delays.push(ms); };
  let attempts = 0;

  const result = await runWithRetryBackoff(
    async () => {
      attempts += 1;
      if (attempts < 3) {
        const err = new Error('TRY_AGAIN_LATER');
        err.code = 'TRY_AGAIN_LATER';
        throw err;
      }
      return 'ok';
    },
    { baseDelayMs: 100, maxDelayMs: 1_000, maxAttempts: 5, sleep: fakeSleep },
  );

  assert.equal(result, 'ok');
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [100, 200]);
});

test('runWithRetryBackoff retries NOT_FOUND then recovers', async (t) => {
  const delays = [];
  const fakeSleep = async (ms) => { delays.push(ms); };
  let attempts = 0;

  const result = await runWithRetryBackoff(
    async () => {
      attempts += 1;
      if (attempts < 2) {
        const err = new Error('NOT_FOUND');
        err.code = 'NOT_FOUND';
        throw err;
      }
      return { status: 'SUCCESS' };
    },
    { baseDelayMs: 250, maxDelayMs: 2_000, maxAttempts: 4, sleep: fakeSleep },
  );

  assert.deepEqual(result, { status: 'SUCCESS' });
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [250]);
});

test('runWithRetryBackoff times out after maxAttempts', async (t) => {
  const fakeSleep = async () => {};
  let attempts = 0;

  await assert.rejects(
    () => runWithRetryBackoff(
      async () => {
        attempts += 1;
        const err = new Error('TRY_AGAIN_LATER');
        err.code = 'TRY_AGAIN_LATER';
        throw err;
      },
      { baseDelayMs: 10, maxDelayMs: 40, maxAttempts: 3, sleep: fakeSleep },
    ),
    /TRY_AGAIN_LATER/,
  );
  assert.equal(attempts, 3);
});

test('runWithRetryBackoff does not retry non-retryable errors', async (t) => {
  const fakeSleep = async () => {};
  let attempts = 0;

  await assert.rejects(
    () => runWithRetryBackoff(
      async () => {
        attempts += 1;
        throw new Error('Fatal: bad request');
      },
      { baseDelayMs: 10, maxDelayMs: 40, maxAttempts: 5, sleep: fakeSleep },
    ),
    /Fatal: bad request/,
  );
  assert.equal(attempts, 1);
});

test('redactDiagnostics redacts memo and auth payload fields', (t) => {
  const input = {
    memo: 'secret-memo-value',
    auth: ['sensitive-auth-entry'],
    authPayload: { signature: 'deadbeef' },
    operation: 'invokeHostFunction',
    contractId: 'CABC...',
  };

  const redacted = redactDiagnostics(input);
  assert.equal(redacted.memo, '[REDACTED]');
  assert.equal(redacted.auth, '[REDACTED]');
  assert.equal(redacted.authPayload, '[REDACTED]');
  assert.equal(redacted.operation, 'invokeHostFunction');
  assert.equal(redacted.contractId, 'CABC...');
});

test('redactDiagnostics handles nested memo/auth fields', (t) => {
  const input = {
    tx: {
      memo: 'nested-secret',
      auth: 'nested-auth',
      amount: 100,
    },
    meta: { authPayload: 'nested-payload', note: 'keep' },
  };

  const redacted = redactDiagnostics(input);
  assert.equal(redacted.tx.memo, '[REDACTED]');
  assert.equal(redacted.tx.auth, '[REDACTED]');
  assert.equal(redacted.tx.amount, 100);
  assert.equal(redacted.meta.authPayload, '[REDACTED]');
  assert.equal(redacted.meta.note, 'keep');
});
