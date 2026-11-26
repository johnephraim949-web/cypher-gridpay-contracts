# ADR-0001: Dual-workspace `core/` / `orchestrator/` separation

- **Status:** Accepted
- **Date:** 2024-01-01
- **Deciders:** Core protocol team
- **Related:** [ADR-0002](0002-soroban-storage-tiering-and-ttl-policy.md), [ADR-0006](0006-fixed-point-arithmetic-and-dust-rounding-invariants.md)

## Context

Cypher GridPay contains two distinct concerns:

1. On-chain protocol logic that must be deterministic, auditable, and compiled to
   Soroban WASM (the `core/` Cargo workspace).
2. Off-chain orchestration — transaction assembly, submission, retries, and
   coordination (the `orchestrator/` Cargo workspace).

Mixing these in a single crate couples deterministic contract code to
non-deterministic I/O, bloats the WASM artifact, and makes independent testing and
release cycles difficult.

## Decision

Maintain two separate Cargo workspaces:

- `core/` — the Soroban contract crate(s). No `std`-dependent orchestration logic.
- `orchestrator/` — off-chain services that depend on `core/` types but never the
  reverse.

The dependency direction is strictly `orchestrator/ -> core/`. `core/` must not
import from `orchestrator/`.

## Alternatives Considered

- **Single workspace / single crate.** Simplest to start, but couples WASM
  determinism to I/O, inflates artifact size, and prevents independent versioning.
- **Feature-gated single crate.** Reduces duplication but feature flags leak across
  the boundary and are easy to misconfigure in release builds.

## Consequences

- Positive: clean dependency direction, smaller WASM, independent test/release.
- Negative: shared types must live in `core/` and be re-exported; some duplication
  of build configuration across the two workspaces.

## Security Impact

Enforcing the one-way dependency prevents non-deterministic or privileged
orchestration code from leaking into the on-chain contract. CI should fail if
`core/` gains a dependency on `orchestrator/`.
