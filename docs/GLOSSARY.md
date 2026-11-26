# Glossary

See the [contract overview](../README.md#-contract-overview),
[architecture guide](ARCHITECTURE.md), and [changelog](../CHANGELOG.md).

## Admin Orchestrator

The contract that coordinates protocol-wide pauses, dependency rotations,
WASM upgrades, and protocol parameters across Payment, Escrow and Refund.
See the [Admin contract](../orchestrator/contracts/admin/README.md).

## Arbitration and Arbitrator

Arbitration is the review of a contested refund or escrow. A Refund arbitrator
is a registered adjudicator who may be required to stake funds and whose
voting record contributes to reputation. See the
[arbitration lifecycle](../core/contracts/refund/README.md#-arbitration-workflow).

## Checks-Effects-Interactions

Validate and authorize first, update internal state second, and perform
external calls last. The ordering limits unsafe reentrant state changes.

## Circuit Breaker

An automatic gate that limits activity when a configured threshold is crossed,
such as refund volume in a rolling window. Oracle deviation checks can be
implemented separately in an [oracle adapter](MULTI_ASSET_AND_ORACLES.md).

## Clawback

Escrow emergency recovery initiated by a registered admin with a reason
commitment and a delay. After the delay a registered admin can execute the
recovery to their address. See the [clawback lifecycle](../core/contracts/escrow/README.md#clawback).

## Commit-Reveal

A two-phase protocol. Participants first publish a hash commitment, then
reveal the data and salt so the contract can check the commitment. Escrow uses
it for [multi-party dispute votes](../core/contracts/escrow/README.md#multi-party-dispute-commit-reveal-voting).

## Deadline Extension

A bounded increase to an evidence deadline when eligible evidence arrives
late in the submission window.

## Dunning

Recovery of a failed subscription charge. `DunningState` records retry
progress and timing for operations such as `retry_failed_payment`. See
[failed payment recovery](../core/contracts/payment/README.md#dunning-failed-payment-recovery).

## Dust Floor and Dust Sink

A dust floor is the smallest amount accepted by a particular flow, such as a
split recipient's minimum share. A dust sink is the designated recipient or
accounting bucket for a remainder after integer rounding. For example, an
escrow split ruling assigns the rounding remainder to the seller. See
[economic invariants](ECONOMIC_INVARIANTS.md).

## Escrow

Conditional custody for an agreed token amount. Release, refund, dispute,
and expiry rules determine when funds move and to whom.

## Fee Sweep

Withdrawal of accumulated protocol fees by an authorized caller. Fee
accounting keeps those funds separate from outstanding payment liabilities.

## Footprint Restoration

Restoring archived persistent or instance ledger entries required by a
transaction. Use simulation to identify the footprint and follow the
[restoration guide](STORAGE_RESTORATION.md).

## Front-Running

Submitting a transaction intended to execute ahead of an observed pending
transaction. Commit-reveal and locked swap quotes reduce exposure in
specific protocol flows.

## Griefing

Imposing cost or delay on another participant, for example through frivolous
disputes. Rate limits, stakes and deadlines bound some of these costs.

## Hold Period

An escrow's minimum buyer inspection period, recorded as `hold_period_until`.
It gates eligible release paths. A [timelock](#timelock) delays execution of
a particular action or proposal.

## Instant Refund Buffer

An operational term for prefunded liquidity reserved for rapid refunds. The
current Refund contract exposes funding and settlement flows and customer-tier
instant approval. The checkout team should treat approval and actual token
settlement as separate states.

## Multisig

Authorization that requires a configured number of eligible approvals.
Some entrypoints instead require a single signature from a registered admin.
Consult the entrypoint and its policy before submitting a transaction.

## Oracle

An external price or observation source. Cypher GridPay can refresh stored
currency rates from an adapter and can snapshot a separate escrow swap rate.
See the [multi-asset and oracle guide](MULTI_ASSET_AND_ORACLES.md).

## Payment Channel

A micropayment mechanism where participants sign off-chain balance updates
and settle against on-chain channel state. A sequence number orders updates.

## Payment Memo

A Payment contract record containing an opaque reference and a digest of
off-chain remittance evidence. See [privacy and compliance](PRIVACY_AND_COMPLIANCE.md).

## Rate Limit

A policy capping the count or volume of activity in a time window, often
scoped to an address or merchant.

## Reentrancy

An external contract calling back during an invocation, while the original
operation is still executing.

## Reproducible WASM Build

A deterministic build that lets a verifier rebuild the bytecode and compare
its digest to a published manifest or deployed WASM. See the
[WASM optimization guide](GAS_AND_WASM_OPTIMIZATION.md).

## Schema Migration Cursor

A persistent progress record that lets Payment, Escrow, and Refund migrate
bounded batches across transactions with `migrate_schema_step`. Check
completion and schema version before treating a deployment as upgraded.
See [storage versioning](STORAGE_VERSIONING.md).

## Schema Version

The stored version of a contract's data layout. Migrations transform existing
records before the contract reports the target version.

## SEP-29

The [Stellar convention for account-level memo requirements](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md).

## SEP-41

The [Stellar token interface](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0041.md),
including balance, transfer, allowance and decimal precision methods.

## SEP-42

The [draft Stellar Asset List proposal](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0042.md).
Some repository material uses “SEP-42” as shorthand for its WASM checksum
workflow. The official proposal concerns asset lists.

## Settlement

The final asset movement for a payment, release or refund, as confirmed by a
successful transaction and reconciled token movements.

## Stellar Asset Contract (SAC)

The Soroban contract representation of a Stellar classic asset, including
native XLM and issued assets identified by asset code and issuer.

## StreamingChannel

An on-chain Payment record for prepaid token streaming. Its recipient can
claim vested base units over time. See the
[streaming lifecycle](../core/contracts/payment/README.md#streaming-channels).

## Supreme Dispute

A refund appeal escalated to the Admin Orchestrator. The current
`resolve_supreme_dispute` entrypoint emits the governance decision. Track
Refund state and settlement separately.

## Timelock

A restriction that prevents execution of an action, such as clawback,
dependency rotation or an upgrade, until a specified ledger time has elapsed.

## TTL (Time to Live)

The ledger lifetime of a contract entry. Persistent or instance entries can
be archived when their lifetime lapses. Temporary entries expire. See the
[restoration guide](STORAGE_RESTORATION.md).

## Vesting Schedule

A rule determining when portions of locked funds become available, for
example after a cliff or progressively over time.

## Wilson Score

The Wilson lower confidence bound ranks estimated proportions while
accounting for sample size. Refund currently ranks arbitrators using a
Bayesian-smoothed majority-vote rate instead.
