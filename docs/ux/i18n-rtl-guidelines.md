# i18n, RTL Layout, and Locale-Aware Formatting Guidelines

**Issue:** #424  
**Status:** Canonical reference — all new UI components must comply.

---

## 1. Motivation

Cypher GridPay's Stellar payment rails serve global merchants and cross-border
energy/commerce users. Hardcoded en-US date formats (`MM/DD/YYYY`), numeric
separators (`1,234.56` vs `1.234,56`), and physical CSS direction properties
(`margin-left`, `text-align: left`, `border-left`) create friction and broken
layouts for international markets, particularly MENA and other RTL regions.

This document establishes the invariants that all UI components must satisfy.

---

## 2. Logical CSS Properties

### 2.1 Rule

**Never** write a physical directional CSS property in component source. Use
the logical equivalent exclusively.

| Physical (forbidden)       | Logical (required)             |
|----------------------------|-------------------------------|
| `margin-left`              | `marginInlineStart`           |
| `margin-right`             | `marginInlineEnd`             |
| `padding-left`             | `paddingInlineStart`          |
| `padding-right`            | `paddingInlineEnd`            |
| `border-left`              | `borderInlineStart`           |
| `border-right`             | `borderInlineEnd`             |
| `text-align: left`         | `textAlign: 'start'`          |
| `text-align: right`        | `textAlign: 'end'`            |
| `left: 0`                  | `insetInlineStart: 0`         |
| `right: 0`                 | `insetInlineEnd: 0`           |
| `float: left`              | `float: inline-start`         |
| `transform: translateX(-50%)` on a centered element | keep — geometric, not directional |

**Tailwind equivalents** (for Tailwind-based projects):

| Physical class | Logical class |
|----------------|--------------|
| `ml-*`         | `ms-*`       |
| `mr-*`         | `me-*`       |
| `pl-*`         | `ps-*`       |
| `pr-*`         | `pe-*`       |
| `border-l-*`   | `border-s-*` |
| `text-left`    | `text-start` |
| `text-right`   | `text-end`   |
| `left-*`       | `start-*`    |
| `right-*`      | `end-*`      |

### 2.2 Exceptions

The following properties are geometric and must **not** be replaced:

- `transform: translateX()` — percentages are geometric in both directions.
- `position: fixed` / `top` / `bottom` — block-axis, not inline.
- `width`, `height`, `border-radius` — dimension, not direction.
- SVG `x1`, `x2`, `y1`, `y2` attributes inside `dir="ltr"` isolated containers.

### 2.3 RTL mirror test

Place `dir="rtl"` on the root `<html>` element (or the nearest ancestor) and
visually verify:

- Navigation drawers open from the **right** edge.
- Timeline progress bars grow from **right** to **left**.
- Table column order is **unchanged** (content, not direction, determines
  column order — column mirroring is a product decision, not a CSS default).
- Coloured left-side accent stripes (`borderInlineStart`) appear on the right.
- Chevron / arrow icons that indicate directional progress (next, back,
  forward) are **mirrored**. See §4 for the icon audit.

---

## 3. Bidirectional Isolation for Data Strings

### 3.1 When to isolate

Apply `dir="ltr"` and `unicodeBidi: 'isolate'` to every element that renders:

- Stellar account addresses (`G…`, `C…`)
- Transaction hashes (hex strings)
- WASM hashes
- Contract addresses
- Numeric amounts embedded inside running RTL text

These strings contain characters (letters, digits, punctuation) whose
bidirectional class causes the Unicode Bidirectional Algorithm to reorder them
when they appear inside an RTL paragraph. Isolation prevents reordering.

### 3.2 How to isolate in React

```tsx
// Good — data string isolated from surrounding RTL paragraph
<span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
  {stellarAddress}
</span>

// Good — amount isolated
<span dir="ltr" style={{ unicodeBidi: 'isolate', fontVariantNumeric: 'tabular-nums' }}>
  {formattedAmount}
</span>
```

The `isolate-override` value is **not** needed here; `isolate` is sufficient
and less disruptive to the surrounding bidi algorithm state.

### 3.3 Asset code exception

Explicit asset codes (`USDC`, `XLM`, `USDT`) must remain **uppercase Latin**
regardless of locale. They are part of the Stellar protocol, not the display
locale. Do not translate or reformat them.

```tsx
// Correct — amount in locale format, asset code always LTR Latin
<span dir="ltr" style={{ unicodeBidi: 'isolate' }}>
  {formatAssetAmount(1234.56, 'USDC', locale)} {/* "1,234.56" in en-US */}
</span>
```

---

## 4. Icon Directionality Audit

### 4.1 Directional icons — mirror in RTL

These icons carry a directional meaning tied to reading direction and **must**
be mirrored (apply `transform: scaleX(-1)` when `dir="rtl"`):

| Icon              | Usage                              |
|-------------------|------------------------------------|
| Chevron right `›` | Next, expand, go-forward           |
| Chevron left `‹`  | Back, collapse, go-backward        |
| Arrow right `→`   | Forward flow, progress direction   |
| Arrow left `←`    | Back action                        |
| Flow arrows in progress bars | Timeline, payment flow  |
| `⟶` stream direction badge | LiveStreamCounter       |

### 4.2 Universal icons — do NOT mirror

These icons are conceptual and must remain unmirrored regardless of direction:

| Icon         | Reason                          |
|--------------|---------------------------------|
| Checkmark ✓  | Completion — no direction       |
| Lock 🔒      | Security — no direction         |
| Clock ⏱      | Time — no direction             |
| Warning ⚠    | Alert — no direction            |
| Calendar 📅  | Date — no direction             |
| Play/Pause ⏸ | Media — conventional symbols   |
| Star ★       | Rating/sink indicator           |
| Cross ×      | Dismiss — no direction          |
| Shield 🛡    | Security — no direction         |

### 4.3 Implementation pattern

```tsx
// In a component that receives a dir prop or reads from context:
const isRtl = dir === 'rtl';

<svg
  style={isRtl ? { transform: 'scaleX(-1)' } : undefined}
  aria-hidden="true"
>
  <polyline points="9 18 15 12 9 6" /> {/* chevron-right */}
</svg>
```

---

## 5. Locale-Aware Formatting

### 5.1 Numbers

Use `Intl.NumberFormat` via the `formatAmount` helpers in
`apps/web/src/utils/formatAmount.ts`. **Never** call `.toLocaleString()` with
a hardcoded `'en-US'` locale.

```ts
import { formatPaymentAmount, formatLedgerNumber } from '@/utils/formatAmount';

// Renders "1,234.56" in en-US, "1.234,56" in de-DE, "١٬٢٣٤٫٥٦" in ar-AE
formatPaymentAmount(1234.56, 'USDC', userLocale);

// Ledger / stroop integer — always uses Latin digits regardless of locale
formatLedgerNumber(50_000_000n, userLocale);
```

### 5.2 Dates and timestamps

Use `Intl.DateTimeFormat` via `formatLedgerDate` / `formatLedgerTimestamp`.

- **On-hover**: always show the raw UTC ISO timestamp for auditability.
- **Display**: use the user's locale for the human-readable date.
- Maintenance windows: show `UTC` in the `timeZoneName` field.

```ts
// Display label — locale-aware
formatLedgerDate(ledgerTimestamp, userLocale);

// Hover tooltip — always UTC ISO
new Date(ledgerTimestamp * 1000).toISOString(); // "2024-11-22T14:30:00.000Z"
```

### 5.3 Decimal input parsing

When accepting a numeric amount from the user:

1. Accept both `.` and `,` as decimal separators.
2. Strip thousands separators (`,` in en-US; `.` in de-DE; `'` in ch-DE).
3. Convert to a canonical float **before** computing stroops.
4. Convert to integer stroops: `Math.round(amount * 10_000_000)`.

```ts
import { parseLocalizedDecimal } from '@/utils/formatAmount';

const stroops = Math.round(parseLocalizedDecimal('1.234,56', 'de-DE') * 10_000_000);
```

### 5.4 Stroop normalization invariant

> Fee computation and contract encoding always operate on integer stroops.
> The `max_amount`, `capture_amount`, and `fee_amount` fields in
> `PreAuthPayment` are integer stroops. Locale formatting is applied only
> at the display layer, never before contract encoding.

---

## 6. Text Expansion Tolerance

Translated strings in German, French, and Spanish can be 25–40% longer than
English. All button labels, status badges, and table headers must accommodate
a **+35% expansion** without truncation, overflow, or layout break.

### 6.1 Requirements

- Buttons: use `white-space: normal` (not `nowrap`) in responsive contexts.
  Fixed-width buttons must be tested at 1.35× their English character count.
- Status badges (`Pending`, `Completed`, `Authorized`, `Captured`): use
  `display: inline-flex` + `paddingInlineStart/End` instead of fixed `width`.
- Table `<th>` / `<td>` cells: allow wrapping with `word-break: break-word`.
- No `text-overflow: ellipsis` on user-facing status text — truncation hides
  meaning.

### 6.2 Pseudo-localization test

Wrap every visible string with a 35%-expansion prefix/suffix for visual
testing without actual translations:

```
"Save" → "[!!Savexxxxxxxx!!]"  (+35% visual length)
```

This can be automated in a Storybook decorator or a test-utility function.

---

## 7. Locale Context

Components must receive locale through React context rather than re-reading
`navigator.language` on every render.

```tsx
// Provide once at app root
<LocaleProvider locale={navigator.language}>
  <App />
</LocaleProvider>

// Consume in components
const { locale, dir } = useLocale();
```

The `dir` value (`'ltr'` | `'rtl'`) is derived from the locale and must be
propagated to the `<html>` element's `dir` attribute and to any isolated
subframes.

### 7.1 RTL locale detection

The following locales require `dir="rtl"`:

```
ar, ar-AE, ar-SA, ar-EG, ar-MA, ar-DZ  (Arabic)
he, he-IL                                (Hebrew)
fa, fa-IR                                (Persian / Farsi)
ur, ur-PK                                (Urdu)
```

---

## 8. Component Checklist

Before merging any new component, verify:

- [ ] All directional CSS uses logical properties.
- [ ] Stellar addresses / hashes wrapped in `dir="ltr"` isolated spans.
- [ ] Numeric amounts pass through `formatPaymentAmount()`.
- [ ] Dates pass through `formatLedgerDate()`.
- [ ] `dir="rtl"` visual test completed on the component.
- [ ] +35% text expansion does not break layout.
- [ ] Directional icons identified and mirrored / excluded correctly.
- [ ] No hardcoded `'en-US'` locale strings outside `formatAmount.ts`.
