# SigningPreviewModal — Soroban Transaction Signing & Simulation Preview UX

Status: Specification (issue #409)
Owner: Design + Wallet Integration
Related component: `apps/web/src/components/tx/TransactionReviewDrawer.tsx`

## 1. Purpose

Wallet extension popups surface raw Soroban contract hashes and XDR arguments that users
blindly approve. Before invoking the wallet, Cypher GridPay presents a **Pre-Flight Signing
Summary** so the user understands the exact state change and token outflow they authorize.

The `SigningPreviewModal` is the single, standardized surface for every transaction intent.

## 2. Supported Intents

| Intent | Risk tier | Primary verb |
| --- | --- | --- |
| `Pay` | routine | You Send |
| `Lock in Escrow` | routine | You Lock |
| `Release Escrow` | **high** (irreversible) | You Release |
| `File Dispute` | routine | You File |
| `Commit Vote` | routine | You Commit |
| `Propose Upgrade` | **high** (admin) | You Propose |
| `Emergency Pause` | **high** (admin, destructive) | You Pause |

Risk tier drives the warning banner (see §6). Routine read-only actions never show a
warning banner — warnings must stay meaningful.

## 3. Layout (top → bottom)

1. **Header** — intent title in plain English (e.g. "Release Escrow") + risk badge.
2. **Transfer card** — "You Send / Lock" vs "Recipient / Vault" (see §4).
3. **Consequence summary** — plain-English irreversible-consequence sentence (§5).
4. **Warning banner** — only for high-risk intents (§6).
5. **Step indicator** — shown when a `restoreFootprint` pre-transaction is required (§7).
6. **Technical Soroban Details** — collapsible accordion (§8).
7. **Action row** — primary "Review in wallet" + secondary "Cancel".

## 4. Transfer Card

Two-column visual transfer card with a directional arrow between columns.

```
┌───────────────────────┐        ┌───────────────────────┐
│  YOU SEND / LOCK      │  ───▶  │  RECIPIENT / VAULT    │
│  500.00 USDC          │        │  Merchant X           │
│  GABC…7Q2F            │        │  GXYZ…4K9M            │
└───────────────────────┘        └───────────────────────┘
```

- Left column label is intent-aware: "You Send" (Pay), "You Lock" (Lock in Escrow),
  "You Release" (Release Escrow), etc.
- Right column label is "Recipient" for direct transfers and "Vault" for escrow intents.
- Amounts use `MoneyDisplay`; addresses use `StellarAddress` (truncated + copyable).
- On mobile the card stacks vertically with the arrow rotating to point downward.

## 5. Plain-English Consequence Summary

One sentence, present tense, states the irreversible effect. Examples:

- Release Escrow: "Releasing escrow transfers **500.00 USDC** immediately to **Merchant X**
  and cannot be undone."
- Pay: "This sends **500.00 USDC** to **Merchant X**."
- Lock in Escrow: "This locks **500.00 USDC** in escrow until released or disputed."
- File Dispute: "This opens a dispute; funds stay locked until resolved."
- Commit Vote: "This commits your vote and cannot be changed after submission."
- Propose Upgrade: "This proposes a contract upgrade that, once approved, changes live
  contract behavior."
- Emergency Pause: "This pauses the contract immediately; all operations halt until unpaused."

## 6. High-Risk Warning Banner

Shown only for `Release Escrow`, `Propose Upgrade`, `Emergency Pause`, clawbacks, slashing,
and admin rotations.

- **Red** banner: irreversible fund movement or destructive admin action (release, pause,
  clawback, slashing).
- **Amber** banner: reversible-but-sensitive admin action (propose upgrade, admin rotation).
- Banner text is a short imperative, e.g. "This action is irreversible."
- Routine intents (`Pay`, `Lock`, `File Dispute`, `Commit Vote`) show **no** banner.

## 7. Step Indicator (restore-then-invoke)

When simulation reports a missing/expired footprint, the modal shows a two-step indicator
before the main invocation:

```
[1] Restore footprint  ──▶  [2] Sign transaction
```

- Step 1 is labeled "Restore contract state (no funds move)".
- Step 2 is the actual intent invocation.
- The indicator makes clear the restore step is a prerequisite, not a second charge.

## 8. Technical Soroban Details (accordion)

Collapsed by default. Expanded, it exposes everything needed to cross-verify on a
Ledger/hardware wallet screen:

- **Contract ID** (full, copyable)
- **Function name**
- **Arguments** (decoded, key/value)
- **Resource footprint** — CPU instructions and memory bytes
- **Estimated fee** (stroops + display amount)
- **Raw XDR** with a copy button

## 9. Component States

| State | UI |
| --- | --- |
| `standard` | Single-step summary + action row |
| `restore-then-invoke` | Two-step indicator (§7) |
| `multisig-cosign` | "Awaiting co-signers (2 of 3)" chip; primary action disabled until threshold met |
| `high-risk` | Warning banner (§6) + consequence summary emphasized |
| `waiting-for-wallet` | "Waiting for your wallet extension…" + reminder to check the browser toolbar/popup |
| `confirming` | "Confirming on Stellar network…" with spinner |
| `success` / `failed` | Terminal result with link to explorer |

### Wallet vs network distinction

- **Waiting for your wallet extension…** — the request is pending in the extension popup.
  Include a gentle reminder: "Check your browser toolbar for the wallet popup."
- **Confirming on Stellar network…** — the user has signed; the transaction is submitted and
  awaiting ledger inclusion. Show `LedgerCountdown` where available.

These two states must never be visually conflated.

## 10. Responsive Behavior

- Desktop: two-column transfer card, side-by-side action row.
- Mobile / wallet redirect flows: stacked transfer card, full-width primary action, technical
  accordion collapsed by default to keep the summary above the fold.

## 11. Acceptance Criteria

- [ ] States cover standard, two-step restore-then-invoke, multisig co-sign, and high-risk
      destructive actions.
- [ ] Technical details drawer provides exact parameters needed to verify on Ledger/hardware
      wallet screens.
- [ ] Visual clarity verified across desktop and mobile wallet redirect flows.
