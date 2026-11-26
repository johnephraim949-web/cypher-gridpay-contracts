# Subscriptions, Metered Billing, Dunning & Streaming Micro-Payments — Developer Guide

This guide explains how to model and integrate the recurring billing primitives exposed by the Cypher GridPay `Payment` contract: fixed-interval subscriptions, trial conversion, metered (usage-based) billing with smart-meter ingestion, automated dunning retries, and real-time `StreamingChannel` kWh micro-payments.

> All amounts are `i128` token base units. All timestamps are ledger timestamps (seconds).

---

## 1. Architecture Overview

Recurring billing is **pull-based**: the contract never schedules itself. Off-chain **crank / keeper** services observe subscription state and call the contract at the right time. The contract enforces all invariants (allowances, caps, dunning policy) so a misbehaving crank cannot over-charge a customer.

```
                 ┌──────────────────────────────────────────────┐
                 │            Off-chain Keeper / Crank           │
                 │  (cron: every N seconds, per subscription)    │
                 └───────┬───────────────┬──────────────┬────────┘
                         │               │              │
        due? ────────────┘   trial end?  │   dunning?   │   usage batch?
                         │               │              │
                         ▼               ▼              ▼
              ┌──────────────────────────────────────────────────┐
              │              Payment Contract (Soroban)           │
              │  create_subscription / execute_metered_billing    │
              │  emit_trial_conversion_notice / retry_failed_...  │
              │  report_usage / resolve_dunning                   │
              └───────┬───────────────────────────────┬──────────┘
                      │ SEP-41 transfer_from           │ StreamingChannel
                      ▼                                ▼
              ┌───────────────┐                ┌──────────────────┐
              │ Customer token│                │  Per-second kWh  │
              │   allowance   │                │  accrual + close │
              └───────────────┘                └──────────────────┘
```

**Keeper loop (pseudocode):**

```
for sub in active_subscriptions:
    now = ledger_timestamp()
    if sub.trial_end > 0 and now >= sub.trial_end:
        emit_trial_conversion_notice(sub.id)      # pre-flight notice
        authorize_trial_conversion_amount(sub.id) # customer pre-authorizes
    if sub.metered and pending_usage(sub.id):
        execute_metered_billing(sub.id)
    elif now >= sub.next_billing_at:
        charge(sub.id)                            # pull via allowance
        if charge_failed: enter_dunning(sub.id)
    if in_dunning(sub.id) and now >= next_retry_at(sub.id):
        retry_failed_payment(sub.id)
```

---

## 2. Fixed-Interval Subscriptions

### Lifecycle

```
create_subscription ──► Active ──pause──► Paused ──resume──► Active
                          │                                     │
                          └──────────── cancel ────────────────┘
                                        ▼
                                    Cancelled
```

### Functions

| Function | Description |
| --- | --- |
| `create_subscription(customer, merchant, amount, token, interval, ...)` | Create a recurring pull. Requires a SEP-41 allowance from `customer` to the contract sized for at least one interval. |
| `pause_subscription(subscription_id)` | Customer/merchant halts future pulls. No charge occurs while paused. |
| `resume_subscription(subscription_id)` | Re-activates a paused subscription; the next billing timestamp is recomputed from resume time. |
| `cancel_subscription(subscription_id)` | Terminal state. No further pulls; already-settled cycles are not refunded. |

### SDK example

```ts
// 1. Size the allowance for N cycles up front (see §6).
await token.approve(customer, contractId, amountPerCycle * BigInt(cycles), expiryLedger);

// 2. Create the subscription.
const subId = await payment.create_subscription({
  customer, merchant, amount: amountPerCycle, token, interval: 30 * 24 * 3600,
});

// 3. Pause / resume / cancel.
await payment.pause_subscription({ subscription_id: subId });
await payment.resume_subscription({ subscription_id: subId });
await payment.cancel_subscription({ subscription_id: subId });
```

---

## 3. Trial Conversion Workflow

Trials let a customer evaluate a plan before the first real pull. Conversion is a **two-step, pre-flight** flow so the customer is never surprised by a charge.

```
create_subscription(trial=true)
        │
        ▼
   Trial active ──extend_trial──► Trial extended
        │
        │ trial_end reached
        ▼
 emit_trial_conversion_notice   (event: amount + conversion timestamp)
        │
        ▼
 authorize_trial_conversion_amount  (customer signs allowance for first cycle)
        │
        ▼
   First billing cycle begins
```

| Function | Description |
| --- | --- |
| `extend_trial(subscription_id, new_trial_end)` | Merchant/admin extends the trial window. |
| `emit_trial_conversion_notice(subscription_id)` | Emits a notice event with the upcoming conversion amount so the customer can top up / approve. |
| `authorize_trial_conversion_amount(subscription_id)` | Customer authorizes the exact first-cycle amount; conversion proceeds only after this. |

```ts
await payment.extend_trial({ subscription_id: subId, new_trial_end: now + 7 * 86400 });
// Keeper emits the notice at trial_end:
await payment.emit_trial_conversion_notice({ subscription_id: subId });
// Customer (or their wallet) authorizes the first cycle:
await payment.authorize_trial_conversion_amount({ subscription_id: subId });
```

---

## 4. Metered Billing & Smart-Meter Ingestion

Metered subscriptions bill per reported unit (e.g. kWh). Usage is reported in **signed batches** by an authorized smart-meter reporter, then settled by a keeper.

### Functions

| Function | Description |
| --- | --- |
| `create_metered_subscription(customer, merchant, price_per_unit, token, ...)` | Create a usage-based subscription. |
| `report_usage(subscription_id, units, signature, ...)` | Ingest a signed usage batch from a smart meter. Rejects unsigned / replayed batches. |
| `set_billing_cap(subscription_id, cap, mode)` | Set a **soft** cap (warn, allow overage) or **hard** cap (reject usage beyond cap). |
| `execute_metered_billing(subscription_id)` | Settle accumulated usage into a charge, respecting the cap. |

### Signed batch usage format

Each batch is signed by the meter's registered key over a canonical payload:

```
payload = sha256(
  subscription_id (u64 BE) ||
  meter_id        (32 bytes) ||
  period_start    (u64 BE) ||
  period_end      (u64 BE) ||
  units           (i128 BE) ||
  nonce           (u64 BE)
)
signature = ed25519_sign(meter_key, payload)
```

**End-to-end example:**

```json
{
  "subscription_id": 42,
  "meter_id": "0x9f2c...a1",
  "period_start": 1735689600,
  "period_end": 1735693200,
  "units": 12,
  "nonce": 7,
  "signature": "0xdeadbeef..."
}
```

```ts
// Meter submits a batch:
await payment.report_usage({
  subscription_id: 42, units: 12, period_start, period_end, nonce: 7, signature,
});
// Keeper settles:
await payment.execute_metered_billing({ subscription_id: 42 });
```

### Billing caps

- **Soft cap** — usage beyond the cap is recorded and billed, but a warning event is emitted.
- **Hard cap** — `report_usage` rejects batches that would push cumulative usage beyond the cap.
- Cap arithmetic uses checked `i128` math; overflow panics rather than wrapping (see §6).

---

## 5. Dunning Lifecycle

When a pull fails (insufficient balance / allowance), the subscription enters **dunning**: a bounded retry schedule with backoff.

```
charge fails
     │
     ▼
  Dunning ──retry_failed_payment──► success ──► Active
     │  ▲
     │  └── retry (backoff) ──┐
     │                        │
     └── max retries ──► resolve_dunning (write-off / cancel)
```

| Function | Description |
| --- | --- |
| `set_dunning_config(subscription_id, max_retries, backoff, grace)` | Configure retry policy. |
| `get_dunning_state(subscription_id)` | Returns current attempt count, next retry timestamp, and status. |
| `retry_failed_payment(subscription_id)` | Keeper attempts a re-pull. On success the subscription returns to `Active`. |
| `resolve_dunning(subscription_id, resolution)` | Terminal resolution: write off the cycle or cancel the subscription. |

```ts
await payment.set_dunning_config({ subscription_id: subId, max_retries: 3, backoff: 86400, grace: 172800 });
const state = await payment.get_dunning_state({ subscription_id: subId });
if (state.next_retry_at <= now) await payment.retry_failed_payment({ subscription_id: subId });
// After max retries:
await payment.resolve_dunning({ subscription_id: subId, resolution: 'cancel' });
```

---

## 6. Streaming Micro-Payment Channels (`channels.rs`)

`StreamingChannel` settles **per-second kWh** micro-payments continuously between a payer and payee, with only the final balance settled on-chain.

```
open channel ──► accruing (rate * elapsed) ──► close / dispute ──► settle on-chain
```

- Accrual is `rate_per_second * (now - last_settled)`; the channel is bounded by `start` and `stop` timestamps.
- Off-chain parties exchange signed state updates; either party can submit the latest signed state to close.
- **Dispute closing:** if the counterparty submits a stale state, the other party submits a newer signed state within the dispute window to win settlement.

```ts
const ch = await payment.open_streaming_channel({ payee, token, rate_per_second, start, stop });
// Off-chain: exchange signed cumulative-amount states.
await payment.close_streaming_channel({ channel_id: ch, signed_state: latestSignedState });
```

---

## 7. Edge Cases, Security & Operational Invariants

### Clock drift

Keepers must tolerate ledger clock drift. Use a small tolerance window (e.g. ±30s) when deciding whether a cycle is due; the contract itself uses ledger timestamps and is authoritative. Never rely on wall-clock time for settlement decisions.

### SEP-41 allowance sizing

Recurring pulls use `transfer_from`, so the customer must maintain an allowance ≥ the next pull. Size the allowance for **N cycles** and refresh before expiry:

```
allowance >= amount_per_cycle * cycles_remaining
```

If the allowance is exhausted, the pull fails and the subscription enters dunning.

### Billing-cap overflow protection

All cap and cumulative-usage arithmetic uses checked `i128` operations. A batch that would overflow panics rather than wrapping, protecting against maliciously large `units` values.

### Proration math

When a subscription starts, resumes, or changes mid-cycle, the charge is prorated:

```
prorated = amount_per_cycle * active_seconds / interval_seconds
```

Integer division truncates in the customer's favor.

### Insufficient balance during a cycle

If the customer's token balance or allowance is insufficient at pull time, the charge fails and the subscription transitions to **dunning** (§5). No partial charge is taken; the cycle is retried per the dunning policy until resolved.

---

## See also

- [Escrow Lifecycle Guide](./ESCROW_LIFECYCLE_GUIDE.md)
- [Refund & Arbitration Guide](./REFUND_AND_ARBITRATION_GUIDE.md)
- [Payment Contract README](../core/contracts/payment/README.md)
