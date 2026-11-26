# Cypher GridPay — External Audit Scope

This document defines the scope, build reproduction, and verification steps for
external smart contract security audits of Cypher GridPay. It complements
[`docs/THREAT_MODEL.md`](./THREAT_MODEL.md).

## 1. In-Scope Crates

| Crate | Path | Notes |
| --- | --- | --- |
| `escrow` | `escrow/` | Escrow lifecycle, releases, refunds |
| `subscriptions` | `subscriptions/` | Subscription & streaming balances |
| `refunds` | `refunds/` | Refund and arbitration outcomes |
| `admin` | `admin/` | Multisig authority, timelocked rotations |

Shared modules (`reentrancy.rs`, `math.rs`, `limits.rs`, `circuit_breaker.rs`,
`crypto/ed25519.rs`, `storage.rs`, `auth/`) are in scope wherever they are
consumed by the crates above.

## 2. Commit Pinning Process

1. Auditors receive a pinned commit SHA recorded in the engagement letter.
2. The SHA is tagged `audit-<date>` in the repository.
3. Any post-pin changes are delivered as a separate diff and re-reviewed.
4. The pinned SHA is referenced in the final audit report.

## 3. Build Reproduction

```bash
# Clone and pin
git clone <repo-url> && cd cypher-gridpay
git checkout <pinned-sha>

# Build all contracts
cargo build --release --target wasm32-unknown-unknown
```

Record the resulting `.wasm` hashes and compare against the published release
artifacts.

## 4. Verification Commands

```bash
# Unit + integration tests
make test

# Differential tests against the reference model
make differential

# State-machine fuzz harness
cargo test --test state_machine_fuzz
```

All three must pass on the pinned commit before the audit begins.

## 5. Out of Scope

- Stellar protocol / validator behaviour.
- Third-party SEP-41 token implementations.
- Off-chain relayer host infrastructure (covered by the security checklist in
  `docs/THREAT_MODEL.md`).
