export interface DecodedGridPayError {
  code?: string;
  message: string;
  recovery?: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) return null;
  return value as Record<string, unknown>;
}

function pickString(source: Record<string, unknown>, keys: string[]): string | undefined {
  for (const key of keys) {
    const candidate = source[key];
    if (typeof candidate === 'string' && candidate.trim() !== '') return candidate;
    if (typeof candidate === 'number' || typeof candidate === 'bigint') {
      return String(candidate);
    }
  }
  return undefined;
}

function recoveryForCode(code?: string): string | undefined {
  if (!code) return undefined;
  const normalized = code.toLowerCase();
  if (normalized.includes('unauthor')) {
    return 'Connect the authorized account and try again.';
  }
  if (normalized.includes('expired') || normalized.includes('stale')) {
    return 'Refresh the on-chain state before submitting again.';
  }
  if (normalized.includes('limit') || normalized.includes('cap')) {
    return 'Reduce the amount or ask the merchant to raise the cap.';
  }
  if (normalized.includes('nonce') || normalized.includes('replay')) {
    return 'Reload the page to obtain a fresh nonce.';
  }
  if (normalized.includes('insufficient')) {
    return 'Fund the account and retry the transaction.';
  }
  return 'Review the transaction details and try again.';
}

/**
 * Converts a thrown SDK/RPC/contract error into the shape consumed by the
 * subscription UX components. This is intentionally local so the components
 * do not depend on a specific wallet adapter.
 */
export function decodeGridPayError(error: unknown): DecodedGridPayError {
  const record = asRecord(error);
  const nested = record ? asRecord(record.error ?? record.response) : null;
  const source = nested ?? record ?? {};

  const code = pickString(source, ['code', 'errorCode', 'status']);
  const message =
    pickString(source, ['message', 'recoveryMessage', 'reason', 'error']) ??
    (error instanceof Error ? error.message : undefined) ??
    'The transaction could not be completed.';

  return {
    code,
    message,
    recovery: pickString(source, ['recovery', 'recoveryHint', 'suggestion']) ?? recoveryForCode(code),
  };
}

export default decodeGridPayError;
