# Architecture Decision Records (ADRs)

This directory records the significant architectural decisions made in Cypher GridPay.
Each ADR captures the context, the decision, the alternatives considered, the
consequences, and the security impact of a choice so that future contributors can
understand *why* the system looks the way it does.

## When to write an ADR

A new ADR is required whenever a change:

- Alters the workspace layout or crate boundaries (e.g. `core/` vs `orchestrator/`).
- Changes a protocol-level invariant (arithmetic, rounding, storage tiers, TTL policy).
- Introduces or changes a public error/status taxonomy (e.g. `RefundReasonCode`).
- Changes the security model (ordering guarantees, commit-reveal, reputation weighting).
- Changes SDK generation or cross-language binding strategy.

See [`CONTRIBUTING.md`](../../CONTRIBUTING.md) for the authoring and review process.

## Status lifecycle

Every ADR carries an explicit status header:

`Proposed | Accepted | Deprecated | Superseded by ADR-XXXX`

When a decision is replaced, do **not** delete the old ADR — mark it
`Superseded by ADR-XXXX` and link forward to the replacement.

## Catalog

| ADR | Title | Status |
| --- | --- | --- |
| [0000](0000-template.md) | Template | — |
| [0001](0001-dual-workspace-core-orchestrator-separation.md) | Dual-workspace `core/` / `orchestrator/` separation | Accepted |
| [0002](0002-soroban-storage-tiering-and-ttl-policy.md) | Soroban storage tiering and TTL policy | Accepted |
| [0003](0003-structured-refund-reason-codes-and-versioned-policies.md) | Structured refund reason codes and versioned policies | Accepted |
| [0004](0004-commit-reveal-arbitration-and-reputation-weighting.md) | Commit-reveal arbitration and reputation weighting | Accepted |
| [0005](0005-typescript-and-python-sdk-binding-generation-strategy.md) | TypeScript and Python SDK binding generation strategy | Accepted |
| [0006](0006-fixed-point-arithmetic-and-dust-rounding-invariants.md) | Fixed-point arithmetic and dust rounding invariants | Accepted |

## Creating a new ADR

1. Copy [`0000-template.md`](0000-template.md) to the next sequential number,
   e.g. `0007-my-decision.md`.
2. Fill in every section. Reference exact file paths and contract invariants.
3. Set the status to `Proposed` and open a PR.
4. On merge, update the status to `Accepted` and add a row to the catalog above.
