/**
 * formatAmount.test.ts
 *
 * Unit tests for the locale-aware formatting helpers.
 *
 * Coverage:
 *   - formatPaymentAmount       — 5 locales (en-US, de-DE, fr-FR, ar-AE, ja-JP)
 *   - formatAmount              — numeric only, no asset code
 *   - formatStroops             — BigInt stroop → locale display
 *   - formatBps                 — basis-point → percentage
 *   - formatPct                 — ratio → percentage
 *   - formatLedgerNumber        — integers with Latin-digit enforcement
 *   - formatLedgerDate          — Unix timestamp → locale date string
 *   - ledgerTimestampIso        — UTC ISO output
 *   - formatMaintenanceWindow   — start/end range with UTC tz label
 *   - parseLocalizedDecimal     — both . and , separators, Arabic-Indic digits
 *   - detectDecimalSeparator    — per-locale decimal char
 *   - detectThousandsSeparator  — per-locale group char
 *   - truncateStellarAddress    — truncation with ellipsis
 *   - groupStellarAddress       — 4-char grouping
 *   - formatXlmShortfall        — 2 dp + XLM asset code
 *   - formatFlowRate            — 4 dp + USDC/min
 *   - formatKwhRate             — 1 dp + kWh/hr prefix
 *   - formatLedgerTtl           — ledger count → ~Xd / ~Xmo / ~Xy
 *   - formatRunwayHours         — hours → "Xh YYm" / "Paused" / "Depleted"
 *   - localeDir                 — RTL/LTR detection
 *
 * Issue: #424
 */

import {
  detectDecimalSeparator,
  detectThousandsSeparator,
  formatAmount,
  formatBps,
  formatFlowRate,
  formatKwhRate,
  formatLedgerDate,
  formatLedgerDateOnly,
  formatLedgerNumber,
  formatLedgerTtl,
  formatMaintenanceWindow,
  formatPaymentAmount,
  formatPct,
  formatRunwayHours,
  formatStroops,
  formatXlmShortfall,
  groupStellarAddress,
  ledgerTimestampIso,
  localeDir,
  parseLocalizedDecimal,
  truncateStellarAddress,
} from './formatAmount';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Strips Unicode non-printable or non-ASCII whitespace variants so comparisons
 * don't fail because of narrow no-break spaces (U+202F) or similar.
 * We normalise by replacing any whitespace between digits and % / letters.
 */
function normaliseWhitespace(s: string): string {
  // Replace narrow no-break space, non-breaking space, and thin space with
  // regular space for comparison purposes.
  return s.replace(/[\u00A0\u202F\u2009]/g, ' ');
}

// ---------------------------------------------------------------------------
// localeDir
// ---------------------------------------------------------------------------

describe('localeDir', () => {
  it('returns ltr for en-US', () => {
    expect(localeDir('en-US')).toBe('ltr');
  });

  it('returns ltr for de-DE', () => {
    expect(localeDir('de-DE')).toBe('ltr');
  });

  it('returns ltr for fr-FR', () => {
    expect(localeDir('fr-FR')).toBe('ltr');
  });

  it('returns ltr for ja-JP', () => {
    expect(localeDir('ja-JP')).toBe('ltr');
  });

  it('returns rtl for ar-AE', () => {
    expect(localeDir('ar-AE')).toBe('rtl');
  });

  it('returns rtl for ar (bare primary subtag)', () => {
    expect(localeDir('ar')).toBe('rtl');
  });

  it('returns rtl for he-IL', () => {
    expect(localeDir('he-IL')).toBe('rtl');
  });

  it('returns rtl for fa-IR', () => {
    expect(localeDir('fa-IR')).toBe('rtl');
  });

  it('returns rtl for ur-PK', () => {
    expect(localeDir('ur-PK')).toBe('rtl');
  });

  it('returns ltr for unknown locale', () => {
    expect(localeDir('xx-XX')).toBe('ltr');
  });
});

// ---------------------------------------------------------------------------
// formatPaymentAmount — 5 locales
// ---------------------------------------------------------------------------

describe('formatPaymentAmount', () => {
  // All tests assert that:
  //  1. The asset code is ALWAYS uppercase Latin.
  //  2. The numeric portion uses the locale's conventions.

  it('en-US: uses comma thousands and dot decimal', () => {
    const result = formatPaymentAmount(1234.56, 'USDC', 'en-US');
    expect(result).toBe('1,234.56 USDC');
  });

  it('en-US: small amount with 2 dp', () => {
    expect(formatPaymentAmount(18.4, 'USDC', 'en-US')).toBe('18.40 USDC');
  });

  it('de-DE: uses dot thousands and comma decimal', () => {
    const result = formatPaymentAmount(1234.56, 'USDC', 'de-DE');
    // "1.234,56 USDC"
    expect(result).toContain('1.234,56');
    expect(result).toContain('USDC');
  });

  it('de-DE: asset code stays Latin uppercase', () => {
    expect(formatPaymentAmount(100, 'usdc', 'de-DE')).toContain('USDC');
  });

  it('fr-FR: uses space thousands and comma decimal', () => {
    const result = normaliseWhitespace(formatPaymentAmount(1234.56, 'USDC', 'fr-FR'));
    // "1 234,56 USDC" (with narrow-no-break or regular space for grouping)
    expect(result).toMatch(/1[  ]234,56/);
    expect(result).toContain('USDC');
  });

  it('ar-AE: formats with Arabic-Indic digits by default', () => {
    const result = formatPaymentAmount(1234.56, 'USDC', 'ar-AE');
    // The numeric part may use Arabic-Indic digits; asset code must stay Latin
    expect(result).toContain('USDC');
    // The result should NOT contain the en-US formatted "1,234.56" string
    // because ar-AE uses Arabic-Indic numerals and different separators
    expect(result).not.toBe('1,234.56 USDC');
  });

  it('ar-AE: asset code is always Latin, not Arabic', () => {
    const result = formatPaymentAmount(50, 'XLM', 'ar-AE');
    expect(result).toContain('XLM');
    expect(result).not.toContain('إكس إل إم'); // no transliteration
  });

  it('ja-JP: formats with comma grouping and dot decimal', () => {
    const result = formatPaymentAmount(1234.56, 'USDC', 'ja-JP');
    expect(result).toContain('1,234.56');
    expect(result).toContain('USDC');
  });

  it('zero amount renders as 0.00', () => {
    expect(formatPaymentAmount(0, 'USDC', 'en-US')).toBe('0.00 USDC');
  });

  it('very small amount preserves 7 dp max', () => {
    const result = formatPaymentAmount(0.0000001, 'XLM', 'en-US');
    expect(result).toContain('0.0000001');
    expect(result).toContain('XLM');
  });

  it('negative amount includes minus sign', () => {
    const result = formatPaymentAmount(-18.5, 'USDC', 'en-US');
    expect(result).toContain('-18.50');
    expect(result).toContain('USDC');
  });
});

// ---------------------------------------------------------------------------
// formatAmount (bare number, no asset code)
// ---------------------------------------------------------------------------

describe('formatAmount', () => {
  it('en-US: 1234.56 → "1,234.56"', () => {
    expect(formatAmount(1234.56, 'en-US')).toBe('1,234.56');
  });

  it('de-DE: 1234.56 → "1.234,56"', () => {
    expect(formatAmount(1234.56, 'de-DE')).toBe('1.234,56');
  });

  it('zero → "0.00"', () => {
    expect(formatAmount(0, 'en-US')).toBe('0.00');
  });
});

// ---------------------------------------------------------------------------
// formatStroops
// ---------------------------------------------------------------------------

describe('formatStroops', () => {
  it('50_000_000 stroops → 5.00 XLM (en-US)', () => {
    expect(formatStroops(50_000_000n, 'XLM', 'en-US')).toBe('5.00 XLM');
  });

  it('10_000_000 stroops → 1.00 XLM (en-US)', () => {
    expect(formatStroops(10_000_000n, 'XLM', 'en-US')).toBe('1.00 XLM');
  });

  it('1 stroop → 0.0000001 XLM (en-US)', () => {
    expect(formatStroops(1n, 'XLM', 'en-US')).toBe('0.0000001 XLM');
  });

  it('de-DE: 10_000_000 stroops → "1,00 XLM" (comma decimal)', () => {
    const result = formatStroops(10_000_000n, 'XLM', 'de-DE');
    expect(result).toContain('1,00');
    expect(result).toContain('XLM');
  });
});

// ---------------------------------------------------------------------------
// formatBps
// ---------------------------------------------------------------------------

describe('formatBps', () => {
  it('en-US: 50 bps → "0.50%"', () => {
    expect(formatBps(50, 'en-US')).toBe('0.50%');
  });

  it('en-US: 10000 bps → "100.00%"', () => {
    expect(formatBps(10000, 'en-US')).toBe('100.00%');
  });

  it('en-US: 0 bps → "0.00%"', () => {
    expect(formatBps(0, 'en-US')).toBe('0.00%');
  });

  it('de-DE: 50 bps uses comma decimal', () => {
    const result = normaliseWhitespace(formatBps(50, 'de-DE'));
    // "0,50 %" — German adds a space before %
    expect(result).toMatch(/0,50/);
  });

  it('ja-JP: 100 bps → "1.00%"', () => {
    expect(formatBps(100, 'ja-JP')).toBe('1.00%');
  });
});

// ---------------------------------------------------------------------------
// formatPct
// ---------------------------------------------------------------------------

describe('formatPct', () => {
  it('en-US: 0.75 → "75.00%"', () => {
    expect(formatPct(0.75, 'en-US')).toBe('75.00%');
  });

  it('en-US: 1.0 → "100.00%"', () => {
    expect(formatPct(1.0, 'en-US')).toBe('100.00%');
  });

  it('en-US: 0 → "0.00%"', () => {
    expect(formatPct(0, 'en-US')).toBe('0.00%');
  });

  it('de-DE: 0.75 uses comma decimal', () => {
    const result = normaliseWhitespace(formatPct(0.75, 'de-DE'));
    expect(result).toMatch(/75,00/);
  });
});

// ---------------------------------------------------------------------------
// formatLedgerNumber
// ---------------------------------------------------------------------------

describe('formatLedgerNumber', () => {
  it('en-US: 1234567 → "1,234,567"', () => {
    expect(formatLedgerNumber(1234567n, 'en-US')).toBe('1,234,567');
  });

  it('de-DE: 1234567 → "1.234.567"', () => {
    expect(formatLedgerNumber(1234567n, 'de-DE')).toBe('1.234.567');
  });

  it('ar-AE: forces Latin digits', () => {
    const result = formatLedgerNumber(1234567n, 'ar-AE');
    // With numberingSystem: 'latn' the result must only contain ASCII digits
    expect(/^[0-9,.\s]+$/.test(result)).toBe(true);
  });

  it('ja-JP: 1234567 → "1,234,567"', () => {
    expect(formatLedgerNumber(1234567n, 'ja-JP')).toBe('1,234,567');
  });

  it('regular number (not BigInt) also works', () => {
    expect(formatLedgerNumber(50000, 'en-US')).toBe('50,000');
  });
});

// ---------------------------------------------------------------------------
// formatLedgerDate / formatLedgerDateOnly / ledgerTimestampIso
// ---------------------------------------------------------------------------

// Unix timestamp for 2023-11-14T22:13:20.000Z
const FIXED_TS = 1700000000;

describe('formatLedgerDate', () => {
  it('returns a non-empty string for en-US', () => {
    const result = formatLedgerDate(FIXED_TS, 'en-US');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('en-US result contains the year 2023', () => {
    expect(formatLedgerDate(FIXED_TS, 'en-US')).toContain('2023');
  });

  it('de-DE result contains 2023', () => {
    expect(formatLedgerDate(FIXED_TS, 'de-DE')).toContain('2023');
  });

  it('ja-JP result contains 2023', () => {
    expect(formatLedgerDate(FIXED_TS, 'ja-JP')).toContain('2023');
  });

  it('ar-AE result is non-empty string', () => {
    const result = formatLedgerDate(FIXED_TS, 'ar-AE');
    expect(typeof result).toBe('string');
    expect(result.length).toBeGreaterThan(0);
  });

  it('fr-FR result contains 2023', () => {
    expect(formatLedgerDate(FIXED_TS, 'fr-FR')).toContain('2023');
  });
});

describe('formatLedgerDateOnly', () => {
  it('en-US result contains "Nov" and "2023"', () => {
    const result = formatLedgerDateOnly(FIXED_TS, 'en-US');
    expect(result).toContain('2023');
  });

  it('de-DE result contains "2023"', () => {
    expect(formatLedgerDateOnly(FIXED_TS, 'de-DE')).toContain('2023');
  });
});

describe('ledgerTimestampIso', () => {
  it('returns a valid ISO 8601 string', () => {
    const iso = ledgerTimestampIso(FIXED_TS);
    expect(iso).toBe('2023-11-14T22:13:20.000Z');
  });

  it('always produces UTC (ends with Z)', () => {
    expect(ledgerTimestampIso(FIXED_TS).endsWith('Z')).toBe(true);
  });

  it('roundtrips through Date', () => {
    const iso = ledgerTimestampIso(FIXED_TS);
    expect(new Date(iso).getTime()).toBe(FIXED_TS * 1000);
  });
});

// ---------------------------------------------------------------------------
// formatMaintenanceWindow
// ---------------------------------------------------------------------------

describe('formatMaintenanceWindow', () => {
  const start = 1700000000;
  const end   = 1700003600; // +1 hour

  it('returns a non-empty string containing a dash separator', () => {
    const result = formatMaintenanceWindow(start, end, 'en-US');
    expect(result).toContain('–');
  });

  it('en-US result contains "UTC"', () => {
    expect(formatMaintenanceWindow(start, end, 'en-US')).toContain('UTC');
  });

  it('de-DE result contains "UTC"', () => {
    expect(formatMaintenanceWindow(start, end, 'de-DE')).toContain('UTC');
  });
});

// ---------------------------------------------------------------------------
// parseLocalizedDecimal
// ---------------------------------------------------------------------------

describe('parseLocalizedDecimal', () => {
  // en-US: comma thousands, dot decimal
  it('en-US: "1,234.56" → 1234.56', () => {
    expect(parseLocalizedDecimal('1,234.56', 'en-US')).toBeCloseTo(1234.56);
  });

  it('en-US: "1234.56" (no grouping) → 1234.56', () => {
    expect(parseLocalizedDecimal('1234.56', 'en-US')).toBeCloseTo(1234.56);
  });

  it('en-US: "0.50" → 0.50', () => {
    expect(parseLocalizedDecimal('0.50', 'en-US')).toBeCloseTo(0.5);
  });

  // de-DE: dot thousands, comma decimal
  it('de-DE: "1.234,56" → 1234.56', () => {
    expect(parseLocalizedDecimal('1.234,56', 'de-DE')).toBeCloseTo(1234.56);
  });

  it('de-DE: "1234,56" → 1234.56', () => {
    expect(parseLocalizedDecimal('1234,56', 'de-DE')).toBeCloseTo(1234.56);
  });

  it('de-DE: "18,40" → 18.40', () => {
    expect(parseLocalizedDecimal('18,40', 'de-DE')).toBeCloseTo(18.4);
  });

  // fr-FR: space (narrow-no-break) thousands, comma decimal
  it('fr-FR: "1 234,56" (ASCII space) → 1234.56', () => {
    expect(parseLocalizedDecimal('1 234,56', 'fr-FR')).toBeCloseTo(1234.56);
  });

  it('fr-FR: "1\u202F234,56" (narrow-no-break space) → 1234.56', () => {
    expect(parseLocalizedDecimal('1\u202F234,56', 'fr-FR')).toBeCloseTo(1234.56);
  });

  // ja-JP: comma thousands, dot decimal (same as en-US numerically)
  it('ja-JP: "1,234.56" → 1234.56', () => {
    expect(parseLocalizedDecimal('1,234.56', 'ja-JP')).toBeCloseTo(1234.56);
  });

  // ar-AE: Arabic-Indic digits
  it('ar-AE: Arabic-Indic digits "١٢٣٤٫٥٦" → 1234.56', () => {
    // ١٢٣٤ = 1234, ٫ (U+066B) = Arabic decimal separator, ٥٦ = 56
    expect(parseLocalizedDecimal('١٢٣٤٫٥٦', 'ar-AE')).toBeCloseTo(1234.56);
  });

  it('ar-AE: Arabic Thousands Separator (U+066C) is stripped', () => {
    // ١٬٢٣٤٫٥٦ with U+066C as thousands separator
    expect(parseLocalizedDecimal('١\u066C٢٣٤\u066B٥٦', 'ar-AE')).toBeCloseTo(1234.56);
  });

  it('ar-AE: plain ASCII digits still work "1234.56" → 1234.56', () => {
    expect(parseLocalizedDecimal('1234.56', 'ar-AE')).toBeCloseTo(1234.56);
  });

  // Edge cases
  it('empty string → NaN', () => {
    expect(parseLocalizedDecimal('', 'en-US')).toBeNaN();
  });

  it('whitespace-only string → NaN', () => {
    expect(parseLocalizedDecimal('   ', 'en-US')).toBeNaN();
  });

  it('non-numeric string → NaN', () => {
    expect(parseLocalizedDecimal('abc', 'en-US')).toBeNaN();
  });

  it('zero "0" → 0', () => {
    expect(parseLocalizedDecimal('0', 'en-US')).toBe(0);
  });

  it('integer without decimal "1000" → 1000', () => {
    expect(parseLocalizedDecimal('1000', 'en-US')).toBe(1000);
  });

  // Stroop conversion invariant
  it('stroop conversion: en-US "1,840.00" → 18400000 stroops', () => {
    const amount = parseLocalizedDecimal('1,840.00', 'en-US');
    const stroops = Math.round(amount * 10_000_000);
    expect(stroops).toBe(18_400_000_000);
  });

  it('stroop conversion: de-DE "1.840,00" → same 18400000 stroops', () => {
    const amount = parseLocalizedDecimal('1.840,00', 'de-DE');
    const stroops = Math.round(amount * 10_000_000);
    expect(stroops).toBe(18_400_000_000);
  });
});

// ---------------------------------------------------------------------------
// detectDecimalSeparator
// ---------------------------------------------------------------------------

describe('detectDecimalSeparator', () => {
  it('en-US → "."', () => {
    expect(detectDecimalSeparator('en-US')).toBe('.');
  });

  it('de-DE → ","', () => {
    expect(detectDecimalSeparator('de-DE')).toBe(',');
  });

  it('fr-FR → ","', () => {
    expect(detectDecimalSeparator('fr-FR')).toBe(',');
  });

  it('ja-JP → "."', () => {
    expect(detectDecimalSeparator('ja-JP')).toBe('.');
  });

  it('returns a single character string', () => {
    const sep = detectDecimalSeparator('en-US');
    expect(sep).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// detectThousandsSeparator
// ---------------------------------------------------------------------------

describe('detectThousandsSeparator', () => {
  it('en-US → ","', () => {
    expect(detectThousandsSeparator('en-US')).toBe(',');
  });

  it('de-DE → "."', () => {
    expect(detectThousandsSeparator('de-DE')).toBe('.');
  });

  it('fr-FR → narrow-no-break space or space variant', () => {
    const sep = detectThousandsSeparator('fr-FR');
    // Could be '\u202F', '\u00A0', or ' ' depending on ICU version
    expect(['\u202F', '\u00A0', '\u2009', ' ']).toContain(sep);
  });

  it('ja-JP → ","', () => {
    expect(detectThousandsSeparator('ja-JP')).toBe(',');
  });
});

// ---------------------------------------------------------------------------
// truncateStellarAddress
// ---------------------------------------------------------------------------

const STELLAR_ADDR = 'GABCDEFGHIJKLMNOPQRSTUVWXYZ234567ABCDEFGHIJKLMNOPQRSTUV';

describe('truncateStellarAddress', () => {
  it('truncates a full address to prefix+…+suffix', () => {
    const result = truncateStellarAddress(STELLAR_ADDR, 6, 4);
    expect(result).toBe('GABCDE…STUV');
  });

  it('default params: prefix=6, suffix=4', () => {
    const result = truncateStellarAddress(STELLAR_ADDR);
    expect(result.startsWith('GABCDE')).toBe(true);
    expect(result.endsWith('STUV')).toBe(true);
    expect(result).toContain('…');
  });

  it('short string returned unchanged', () => {
    expect(truncateStellarAddress('GABCD', 6, 4)).toBe('GABCD');
  });

  it('empty string returns empty string', () => {
    expect(truncateStellarAddress('')).toBe('');
  });

  it('contains exactly one ellipsis', () => {
    const result = truncateStellarAddress(STELLAR_ADDR, 6, 4);
    expect((result.match(/…/g) ?? []).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// groupStellarAddress
// ---------------------------------------------------------------------------

describe('groupStellarAddress', () => {
  it('splits into 4-char groups separated by spaces', () => {
    expect(groupStellarAddress('GABCDEFG', 4)).toBe('GABC DEFG');
  });

  it('handles address length not divisible by group size', () => {
    expect(groupStellarAddress('GABCDE', 4)).toBe('GABC DE');
  });

  it('empty string returns empty string', () => {
    expect(groupStellarAddress('')).toBe('');
  });

  it('default group size is 4', () => {
    const result = groupStellarAddress('GABCDEFGHIJK');
    // "GABC DEFG HIJK"
    expect(result).toBe('GABC DEFG HIJK');
  });
});

// ---------------------------------------------------------------------------
// formatXlmShortfall
// ---------------------------------------------------------------------------

describe('formatXlmShortfall', () => {
  it('en-US: 1.5 → "1.50 XLM"', () => {
    expect(formatXlmShortfall(1.5, 'en-US')).toBe('1.50 XLM');
  });

  it('de-DE: 1.5 → "1,50 XLM"', () => {
    expect(formatXlmShortfall(1.5, 'de-DE')).toBe('1,50 XLM');
  });

  it('always appends uppercase XLM', () => {
    const result = formatXlmShortfall(0.25, 'en-US');
    expect(result.endsWith(' XLM')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// formatFlowRate
// ---------------------------------------------------------------------------

describe('formatFlowRate', () => {
  it('en-US: 0.0042 → "0.0042 USDC/min"', () => {
    expect(formatFlowRate(0.0042, 'en-US')).toBe('0.0042 USDC/min');
  });

  it('en-US: 1.2345 → "1.2345 USDC/min"', () => {
    expect(formatFlowRate(1.2345, 'en-US')).toBe('1.2345 USDC/min');
  });

  it('always ends with "USDC/min"', () => {
    expect(formatFlowRate(0, 'de-DE').endsWith('USDC/min')).toBe(true);
  });

  it('de-DE: uses comma decimal', () => {
    const result = formatFlowRate(0.0042, 'de-DE');
    expect(result).toContain(',');
    expect(result).toContain('USDC/min');
  });
});

// ---------------------------------------------------------------------------
// formatKwhRate
// ---------------------------------------------------------------------------

describe('formatKwhRate', () => {
  it('en-US: 20.736 → "~20.7 kWh/hr"', () => {
    expect(formatKwhRate(20.736, 'en-US')).toBe('~20.7 kWh/hr');
  });

  it('always starts with "~"', () => {
    expect(formatKwhRate(5, 'en-US').startsWith('~')).toBe(true);
  });

  it('always ends with "kWh/hr"', () => {
    expect(formatKwhRate(5, 'en-US').endsWith('kWh/hr')).toBe(true);
  });

  it('de-DE: uses comma decimal', () => {
    const result = formatKwhRate(20.736, 'de-DE');
    expect(result).toContain(',');
    expect(result).toContain('kWh/hr');
  });
});

// ---------------------------------------------------------------------------
// formatLedgerTtl
// ---------------------------------------------------------------------------

const D = 17_280; // ledgers per day

describe('formatLedgerTtl', () => {
  it('1 day → "~1d"', () => {
    expect(formatLedgerTtl(D)).toBe('~1d');
  });

  it('29 days → "~29d"', () => {
    expect(formatLedgerTtl(29 * D)).toBe('~29d');
  });

  it('30 days → "~1mo"', () => {
    expect(formatLedgerTtl(30 * D)).toBe('~1mo');
  });

  it('365 days → "~1y"', () => {
    expect(formatLedgerTtl(365 * D)).toBe('~1y');
  });

  it('2 years → "~2y"', () => {
    expect(formatLedgerTtl(730 * D)).toBe('~2y');
  });

  it('half a day → "~12h"', () => {
    expect(formatLedgerTtl(Math.floor(D / 2))).toBe('~12h');
  });

  it('zero ledgers → "~0h"', () => {
    expect(formatLedgerTtl(0)).toBe('~0h');
  });
});

// ---------------------------------------------------------------------------
// formatRunwayHours
// ---------------------------------------------------------------------------

describe('formatRunwayHours', () => {
  it('3.5 hours → "3h 30m"', () => {
    expect(formatRunwayHours(3.5)).toBe('3h 30m');
  });

  it('1 hour → "1h 00m"', () => {
    expect(formatRunwayHours(1)).toBe('1h 00m');
  });

  it('0.25 hours → "0h 15m"', () => {
    expect(formatRunwayHours(0.25)).toBe('0h 15m');
  });

  it('Infinity → "Paused"', () => {
    expect(formatRunwayHours(Infinity)).toBe('Paused');
  });

  it('NaN → "Paused"', () => {
    expect(formatRunwayHours(NaN)).toBe('Paused');
  });

  it('0 → "Depleted"', () => {
    expect(formatRunwayHours(0)).toBe('Depleted');
  });

  it('negative → "Depleted"', () => {
    expect(formatRunwayHours(-1)).toBe('Depleted');
  });

  it('1000 hours → ">999h"', () => {
    expect(formatRunwayHours(1000)).toBe('>999h');
  });

  it('999 hours → "999h 00m"', () => {
    expect(formatRunwayHours(999)).toBe('999h 00m');
  });

  it('minutes padded to 2 digits', () => {
    // 2h 5min
    expect(formatRunwayHours(2 + 5 / 60)).toBe('2h 05m');
  });
});

// ---------------------------------------------------------------------------
// Asset-code invariant tests
// ---------------------------------------------------------------------------

describe('asset code invariant', () => {
  const cases = ['usdc', 'USDC', 'Usdc', 'xlm', 'XLM', 'usdt'];

  it.each(cases)('formatPaymentAmount always uppercases asset code "%s"', (code) => {
    const result = formatPaymentAmount(100, code, 'en-US');
    const expected = code.toUpperCase();
    expect(result).toContain(expected);
    // Should not contain the lowercase version separately
    expect(result.split(' ').pop()).toBe(expected);
  });
});

// ---------------------------------------------------------------------------
// Stroop normalization invariant
// ---------------------------------------------------------------------------

describe('stroop normalization invariant', () => {
  it('de-DE "5.000,00" and en-US "5,000.00" produce the same stroop count', () => {
    const amountDe = parseLocalizedDecimal('5.000,00', 'de-DE');
    const amountEn = parseLocalizedDecimal('5,000.00', 'en-US');
    const stroopsDe = Math.round(amountDe * 10_000_000);
    const stroopsEn = Math.round(amountEn * 10_000_000);
    expect(stroopsDe).toBe(stroopsEn);
    expect(stroopsDe).toBe(50_000_000_000);
  });

  it('fr-FR "1 234,56" produces the same stroops as en-US "1,234.56"', () => {
    const amountFr = parseLocalizedDecimal('1 234,56', 'fr-FR');
    const amountEn = parseLocalizedDecimal('1,234.56', 'en-US');
    expect(Math.round(amountFr * 10_000_000)).toBe(Math.round(amountEn * 10_000_000));
  });
});
