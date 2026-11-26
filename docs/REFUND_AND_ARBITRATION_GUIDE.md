# Refund & Arbitration Guide

Authoritative handbook for merchants, customers, and arbitrators interacting with the `Refund` contract (`core/contracts/refund`). It covers refund policy governance, reason codes, the merchant/customer dispute flow, arbitrator onboarding and panel selection, commit-reveal voting, slashing economics, fee flows, and escalation to the court of final resort.

> Companion docs: [Refund contract README](../core/contracts/refund/README.md), [Escrow Lifecycle Guide](./ESCROW_LIFECYCLE_GUIDE.md).

---

## 1. Actors & Roles

| Role | Responsibility |
| --- | --- |
| **Merchant** | Publishes versioned refund policies, approves/denies refunds, may override a denial, registers auto-refund triggers. |
| **Customer** | Requests refunds (via merchant), files appeals, escalates to arbitration. |
| **Arbitrator** | Stakes collateral, votes on arbitration cases via commit-reveal, may recuse. |
| **Admin** | Registers arbitrators, sets fee/stake/timeout configs, resolves supreme disputes. |
| **Orchestrator / AdminContract** | Court of final resort for escalated appeals. |

---

## 2. Refund Policy Governance

Policies are **versioned** and **time-addressable**. Every `set_refund_policy` call creates a new version; historical versions remain queryable.

### 2.1 Policy lifecycle

```
Merchant ──set_refund_policy()──▶ Policy vN (active)
                                     │
              get_refund_policy_at_time(ts) ──▶ version in effect at ts
              get_refund_policy_version(v)  ──▶ exact version v
              get_refund_policy_history()   ──▶ [v1, v2, ... vN]
```

- `get_refund_policy()` returns the currently active policy.
- `get_refund_policy_at_time(merchant, timestamp)` resolves the version that was in effect at `timestamp` — **always** use this when adjudicating a historical refund so the policy cannot be retroactively changed.
- `get_effective_refund_policy()` traverses the inheritance chain (merchant → template → global default).
- `deactivate_refund_policy()` lets a merchant retire their policy; the global default then applies.

### 2.2 Templates & defaults

- `create_policy_template()` / `apply_template_to_merchant()` — admins publish reusable templates.
- `set_default_refund_policy()` / `remove_default_refund_policy()` — global fallback.
- `set_requires_admin_approval()` — merchant opts into admin co-sign for policy changes.

---

## 3. Refund Eligibility & Reason Codes

### 3.1 Eligibility check

Before a refund can be requested, `can_refund_payment(payment_id)` must return `true`. It validates:

1. The payment exists and is in a refundable state.
2. The refund window (from the policy in effect at payment time) has not elapsed.
3. No prior refund already consumed the payment.
4. Merchant quota and customer rate limits are not exceeded.

### 3.2 `RefundReasonCode` taxonomy

| Variant | Meaning |
| --- | --- |
| `ProductDefect` | Item/service defective or not as described. |
| `NonDelivery` | Goods/services not received. |
| `DuplicateCharge` | Accidental double billing. |
| `Unauthorized` | Charge made without consent (fraud). |
| `CustomerRequest` | Buyer's remorse / voluntary return. |
| `Other` | Fallback / legacy. |

Reason codes drive `get_reason_code_analytics()` and may gate auto-refund triggers.

### 3.3 Sequence — request eligibility

```
Customer        Merchant         Refund Contract
   │               │                   │
   │  request      │                   │
   │──────────────▶│                   │
   │               │ can_refund_payment│
   │               │──────────────────▶│
   │               │   true/false      │
   │               │◀──────────────────│
   │               │ get_refund_policy_at_time(payment_ts)
   │               │──────────────────▶│
   │               │   policy version  │
   │               │◀──────────────────│
   │               │ request_refund(reason_code)
   │               │──────────────────▶│  state = Requested
```

---

## 4. Merchant Decision, Override, Cooling-Off & Appeal

### 4.1 Approval / denial

- `approve_refund()` → `Requested → Approved`.
- `reject_refund()` → `Requested → PendingAppeal` (starts the appeal window).
- `finalize_denial()` — callable after the appeal window expires; locks the denial.
- `process_refund()` — executes an approved refund, deducting platform fees (see §8).

### 4.2 Merchant override

`merchant_override_denial()` lets a merchant reverse a prior denial **before** the appeal window closes, moving the refund back to `Approved`. This is the merchant's last chance to avoid arbitration.

### 4.3 Cooling-off period

After a denial, a **cooling-off / appeal window** (configured at `initialize`) must elapse before `finalize_denial()` succeeds. During this window the customer may `file_appeal()`.

### 4.4 Customer appeal

`file_appeal(refund_id, evidence)` creates an appeal record (`get_appeal`, `get_appeals_by_customer`). An admin resolves it via `resolve_appeal()` (uphold or deny). If the customer is unsatisfied, they may escalate to arbitration.

### 4.5 Sequence — denial, override, appeal

```
Merchant          Refund Contract            Customer
   │                    │                       │
   │ reject_refund()    │                       │
   │───────────────────▶│ PendingAppeal         │
   │                    │──── appeal window ───▶│
   │ merchant_override_denial() (optional)      │
   │───────────────────▶│ Approved              │
   │                    │                       │
   │                    │◀──── file_appeal() ───│
   │                    │ Appeal filed          │
   │                    │◀──── resolve_appeal()─│ (admin)
   │                    │                       │
   │                    │◀ escalate_to_arbitration()
```

---

## 5. Arbitration

### 5.1 Arbitrator onboarding

1. `register_arbitrator(arbitrator)` — admin adds the arbitrator.
2. `deposit_arbitrator_stake(arbitrator, amount)` — arbitrator locks collateral per `get_arbitration_stake_config()`. Staking is **required** before voting; slashing draws from this stake.

### 5.2 Panel selection

When a case is opened (`escalate_to_arbitration`), the contract selects a panel weighted by reputation (Wilson score, see §6). `assign_arbitrator()` allows admin manual assignment. Tiered escalation (`escalate_arbitration_case`) promotes a case from a junior to a senior panel (`add_senior_arbitrator`, `set_arbitration_tier_config`).

### 5.3 Recusal

`recuse_arbitrator(case_id)` removes an arbitrator from a panel (conflict of interest). A substitute is drawn from the eligible pool; recusal is recorded for reputation purposes.

### 5.4 Commit-reveal voting

Voting is two-phase to prevent copying:

1. **Commit** — `commit_vote(case_id, commit_hash)` where `commit_hash = SHA256(preimage)` (see §7).
2. **Reveal** — `reveal_vote(case_id, vote, nonce)`; the contract recomputes the hash and compares.

`close_arbitration_case()` finalizes once quorum is reached.

### 5.5 Timeout substitution

If a case exceeds `get_arbitration_timeout_config()`, `trigger_arbitration_timeout()` fires. Non-responding arbitrators are substituted and slashed (see §9).

### 5.6 Sequence — full arbitration

```
Arbitrator        Refund Contract              Admin
   │                    │                       │
   │ register_arbitrator│◀──────────────────────│
   │ deposit_arbitrator_stake()                 │
   │───────────────────▶│ stake locked          │
   │                    │◀ escalate_to_arbitration()
   │                    │ panel selected        │
   │ recuse_arbitrator()│ (optional)            │
   │───────────────────▶│ substitute drawn      │
   │ commit_vote(hash)  │                       │
   │───────────────────▶│ commit stored         │
   │ reveal_vote(v,n)   │                       │
   │───────────────────▶│ hash verified         │
   │                    │ close_arbitration_case()
   │                    │ reputation updated    │
```

---

## 6. Reputation

Arbitrator reputation uses a **Wilson score** with **inactivity decay**. `get_arbitrator_reputation()` returns the current score; `get_top_arbitrators()` ranks by score. `deregister_low_performers()` removes arbitrators below a minimum. Coherent majority votes raise the score; minority/incoherent votes lower it.

---

## 7. Commit-Reveal XDR Preimage Hash Specification

Third-party wallets and SDKs **must** produce identical commit hashes. The preimage is the XDR serialization of a tuple:

```
preimage = XDR( (case_id: u64, vote: u32, nonce: BytesN<32>) )
commit_hash = SHA256(preimage)
```

- `case_id` — `u64` big-endian.
- `vote` — `u32` big-endian (`0` = uphold refund, `1` = deny).
- `nonce` — 32 random bytes chosen by the arbitrator.

### 7.1 Concrete test vector

```
case_id = 1
vote    = 0
nonce   = 0x0000000000000000000000000000000000000000000000000000000000000000

preimage (hex) = 0000000000000001 00000000 0000000000000000000000000000000000000000000000000000000000000000
commit_hash    = SHA256(preimage)
```

This vector is asserted in both `sdk/python` and the Rust contract tests; any SDK producing a different hash for this input is non-conformant.

---

## 8. Fee Flows

- `calculate_net_refund()` — gross refund minus platform fee.
- **Arbitration fees** — configured via `set_arbitration_fee_config()`; distributed to panel members on case close.
- **Protocol fee sweep** — accumulated treasury fees (`get_accumulated_arbitration_fees()`) are withdrawn by admin via `withdraw_treasury_fees()`.

```
refund amount ──▶ calculate_net_refund() ──▶ customer
                        │
                        └── platform fee ──▶ treasury
arbitration fee ──▶ panel members
```

---

## 9. Slashing Conditions

Arbitrators must understand economic risk **before** staking:

| Trigger | Consequence |
| --- | --- |
| Non-response past `ArbitrationTimedOut` | Stake slashed; arbitrator substituted. |
| Revealed vote ≠ committed hash | Stake slashed; vote discarded. |
| Fraudulent / incoherent minority vote | Partial slash + reputation penalty. |
| Deregistered for low performance | Stake returned minus penalties. |

---

## 10. Supreme Escalation

When arbitration is exhausted or contested, `escalate_appeal_to_orchestrator()` forwards the case to the orchestrator, which calls `AdminContract::resolve_supreme_dispute()`. The supreme ruling is final and binding.

```
Customer ──escalate_appeal_to_orchestrator()──▶ Orchestrator
                                                    │
                          AdminContract::resolve_supreme_dispute()
                                                    │
                                              final ruling
```

---

## 11. Operational Invariants

- Historical policies are immutable; always adjudicate with `get_refund_policy_at_time`.
- An arbitrator cannot vote without a locked stake.
- Commit hashes are verified on reveal; mismatches are slashed.
- Timeouts always substitute and slash non-responders.
- Supreme rulings are terminal.
