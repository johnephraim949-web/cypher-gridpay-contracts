# Refund Policy Studio — UX Specification

Scope: merchant-facing refund policy editing experience for `set_refund_policy`,
`apply_template_to_merchant`, `get_refund_policy_history`, and
`get_refund_policy_at_time`. This document specifies three surfaces:

1. **Policy Diff Review Card** — side-by-side previous vs. proposed rules.
2. **Policy Template Comparison Matrix** — compare up to 3 templates before drafting.
3. **Historical Policy Lookup Bar** — jump to the version that governed a payment.

All three surfaces share the same rule vocabulary (refund window, restocking fee,
auto-refund threshold, approval requirements) and the same accessibility contract.

---

## 1. Policy Diff Review Card

Shown immediately before a merchant confirms `set_refund_policy` or
`apply_template_to_merchant`. It is the last gate before signing.

### Layout

- Two columns: **Current policy** (left) and **Proposed policy** (right).
- Each rule is a row keyed by rule name so the two columns stay aligned.
- Unchanged rules render in neutral text with a `=` marker and no highlight.
- Changed rules render:
  - Left column: previous value in muted color with **strikethrough** and a `-` marker.
  - Right column: proposed value in a crisp highlighted badge with a `+` marker.
- Added rules: left column shows an empty placeholder (`—`), right column shows the
  new value with a `+` badge.
- Removed rules: left column shows the old value struck through with `-`, right
  column shows `—` with a `-` badge.

### Plain-English impact summaries

Above the columns, a summary list translates each changed rule into a sentence:

- "Customers will now have **14 days** instead of **7 days** to request a refund."
- "Restocking fee changes from **10%** to **0%**."
- "Auto-refund threshold changes from **$50** to **$25**."
- "Approval requirement added: refunds above **$200** need manual review."

Each summary carries the same `+`/`-`/arrow icon as its rule row so the mapping
between summary and diff row is unambiguous.

### Prospective-only scope banner

A persistent banner sits at the top of the card:

> Changes apply only to payments created after confirmation; existing payments
> remain governed by their original purchase-time policy.

The banner is not dismissible and is repeated in the confirmation dialog copy.

### Confirmation

- Primary action: **Confirm policy change** (disabled until the merchant has
  scrolled through or acknowledged all changed rules).
- Secondary action: **Back to editing**.
- If the merchant has unsaved custom edits, confirming a template-derived diff
  triggers the overwrite guard described in section 2.

---

## 2. Policy Template Comparison Matrix

Lets a merchant compare platform templates before choosing a starting draft.

### Templates

- **Strict**
- **Standard SaaS**
- **Buyer-Friendly Energy**

### Layout

- A matrix with rules as rows and templates as columns (up to 3 columns).
- Each cell shows the template's value for that rule.
- The currently selected template column is highlighted with a border and a
  "Selected" badge.
- A footer row offers **Use as starting draft** per column.

### Selecting a template

- Selecting a template loads it into the editor as a draft; it does not call
  `apply_template_to_merchant` until the merchant confirms via the Policy Diff
  Review Card.
- **Overwrite guard:** if the merchant already has unsaved custom edits,
  selecting a different template opens a confirmation dialog:
  - "You have unsaved custom edits. Switching templates will replace them."
  - Actions: **Keep my edits** (default, safe) and **Switch and discard edits**.
  - The destructive action is visually distinct and requires an explicit click.

---

## 3. Historical Policy Lookup Bar

An interactive bar for support agents and merchants to inspect which policy
applied to a given payment at a given time.

### Input

- Payment identifier field (e.g. `#12345`).
- Date field (e.g. `Oct 12, 2026`).
- Prompt copy: "Check which policy applied to Payment #12345 on Oct 12, 2026."

### Behavior

- On submit, the bar calls `get_refund_policy_at_time` for the payment/date pair
  and resolves the matching entry in `get_refund_policy_history`.
- The matching version is scrolled into view and highlighted in the
  **Policy Version Timeline** (`PolicyVersionTimeline.tsx`).
- If no version matches, the bar shows an inline empty state: "No policy version
  found for that payment and date."
- The resolved version is read-only; editing historical versions is not offered.

---

## Accessibility & Color-Blind Contract

Diff indicators must never rely on color alone. Every changed rule and summary
uses an icon plus a text label:

- `+` icon with label **Added** / **Proposed**.
- `-` icon with label **Removed** / **Previous**.
- Arrow icon with label **Changed**.

Strikethrough on previous values is paired with the `-` marker and the
"Previous" label so the meaning survives grayscale and color-blind modes.

---

## Responsive Layout

- **Desktop:** side-by-side columns for the diff card and matrix.
- **Tablet:** columns narrow; impact summaries stack above the columns.
- **Mobile:** the diff card and matrix stack vertically — previous value above
  proposed value per rule, with the `-`/`+` markers preserved. The historical
  lookup bar collapses to a single-column form with full-width inputs.
