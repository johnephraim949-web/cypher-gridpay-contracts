# Subscription lifecycle UX (trial, metered caps, dunning)

Plain CSS only. No Tailwind, CSS-in-JS, or utility frameworks. Shared styles live in
`apps/web/src/styles/subscriptions.css`.

## States

| State | `data-state` | Trigger | Required copy | Visual treatment |
| --- | --- | --- | --- | --- |
| Active | `active` | subscription is current | "Subscription active" | neutral border, blue action |
| Trial ending | `trial-ending` | trial expires within 7 days | "Trial ending soon" + days + conversion amount | amber border, confirm-conversion action |
| Metered near cap | `metered-near-cap` | usage >= 80% of hard cap | "Approaching hard cap" + used/cap | amber alert + progress bar |
| Metered capped | `metered-capped` | usage >= hard cap | "Hard cap reached — usage is blocked." | red alert, no report action |
| Dunning retry 1..N | `dunning-retry-<n>` | charge failed, retry window open | "Payment failed — retry n of N" + amount due + next retry | amber/red alert, freshness-gated retry |
| Paused | `paused` | merchant paused billing | "Subscription paused" | grey border, resume action |
| Cancelled | `cancelled` | terminal cancellation | "No further charges will be made." | red border, optional reactivate action |

`SubscriptionLifecycleCard` renders every state and exposes `data-subscription-id`,
`data-state`, and stable test IDs (`lifecycle-retry-button`, `lifecycle-resume-button`,
`lifecycle-reactivate-button`).

## Dunning retry invariants

1. `get_dunning_state` is fetched immediately before transaction construction. A cached
   state is never sufficient for a retry.
2. The retry button is disabled until `now >= next_retry_at` using the current ledger
   timestamp (not the browser clock).
3. On confirmation the state is fetched once more; if dunning ended, show a neutral
   "no longer in dunning" message and do not submit.
4. Errors are decoded through `decodeGridPayError`; both the message and the recovery
   hint are shown. Recovery hints must never display secrets or raw transaction blobs.
5. After submission, refresh state again so retry counters and eligibility stay correct.

## Metered caps

- Soft cap at 80%: show the amber near-cap alert and progress bar.
- Hard cap at 100%: show the red capped alert; further `report_usage` is rejected by the
  contract and the UI must not present a misleading submit action.
- The projected invoice is `currentUsage * unitPrice`; cap edits require confirmation and
  a fresh usage read before the mutation.

## Accessibility

- Alerts use `role="alert"`; success messages use `role="status"`.
- The cap meter is a `progressbar` with `aria-valuenow`, `aria-valuemin`, `aria-valuemax`.
- Colors are never the only signal; every state includes a text heading and explanation.
