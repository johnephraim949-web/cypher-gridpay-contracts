# Escrow Lifecycle Timeline & Multi-Party Quorum — UX Spec

This document specifies the interactive escrow state-machine timeline, the
multi-party weighted quorum visualization, and the vesting/milestone curve
visualizer. It covers standard, multi-party weighted, multi-token, and
vesting-milestone escrows.

## 1. Lifecycle Timeline

A horizontal timeline on desktop (`>= 640px`) that collapses into a vertical
accordion on narrow screens (`< 640px`).

### Phases

| Phase | Source field | Plain-language meaning |
|-------|--------------|------------------------|
| Hold Period | `hold_period_until` | Funds are held and cannot be released yet. |
| Timelock Release | `release_timestamp` | Earliest moment the release can execute. |
| Expiry Deadline | `expiry_timestamp` | After this, the escrow expires and can be refunded. |
| Vesting Cliff | `cliff_timestamp` | No tokens vest before this date. |
| Quorum | `threshold_bps` | Share of signer weight required to approve. |

### Visual states

- **Completed** milestones: solid marker, timestamp, and tx link.
- **Current** phase: pulsing/highlighted marker.
- **Upcoming** gates: outlined marker with countdown.

Each marker exposes a hover/inline tooltip with the plain-language explanation
above so users never confuse hold period, timelock, and expiry.

## 2. Multi-Party Weighted Quorum

### Segmented threshold bar

- A single horizontal bar split into color-coded segments per signer weight:
  `Approved` (green), `Pending` (amber), `Rejected` (red).
- A vertical marker at `threshold_bps` (e.g. `66.67%`) shows the exact approval
  threshold. Approved weight crossing the marker flips the escrow to releasable.

### Participant roster

| Column | Description |
|--------|-------------|
| Role | `Buyer`, `Seller`, `Co-Signer`, `Observer` |
| Weight | Voting weight (bps) |
| Status | Approved / Pending / Rejected |
| Signed at | Signature timestamp |

Observers carry zero weight and never affect the threshold.

## 3. Vesting & Milestone Curve

- Continuous vested accrual line from start to end.
- Cliff date marked as a vertical gate; nothing vests before it.
- Discrete milestone deliverable checkpoints plotted on the curve.
- Clickable breakdown toggling **Claimable Now** vs **Locked** amounts.

## 4. Anomalous States

These overlays take visual precedence over the normal timeline:

- **Disputed / Frozen**: full lock overlay, timeline dimmed.
- **Pending Beneficiary Transfer**: banner above the timeline.
- **Clawback Requested**: countdown banner with remaining time.
- **Collateral Health Factor**: warning zone when the health factor drops
  below the safe threshold.

## 5. Responsive Behavior

- Desktop: horizontal timeline, side-by-side quorum bar and roster.
- Mobile (`< 640px`): vertical accordion timeline, stacked quorum bar and
  roster, collapsible vesting breakdown.
