# Notification Choreography & Activity Feed UX

This document defines how on-chain events are surfaced to users through toasts and the Notification Center drawer. On-chain apps emit bursts of events (batch settlements, multi-party escrow releases), so choreography must stay calm, readable, and never obscure critical navigation.

## 1. Toast Choreography

### Queueing & Burst Collapsing
- **Max 3 visible toasts** at any time. Additional toasts queue.
- **Burst collapsing:** when more than 3 events arrive within a 2-second window, they collapse into a single smart summary toast, e.g.:
  > 5 payments settled in Ledger #54,102,411 — View all
- The summary toast links to the Notification Center filtered to the relevant category.
- Individual events in a collapsed burst are still recorded in the Notification Center.

### Duration Rules
- **Success** toasts auto-dismiss after **6s**.
- The dismiss timer **pauses on hover and on keyboard focus** within the toast, and resumes on leave/blur.
- **Error** and **Action Required** toasts **persist until explicitly dismissed**.
- Every toast includes a **keyboard-accessible Close button** (`<button>` with an accessible label).

### Placement
- **Desktop (`>= 768px`):** bottom-right.
- **Mobile (`< 768px`):** top-center, below the header.
- Placement must never cover bottom navigation tabs or checkout CTA buttons.

### Accessibility
- Do **not** use `role="alert"` on low-priority informational toasts; screen readers should not be interrupted mid-sentence. Reserve assertive announcements for errors and action-required items.
- Close buttons are reachable via keyboard and have discernible names.

## 2. Notification Center Drawer

- Categorized filters: **All**, **Action Required**, **Disputes**, **Settlements**.
- **Unread dot indicators** per item.
- **Mark all as read** action.
- **Granular per-event notification preference toggles** (e.g. settlements, disputes, multisig requests).

### Pinned Action-Required Items
Action Required notifications pin to the top of the drawer until resolved:
- Dispute Appeal Deadline Approaching
- Arbitrator Reveal Window Open
- Multisig Signature Requested

### Focus Management
- Opening the drawer moves focus into it; closing returns focus to the trigger.
- The drawer is dismissible via Escape and a keyboard-accessible close button.

## 3. Verification
- Automated tests verify burst-collapsing behavior (events within 2s collapse into a summary).
- Automated tests verify the success timer pauses on hover/focus and resumes on leave/blur.
