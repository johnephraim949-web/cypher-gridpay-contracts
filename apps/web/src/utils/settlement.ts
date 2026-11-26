/** Basis points in one whole unit (100.00%). */
export const TOTAL_BPS = 10_000n;

/** Stellar USDC uses 7 decimal places (1 USDC = 10_000_000 stroops). */
export const STROOP_DECIMALS = 7;
export const STROOPS_PER_USDC = 10n ** BigInt(STROOP_DECIMALS);

export interface SplitShare {
  address: string;
  share_bps: number;
  isDustSink?: boolean;
}

export interface SettlementInput {
  /** Example or real payment amount expressed in stroops. */
  amountStroops: bigint;
  /** Protocol fee in basis points, deducted before splitting. */
  protocolFeeBps: number;
  recipients: readonly SplitShare[];
}

export interface RecipientPayout {
  address: string;
  share_bps: number;
  netStroops: bigint;
  isDustSink: boolean;
  /** True when integer split division discarded a fraction of one stroop. */
  subStroopRemainder: boolean;
}

export interface SettlementResult {
  totalStroops: bigint;
  protocolFeeStroops: bigint;
  distributableStroops: bigint;
  payouts: RecipientPayout[];
  dustRemainderStroops: bigint;
  dustSinkAddress: string | null;
  hasSubStroopRemainder: boolean;
}

/**
 * Parses a human decimal string into stroops without going through a float.
 * Accepts up to STROOP_DECIMALS fractional digits.
 */
export function usdcToStroops(value: string | number): bigint {
  const text = String(value).trim();
  if (!/^\d+(?:\.\d+)?$/.test(text)) {
    throw new TypeError(`Invalid USDC amount: ${String(value)}`);
  }
  const [whole = "0", fraction = ""] = text.split(".");
  if (fraction.length > STROOP_DECIMALS) {
    throw new RangeError(
      `USDC supports at most ${STROOP_DECIMALS} decimal places`
    );
  }
  const padded = fraction.padEnd(STROOP_DECIMALS, "0");
  return BigInt(whole) * STROOPS_PER_USDC + BigInt(padded || "0");
}

/** Formats stroops as a fixed 2-decimal USDC string for the live simulator. */
export function formatStroops(stroops: bigint): string {
  const negative = stroops < 0n;
  const absolute = negative ? -stroops : stroops;
  const whole = absolute / STROOPS_PER_USDC;
  const cents = (absolute % STROOPS_PER_USDC) / (STROOPS_PER_USDC / 100n);
  return `${negative ? "-" : ""}${whole}.${cents.toString().padStart(2, "0")}`;
}

/**
 * Deterministic settlement simulator. All division is BigInt integer
 * division (floor), matching Soroban's fixed-point integer arithmetic.
 *
 * The protocol fee is deducted first. The remaining stroops are split by
 * `share_bps`, and any stroops lost to floor rounding are assigned to the
 * dust-sink recipient so the payout total always conserves the input.
 */
export function calculateSettlement({
  amountStroops,
  protocolFeeBps,
  recipients,
}: SettlementInput): SettlementResult {
  if (!Number.isInteger(protocolFeeBps) || protocolFeeBps < 0 || protocolFeeBps > 10_000) {
    throw new RangeError("protocolFeeBps must be an integer between 0 and 10000");
  }
  if (amountStroops < 0n) {
    throw new RangeError("amountStroops must be non-negative");
  }

  const protocolFeeStroops =
    (amountStroops * BigInt(protocolFeeBps)) / TOTAL_BPS;
  const distributableStroops = amountStroops - protocolFeeStroops;

  const quotes = recipients.map((recipient) => {
    const quote = distributableStroops * BigInt(recipient.share_bps);
    return {
      recipient,
      whole: quote / TOTAL_BPS,
      remainder: quote % TOTAL_BPS,
    };
  });

  const allocated = quotes.reduce((sum, q) => sum + q.whole, 0n);
  const dustRemainderStroops = distributableStroops - allocated;

  const sinkIndex = Math.max(
    0,
    recipients.findIndex((recipient) => recipient.isDustSink)
  );
  const hasRecipients = recipients.length > 0;
  const dustSinkAddress = hasRecipients
    ? (recipients[sinkIndex]?.address ?? null)
    : null;

  const payouts: RecipientPayout[] = quotes.map((q, index) => ({
    address: q.recipient.address,
    share_bps: q.recipient.share_bps,
    netStroops: q.whole + (index === sinkIndex ? dustRemainderStroops : 0n),
    isDustSink: Boolean(q.recipient.isDustSink) && index === sinkIndex,
    subStroopRemainder: q.remainder > 0n,
  }));

  return {
    totalStroops: amountStroops,
    protocolFeeStroops,
    distributableStroops,
    payouts,
    dustRemainderStroops,
    dustSinkAddress,
    hasSubStroopRemainder: payouts.some((p) => p.subStroopRemainder),
  };
}
