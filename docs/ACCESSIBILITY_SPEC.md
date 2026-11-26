# Accessibility Architecture Specification (WCAG 2.1 AA)

This document defines the accessibility blueprint for the payment infrastructure UI. It covers navigation, focus management, live announcements, focus visibility, reduced motion, and the mandatory keyboard-only test script.

## 1. Navigation & Structure

### Skip-to-content
Every page MUST render a skip link as the first focusable element:

```tsx
<a href="#main-content" className="skip-link">Skip to main content</a>
```

The link is visually hidden until focused, then becomes visible with the standard focus ring. The target `#main-content` MUST be the `<main>` landmark and receive `tabIndex={-1}` so focus can move to it.

### Heading hierarchy
- Exactly one `h1` per page (the page title).
- Sections use `h2`, subsections `h3`, and detail groupings `h4`.
- Never skip levels (no `h1` → `h3`).
- Headings MUST describe content, not styling.

### ARIA landmarks
- `<header role="banner">` — global site header.
- `<nav role="navigation" aria-label="Primary">` — primary navigation (label each nav when multiple exist).
- `<main role="main" id="main-content">` — primary content, one per page.
- `<aside role="complementary" aria-label="...">` — secondary content (e.g. ledger sidebar, help panel).

## 2. Focus-Trapping Modal / Drawer Pattern

All modals and drawers MUST use the shared `FocusTrapDialog` primitive.

- On open: move focus to the first focusable element (or the dialog container with `tabIndex={-1}`).
- While open: `Tab`/`Shift+Tab` cycle within the dialog; focus never escapes to the page behind.
- On close: return focus deterministically to the element that triggered the dialog (store the trigger ref before opening).
- `Escape` dismisses the dialog — EXCEPT during active un-cancellable signing states (e.g. a wallet signature request in flight). In those states `Escape` is ignored and the dialog exposes `aria-busy="true"`.
- The dialog uses `role="dialog"` `aria-modal="true"` and is labelled via `aria-labelledby` / `aria-describedby`.

### Wallet extension edge case
When a browser extension (Freighter/xBull) opens an external window and closes it, the signing dialog MUST retain focus. Do not move focus on `window.blur`/`focus` events; only restore focus to the trigger after the dialog actually closes. If the extension steals focus, re-focus the dialog container on `window.focus` while the signing state is active.

## 3. Live Announcements

Use the shared `LiveAnnouncer` primitive.

- `aria-live="assertive"` (`role="alert"`): transaction errors, emergency pauses, and other time-critical failures.
- `aria-live="polite"` (`role="status"`): ledger confirmations, toast notifications, and non-critical status updates.

Announcers are visually hidden but present in the DOM at all times so assistive technology observes region changes.

## 4. Focus Visibility

- All interactive elements MUST show a `:focus-visible` ring: `outline: 2px solid currentColor; outline-offset: 2px;`.
- Rings MUST NOT be clipped by `overflow: hidden` containers. Add padding or use `outline` (which is not clipped by overflow) rather than `box-shadow` inside clipped containers.
- Never remove outlines without providing an equivalent visible focus indicator.

## 5. Reduced Motion

When `prefers-reduced-motion: reduce` is active:
- Disable streaming counter animations (e.g. `LedgerCountdown` renders static values).
- Disable chart transitions and any auto-playing motion.
- Provide a static fallback for all animated status indicators.

## 6. Touch Targets

All interactive controls MUST be at least `44x44px` on mobile viewports. Use `min-height: 44px; min-width: 44px;` on buttons, links, and icon controls.

## 7. Mandatory Keyboard-Only Test Script

Perform each flow using only the keyboard (no mouse/trackpad).

### Checkout
1. `Tab` to the skip link, press `Enter`, confirm focus lands on `main`.
2. `Tab` through cart items and quantity controls; adjust with arrow keys / `Enter`.
3. Activate "Pay" with `Enter`; confirm the signing dialog traps focus.
4. Press `Escape` during signing — confirm it is ignored while signing is active.
5. After signing completes, confirm focus returns to the "Pay" trigger.
6. Confirm success is announced via the polite live region.

### Dispute Filing
1. Navigate to the dispute form via keyboard only.
2. Submit with empty required fields; confirm errors are announced assertively and focus moves to the first invalid field.
3. Complete the form and submit; confirm the confirmation is announced politely.

### Arbitrator Voting
1. Reach the voting table via keyboard; use arrow keys to move between rows.
2. Select a vote option with `Space`/`Enter`.
3. Confirm the vote dialog traps focus and returns focus to the triggering row on close.
4. Confirm the vote result is announced via the polite live region.

## 8. Verification

- `@axe-core/playwright` and Storybook `addon-a11y` MUST report 0 critical/serious violations.
- VoiceOver / NVDA testing confirms form errors, live ledger updates, and status badges are announced meaningfully.
