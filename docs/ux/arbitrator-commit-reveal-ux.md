# Arbitrator Commit-Reveal Blind Voting & Salt Backup Safety UX

Status: Design spec (issue #412)
Scope: Arbitrator dispute voting flow — blind commit, salt backup, reveal, recusal.

## 1. Problem

Commit-reveal blind voting prevents juror herding, but introduces a Web3 UX hazard:
if an arbitrator forgets to return during the reveal phase, or loses their local secret
salt (device switch, cleared browser storage), they cannot reveal their vote and risk
`slash_arbitrator_stake` and reputation loss.

The UX must make the commit-vs-reveal distinction unambiguous and make salt backup
unmissable before the commit transaction is submitted.

## 2. Two-Phase Voting Progress Experience

A persistent progress rail at the top of the arbitrator voting surface:

```
[ Phase 1: Blind Commit ] -> [ Phase 2: Reveal Vote ] -> [ Consensus Finalized ]
```

- Each phase shows a **prominent countdown clock** to its deadline
  (`commitDeadline`, `revealDeadline`).
- The active phase is highlighted; completed phases show a check; future phases are muted.
- A short helper line under the rail states the current duty in plain language, e.g.
  "Committing does NOT finish your duty — you must return to reveal."
- When the reveal window opens, a **calendar-export (.ics) reminder button** is shown so
  the arbitrator can add the reveal-window opening time to their calendar.

### Phase states

| State | Rail | Primary action |
|-------|------|----------------|
| Commit open | Phase 1 active | Salt Backup Checkpoint -> Commit |
| Awaiting reveal | Phase 2 pending | Calendar reminder + "Reveal key ready" status |
| Reveal open | Phase 2 active | Upload keyfile (if missing) -> Reveal |
| Finalized | Consensus Finalized | Read-only outcome |

## 3. Salt Backup Checkpoint (before commit)

Shown as a blocking, unmissable panel before the commit transaction can be submitted.

- **Option A — Automatic encrypted browser storage + one-click
  "Download Reveal Keyfile (.json)".** The salt is encrypted and stored in IndexedDB; the
  keyfile is the portable backup.
- **Option B — Copyable recovery passphrase / QR code** for cross-device reveal.
- **Explicit confirmation checkbox** acknowledging slashing risk if the reveal is missed.
  The Commit button stays disabled until the checkbox is checked.

### Local keyfile detection

- Keyfile present in IndexedDB: show **"Reveal key ready on this device"** (green).
- Keyfile missing: show **"Upload your saved Reveal Keyfile to unlock Reveal button"**
  and keep the Reveal button disabled until a valid keyfile is uploaded.

## 4. Evidence Comparison Split-View

Two-column layout:

- **Left:** Customer Claim & Evidence.
- **Right:** Merchant Counter-Evidence & Policy Version.

Before voting, a **conflict-of-interest self-check prompt** asks the arbitrator to confirm
no relationship with either party. A one-click **`Recuse Myself`** escape hatch is always
available and immediately exits the voting flow.

### Responsive behavior

- Desktop: side-by-side columns.
- Tablet: columns narrow, evidence cards stack within each column.
- Narrow/mobile: single column, customer evidence first, merchant evidence second, with
  a sticky toggle to switch sides.

## 5. Edge Cases & Invariants

- Missing salt on a fresh browser session: reveal is locked until a keyfile is uploaded;
  the recovery flow is reachable from the reveal phase.
- Commit and reveal are visually and textually distinct at all times.
- Recusal is always one click away and never blocked by the salt checkpoint.
- Countdowns reflect server deadlines; expired phases disable their primary action.

## 6. Acceptance Criteria

- [ ] End-to-end flow covers evidence review, recusal, salt backup, commit confirmation,
      calendar reminder, keyfile recovery, and reveal confirmation.
- [ ] Missing-salt recovery works across a simulated fresh browser session.
- [ ] Split-view adapts cleanly to tablet and narrow screens.
