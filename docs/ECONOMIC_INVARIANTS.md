# Formal Economic Invariants & Balance Conservation

This specification formally establishes the financial and economic invariants governing the Cypher GridPay smart contract protocol across the `core` (Payment, Escrow, Refund) and `orchestrator` workspaces.

---

## 📐 Primary Protocol Invariant: Balance Conservation

The foundational economic law of Cypher GridPay is strict conservation of value across all on-chain operations. Under no circumstances may tokens held by the protocol contracts exceed or fall short of active liabilities:

$$\text{Total Locked Contract Tokens} = \sum \text{Active Escrows} + \sum \text{Pending Settlements} + \sum \text{Merchant Accumulated Balances} + \text{Accumulated Protocol Fees}$$

### Mathematical Definition

For any supported token contract $T$:

$$\mathcal{B}_{\text{contract}}(T) = \sum_{e \in \mathcal{E}_{\text{active}}} \text{amount}(e) + \sum_{s \in \mathcal{S}_{\text{pending}}} \text{amount}(s) + \sum_{m \in \mathcal{M}} \text{accumulated}(m, T) + \mathcal{F}_{\text{accumulated}}(T)$$

Where:
- $\mathcal{B}_{\text{contract}}(T)$: Token balance held at `env.current_contract_address()` for token $T$.
- $\mathcal{E}_{\text{active}}$: The set of all escrows where $\text{status} \in \{\text{Locked}, \text{Disputed}\}$.
- $\mathcal{S}_{\text{pending}}$: The set of all settlements currently within the finality delay window.
- $\mathcal{M}$: The set of all registered merchants with deferred payout schedules.
- $\mathcal{F}_{\text{accumulated}}(T)$: Protocol fees collected from completed transactions that have not yet been swept via `sweep_fees`.

---

## 🛡️ Secondary Invariants

### 1. Solvency Invariant (No Deficit)
No contract operation (release, refund, payout, or fee sweep) may execute if the resulting contract balance would drop below the sum of remaining liabilities:
$$\forall t, \quad \mathcal{B}_{\text{contract}}(t) \ge \text{Total Unresolved Liabilities}(t)$$

### 2. No-Leakage & Non-Inflation Invariant
Tokens can only enter contract custody via explicit customer deposits or authorized payment transfers:
$$\Delta \mathcal{B}_{\text{contract}} = \text{Deposits} - \text{Disbursements}$$
No function creates, mints, or burns external tokens internally.

### 3. Non-Negative State Invariant
All quantitative accounting values in storage must be non-negative:
$$\forall e, \quad \text{amount}(e) \ge 0$$
$$\forall m, \quad \text{accumulated}(m) \ge 0$$
$$\mathcal{F}_{\text{accumulated}} \ge 0$$

### 4. Fee Sweep Upper Bound
Fee sweeps are strictly bounded by verified accumulated protocol revenue:
$$\text{sweep\_amount} \le \mathcal{F}_{\text{accumulated}}$$
Fee sweeps cannot draw from active escrow reserves or pending customer/merchant settlements.

### 5. Escrow State Invariance
An escrow transitioned to a terminal status ($\text{Released}, \text{Resolved}, \text{Cancelled}, \text{Refunded}$) is strictly immutable and cannot be re-entered or disbursed again:
$$\text{TerminalStatus}(e) \implies \Delta \text{amount}(e) = 0$$

---

## 🧪 Invariant Verification in Contract Testing

The test suites enforce these invariants through explicit balance conservation assertions across all lifecycle stages:

```rust
/// Formal invariant verification asserting token conservation across payment settlement.
pub fn assert_protocol_balance_conservation(
    env: &Env,
    token: &Address,
    expected_liabilities: i128,
) {
    let token_client = token::Client::new(env, token);
    let contract_balance = token_client.balance(&env.current_contract_address());
    assert_eq!(
        contract_balance, expected_liabilities,
        "Invariant violation: contract balance does not match total protocol liabilities"
    );
}
```

---

# Part II: Formal Arithmetic Specification and Proofs

This part was derived by reading the contract code (`core/contracts/payment`, `core/contracts/escrow`, `core/contracts/refund`). It states what the code **does**, proves the properties that follow from it, and flags properties that do **not** hold or are **not enforced**. It does not claim any property that was not traced to code. Nothing here was executed or machine-checked.

## 0. Conventions and assumptions

- All amounts are `i128` (smallest token unit). $I = 2^{127}-1$. Basis-point denominators are $B = 10^4$.
- $\lfloor x \rfloor$ and $\lceil x \rceil$ denote mathematical floor and ceiling. Rust integer division on non-negative operands equals $\lfloor \cdot \rfloor$. All division operands below are non-negative unless stated.
- **Helpers.** `fixed_math::mul_div_floor(a,b,d)` $=\lfloor ab/d \rfloor$ and `mul_div_ceil(a,b,d)` $=\lceil ab/d \rceil$ compute $ab$ in 256 bits, so the intermediate product never overflows; they fail only for $a<0$, $b<0$, $d\le 0$ or a quotient above $I$. Raw expressions such as `(x * y) / 10000` in `i128` can overflow when $xy > I$ (Rust `overflow-checks` panics in the contract build; `saturating_mul` clamps instead, as noted per formula).
- **Rounding policy of the codebase** (stated in `fixed_math.rs`): `ceil` for inflows to the protocol (fees, collateral), `floor` for outflows to users (payouts, rebates). Section 7 lists every division and whether it follows this policy. There are deviations.
- **Standing assumptions** (not enforced by the contracts unless stated): the token is a standard SEP-41 token (no fee-on-transfer, no rebasing); basis-point parameters supplied by admins are $\le B$ where the code does not validate this (each such place is flagged); admins are not malicious.

## 1. Invariant index and test mapping

| ID | Statement (short) | Enforced by code | Test / evidence | Status |
| --- | --- | --- | --- | --- |
| INV-BAL-01 | Token conservation across tracked accounts | Transfers only move tokens; no mint/burn | `tests/e2e/tests/state_machine_fuzz.rs` (`check_invariants`: `total_balance() == MINT`, `payment_escrow_state_machine`) | Covered for create/complete/refund/escrow actions only |
| INV-BAL-02 | Contract balance $\ge$ tracked liabilities | By construction, with dust surplus (see 2.2, 5.2) | None directly | **Gap**: no test asserts the liability inequality; the helper `assert_protocol_balance_conservation` in Part I is an illustrative snippet |
| INV-PAY-01 | Fee is rounded up, bounded by clamps | `compute_fee_amount` | `test_fixed_math_prop.rs` (`floor_le_ceil_and_differ_by_at_most_one`, `fee_plus_payout_never_exceeds_inflow`, `matches_checked_i128_when_it_does_not_overflow`) cover only `mul_div_*` | Partial: `compute_fee_amount` itself and the clamp are untested by property |
| INV-PAY-02 | Split shares: $\sum s_i \le A$, remainder bounded | `create_split_payment`, `execute_split_settlement` | `test_split_payment.rs` (share-sum, recipient-count, double execution) | **Gap**: remainder is stranded, no property test |
| INV-PAY-03 | Rebate $\le$ fees collected | `maybe_accrue_fee_rebate`, `claim_fee_rebate` | `test_fee_rebate.rs` (property tests on local helper functions `calculate_fee` / `calculate_net_amount`, not on contract code) | **Gap**: no test of rebate accrual or claim |
| INV-PAY-04 | Fee sweep $\le$ accumulated fees | `sweep_fees` | `test_fee_sweep.rs` (`test_sweep_fees_rejects_excessive_amount`, `test_sweep_fees_partial_sweep_succeeds`), `test_fee_sweep_audit.rs` (`test_sweep_amount_never_exceeds_accumulated_fees`, `test_sweep_only_touches_accumulated_fees`) | Covered by unit tests |
| INV-ESC-01 | Vesting monotone, bounded by total | `get_base_vested_amount_at`, `compute_vested_amount_at` | `timelock_test.rs` (`test_vesting_cliff_boundary`, `test_vesting_linear_interpolation`, `test_mid_stream_revocation_splits_vested_and_unvested_balances`) are example tests | **Gap**: no property test of monotonicity |
| INV-ESC-02 | Released $\le$ vested | `release_vested_amount` | Same example tests | **Gap** (as above) |
| INV-REF-01 | Cumulative refunds $\le$ payment amount | `check_accumulated_refunds`, `can_refund_payment` | `test_payment_refund_cap.rs` (`test_accumulated_refunds_exact_boundary`, `test_accumulated_refunds_one_over_boundary`, `test_accumulated_refunds_counts_pending_and_releases_on_denial`) | Covered by unit tests; multi-currency and cross-contract not covered |
| INV-REF-02 | Refund fee split reconciles exactly | `split_net_refund`, `preview_net_refund` | No dedicated test located (`test_process.rs` / `test_refund_events.rs` were not checked for fee assertions) | Gap: no property test |
| INV-ARB-01 | Case fee pool never over-distributed; dust bounded | `close_arbitration_case` | `test_arbitration_fees.rs` (`test_fee_distribution_equal_split`, `_majority_only`, `_100_percent_treasury`) | Covered for examples; dust not asserted |
| INV-ARB-02 | Stake ledger matches transfers | `deposit_arbitrator_stake`, `slash_arbitrator_stake` | `test_arbitration_stake.rs` (`test_slash_arbitrator_stake_reduces_stake_and_pays_recipient`, `_rejects_amount_above_stake`) | Covered by unit tests |

## 2. Balance conservation and solvency

### 2.1 Token conservation (INV-BAL-01)

Every state transition moves tokens with `transfer` / `transfer_from` between addresses; no function mints or burns. Hence for the set $\mathcal{A}$ of all accounts that can hold token $T$,

$$\sum_{a \in \mathcal{A}} \text{balance}_T(a) = \text{const}.$$

`state_machine_fuzz.rs` checks this equality over five tracked addresses after each random action sequence (up to 40 steps).

### 2.2 Liability inequality (INV-BAL-02)

The equality in Part I,

$$\mathcal{B}_{\text{contract}}(T) = \sum \text{Escrows} + \sum \text{Pending} + \sum \text{Merchant balances} + \mathcal{F}_{\text{acc}}(T),$$

is an upper-level specification. The code supports the weaker, correct form

$$\mathcal{B}_{\text{contract}}(T) \;\ge\; \sum_{p \in \text{pending}} \text{amount}(p) + \sum_{e \in \text{locked}} \text{amount}(e) + \mathcal{F}_{\text{acc}}(T) + \mathcal{R}(T) + \mathcal{S}(T) + \mathcal{P}(T),$$

where $\mathcal{R}$ is unclaimed merchant rebate accrual (paid out of $\mathcal{F}_{\text{acc}}$ and therefore already included in it; listed for clarity only), $\mathcal{S}$ is arbitrator and case stakes held by the Refund contract, and $\mathcal{P}$ is open arbitration fee pools. The difference
$\mathcal{B} - (\text{liabilities})$ is the **stranded dust** $\delta \ge 0$ created by floor-division remainders (Sections 3.2 and 5.2). It is never negative on the paths analysed, but it is also not tracked or claimable. Part I's equality therefore holds exactly only when $\delta = 0$.

## 3. Fee and split arithmetic

### 3.1 Platform fee (INV-PAY-01)

Code: `PaymentContract::compute_fee_amount` and `deduct_fee`.

Let $a$ be the payment amount, $b_{\text{cfg}}$ = `FeeConfig.fee_bps`, $\rho$ the risk surcharge in bps (0 unless `RiskFeeConfig` is set), $d \in \{0, 750, 2000\}$ the tier discount in bps of the fee (Standard / Premium / Enterprise). `deduct_fee` first computes

$$b = \min(b_{\text{cfg}} + \rho,\; 1000), \qquad b' = b - \left\lfloor \frac{b\,d}{B} \right\rfloor, \qquad f_{\text{raw}} = \left\lceil \frac{a\,b'}{B} \right\rceil.$$

The fee is then clamped: $f = \text{min\_fee}$ if $\text{min\_fee} > 0 \wedge f_{\text{raw}} < \text{min\_fee}$; $f = \text{max\_fee}$ if $\text{max\_fee} > 0 \wedge f > \text{max\_fee}$; negative results become $0$. A fee waiver may then reduce it: $f \leftarrow f - w$, and the customer receives $a - f$ net.

**Rounding.** The tier discount is floored, so the discounted rate $b'$ is rounded **up** (protocol-favourable). The fee itself is rounded up with `mul_div_ceil`. Both follow the "ceil on inflows" policy.

**Claim 1.** If $0 \le b' \le B$ and $0 \le a \le I$, then $0 \le f_{\text{raw}} \le a$, and $f_{\text{raw}} - a b'/B < 1$.

*Proof.* $0 \le a b'/B \le a$ and ceiling of an integer-bounded value is at most $a$ because $a$ is an integer. The excess of the ceiling over the exact value is below 1 by definition. The 256-bit product cannot overflow, and the quotient $\le a \le I$ so no `ArithmeticOverflow` arises. $\square$

**Preconditions that hold:** $b \le 1000 \Rightarrow b' \le 1000 \le B$ (the $\min$ in `deduct_fee`). `compute_fee_amount` is also called directly with a `fee_bps` and surcharge; the cap exists only in `deduct_fee`.

**Not guaranteed (flagged):**
- `set_fee_config` performs no validation of `fee_bps`, `min_fee`, `max_fee`. `min_fee > a` is possible, giving $f > a$. In that case `net_amount = amount.saturating_sub(fee)` is a **negative** `i128` (saturating only at $-2^{127}$), not zero. Whether higher layers reject such a payment was not traced.
- `compute_fee_amount` computes `fee_bps - (fee_bps * discount) / 10000 + risk_surcharge_bps` in `u32` arithmetic; this is exact for $b \le 1000$ but unchecked for larger inputs.

**Dust/extraction note.** Rounding up on each payment means repeated tiny payments pay *at least* the exact fee, so splitting a payment into many small ones cannot reduce fees below the exact rate; it can only increase them (each payment overpays by $<1$ unit). The property `fee_plus_payout_never_exceeds_inflow` in `test_fixed_math_prop.rs` covers $f + (a - f) \le a$ for the helper.

### 3.2 Split payments (INV-PAY-02)

Code: `create_split_payment` validates $\sum_i b_i = B$ (with $b_i$ = `share_bps`, $n \le 10$ recipients; no recipient equals the customer). `execute_split_settlement` pays

$$s_i = \left\lfloor \frac{A\, b_i}{B} \right\rfloor \quad (i = 1..n),$$

with raw `i128` arithmetic `(payment.amount * share_bps) / 10000` (overflow-checked panic if $A b_i > I$; no 256-bit widening here).

**Claim 2.** $\sum_i s_i = A - r$ with an integer $0 \le r \le n-1 \le 9$, and $r > 0$ in general.

*Proof.* Write $A b_i / B = s_i + \phi_i$ with $\phi_i \in [0, 1)$. Summing gives $A \sum b_i / B = A = \sum s_i + \sum \phi_i$. So $r = \sum \phi_i$ is an integer (it equals $A - \sum s_i$) and $r < n$. $\square$

**Finding.** The contract transfers only $s_i$ and then marks the payment `Completed`. The remainder $r$ is neither sent to a dust sink nor recorded in any counter, so it stays in the Payment contract's balance, unassigned. This contradicts the issue's requirement $\sum \text{shares} + \text{dust\_sink} = \text{net}$ ("zero value stranded"): value is not *created*, but up to 9 base units per split are *stranded*. Follow-up: either assign $r$ to the last recipient / merchant, or accumulate it into $\mathcal{F}_{\text{acc}}$, and add a property test. Also note that `execute_split_settlement` does not call `deduct_fee`, so the fee in 3.1 is not applied to split settlements in the code reviewed.

### 3.3 Fee sweep (INV-PAY-04)

`sweep_fees` rejects $x \le 0$ and $x > \mathcal{F}_{\text{acc}}$, then transfers $x$ and sets $\mathcal{F}_{\text{acc}} \leftarrow \mathcal{F}_{\text{acc}} - x$. Hence $0 \le \mathcal{F}_{\text{acc}}$ is preserved (given $\mathcal{F}_{\text{acc}} \ge x > 0$). The code's own comment says "Ensure sweep won't encroach on merchant pending settlements", but the only check is $x \le \mathcal{F}_{\text{acc}}$; correctness against pending settlements relies on $\mathcal{F}_{\text{acc}}$ being backed by tokens actually pulled in by `deduct_fee` (`transfer_from` customer $\to$ contract), which it is.

## 4. Rebates (INV-PAY-03)

Code: `maybe_accrue_fee_rebate`, `claim_fee_rebate`.

For merchant $m$ and rebate period starting at $t_0$ (reset when $\text{now} \ge t_0 + \text{rebate\_period\_seconds}$, which also **zeroes any unclaimed accrual**), let $V_k$ be the cumulative period volume after payment $k$ and $f_k$ the fee on payment $k$. If $V_k > \text{threshold}$ and $f_k > 0$:

$$\text{rebate}_k = \left\lfloor \frac{f_k\, \beta}{B} \right\rfloor, \qquad \text{accrued} \mathrel{+}= \text{rebate}_k,$$

where $\beta$ = `rebate_bps`. `claim_fee_rebate` pays out `accrued`, sets $\mathcal{F}_{\text{acc}} \leftarrow \mathcal{F}_{\text{acc}} - \text{accrued}$ and zeroes `accrued`.

**Claim 3.** If $\beta \le B$, then total accrued rebate satisfies $\text{accrued} \le \sum_{k \in K} f_k$ where $K$ is the set of qualifying payments, i.e. never more than the fees collected from that merchant in the period.

*Proof.* $\lfloor f_k \beta / B \rfloor \le f_k \beta / B \le f_k$. Sum over $k \in K$. $\square$

**Rounding direction.** Floor, which follows "round down on user payouts".

**Findings.**
1. `configure_fee_rebate` stores `FeeRebateConfig` with **no validation** ($\beta$, period, threshold). With $\beta > B$, Claim 3 fails and `claim_fee_rebate` would pay out more than the merchant's fees, drawing on tokens backing other liabilities; `accumulated - rebate` is not checked for non-negativity.
2. The code comment says rebate accrues "only on volume above the threshold", but the implementation accrues on the **entire fee** of every payment made once $V_k > \text{threshold}$, including the crossing payment, not just on the portion of volume above the threshold.
3. Period reset discards unclaimed rebate.
4. No test exercises accrual or claim; `test_fee_rebate.rs` tests local helper functions only.

## 5. Escrow vesting (INV-ESC-01, INV-ESC-02)

Code: `get_base_vested_amount_at`, `compute_vested_amount_at`, `release_vested_amount`.

Let $T$ = `total_amount`, $c$ = `cliff_timestamp`, $e$ = `end_timestamp`, with $c < e$ (enforced at creation, as is $c \ge$ now).

### 5.1 Linear schedule (no milestones, no acceleration config)

$$V(t) = \begin{cases} 0 & t < c \\ \left\lfloor \dfrac{(t - c)\, T}{e - c} \right\rfloor & c \le t < e \\ T & t \ge e \end{cases}$$

(computed as `(elapsed as i128).saturating_mul(T) / duration`; floor, i.e. rounding down on payouts).

**Claim 4.** For $0 \le T \le I$: $0 \le V(t_1) \le V(t_2) \le T$ for $t_1 \le t_2$.

*Proof.* On $[c, e)$, $(t-c)T$ is non-decreasing in $t$ and $\lfloor \cdot / (e-c) \rfloor$ is monotone, so $V$ is non-decreasing there; $V(c) = 0$ matches the pre-cliff value. For $t < e$, $(t-c) \le e-c-1$ so $V(t) \le \lfloor (e-c-1)T/(e-c) \rfloor \le T$, and $V(t \ge e) = T$. Hence $V(t) \le T$ everywhere and monotone across the boundaries. Saturation of the product at $I$ keeps the map monotone non-decreasing and only *under*-states $V$, so it cannot overpay. $\square$

**Overflow bound.** The product exceeds $I$ only when $(t-c)\,T > 2^{127}-1$. With $e - c \le 2^{64}$ and typical durations (say $\le 10^9$ s $\approx 2^{30}$), this needs $T > 2^{97} \approx 1.6 \times 10^{29}$ base units, far beyond any 7-decimal token supply; the saturation is therefore not reachable in practice but is not rejected at creation.

### 5.2 Milestone schedules

$V(t) = \sum_{i:\, u_i \le t} m_i$ (for $c \le t < e$), $0$ before $c$, $T$ at/after $e$, with $u_i \in [c, e]$ and $\sum_i m_i = T$ checked at creation (using `saturating_add`).

**Claim 5.** If every $m_i \ge 0$ then $V$ is monotone and bounded by $T$. *Proof.* Adding non-negative terms as $t$ grows. $\square$

**Finding.** `create_vesting_escrow` checks the sum and timestamps but **not** $m_i \ge 0$. A negative milestone amount (balanced by a larger positive one) would break monotonicity and Claim 5. Follow-up: validate $m_i > 0$.

### 5.3 Acceleration layers

When a `VestingAccelerationConfig` exists, `compute_vested_amount_at` composes: a base curve $b(t)$ (cliff-unlock plus linear, or the max with the milestone curve), then two acceleration layers of the form $g_\alpha(x) = x + \lfloor (T - x)\alpha / B \rfloor$.

**Claim 6.** If $0 \le \alpha \le B$ and $0 \le x \le T$, then $g_\alpha$ is non-decreasing in $x$ and $x \le g_\alpha(x) \le T$.

*Proof.* Bounds: the added term is in $[0, T - x]$. Monotonicity: for $x' = x + 1$, $x' + \lfloor (T-x-1)\alpha/B \rfloor \ge x + 1 + \lfloor (T-x)\alpha/B - \alpha/B \rfloor \ge x + 1 + \lfloor (T-x)\alpha/B \rfloor - 1$, because $\alpha/B \le 1$. $\square$

Therefore, **for a fixed configuration**, $V(t)$ stays monotone in $t$ and is capped by `.min(T)`. Assumptions not enforced by the code reviewed: $\alpha \le B$ for all acceleration bps parameters, and trigger confirmations never revert (if they could be unset, $V$ could decrease between calls).

### 5.4 Claimed $\le$ vested (INV-ESC-02)

`release_vested_amount` computes $\text{rel} = V(t) - \text{released}$ (saturating), rejects $\text{rel} = 0$, then sets $\text{released} \leftarrow \text{released} + \text{rel} = V(t)$ and transfers $\text{rel}$. By induction, after each call $\text{released} = V(t_{\text{call}})$ and, because $V$ is monotone, $\text{released} \le V(t')$ for all later $t'$ and $\le T$. If $V$ ever fell below `released`, `saturating_sub` yields $0$ and the call reverts with `InvalidStatus`, so no over-release. Revoked schedules (`VestingRevoked`) are blocked from this path. The separate `claim_vested_escrow_tokens` and `revoke_unvested_escrow` paths were **not** analysed here.

## 6. Refunds and arbitration

### 6.1 Cumulative refund cap (INV-REF-01)

`check_accumulated_refunds` rejects when $\text{acc}(p) + x > P$ (checked addition), where $P$ is the payment amount and $\text{acc}(p)$ the stored `PaymentKey::AccumulatedRefunds(p)`.

**Claim 7.** If $\text{acc}(p) \le P$ before a request of amount $x \ge 0$ and the request is accepted, then $\text{acc}(p) + x \le P$ afterwards. By induction from $\text{acc}(p) = 0$ the invariant $\sum \text{accepted refunds} \le P$ holds, provided every accepted refund updates `AccumulatedRefunds` by exactly $x$. The test `test_accumulated_refunds_counts_pending_and_releases_on_denial` shows pending refunds are counted and released on denial.

A second, separate guard `can_refund_payment` compares requested $+$ the sum of `Processed` refunds (found by scanning `RefundCounter`, `saturating_add`) with the original amount.

**Not covered:** multi-currency refunds (no conversion logic was traced), installment refunds, and the interaction between the Refund contract's cap and `PaymentContract::refund_payment` in the Payment contract (an independent full-refund path); no cross-contract invariant ties them together in the code reviewed.

### 6.2 Refund fee split (INV-REF-02)

`split_net_refund` (gross $g$, rate $\phi$ bps capped at $B$, network share $\sigma$ bps capped at $B$):

$$F = \left\lfloor \frac{g\,\phi}{B} \right\rfloor,\quad F_{\text{net}} = \left\lfloor \frac{F\,\sigma}{B} \right\rfloor,\quad F_{\text{proc}} = F - F_{\text{net}},\quad N = g - F.$$

Then $F_{\text{net}} + F_{\text{proc}} = F$ and $F + N = g$ **exactly** (the remainder goes to the processing fee), so this split strands no dust. After clamping to `min_fee` / `max_fee` the split is re-derived the same way.

**Rounding deviation.** $F$ is rounded **down**, which is the opposite of the "round up protocol fee" policy stated in the issue: the customer's net is rounded up. This matches no explicit rationale in the code; it is recorded here as observed. Products use `saturating_mul`, so values near $I$ would clamp rather than panic. If $\text{min\_fee} > g$ the clamp can still yield $F > g$ (no validation beyond $\text{min} \le \text{max}$ and non-negativity).

### 6.3 Arbitration protocol fee

`deduct_arbitration_protocol_fee`: $F_p = \lceil \text{payout} \cdot \pi / B \rceil$ with $\pi = 200$ by default, $N = \text{payout} - F_p$. Rounded **up** (policy-compliant); credited to `AccumulatedFees(token)` while the tokens stay in the contract; one-shot per award. For $\pi \le B$, $0 \le F_p \le \text{payout}$. `set_arbitration_protocol_fee` was not checked for an upper bound.

### 6.4 Case fee pool distribution (INV-ARB-01)

`close_arbitration_case`, with pool $P$ and `ArbitrationFeeConfig` shares $\alpha_a + \alpha_t = B$ (validated by `set_arbitration_fee_config`):

$$A = \left\lfloor \frac{P\alpha_a}{B} \right\rfloor,\quad Q = \left\lfloor \frac{P\alpha_t}{B} \right\rfloor,\quad p = \left\lfloor \frac{A}{k} \right\rfloor \ (k = |\text{majority voters}| > 0),\quad \text{paid} = k\,p + Q.$$

If no config exists, $A = P$, $Q = 0$. If $k = 0$ then $p = 0$ and nothing is paid to arbitrators.

**Claim 8.** $\text{paid} \le P$ and the stranded remainder $\delta_P = P - \text{paid}$ satisfies $0 \le \delta_P \le 1 + (k - 1)$ when $k > 0$.

*Proof.* $A + Q \le P(\alpha_a + \alpha_t)/B = P$, and $A + Q \ge P - 1$ (two floors of fractions summing to an integer lose at most one unit in total). $kp \le A$ with $A - kp = A \bmod k \le k - 1$. So $P - \text{paid} = (P - A - Q) + (A - kp) \in [0, 1 + (k-1)]$. $\square$

**Findings.** The remainder $\delta_P$ is left in the Refund contract and not credited to anyone; for $k = 0$ the entire arbitrator share $A$ is stranded. Rounding is floor on all payouts, consistent with the policy.

### 6.5 Stake accounting and arbitration solvency (INV-ARB-02)

Per stake token $\tau$, let $S_a$ be arbitrator $a$'s recorded stake (`ArbitratorStake`).

- `deposit_arbitrator_stake`: transfers $x > 0$ from the arbitrator to the contract and sets $S_a \leftarrow S_a + x$ (checked add).
- `slash_arbitrator_stake`: requires $0 < x \le S_a$, sets $S_a \leftarrow S_a - x$ and transfers $x$ to the recipient.

Each stake-ledger change is paired with a transfer of equal size in the matching direction, so $\mathcal{B}_{\text{Refund}}(\tau)$ moves by exactly $\Delta\!\sum_a S_a$ for these two operations. Hence if $\mathcal{B}(\tau) \ge \sum_a S_a + \sum_c \text{caseStake}_c + \sum_c P_c + \mathcal{F}^{\text{ref}}_{\text{acc}}(\tau)$ holds initially (and at deploy it is $0 \ge 0$), it is preserved by deposit and slash, by pool distribution (Claim 8: outflow $\le P_c$ with $P_c$ removed), and by protocol fee withdrawal (counter set to $0$, equal tokens transferred).

This is the correct formalisation of the issue's "arbitration solvency" requirement; the literal form $\sum \text{stakes} + \sum \text{fees} \ge \text{total claimable obligations}$ depends on what counts as an "obligation" and is only meaningful per token. Caveats:
- Stake and fee tokens may differ (`ArbitrationStakeConfig.token` vs `ArbitrationFeeConfig.fee_token` vs refund payout token), so the inequality must be taken per token.
- `withdraw_treasury_fees` resets `AccumulatedTreasuryFees` and returns the amount but performs no transfer: the counter is already incremented only when the treasury share is paid out, so it is bookkeeping and not a liability.
- Slashing is an admin action; no slashing is triggered automatically by the contract on missed deadlines in the code reviewed.

## 7. Rounding direction audit

| Operation | Location | Direction | Follows policy? |
| --- | --- | --- | --- |
| Tier discount on fee bps | `compute_fee_amount` | floor of discount (rate rounded up) | Yes |
| Platform fee | `compute_fee_amount` | ceil (`mul_div_ceil`) | Yes |
| Fee waiver | `apply_fee_waiver` | not analysed | n/a |
| Split share | `execute_split_settlement` | floor, remainder stranded | Direction yes; dust unhandled |
| Rebate | `maybe_accrue_fee_rebate` | floor | Yes |
| Vested amount (linear) | `get_base_vested_amount_at` | floor | Yes |
| Cliff unlock / linear part / acceleration | `compute_vested_amount_at` | floor | Yes |
| Refund fee | `split_net_refund` | floor | **No** (protocol fee rounded down) |
| Refund network fee share | `split_net_refund` | floor; remainder to processing fee | Exact split |
| Arbitration protocol fee | `deduct_arbitration_protocol_fee` | ceil | Yes |
| Arbitration pool shares | `close_arbitration_case` | floor | Yes; dust stranded |
| Per-arbitrator share | `close_arbitration_case` | floor | Yes; dust stranded |

Out of scope for this revision (not audited): escrow fee collection, Dutch-auction collateral liquidation, installment amortization, loyalty point caps, subscription billing and streaming-channel math. The issue lists them as targets; they need a follow-up pass.

## 8. Follow-ups identified

1. Handle the split-settlement remainder (3.2) and add a property test for $\sum s_i + r = A$.
2. Validate `rebate_bps`, `fee_bps`, `min_fee`/`max_fee` ranges at configuration time (3.1, 4).
3. Reject non-positive vesting milestone amounts (5.2) and add proptests for $V$ monotonicity and `released <= V`.
4. Decide on the refund-fee rounding direction (6.2).
5. Handle or document the arbitration pool remainder and the $k = 0$ case (6.4).
6. Add a test asserting the liability inequality of Section 2.2 and extend `state_machine_fuzz.rs` beyond create/complete/refund/escrow actions (fees, rebates, vesting, arbitration).
