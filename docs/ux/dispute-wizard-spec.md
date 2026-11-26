# Guided Dispute Filing & Evidence Checklist Wizard — UX Spec

Issue: #410

## Goal

Reduce invalid refund claims by guiding buyers through a 4-step wizard that:

1. Maps plain-language scenarios to the correct `RefundReasonCode`.
2. Runs an instant policy/eligibility check before the user invests effort.
3. Collects valid evidence with privacy assurances.
4. Sets clear timeline expectations before submission.

## Wizard Steps

### Step 1 — Select Issue

Card-based selector. Each card maps a plain-language scenario to a `RefundReasonCode` and shows a short evidence hint.

| Scenario (plain language) | `RefundReasonCode` | Evidence that strengthens the claim |
| --- | --- | --- |
| Item arrived damaged | `ProductDefect` | Photos of damage, unboxing video, packaging photos |
| Charged twice | `DuplicateCharge` | Bank/card statement showing both charges, order confirmation |
| Never received | `NonDelivery` | Tracking number, carrier status screenshot, merchant messages |
| Not as described | `NotAsDescribed` | Listing screenshots, received-item photos, spec comparison |
| Unauthorized charge | `Unauthorized` | Statement, notice of fraud, identity confirmation |
| Changed my mind / other | `Other` | Order confirmation, merchant communication |

All 6 `RefundReasonCode` variants must be represented. Selecting a card advances to Step 2.

### Step 2 — Eligibility & Net Payout Preview

Runs automatically on entry:

- `get_refund_policy_at_time` → shows the historical merchant policy that applied at purchase time (window, cooling-off, restocking fee).
- `preview_net_refund` → shows expected net payout after restocking/processing fees.
- `can_refund_payment` → determines eligibility and whether the claim qualifies for **Instant Auto-Refund** vs **Merchant Review**.

#### Eligible

- Green status: "You qualify for a refund."
- Show policy window, net payout breakdown, and qualification badge (Instant Auto-Refund / Merchant Review).
- Continue enabled.

#### Partially eligible

- Amber status: "Partially eligible."
- Explain the limiting factor (e.g. partial refund already issued, restocking fee applies, window nearly expired).
- Show adjusted net payout. Continue enabled with a warning.

#### Instant-refund

- Blue status: "Instant Auto-Refund available."
- Explain that funds return automatically once evidence is submitted.
- Continue enabled.

#### Ineligible

- Red status: "This payment is not eligible for a refund."
- Explain *why*: expired window, already fully refunded, rate-limited, or locked in escrow.
- Offer alternative next steps (e.g. "Open Escrow Dispute instead").
- Continue disabled — do not let the user fill out the rest of the form only to fail on submit.

### Step 3 — Attach Evidence

- Drag-and-drop uploader.
- Per-file privacy badge: "EXIF metadata stripped locally".
- Live SHA-256 hash preview per file.
- Evidence count/size meter.
- Privacy copy: files are processed locally (EXIF stripped before upload); only the SHA-256 hash is committed on-chain, while the file blob is stored off-chain.

### Step 4 — Review & Submit

- Summary of reason, eligibility, net payout, and attached evidence.
- Timeline expectation: "Merchant has 48h to respond; if denied, you may appeal after the cooling-off window."
- Submit button.

## Edge Cases

- Ineligible payments are surfaced in Step 2 with alternatives, never at submit time.
- Missing evidence shows a checklist reminder but does not block submission unless the reason requires it.
- Rate-limited or escrow-locked payments link to the escrow dispute flow.

## Acceptance Criteria

- [x] Flows designed for eligible, partially eligible, instant-refund, and ineligible cases.
- [x] Reason-code mapping covers all 6 `RefundReasonCode` variants with tailored evidence checklists.
- [x] Privacy assurance copy explains local EXIF stripping and on-chain hash commitment vs. off-chain blob storage.
