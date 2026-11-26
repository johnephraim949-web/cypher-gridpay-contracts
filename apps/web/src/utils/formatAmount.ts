/**
 * formatAmount.ts
 *
 * Locale-aware number, date, and Stellar-specific formatting helpers.
 *
 * Design principles (see docs/ux/i18n-rtl-guidelines.md):
 *
 *  1. All number and date formatting goes through Intl APIs — no hardcoded
 *     'en-US' locale strings anywhere in component code.
 *  2. Stellar asset codes (USDC, XLM, USDT, …) are always uppercase Latin;
 *     they are protocol identifiers, not display strings.
 *  3. Stellar addresses (G…/C…), transaction hashes, and WASM hashes are
 *     always rendered in LTR-isolated spans by the calling component.
 *  4. Decimal input from the user must be normalised to a JavaScript float
 *     via `parseLocalizedDecimal` BEFORE converting to integer stroops.
 *  5. Stroop arithmetic happens on BigInt; display conversion happens last.
 *
 * Issue: #424
 */

// ---------------------------------------------------------------------------
// RTL locale helpers
// ---------------------------------------------------------------------------

/** Locales that require dir="rtl". Extend as needed. */
const RTL_LOCALES = new Set([
  'ar', 'ar-AE', 'ar-BH', 'ar-DZ', 'ar-EG', 'ar-IQ', 'ar-JO', 'ar-KW',
  'ar-LB', 'ar-LY', 'ar-MA', 'ar-MR', 'ar-OM', 'ar-QA', 'ar-SA', 'ar-SD',
  'ar-SY', 'ar-TN', 'ar-YE',
  'he', 'he-IL',
  'fa', 'fa-IR',
  'ur', 'ur-PK',
]);

/**
 * Returns `'rtl'` for right-to-left locales, `'ltr'` for all others.
 *
 * @example
 * localeDir('ar-AE') // 'rtl'
 * localeDir('en-US') // 'ltr'
 */
export function localeDir(locale: string): 'ltr' | 'rtl' {
  // Normalise by extracting the primary language subtag.
  const primary = locale.split(/[-_]/)[0].toLowerCase();
  if (RTL_LOCALES.has(locale) || RTL_LOCALES.has(primary)) return 'rtl';
  return 'ltr';
}

// ---------------------------------------------------------------------------
// Payment and asset amount formatting
// ---------------------------------------------------------------------------

/**
 * Formats a payment amount with its Stellar asset code for display.
 *
 * The asset code is always rendered in uppercase Latin and is not
 * subject to locale number formatting (it stays "USDC", never "usdc").
 *
 * @param amount   - Raw float value (already divided out of stroops).
 * @param assetCode - Stellar asset code, e.g. "USDC", "XLM".
 * @param locale   - BCP 47 locale string, e.g. "en-US", "de-DE".
 * @param options  - Optional Intl.NumberFormat overrides.
 *
 * @example
 * formatPaymentAmount(1234.56, 'USDC', 'en-US') // "1,234.56 USDC"
 * formatPaymentAmount(1234.56, 'USDC', 'de-DE') // "1.234,56 USDC"
 * formatPaymentAmount(1234.56, 'USDC', 'fr-FR') // "1 234,56 USDC"  (narrow-no-break space)
 * formatPaymentAmount(1234.56, 'USDC', 'ar-AE') // "١٬٢٣٤٫٥٦ USDC"
 * formatPaymentAmount(1234.56, 'USDC', 'ja-JP') // "1,234.56 USDC"
 */
export function formatPaymentAmount(
  amount: number,
  assetCode: string,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
    ...options,
  }).format(amount);
  return `${formatted} ${assetCode.toUpperCase()}`;
}

/**
 * Formats a bare numeric amount without an asset code.
 * Use for internal display (e.g. fee amounts inside a larger labelled row).
 */
export function formatAmount(
  amount: number,
  locale: string,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 7,
    ...options,
  }).format(amount);
}

/**
 * Formats a stroop integer (1 XLM = 10 000 000 stroops) for display.
 * Converts BigInt stroops → float XLM → locale string.
 *
 * @example
 * formatStroops(50_000_000n, 'XLM', 'en-US') // "5.00 XLM"
 * formatStroops(12_345_678n, 'XLM', 'de-DE') // "1,2345678 XLM"
 */
export function formatStroops(
  stroops: bigint,
  assetCode: string,
  locale: string,
): string {
  const amount = Number(stroops) / 10_000_000;
  return formatPaymentAmount(amount, assetCode, locale, { maximumFractionDigits: 7 });
}

/**
 * Formats a basis-points value as a percentage string in the user's locale.
 *
 * @example
 * formatBps(50, 'en-US')  // "0.50%"
 * formatBps(10000, 'de-DE') // "100,00 %"  (fr/de add space before %)
 * formatBps(50, 'ar-AE')  // "٠٫٥٠٪"
 */
export function formatBps(bps: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(bps / 10_000);
}

/**
 * Formats a ratio (0–1) as a locale-aware percentage.
 *
 * @example
 * formatPct(0.75, 'en-US') // "75.00%"
 * formatPct(0.75, 'de-DE') // "75,00 %"
 */
export function formatPct(ratio: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(ratio);
}

// ---------------------------------------------------------------------------
// Integer / ledger number formatting
// ---------------------------------------------------------------------------

/**
 * Formats a ledger number, storage entry count, or other integer
 * using locale-aware thousands grouping but always in Latin digits.
 *
 * Latin digits are enforced because ledger numbers are protocol references
 * and must be copy-pasteable regardless of display locale.
 *
 * @example
 * formatLedgerNumber(1234567n, 'en-US') // "1,234,567"
 * formatLedgerNumber(1234567n, 'de-DE') // "1.234.567"
 * formatLedgerNumber(1234567n, 'ar-AE') // "1,234,567"  (forced Latin)
 */
export function formatLedgerNumber(
  value: bigint | number,
  locale: string,
): string {
  return new Intl.NumberFormat(locale, {
    numberingSystem: 'latn',
    maximumFractionDigits: 0,
  }).format(value as number);
}

// ---------------------------------------------------------------------------
// Date and timestamp formatting
// ---------------------------------------------------------------------------

/**
 * Formats a Unix timestamp (seconds) for a human-readable date display.
 *
 * Returns a locale-aware date/time string. The calling component should
 * render the raw UTC ISO string in a `title` attribute for auditability.
 *
 * @example
 * formatLedgerDate(1700000000, 'en-US') // "Nov 14, 2023, 2:13 PM"
 * formatLedgerDate(1700000000, 'de-DE') // "14. Nov. 2023, 14:13"
 * formatLedgerDate(1700000000, 'ar-AE') // "١٤ نوف ٢٠٢٣، ٢:١٣ م"
 * formatLedgerDate(1700000000, 'ja-JP') // "2023/11/14 14:13"
 */
export function formatLedgerDate(unixSeconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(unixSeconds * 1000));
}

/**
 * Formats a Unix timestamp as a locale-aware date only (no time).
 * Useful for maintenance windows and billing dates.
 */
export function formatLedgerDateOnly(unixSeconds: number, locale: string): string {
  return new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(unixSeconds * 1000));
}

/**
 * Returns a UTC ISO-8601 string for use in `title`/`datetime` attributes
 * so the raw ledger timestamp is always available for auditability,
 * regardless of display locale.
 *
 * @example
 * ledgerTimestampIso(1700000000) // "2023-11-14T22:13:20.000Z"
 */
export function ledgerTimestampIso(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toISOString();
}

/**
 * Formats a maintenance window as a human-readable range.
 * Uses `timeZoneName: 'short'` to show "UTC" in the output.
 */
export function formatMaintenanceWindow(
  startUnix: number,
  endUnix: number,
  locale: string,
): string {
  const fmt = new Intl.DateTimeFormat(locale, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'UTC',
    timeZoneName: 'short',
  });
  return `${fmt.format(new Date(startUnix * 1000))} – ${fmt.format(new Date(endUnix * 1000))}`;
}

// ---------------------------------------------------------------------------
// Decimal input parsing
// ---------------------------------------------------------------------------

/**
 * Parses a locale-formatted decimal string entered by the user into a
 * JavaScript float, normalising both `.` and `,` decimal separators.
 *
 * Algorithm:
 *  1. Detect whether the locale uses `,` or `.` as the decimal separator
 *     by formatting `1.1` and reading the separator character.
 *  2. If the string contains the decimal separator after the last thousands
 *     separator, treat it as the decimal mark and strip thousands separators.
 *  3. Return `NaN` for strings that cannot be interpreted.
 *
 * @example
 * parseLocalizedDecimal('1,234.56', 'en-US') // 1234.56
 * parseLocalizedDecimal('1.234,56', 'de-DE') // 1234.56
 * parseLocalizedDecimal('1 234,56', 'fr-FR') // 1234.56  (narrow-no-break space)
 * parseLocalizedDecimal('1234.56',  'ja-JP') // 1234.56
 * parseLocalizedDecimal('١٢٣٤٫٥٦', 'ar-AE') // 1234.56  (Arabic-Indic → Latin)
 *
 * Contract encoding:
 *   const stroops = Math.round(parseLocalizedDecimal(input, locale) * 10_000_000);
 */
export function parseLocalizedDecimal(value: string, locale: string): number {
  if (!value || value.trim() === '') return NaN;

  // Convert Arabic-Indic / other non-Latin digit sets to ASCII digits.
  const normalizedDigits = value
    .trim()
    // Arabic-Indic (٠١٢٣٤٥٦٧٨٩)
    .replace(/[\u0660-\u0669]/g, (c) => String(c.charCodeAt(0) - 0x0660))
    // Extended Arabic-Indic (۰۱۲۳۴۵۶۷۸۹)
    .replace(/[\u06F0-\u06F9]/g, (c) => String(c.charCodeAt(0) - 0x06f0))
    // Devanagari digits
    .replace(/[\u0966-\u096F]/g, (c) => String(c.charCodeAt(0) - 0x0966))
    // Arabic Decimal Separator (٫ U+066B) → canonical dot
    .replace(/\u066B/g, '.')
    // Arabic Thousands Separator (٬ U+066C) → remove
    .replace(/\u066C/g, '');

  // Detect the decimal separator character for this locale.
  const decimalSep = detectDecimalSeparator(locale);
  const thousandsSep = detectThousandsSeparator(locale);

  // Strip thousand-separator characters (spaces, non-breaking spaces,
  // narrow no-break spaces, ASCII comma/period used as thousands sep).
  let cleaned = normalizedDigits;

  if (thousandsSep && thousandsSep !== decimalSep) {
    // Replace all occurrences of the thousands separator.
    cleaned = cleaned.split(thousandsSep).join('');
    // Also strip common whitespace group separators in case the browser
    // uses a different variant than what Intl reports.
    cleaned = cleaned.replace(/[\u00A0\u202F\u2009\u0020]/g, '');
  } else {
    // Ambiguous or no thousands separator — strip whitespace variants.
    cleaned = cleaned.replace(/[\u00A0\u202F\u2009\u0020]/g, '');
  }

  // Replace locale decimal separator with the canonical '.'.
  if (decimalSep !== '.') {
    cleaned = cleaned.replace(decimalSep, '.');
  }

  // Strip any remaining commas that were used as thousands separators in en-US.
  // At this point only the canonical '.' decimal can remain.
  cleaned = cleaned.replace(/,/g, '');

  const result = parseFloat(cleaned);
  return Number.isFinite(result) ? result : NaN;
}

/**
 * Returns the decimal separator character for the given locale.
 * Falls back to '.' if the Intl API is unavailable.
 */
export function detectDecimalSeparator(locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale).formatToParts(1.1);
    const decimalPart = parts.find((p) => p.type === 'decimal');
    return decimalPart?.value ?? '.';
  } catch {
    return '.';
  }
}

/**
 * Returns the thousands (group) separator character for the given locale,
 * or an empty string if the locale does not use grouping.
 * Falls back to ',' if the Intl API is unavailable.
 */
export function detectThousandsSeparator(locale: string): string {
  try {
    const parts = new Intl.NumberFormat(locale, { useGrouping: true }).formatToParts(1234567);
    const groupPart = parts.find((p) => p.type === 'group');
    return groupPart?.value ?? '';
  } catch {
    return ',';
  }
}

// ---------------------------------------------------------------------------
// Stellar address / hash display helpers
// ---------------------------------------------------------------------------

/**
 * Truncates a Stellar address (G… or C…) or hash for compact display.
 * Always returns exactly `prefix + '…' + suffix` characters.
 * Returns the original string if shorter than prefix + suffix.
 */
export function truncateStellarAddress(
  address: string,
  prefixLen = 6,
  suffixLen = 4,
): string {
  if (!address) return '';
  if (address.length <= prefixLen + suffixLen + 1) return address;
  return `${address.slice(0, prefixLen)}…${address.slice(-suffixLen)}`;
}

/**
 * Returns a grouped display string for a full Stellar address or hash
 * (4 characters per group, space-separated) for the checksum verification
 * UI. The result is always suitable for `dir="ltr"` display.
 *
 * @example
 * groupStellarAddress('GABCDEF1234', 4) // "GABC DEF1 234"
 */
export function groupStellarAddress(address: string, groupSize = 4): string {
  if (!address) return '';
  const groups: string[] = [];
  for (let i = 0; i < address.length; i += groupSize) {
    groups.push(address.slice(i, i + groupSize));
  }
  return groups.join(' ');
}

// ---------------------------------------------------------------------------
// XLM shortfall / reserve display
// ---------------------------------------------------------------------------

/**
 * Formats an XLM shortfall value for the LowXlmReserveCard.
 * Always uses 2 decimal places; the asset code is appended in Latin.
 */
export function formatXlmShortfall(xlm: number, locale: string): string {
  return formatPaymentAmount(xlm, 'XLM', locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ---------------------------------------------------------------------------
// Flow-rate formatting for LiveStreamCounter
// ---------------------------------------------------------------------------

/**
 * Formats a USDC-per-minute flow rate for the streaming channel display.
 * Uses 4 decimal places and always appends "USDC/min".
 */
export function formatFlowRate(usdcPerMin: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(usdcPerMin);
  return `${formatted} USDC/min`;
}

/**
 * Formats a kWh-per-hour rate for the streaming channel display.
 * Uses 1 decimal place and always appends "kWh/hr".
 */
export function formatKwhRate(kwhPerHr: number, locale: string): string {
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(kwhPerHr);
  return `~${formatted} kWh/hr`;
}

// ---------------------------------------------------------------------------
// TTL / runway duration formatting
// ---------------------------------------------------------------------------

/**
 * Converts a ledger count to an approximate human-readable duration.
 * Not locale-aware intentionally: the abbreviations (d, h, mo, y) are
 * technical, not prose. Full prose durations go through Intl.RelativeTimeFormat.
 */
export function formatLedgerTtl(ledgers: number): string {
  const LEDGERS_PER_DAY = 17_280;
  const days = Math.floor(ledgers / LEDGERS_PER_DAY);
  if (days >= 365) return `~${Math.floor(days / 365)}y`;
  if (days >= 30)  return `~${Math.floor(days / 30)}mo`;
  if (days >= 1)   return `~${days}d`;
  const hours = Math.floor((ledgers / LEDGERS_PER_DAY) * 24);
  return `~${hours}h`;
}

/**
 * Formats a runway in hours as "Xh YYm" for the LiveStreamCounter.
 * Falls back to "Paused" or "Depleted" for edge cases.
 */
export function formatRunwayHours(hours: number): string {
  if (!Number.isFinite(hours) || Number.isNaN(hours)) return 'Paused';
  if (hours > 999) return '>999h';
  if (hours <= 0)  return 'Depleted';
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  return `${h}h ${String(m).padStart(2, '0')}m`;
}
 * BigInt-safe amount formatting utilities for Cypher GridPay.
 *
 * All monetary math is performed with `bigint` arithmetic to avoid IEEE-754
 * floating point precision loss (Stellar i128 amounts routinely exceed
 * `Number.MAX_SAFE_INTEGER` = 2^53 - 1).
 *
 * This module intentionally never converts token amounts to `number`.
 */

/** Maximum safe integer for JavaScript `number` (2^53 - 1). */
export const MAX_SAFE_INTEGER_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);

/** Default number of decimal places used when formatting display strings. */
export const DEFAULT_DISPLAY_DECIMALS = 7;

/** Characters that spreadsheet applications interpret as formula prefixes. */
const CSV_FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'] as const;

/**
 * Error thrown when an amount string cannot be parsed as a valid decimal.
 */
export class AmountParseError extends Error {
  constructor(message: string, public readonly input: unknown) {
    super(message);
    this.name = 'AmountParseError';
  }
}

/**
 * Normalize a raw amount input into a `bigint`.
 *
 * Accepts `bigint`, integer `number` (must be a safe integer), or a string of
 * digits with an optional leading sign. Rejects anything that would require
 * floating point interpretation.
 */
export function toBigIntAmount(value: bigint | number | string): bigint {
  if (typeof value === 'bigint') {
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isInteger(value)) {
      throw new AmountParseError(
        `Amount must be an integer, received non-integer number: ${value}`,
        value,
      );
    }
    if (!Number.isSafeInteger(value)) {
      throw new AmountParseError(
        `Amount ${value} exceeds Number.MAX_SAFE_INTEGER; pass a bigint or string instead`,
        value,
      );
    }
    return BigInt(value);
  }
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!/^[+-]?\d+$/.test(trimmed)) {
      throw new AmountParseError(
        `Amount string must contain only an optional sign and digits: "${value}"`,
        value,
      );
    }
    return BigInt(trimmed);
  }
  throw new AmountParseError(
    `Unsupported amount type: ${typeof value}`,
    value,
  );
}

/**
 * Compute `10 ** decimals` as a `bigint`.
 */
export function pow10(decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 0) {
    throw new AmountParseError(
      `Decimals must be a non-negative integer, received: ${decimals}`,
      decimals,
    );
  }
  // Guard against pathological exponents that would exhaust memory.
  if (decimals > 77) {
    throw new AmountParseError(
      `Decimals ${decimals} exceeds supported maximum of 77`,
      decimals,
    );
  }
  return BigInt(10) ** BigInt(decimals);
}

/**
 * Split a raw integer amount into its integer and fractional parts as strings.
 *
 * The fractional part is truncated (never rounded) to `displayDecimals`.
 */
export function splitAmount(
  rawAmount: bigint | number | string,
  decimals: number,
  displayDecimals: number = decimals,
): { negative: boolean; integer: string; fraction: string } {
  const amount = toBigIntAmount(rawAmount);
  if (!Number.isInteger(displayDecimals) || displayDecimals < 0) {
    throw new AmountParseError(
      `displayDecimals must be a non-negative integer, received: ${displayDecimals}`,
      displayDecimals,
    );
  }

  const negative = amount < BigInt(0);
  const absolute = negative ? -amount : amount;
  const scale = pow10(decimals);

  const integerPart = absolute / scale;
  const remainder = absolute % scale;

  // Pad the remainder to `decimals` digits, then truncate to displayDecimals.
  const paddedRemainder = remainder.toString().padStart(decimals, '0');
  const truncatedFraction = paddedRemainder.slice(0, displayDecimals);

  return {
    negative,
    integer: integerPart.toString(),
    fraction: truncatedFraction,
  };
}

/**
 * Format a raw token amount (in smallest units) as a human-readable decimal
 * string. Uses BigInt arithmetic exclusively and truncates rather than rounds.
 *
 * @example
 * formatAmount(1234567890n, 7) // "123.456789"
 * formatAmount(1n, 7)          // "0.0000001"
 * formatAmount(-5n, 2)         // "-0.05"
 */
export function formatAmount(
  rawAmount: bigint | number | string,
  decimals: number,
  options: {
    /** Number of fractional digits to display. Defaults to `decimals`. */
    displayDecimals?: number;
    /** Minimum integer digits (zero-padded). Defaults to 0. */
    minIntegerDigits?: number;
    /** Whether to include thousands separators in the integer part. */
    groupThousands?: boolean;
    /** Whether to trim trailing zeros from the fractional part. */
    trimTrailingZeros?: boolean;
  } = {},
): string {
  const {
    displayDecimals = decimals,
    minIntegerDigits = 0,
    groupThousands = false,
    trimTrailingZeros = false,
  } = options;

  const { negative, integer, fraction } = splitAmount(
    rawAmount,
    decimals,
    displayDecimals,
  );

  let integerDisplay = integer;
  if (minIntegerDigits > 0) {
    integerDisplay = integerDisplay.padStart(minIntegerDigits, '0');
  }
  if (groupThousands) {
    integerDisplay = groupThousandsString(integerDisplay);
  }

  let fractionDisplay = fraction;
  if (trimTrailingZeros) {
    fractionDisplay = fractionDisplay.replace(/0+$/, '');
  }

  const sign = negative && (integer !== '0' || fractionDisplay !== '') ? '-' : '';
  const body =
    fractionDisplay.length > 0
      ? `${integerDisplay}.${fractionDisplay}`
      : integerDisplay;

  return `${sign}${body}`;
}

/**
 * Insert thousands separators into a digit-only string.
 */
function groupThousandsString(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/**
 * Format a raw token amount with a currency symbol prefix.
 *
 * @example
 * formatCurrency(1234567890n, 7, 'XLM') // "XLM 123.456789"
 */
export function formatCurrency(
  rawAmount: bigint | number | string,
  decimals: number,
  symbol: string,
  options: {
    displayDecimals?: number;
    groupThousands?: boolean;
    trimTrailingZeros?: boolean;
    /** Placement of the symbol relative to the amount. Defaults to "prefix". */
    symbolPosition?: 'prefix' | 'suffix';
    /** Separator between symbol and amount. Defaults to a single space. */
    separator?: string;
  } = {},
): string {
  const {
    symbolPosition = 'prefix',
    separator = ' ',
    ...formatOptions
  } = options;

  const formatted = formatAmount(rawAmount, decimals, formatOptions);
  return symbolPosition === 'prefix'
    ? `${symbol}${separator}${formatted}`
    : `${formatted}${separator}${symbol}`;
}

/**
 * Parse a human-readable decimal string into a raw integer amount (smallest
 * units) using BigInt arithmetic. Extra fractional digits beyond `decimals`
 * are rejected to prevent silent precision loss.
 */
export function parseAmount(
  decimalString: string,
  decimals: number,
): bigint {
  const trimmed = decimalString.trim();
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(trimmed);
  if (!match || (match[2] === '' && (match[3] === undefined || match[3] === ''))) {
    throw new AmountParseError(
      `Invalid decimal amount: "${decimalString}"`,
      decimalString,
    );
  }

  const [, sign, integerPart = '', fractionPart = ''] = match;
  if (fractionPart.length > decimals) {
    throw new AmountParseError(
      `Amount "${decimalString}" has more than ${decimals} fractional digits`,
      decimalString,
    );
  }

  const scale = pow10(decimals);
  const paddedFraction = fractionPart.padEnd(decimals, '0');
  const integerValue = BigInt(integerPart === '' ? '0' : integerPart);
  const fractionValue = BigInt(paddedFraction === '' ? '0' : paddedFraction);
  const raw = integerValue * scale + fractionValue;

  return sign === '-' ? -raw : raw;
}

/**
 * Compute a percentage delta between two raw amounts as a display string.
 *
 * Returns `null` when the baseline is zero (percentage change undefined).
 * Uses BigInt arithmetic with fixed-point scaling to avoid floating point
 * drift; the result is truncated to `displayDecimals`.
 */
export function formatPercentageDelta(
  current: bigint | number | string,
  previous: bigint | number | string,
  options: {
    displayDecimals?: number;
    /** Include a leading "+" for positive deltas. Defaults to true. */
    includePlusSign?: boolean;
  } = {},
): string | null {
  const { displayDecimals = 2, includePlusSign = true } = options;
  const currentAmount = toBigIntAmount(current);
  const previousAmount = toBigIntAmount(previous);

  if (previousAmount === BigInt(0)) {
    return null;
  }

  // Scale by 10^(displayDecimals + 2) to retain two extra digits of precision
  // before truncating to the requested display precision.
  const precisionScale = pow10(displayDecimals + 2);
  const hundred = BigInt(100);

  const delta = currentAmount - previousAmount;
  const scaledNumerator = delta * hundred * precisionScale;
  // BigInt division truncates toward zero, matching our truncation policy.
  const scaledResult = scaledNumerator / previousAmount;

  const negative = scaledResult < BigInt(0);
  const absolute = negative ? -scaledResult : scaledResult;
  const divisor = pow10(2);
  const integerPart = absolute / divisor;
  const fractionPart = (absolute % divisor).toString().padStart(2, '0');

  const sign = negative ? '-' : includePlusSign ? '+' : '';
  const fractionDisplay = displayDecimals > 0 ? `.${fractionPart}` : '';
  return `${sign}${integerPart.toString()}${fractionDisplay}%`;
}

/**
 * Format a volume delta for KPI cards, e.g. "+12.34%".
 * Convenience wrapper around {@link formatPercentageDelta}.
 */
export function formatVolumeDelta(
  current: bigint | number | string,
  previous: bigint | number | string,
  displayDecimals: number = 2,
): string | null {
  return formatPercentageDelta(current, previous, { displayDecimals });
}

/**
 * Escape a string for safe insertion into HTML text content or attributes.
 *
 * This is a defense-in-depth helper for free-text fields such as payment
 * `notes` and `metadata`. React already escapes interpolated text, but this
 * helper protects against `dangerouslySetInnerHTML` usage and non-React
 * rendering paths.
 */
export function sanitizeText(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  const text = typeof value === 'string' ? value : String(value);
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/\//g, '&#x2F;');
}

/**
 * Escape a single CSV field.
 *
 * - Prefixes formula-injection characters (`=`, `+`, `-`, `@`, tab, CR) with a
 *   single quote so spreadsheet applications treat the value as text.
 * - Wraps fields containing commas, quotes, or newlines in double quotes and
 *   doubles any embedded quotes per RFC 4180.
 */
export function escapeCsvField(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  let text = typeof value === 'string' ? value : String(value);

  // Neutralize spreadsheet formula injection.
  if (text.length > 0 && (CSV_FORMULA_PREFIXES as readonly string[]).includes(text[0])) {
    text = `'${text}`;
  }

  const needsQuoting = /[",\r\n]/.test(text);
  if (needsQuoting) {
    text = `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

/**
 * Serialize rows into a CSV string, escaping every field.
 */
export function toCsv(
  rows: ReadonlyArray<ReadonlyArray<unknown>>,
  options: { lineEnding?: string } = {},
): string {
  const { lineEnding = '\r\n' } = options;
  return rows
    .map((row) => row.map((field) => escapeCsvField(field)).join(','))
    .join(lineEnding);
}
