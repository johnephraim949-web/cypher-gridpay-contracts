# Checkout Flow UX Spec — 3-Step Frictionless Checkout

Issue: #408 — Design Frictionless 3-Step Customer Checkout Flow with Progressive Disclosure for Escrow Protection and Network Fees.

Scope: UX/design spec for `packages/checkout-widget/src/GridPayCheckout.tsx`. This document defines the flow, states, copy, and layout invariants. It does not prescribe implementation internals beyond what the widget must surface.

## Goals

- Reduce crypto checkout abandonment by hiding raw XDR/trustline/Soroban jargon behind progressive disclosure.
- Make three things unmistakable at all times: **who the merchant is**, **what the total is (incl. fees)**, and **whether funds are buyer-protected (Escrow)**.
- Keep layout stable while async data (oracle quotes, loyalty discounts) loads: CLS < 0.05.

## Flow Overview

A single-page stepper with three steps. Steps advance in place (no full-page reloads). Back navigation is always allowed except after signing.

1. **Review & Asset** — merchant identity, itemized total, currency picker + oracle preview, loyalty/voucher toggle, Buyer Protection callout.
2. **Authorize & Sign** — separated trustline/allowance approval vs. final payment signing, network fee in XLM + USD.
3. **Receipt & Tracking** — verifiable receipt card, downloads, Stellar Expert link, Track Escrow / Request Support.

Responsive targets: `360px` (mobile), `768px` (tablet / embedded iframe), `1280px` (desktop). All three steps must be usable at every width.

---

## Step 1 — Review & Asset

### Merchant identity header
- Merchant display name (primary), verified tier badge (e.g. `Verified`, `Trusted`, `New`) with accessible label (`aria-label="Verified merchant, tier 2"`).
- Optional merchant avatar/logo with fixed dimensions to avoid CLS.
- Short merchant descriptor line (category / location) in muted text.

### Itemized total
- Line items: unit price × qty, subtotal, discounts, network fee (see Step 2), and **Total** in the selected asset.
- Total row is visually dominant; secondary fiat equivalent shown beneath in muted text.
- Skeleton placeholders reserve exact row heights while oracle quote loads.

### Currency picker with live oracle conversion preview
- Dropdown of supported assets (e.g. XLM, USDC, EURC).
- On selection, show a live conversion preview: `1 USDC ≈ 0.9998 USD · updated 3s ago`.
- While refreshing, keep the previous value visible with a subtle `Updating…` pill — never collapse the row (CLS guard).
- If oracle is stale/unavailable, show `Rate unavailable — retry` inline; do not block the picker.

### Loyalty / Refund Voucher toggle
- Optional toggle: `Apply Loyalty Points` and `Apply Refund Voucher` (shown only when the buyer has a balance).
- When toggled, the discount line animates into a **pre-reserved** slot so the total row does not jump.
- Show applied amount and remaining balance after redemption.

### Buyer Protection (Escrow) callout
- Plain-language card: `Your payment is held in Escrow until you confirm delivery. Funds release automatically after the hold period, or you can open a dispute within the dispute window.`
- Show explicit numbers: **hold period** (e.g. `7 days`) and **dispute window** (e.g. `48 hours after delivery`).
- If the merchant is non-escrowed, replace with a neutral `Direct payment — funds go to the merchant immediately` note (no protection claim).

### Checkout expiration
- Persistent countdown chip near the primary CTA: `Checkout expires in 04:59`.
- At < 60s the chip turns warning-colored and the CTA copy changes to `Complete checkout soon`.
- At expiry, Step 1 locks and shows `Session expired — start a new checkout` with a restart CTA. Never allow signing after `expires_at`.

---

## Step 2 — Authorize & Sign

### Visual separation
Two distinct blocks, clearly labeled and never merged into one button:

1. **Allowance / Trustline approval** (only shown when required)
   - Copy: `Allow this checkout to use your USDC. This does not move funds yet.`
   - Single primary action: `Approve USDC`.
   - On success, block collapses to a checked summary row.
2. **Final payment signing**
   - Copy: `Sign to send {total} {asset} to Escrow.`
   - Primary action: `Sign & Pay`.
   - Disabled until approval (if required) completes.

### Network fee disclosure
- Show Soroban network fee in both units: `Network fee: 0.00001 XLM (~$0.001)`.
- Fee is included in the itemized total from Step 1; Step 2 restates it for confirmation.
- If fee estimate changes on refresh, update in place without reflowing surrounding rows.

### Wallet rejection & errors
- Wallet rejection: inline non-destructive banner `Signature cancelled — nothing was charged.` with `Try again`.
- Insufficient balance: inline recovery (see micro-flows).
- Never advance to Step 3 unless the transaction is confirmed on-chain.

---

## Step 3 — Receipt & Tracking

### Verifiable receipt card
- Payment ID (truncated with copy button), amount, asset, timestamp, merchant, and escrow status.
- `Verified on-chain` badge once confirmation is observed.

### Downloads & links
- `Download PDF` and `Download JSON` receipt actions.
- `View on Stellar Expert` link opening the transaction in a new tab (`rel="noopener noreferrer"`).

### Tracking CTAs
- Primary: `Track Escrow` (opens escrow status / hold countdown).
- Secondary: `Request Support` (opens support with payment ID prefilled).

---

## Inline Recovery Micro-Flows

Shown contextually, never as blocking modals:

- **Missing trustline**: `Need a USDC trustline? Add in 1 click` → inline `Add trustline` action; on success, resume Step 2.
- **Insufficient balance**: `Insufficient {asset} balance — switch payment asset` → opens currency picker prefilled with affordable assets.
- **Expired session**: `Checkout expired` → `Start new checkout` (re-quotes oracle).
- **Wallet rejection**: `Signature cancelled` → `Try again` (re-signs same intent if not expired).
- **Stale oracle**: `Rate unavailable` → `Retry` inline; keep last known value visible.

---

## Edge Cases & Invariants

- **Expiration**: countdown always visible from Step 1; signing blocked at/after `expires_at`; expired state is explicit and recoverable.
- **CLS < 0.05**: reserve fixed heights for oracle preview, discount rows, fee rows, and receipt fields; use skeletons, not layout insertion.
- **Escrow vs direct**: protection language only appears for escrowed payments; direct payments state clearly that funds go to the merchant immediately.
- **Accessibility**: stepper exposes `aria-current="step"`; badges and countdown have text alternatives; all recovery actions are keyboard reachable.

## States to Cover (prototype matrix)

| State | Step 1 | Step 2 | Step 3 |
|---|---|---|---|
| Happy path (direct) | ✓ | ✓ | ✓ |
| Escrowed path | ✓ | ✓ | ✓ |
| Loyalty redemption | ✓ | ✓ | ✓ |
| Trustline missing | ✓ | recovery | — |
| Expired session | locked | blocked | — |
| Wallet rejection | ✓ | inline error | — |

## Acceptance Checklist

- [ ] Wireframes/specs cover desktop, mobile, and embedded iframe widths (`360px`–`1280px`).
- [ ] All six states above are represented.
- [ ] Non-crypto-native reviewers can correctly identify merchant, total fee, and escrow protection terms.
