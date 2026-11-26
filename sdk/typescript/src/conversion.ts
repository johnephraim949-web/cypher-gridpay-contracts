/**
 * Framework-agnostic oracle conversion + slippage-guard preview math (issue #360).
 *
 * SCAFFOLDING NOTE: this is the pure, testable core only. The React component
 * (`CurrencyConversionQuote`) and `useCurrencyConversion` hook described in the
 * issue are NOT included; they should wrap these functions.
 *
 * Rates follow the Payment contract convention: `get_conversion_rate` returns an
 * i128 scaled by 1e7 (`1_0000000` == 1:1). Oracle staleness follows
 * `refresh_conversion_rate`: stale when `now - fetchedAt > max_staleness_seconds`.
 * Division semantics mirror `core/contracts/escrow/src/fixed_math.rs`:
 * `mulDivFloor` for outflows (amount the user receives), `mulDivCeil` for inflows.
 * BigInt is arbitrary precision, so the contract's U256 widening is implicit.
 */

/** Rate scale used by the Payment contract (7 decimals). */
export const RATE_SCALE = 10_000_000n;
/** Basis points denominator. */
export const BPS_DENOMINATOR = 10_000n;

export class ConversionArithmeticError extends Error {}

function mulDiv(a: bigint, b: bigint, d: bigint, roundUp: boolean): bigint {
  // Same domain checks as fixed_math.rs::mul_div.
  if (a < 0n || b < 0n || d <= 0n) throw new ConversionArithmeticError('invalid mul_div input');
  const prod = a * b;
  const q = roundUp ? (prod + d - 1n) / d : prod / d;
  if (q > (1n << 127n) - 1n) throw new ConversionArithmeticError('i128 overflow');
  return q;
}

/** floor(a*b/d), for outflows. */
export const mulDivFloor = (a: bigint, b: bigint, d: bigint): bigint => mulDiv(a, b, d, false);
/** ceil(a*b/d), for inflows. */
export const mulDivCeil = (a: bigint, b: bigint, d: bigint): bigint => mulDiv(a, b, d, true);

/** Slippage presets from the issue, in basis points. */
export const SLIPPAGE_PRESETS_BPS = [10, 50, 100] as const;
/** Custom slippage above this (3%) risks sandwiching. */
export const HIGH_SLIPPAGE_BPS = 300;
/** Custom slippage below this (0.05%) is likely to revert. */
export const LOW_SLIPPAGE_BPS = 5;

export type SlippageWarning = 'high' | 'low' | 'invalid' | null;

export function slippageWarning(slippageBps: number): SlippageWarning {
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps >= Number(BPS_DENOMINATOR)) {
    return 'invalid';
  }
  if (slippageBps > HIGH_SLIPPAGE_BPS) return 'high';
  if (slippageBps < LOW_SLIPPAGE_BPS) return 'low';
  return null;
}

/** Convert a custom percentage string such as "0.5" into basis points. */
export function percentToBps(percent: string): number {
  const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(percent.trim());
  if (!m) throw new ConversionArithmeticError(`invalid percent: ${percent}`);
  return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
}

export interface OracleQuoteInput {
  /** Rate scaled by RATE_SCALE (output units per input unit). */
  rate: bigint;
  /** Unix seconds the oracle price was published. */
  fetchedAt: bigint;
  /** `OracleRateConfig.max_staleness_seconds`. */
  maxStalenessSeconds: bigint;
  /** Current unix seconds (ledger time preferred over wall clock). */
  now: bigint;
}

export interface OracleFreshness {
  ageSeconds: bigint;
  secondsUntilStale: bigint;
  stale: boolean;
  /** True when within the last 20% of the staleness window (and not yet stale). */
  approachingStale: boolean;
}

export function oracleFreshness(q: OracleQuoteInput): OracleFreshness {
  const age = q.now > q.fetchedAt ? q.now - q.fetchedAt : 0n;
  const stale = age > q.maxStalenessSeconds; // matches refresh_conversion_rate
  const remaining = stale ? 0n : q.maxStalenessSeconds - age;
  return {
    ageSeconds: age,
    secondsUntilStale: remaining,
    stale,
    approachingStale: !stale && remaining * 5n <= q.maxStalenessSeconds,
  };
}

export interface ConversionPreview {
  /** Expected output amount (floor, outflow). */
  expectedOut: bigint;
  /** Worst-case output after slippage (floor). Use as min-received. */
  minReceived: bigint;
  /** Inverse rate scaled by RATE_SCALE (floor); 0n if rate is 0. */
  inverseRate: bigint;
  freshness: OracleFreshness;
  warning: SlippageWarning;
  /** Checkout must be blocked while true (stale oracle would revert on-chain). */
  blockSubmission: boolean;
  /** True when the UI should offer a one-click `refresh_conversion_rate`. */
  refreshable: boolean;
}

/**
 * Build the quote preview. `amount` is in base units of the input asset; the
 * result is in the same base units as the contract rate implies (callers adjust
 * for differing asset decimals before calling, if any).
 */
export function previewConversion(
  amount: bigint,
  quote: OracleQuoteInput,
  slippageBps: number,
): ConversionPreview {
  const warning = slippageWarning(slippageBps);
  if (warning === 'invalid') throw new ConversionArithmeticError('invalid slippage');
  if (quote.rate <= 0n) throw new ConversionArithmeticError('rate must be positive');
  const expectedOut = mulDivFloor(amount, quote.rate, RATE_SCALE);
  const minReceived = mulDivFloor(expectedOut, BPS_DENOMINATOR - BigInt(slippageBps), BPS_DENOMINATOR);
  const inverseRate = mulDivFloor(RATE_SCALE, RATE_SCALE, quote.rate);
  const freshness = oracleFreshness(quote);
  return {
    expectedOut,
    minReceived,
    inverseRate,
    freshness,
    warning,
    blockSubmission: freshness.stale,
    refreshable: freshness.stale,
  };
}
