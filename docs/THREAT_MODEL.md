# Cypher GridPay — Formal Threat Model

This document is the audit-ready threat model for Cypher GridPay. It maps the
assets at risk, the attacker personas we defend against, the STRIDE mitigations
implemented in code, the trust assumptions we rely on, and the residual risks
that remain out of scope. It is intended to be read alongside
[`docs/ECONOMIC_INVARIANTS.md`](./ECONOMIC_INVARIANTS.md) and
[`docs/AUDIT_SCOPE.md`](./AUDIT_SCOPE.md).

## 1. Assets & Invariants Inventory

| Asset | Where it lives | Invariant | Verified by |
| --- | --- | --- | --- |
| Escrowed customer funds | `escrow` contract storage | Sum of escrow balances equals sum of deposits minus releases/refunds | `docs/ECONOMIC_INVARIANTS.md`, `escrow/tests/state_machine_fuzz.rs` |
| Subscription / streaming balances | `subscriptions` contract storage | Accrued amount never exceeds funded amount | `docs/ECONOMIC_INVARIANTS.md`, `subscriptions/tests/state_machine_fuzz.rs` |
| Refund & arbitration outcomes | `refunds` / `arbitration` modules | A dispute resolves to exactly one terminal state | `docs/ECONOMIC_INVARIANTS.md`, `refunds/tests/state_machine_fuzz.rs` |
| Admin / config authority | `admin` module, multisig | Rotations are timelocked and require threshold signatures | `admin/tests/rotation.rs` |
| Off-chain relayer / webhook state | relayer service | Webhook deliveries are idempotent and authenticated | relayer integration tests |

See [`docs/ECONOMIC_INVARIANTS.md`](./ECONOMIC_INVARIANTS.md) for the full
invariant catalogue and the differential test harness that checks them.

## 2. Threat Actors

- **Malicious merchant** — attempts to release escrow without delivering, or to
  double-spend a subscription balance.
- **Sybil customer** — spins up many identities to grief rate limits or drain
  promotional/streaming allowances.
- **Colluding arbitrator** — a subset of arbitrators that collude to force a
  biased dispute outcome.
- **Compromised relayer / keeper** — an off-chain operator whose keys leak and
  who submits forged or replayed transactions.
- **Compromised single multisig key** — one signer of the admin multisig is
  compromised.
- **Malicious SEP-41 token contract** — a token whose `transfer`/`transfer_from`
  re-enters, reverts, or lies about balances.
- **Front-running MEV searcher** — reorders or sandwiches transactions to extract
  value from releases, refunds, or oracle updates.

## 3. STRIDE Mitigations Mapped to Code

| Threat | Mitigation | Module / test |
| --- | --- | --- |
| Spoofing | Domain-separated Ed25519 signatures over typed payloads | `crypto/ed25519.rs`, `crypto/tests/signatures.rs` |
| Tampering | Checks-Effects-Interactions ordering on all state transitions | `escrow/src/lib.rs`, `escrow/tests/state_machine_fuzz.rs` |
| Repudiation | On-chain events emitted for every state transition | `events.rs`, `escrow/tests/events.rs` |
| Information disclosure | No secrets stored on-chain; off-chain keys never serialized to storage | `admin/src/lib.rs` |
| Denial of service | Bounded vectors, rate limits, and circuit breakers | `limits.rs`, `circuit_breaker.rs`, `tests/limits.rs` |
| Elevation of privilege | Timelocked admin rotations + multisig threshold | `admin/src/rotation.rs`, `admin/tests/rotation.rs` |

Additional code-level mitigations:

- **Reentrancy guards** — `reentrancy.rs` wraps every external token call;
  verified by `escrow/tests/reentrancy.rs`.
- **Fixed-point math** — all monetary arithmetic uses `U256` fixed math in
  `math.rs` to prevent rounding/overflow; verified by `math/tests/fixed.rs`.
- **Rate limits & circuit breakers** — `limits.rs` and `circuit_breaker.rs`
  bound per-account and global throughput; verified by `tests/limits.rs`.
- **Timelocked rotations** — `admin/src/rotation.rs` enforces a delay before
  authority changes take effect; verified by `admin/tests/rotation.rs`.
- **Domain-separated signatures** — `crypto/ed25519.rs` prefixes every signed
  payload with a domain tag to prevent cross-context replay; verified by
  `crypto/tests/signatures.rs`.

## 4. Soroban-Specific Threats

- **Storage archival / resurrection griefing** — persistent entries can be
  archived and later resurrected by an attacker. Mitigation: critical state is
  stored in persistent storage with TTL bumps on access (`storage.rs`), and
  resurrection is treated as a no-op re-read guarded by the reentrancy lock.
- **CPU / memory budget exhaustion (DoS via unbounded vectors)** — all loops
  over user-supplied collections are bounded (`limits.rs`), and pagination is
  required for large sets; verified by `tests/limits.rs`.
- **Sub-invocation authorization spoofing** — every privileged entry point uses
  `require_auth_for_args` with the exact argument tuple, preventing a
  sub-invocation from authorizing a different call; verified by
  `auth/tests/require_auth.rs`.

## 5. Trust Assumptions

- The Stellar network and Soroban runtime behave as specified (no validator
  collusion beyond the protocol's BFT threshold).
- The admin multisig threshold is not simultaneously compromised.
- SEP-41 tokens used are honest implementations; malicious tokens are handled
  defensively but not fully trusted.
- Off-chain relayers are operated by trusted parties whose keys are rotated on
  compromise.

## 6. Out-of-Scope / Residual Risk Register

| Risk | Status | Notes |
| --- | --- | --- |
| Stellar validator halt / network partition | Out of scope | Protocol-level liveness; contracts cannot mitigate |
| Upstream oracle manipulation beyond TWAP bounds | Residual | TWAP bounds limit but do not eliminate manipulation |
| Simultaneous compromise of multisig threshold | Residual | Mitigated by threshold + timelock, not eliminated |
| Malicious SEP-41 token with arbitrary reentrancy | Residual | Guards reduce but cannot fully sandbox a hostile token |
| Off-chain relayer host compromise | Residual | Key rotation + idempotent webhooks limit blast radius |

## 7. Security Checklist (On-chain & Off-chain)

- [ ] All external token calls wrapped by `reentrancy.rs` guards.
- [ ] All state transitions follow Checks-Effects-Interactions.
- [ ] All monetary math uses `U256` fixed math.
- [ ] Rate limits and circuit breakers configured for production.
- [ ] Admin rotations timelocked and multisig-gated.
- [ ] Ed25519 signatures domain-separated and replay-protected.
- [ ] `require_auth_for_args` used on every privileged entry point.
- [ ] Relayer webhooks authenticated and idempotent.
- [ ] Relayer/keeper keys rotated on compromise.
- [ ] Invariant tests (`make test`, `make differential`, `state_machine_fuzz`) green.
