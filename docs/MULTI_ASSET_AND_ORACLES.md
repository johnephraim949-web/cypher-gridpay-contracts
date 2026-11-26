# Multi-Asset & Oracle Configuration Guide

This guide is for protocol admins and integrators who onboard a new Stellar Asset
Contract (SAC) or custom SEP-41 token, configure oracle rate feeds, and delist a
token safely. It describes the behaviour that is **actually implemented** in the
contracts, so that an onboarding runbook cannot silently assume a feature that the
code does not enforce.

Source of truth for this guide:

- `core/contracts/payment/src/lib.rs` — token allowlist, conversion rates, oracle config
- `core/contracts/payment/src/types.rs` — `Currency`, `OracleRateConfig`
- `core/contracts/escrow/src/lib.rs` — escrow token swaps and rate lock
- `core/contracts/refund/src/lib.rs` — refund token registry and settlement
- `docs/DEPLOYMENT.md`, `docs/OPERATIONAL_RUNBOOK.md` — CLI style and incident response

### Scope note: requested concepts vs. implementation

Several concepts that often appear in multi-asset designs are **not** present in
the current code. They are called out explicitly below so that operators do not
rely on them:

| Concept | Reality in this repository |
| --- | --- |
| TWAP / deviation-band circuit breaker in `set_oracle_rate_config` | Not implemented. `OracleRateConfig` has only `oracle_address`, `currency`, `price_feed_id`, `max_staleness_seconds`, `enabled`. The only contract-level circuit breaker is **refund volume** in the refund contract, not price deviation. |
| Per-token `decimals` / `scale` field | Not implemented. Amounts are always raw token base units; the shared fixed-point scale is `10_000_000` (1e7) for rates. |
| Conversion rate snapshotted onto each payment | Not implemented. `Payment` stores `currency` as a label, not a rate. Rates are global per currency. The only real rate snapshot is `locked_rate` on an escrow swap. |
| FX conversion inside refund settlement | Not implemented. Refunds pay the original token/amount; there is no conversion-rate call in the refund contract. |

---

## 1. Units, decimals and fixed-point rates

- **Amounts** passed to `create_payment`, `execute_escrow_swap`, refunds, etc. are
  **integer base units** of the token contract. The contracts do not read a
  `decimals` attribute from SEP-41 tokens and do not rescale amounts themselves.
- **Rates** use Stellar/Soroban 1e7 fixed point: `1_0000000` means **1:1**
  (`get_conversion_rate` defaults to this when no rate has been set,
  `core/contracts/payment/src/lib.rs:6604`). The escrow swap applies the rate as
  `output_amount = (escrow.amount * rate) / 10_000_000`
  (`core/contracts/escrow/src/lib.rs:14926`).
- The `Currency` enum is `XLM | USDC | USDT | BTC | ETH`
  (`core/contracts/payment/src/types.rs:13`). It is a **label used as a storage key**,
  not a promise that the underlying token has any particular decimals.

### Decimal normalization examples

Because there is no on-chain normalization, the integrator (client / keeper) is
responsible for choosing the integer amount that represents the intended human
value. When comparing assets, keep the human value constant and scale by the
token's own exponent:

| Asset (typical deployment) | Decimals | Human value | Raw amount (`value * 10^decimals`) |
| --- | --- | --- | --- |
| Classic SAC: XLM | 7 | 10 XLM | `100_000_000` |
| Classic SAC: USDC on Stellar | 7 | 10 USDC | `100_000_000` |
| Wrapped stablecoin with 6 decimals | 6 | 10 units | `10_000_000` |
| Wrapped asset with 18 decimals | 18 | 10 units | `10_000_000_000_000_000_000` |

The swap operates directly on integer base units. When source and target
precision differ, the oracle must include the precision ratio in the rate
that the contract snapshots. For example, 10 tokens at 7 decimals is
`100_000_000` source base units. At a 1.5 whole-token rate and 6 target
decimals, publish the fixed-point base-unit rate `1_500_000` (0.15 × 1e7).
The contract then records `15_000_000` target base units. Verify that the
rate is representable at 1e7 precision and that the intermediate i128
product fits before configuring the swap.

### Dust floor

The closest thing to a dust threshold is the **split-payment minimum**, not a
decimal rule: `set_min_split_amount(env, admin, min_amount)`
(`core/contracts/payment/src/lib.rs:13873`) with `get_min_split_amount` returning
`Option<i128>`. It is an absolute amount in the token's base units and is
multisig-admin gated (`Unauthorized` otherwise). Set it **in the smallest unit of
each asset you care about** — e.g. `100_000` for a 7-decimal asset is 0.01 units,
but the same number for an 18-decimal asset is negligible. Verify against
`core/contracts/payment/src/test_split_payment.rs` before changing it in production.

---

## 2. Token onboarding checklist (payment allowlist)

Entrypoint: `add_allowed_token(env, admin, token)`
(`core/contracts/payment/src/lib.rs:6285`).

**On-chain behaviour:**

1. `admin.require_auth()` — the signer must exist.
2. The signer must be in `MultiSigConfig.admins`; otherwise `Unauthorized` (100),
   or `MultiSigNotInitialized` (111) if the config is missing.
3. The token address is appended to the allowlist in **persistent shards**
   (`TokenWhitelistShard`), with only the count in instance storage. Adding an
   already-present token is a no-op (idempotent).
4. **No events are emitted** by this entrypoint. Off-chain indexers must not rely
   on an event; they should diff `get_allowed_tokens` or record the CLI tx hash.

**Critical invariant — empty allowlist means "allow all":**

`is_token_allowed` (`core/contracts/payment/src/lib.rs:6388`) returns
`tokens.is_empty() || tokens.contains(token)`. Until an admin adds the first
token, **every token is accepted**. `create_payment` rejects non-listed tokens with
`TokenNotAllowed` (224) only once the list is non-empty. Treat the first
`add_allowed_token` as closing an open gate: enumerate and add **all** intended
tokens in the same maintenance window.

**Off-chain verification before calling `add_allowed_token`** (the contract does
not check any of this):

- [ ] Token is a genuine SAC or a SEP-41 contract you control/trust; the address is
      from an official source, not pasted from chat.
- [ ] **Non-rebasing**: balance of a holder does not change without a transfer.
      Rebasing tokens break the protocol's balance-conservation invariant
      (`docs/ECONOMIC_INVARIANTS.md`).
- [ ] **No fee-on-transfer**: an incoming transfer of N credits exactly N. A
      fee-on-transfer token makes contract accounting diverge from the real
      balance, which can render payments or escrows under-collateralized.
- [ ] **Not pausable / freezeable by a third party without notice**: a token whose
      issuer can freeze the payment or escrow account after funds are locked can
      strand settlement. If such a token must be supported, document the issuer
      and set an explicit monitoring/response owner.
- [ ] Decimals and symbol recorded in your integration config; raw amounts and
      dust floor computed against those decimals (Section 1).
- [ ] Oracle config and manual fallback rate prepared if this currency is valued
      by an oracle (Section 3).
- [ ] Testnet smoke test: create and complete a small payment, then request and
      settle a refund in the same token.

### CLI: whitelist a token on Testnet

Replace the example contract IDs with your Testnet IDs. Use the name of a locally configured Stellar CLI identity for the admin signer.

```bash
export NETWORK=testnet
export PAYMENT_ID=C...                    # payment contract id
export ADMIN_IDENTITY=gridpay-admin
ADMIN_ADDR=$(stellar keys address "$ADMIN_IDENTITY")
export USDC_ID=C...                       # Stellar Asset Contract id

# Whitelist the token (idempotent, no event emitted)
stellar contract invoke \
    --id $PAYMENT_ID \
    --source "$ADMIN_IDENTITY" \
    --network $NETWORK \
    -- add_allowed_token \
    --admin $ADMIN_ADDR \
    --token $USDC_ID

# Verify
stellar contract invoke --id $PAYMENT_ID --network $NETWORK --source "$ADMIN_IDENTITY" -- get_allowed_tokens
```

---

## 3. Oracle rate feeds and manual fallback (payment contract)

### 3.1 `OracleRateConfig` fields

`core/contracts/payment/src/types.rs:320`:

```rust
pub struct OracleRateConfig {
    pub oracle_address: Address,
    pub currency: Currency,
    pub price_feed_id: BytesN<32>,
    pub max_staleness_seconds: u64,
    pub enabled: bool,
}
```

- `oracle_address` — contract exposing `get_price(feed_id) -> (i128, u64)` where
  the `u64` is the last-update ledger timestamp.
- `price_feed_id` — 32-byte feed identifier passed verbatim to `get_price`.
- `max_staleness_seconds` — freshness window checked by `refresh_conversion_rate`.
- `enabled` — when `false`, the oracle is bypassed and the manual rate is returned.

There is **no deviation band / TWAP field** in this struct. If you need price
deviation protection, implement it in the oracle contract or in your keeper
logic; do not assume the payment contract enforces it. Do not confuse this with
the refund contract's `set_circuit_breaker_config`
(`core/contracts/refund/src/lib.rs:9615`), which tracks refund volume/rate, not
price.

### 3.2 Configure the feed — `set_oracle_rate_config`

`core/contracts/payment/src/lib.rs:6623`:

```rust
pub fn set_oracle_rate_config(env: Env, admin: Address, config: OracleRateConfig) -> Result<(), Error>
```

Admin is multisig-gated (`require_auth`, `Unauthorized` 100,
`MultiSigNotInitialized` 111). The config is stored in instance storage under
`FeatureKey::OracleRateConfig(currency)`, overwriting any previous config for
that currency. No event is emitted. Note the currency is used as a key but is
**not validated** here — a typo produces an unusable config; verify with
`get_oracle_rate_config` immediately after the call.

### 3.3 Refresh — `refresh_conversion_rate`

`core/contracts/payment/src/lib.rs:6672`:

```rust
pub fn refresh_conversion_rate(env: Env, currency: Currency) -> Result<i128, Error>
```

- **Permissionless** — anyone can call it. Run it from a keeper/cron.
- No config → `OracleNotConfigured` (120).
- `enabled == false` → returns `get_conversion_rate(currency)` (the manual rate)
  and does **not** write storage. This is the manual fallback path.
- Calls `get_price(price_feed_id)`; any call failure → `OracleCallFailed` (115).
- `now - fetched_timestamp > max_staleness_seconds` → `OracleFeedStale` (119).
- On success writes `FeatureKey::ConversionRate(currency) = fetched_rate` and
  returns it. The rate is a global value per currency, shared by all payments.

### 3.4 Manual fallback — `set_conversion_rate`

`core/contracts/payment/src/lib.rs:6566`:

```rust
pub fn set_conversion_rate(env: Env, admin: Address, currency: Currency, rate: i128) -> Result<(), Error>
```

Multisig admin only; currency must be one of the five `Currency` variants,
otherwise `InvalidCurrency` (103). Rate uses 1e7 fixed point (`1_0000000` = 1:1).
`get_conversion_rate` returns `1_0000000` when nothing is stored. Use this rate as
the safe value while the oracle feed is disabled, misconfigured, or repeatedly
stale; re-enable the feed only after `refresh_conversion_rate` succeeds.

### CLI: configure and refresh an oracle on Testnet

```bash
export CURRENCY=USDC
export ORACLE_ID=C...                      # oracle contract exposing get_price(feed_id) -> (rate, timestamp)
export FEED_ID=0000000000000000000000000000000000000000000000000000000000000001  # Replace with the adapter feed ID

# 1. Set a known-good manual fallback rate (1.0000000 = 1:1)
stellar contract invoke \
    --id $PAYMENT_ID \
    --source "$ADMIN_IDENTITY" \
    --network $NETWORK \
    -- set_conversion_rate \
    --admin $ADMIN_ADDR \
    --currency $CURRENCY \
    --rate 10000000

# 2. Configure the feed (struct passed as JSON; enum as its variant name)
stellar contract invoke \
    --id $PAYMENT_ID \
    --source "$ADMIN_IDENTITY" \
    --network $NETWORK \
    -- set_oracle_rate_config \
    --admin $ADMIN_ADDR \
    --config "{\"oracle_address\":\"$ORACLE_ID\",\"currency\":\"$CURRENCY\",\"price_feed_id\":\"$FEED_ID\",\"max_staleness_seconds\":300,\"enabled\":true}"

# 3. Verify the stored config and the effective rate
stellar contract invoke --id $PAYMENT_ID --network $NETWORK --source "$ADMIN_IDENTITY" -- get_oracle_rate_config --currency $CURRENCY
stellar contract invoke --id $PAYMENT_ID --network $NETWORK --source "$ADMIN_IDENTITY" -- get_conversion_rate --currency $CURRENCY

# 4. Keeper refresh (permissionless; fails with 119 if the feed is stale)
stellar contract invoke \
    --id $PAYMENT_ID \
    --network $NETWORK \
    --source "$ADMIN_IDENTITY" \
    -- refresh_conversion_rate \
    --currency $CURRENCY
```

If the feed is unhealthy, disable refresh writes with `enabled:false` in step 2,
then write a reviewed manual rate. A successful refresh on an enabled feed
overwrites the rate slot. Document who re-enables the feed. There is no automatic
deviation trip switch in the payment contract.

---

## 4. Rate-lock semantics and FX settlement

**Payments do not lock an FX rate.** The `Payment` struct
(`core/contracts/payment/src/lib.rs:1381`) contains `amount`, `token`, `currency`,
`status`, timestamps and refund bookkeeping, but **no rate field**. `currency` is
an enum label only. `get_conversion_rate` is consulted inside
`refresh_conversion_rate` as a fallback, not during payment creation or
completion. Consequences:

- Changing the stored conversion rate changes the value used by any future
  consumers of that global rate; it does **not** rewrite existing payments.
- To reconstruct the effective rate at a historical ledger, query on-chain
  config history / transaction history; do not expect a per-payment snapshot.
- The field named `locked_conversion_amount` in subscription trial data is a
  trial conversion **amount**, not an FX rate — do not use it for FX logic.

**The only genuine rate lock is in escrow swaps** (`locked_rate`, Section 5).
It snapshots the oracle rate at configure time specifically to prevent MEV
sandwiching between configure and execute.

---

## 5. Escrow token swaps

Entrypoints in `core/contracts/escrow/src/lib.rs`:

| Function | Signature | Notes |
| --- | --- | --- |
| `configure_escrow_swap` | `(env, merchant: Address, escrow_id: u64, target_token: Address, min_output: i128, oracle: Address) -> Result<(), Error>` (line 14804) | `merchant.require_auth()`; also allowed for multisig admins. Escrow must exist and be `Locked`. |
| `execute_escrow_swap` | `(env, caller: Address, escrow_id: u64) -> Result<i128, Error>` (line 14873) | `caller.require_auth()`; merchant or multisig admin; escrow must still be `Locked`. |
| `get_swap_config` | `(env, escrow_id: u64) -> Option<EscrowSwapConfig>` (line 14960) | Read-only verification. |

`EscrowSwapConfig` (line 1598) stores `source_token`, `target_token`,
`min_output_amount`, `oracle`, `executed`, and `locked_rate` (1e7 fixed point,
captured by calling `get_rate()` on the oracle at configure time).

**Execute-time checks:**

1. Swap config must exist (`SwapConfigNotFound`) and not already be executed
   (`SwapAlreadyExecuted`).
2. Oracle must expose `get_updated_at() -> u64`; if
   `now - updated_at > MAX_ORACLE_AGE_SECS` with `MAX_ORACLE_AGE_SECS = 300`
   (line 14908) → `StaleOraclePrice`.
3. `rate = locked_rate` — the live price is deliberately **not** re-fetched
   (MEV mitigation).
4. `output_amount = (escrow.amount * rate) / 10_000_000` (1e7 fixed point).
5. `output_amount < min_output_amount` → `SwapOutputBelowMinimum` (slippage guard).
6. On success the escrow's `token` becomes `target_token`, `amount` becomes
   `output_amount`, and `executed` is set. No event is emitted.

This is a **metadata-modeled** swap: it redirects settlement to the new token;
it is not a Transfer of the original token out of the contract. Treat the
target token with the same onboarding checklist as any other accepted token
(Section 2) and confirm the settlement path can actually deliver that token.

### CLI: configure and execute a swap on Testnet

```bash
export ESCROW_CONTRACT_ID=C...         # escrow contract id (not the record id)
export ESCROW_ID=1                     # numeric escrow record id inside the contract
export SWAP_ORACLE_ID=C...             # must implement get_rate() and get_updated_at()
export TARGET_TOKEN_ID=C...
export MERCHANT_IDENTITY=gridpay-merchant
MERCHANT_ADDR=$(stellar keys address "$MERCHANT_IDENTITY")

stellar contract invoke \
    --id $ESCROW_CONTRACT_ID \
    --source "$MERCHANT_IDENTITY" \
    --network $NETWORK \
    -- configure_escrow_swap \
    --merchant $MERCHANT_ADDR \
    --escrow_id $ESCROW_ID \
    --target_token $TARGET_TOKEN_ID \
    --min_output 9000000 \
    --oracle $SWAP_ORACLE_ID

stellar contract invoke --id $ESCROW_CONTRACT_ID --network $NETWORK --source "$MERCHANT_IDENTITY" -- get_swap_config --escrow_id $ESCROW_ID

stellar contract invoke \
    --id $ESCROW_CONTRACT_ID \
    --source "$MERCHANT_IDENTITY" \
    --network $NETWORK \
    -- execute_escrow_swap \
    --caller $MERCHANT_ADDR \
    --escrow_id $ESCROW_ID
```

---

## 6. Multi-currency refund settlement

The refund contract settles in the token that was originally paid. It does not
call any conversion-rate entrypoint.

- Refund token registry: `register_refund_token(env, admin, token)`
  (`core/contracts/refund/src/lib.rs:12157`) and
  `deregister_refund_token(env, admin, token)` (line 12206). Admin-gated from
  `DataKey::Admin`. Deregistration marks `active = false`; it does not delete the
  entry. `get_supported_refund_tokens` (line 12230) lists the registry.
- As with the payment allowlist, an **empty registry means all tokens are
  allowed** (Issue #191). `request_refund` validates the token against the
  registry only when the registry is non-empty. In that case an unlisted token
  returns `UnsupportedRefundToken` (50)
  (`core/contracts/refund/src/lib.rs:2738`).
- Refund records carry `original_token: Address` (lines 1213, 1245) set from the
  paid token at creation (line 8670). Amounts are raw base units of that token.
- The `ExternalCurrency` enum exists in types but is not used by public
  entrypoints — do not treat it as an FX settlement API.
- The refund circuit breaker (`set_circuit_breaker_config`, line 9615) monitors
  refund **volume/rate**, not token prices.

### CLI: manage the refund token registry on Testnet

```bash
export REFUND_ID=C...
export REFUND_ADMIN_IDENTITY=gridpay-refund-admin
REFUND_ADMIN_ADDR=$(stellar keys address "$REFUND_ADMIN_IDENTITY")

stellar contract invoke \
    --id $REFUND_ID \
    --source "$REFUND_ADMIN_IDENTITY" \
    --network $NETWORK \
    -- register_refund_token \
    --admin $REFUND_ADMIN_ADDR \
    --token $USDC_ID

stellar contract invoke --id $REFUND_ID --network $NETWORK --source "$REFUND_ADMIN_IDENTITY" -- get_supported_refund_tokens
```

---

## 7. Safe delisting checklist

Delisting only affects **new** payments/refunds. There is no cascade that closes
existing payments or escrows.

**Payment token — `remove_allowed_token(env, admin, token)`**
(`core/contracts/payment/src/lib.rs:6314`):

- [ ] Confirm no new payments should accept the token; multisig admin auth required.
- [ ] **Account for the empty-list bypass**: removing the *last* token leaves an
      empty allowlist, which re-opens payments to **all** tokens. Before doing
      that, first add every other intended token (or deliberately accept the
      open state and document it).
- [ ] Inventory in-flight state before the change: `get_payment`,
      `get_payments_by_customer`, `get_payments_by_merchant` for pending payments
      in this token, and escrows still holding it. Removal does not touch their
      stored `token` field, so they remain processable.
- [ ] If escrows hold the token and must be migrated, use the escrow swap flow
      (Section 5) while the swap oracle is healthy and `min_output` is current.
- [ ] Verify with `get_allowed_tokens` and record the tx hash (no event exists).
- [ ] Monitor for `TokenNotAllowed` (224) spikes after the change.

**Refund token — `deregister_refund_token(env, admin, token)`** (line 12206):

- [ ] Only do this once no refunds in that token remain to be requested. It sets
      `active = false`; existing refund records keep their `original_token`.
- [ ] Deactivation leaves the registry entry in place. Keep any other tokens
      that need to accept new refunds active.
- [ ] Verify with `get_supported_refund_tokens`.

**Compromised token (urgent):** pause affected entrypoints or use the global
emergency pause first (`docs/OPERATIONAL_RUNBOOK.md` §2), then delist, then work
through pending payments/escrows. Never leave the allowlist/registry empty unless
"allow all" is the intended state.

---

## 8. Security warnings and edge cases

> **Do not whitelist** tokens that are malicious, rebase, charge a fee on
> transfer, or can be paused/frozen by a third party without notice. The contracts
> do not validate token behaviour; these tokens violate the balance-conservation
> invariant documented in `docs/ECONOMIC_INVARIANTS.md` and can strand user funds.

- A non-existent or wrong token address is accepted by `add_allowed_token` —
  nothing is validated. Double-check the address from an official source.
- Config mutations (`add_allowed_token`, `remove_allowed_token`,
  `set_conversion_rate`, `set_oracle_rate_config`, swap config) **emit no events**.
  Build alerting from tx monitoring and periodic reads of the getters.
- `refresh_conversion_rate` is permissionless: a caller cannot forge a rate, but
  it can choose *when* to refresh. Keep `max_staleness_seconds` tight enough that
  a stale-but-valid feed cannot persist, and keep the manual fallback current.
- Stale oracle data returns `OracleFeedStale` (119) rather than silently using an
  old price; do not paper over this by raising the staleness window without a
  risk decision.
- Decimal mismatches are an integration concern: validate raw amounts at the
  client boundary, especially for 6- and 18-decimal wrapped tokens.
- `is_token_allowed` / refund registry "empty = allow all" is a deliberate
  bootstrap behaviour; it is the most common configuration mistake.

---

## 9. Operational verification commands

```bash
# Allowlist, oracle config and effective rate
stellar contract invoke --id $PAYMENT_ID --network $NETWORK --source "$ADMIN_IDENTITY" -- get_allowed_tokens
stellar contract invoke --id $PAYMENT_ID --network $NETWORK --source "$ADMIN_IDENTITY" -- get_oracle_rate_config --currency $CURRENCY
stellar contract invoke --id $PAYMENT_ID --network $NETWORK --source "$ADMIN_IDENTITY" -- get_conversion_rate --currency $CURRENCY

# Refund registry and escrow swap state
stellar contract invoke --id $REFUND_ID --network $NETWORK --source "$REFUND_ADMIN_IDENTITY" -- get_supported_refund_tokens
stellar contract invoke --id $ESCROW_CONTRACT_ID --network $NETWORK --source "$MERCHANT_IDENTITY" -- get_swap_config --escrow_id $ESCROW_ID
```

For read-only checks you may use `--send=no` as shown in
`docs/OPERATIONAL_RUNBOOK.md`.

---

## See Also

- [Deployment guide](./DEPLOYMENT.md)
- [Operational runbook](./OPERATIONAL_RUNBOOK.md)
- [Economic invariants & balance conservation](./ECONOMIC_INVARIANTS.md)
- [Error codes reference](./ERROR_CODES.md)
- [Storage versioning](./STORAGE_VERSIONING.md)
- [Payment contract README](../core/contracts/payment/README.md)
- [Escrow contract README](../core/contracts/escrow/README.md)
- [Refund contract README](../core/contracts/refund/README.md)
