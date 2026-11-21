# ADR-0000: <Short Decision Title>

- **Status:** Proposed | Accepted | Deprecated | Superseded by ADR-XXXX
- **Date:** YYYY-MM-DD
- **Deciders:** <names / roles>
- **Related:** <links to issues, PRs, other ADRs>

## Context

Describe the forces at play: the problem being solved, the constraints
(protocol, security, performance, operational), and the relevant code paths
(e.g. `core/src/...`, `orchestrator/src/...`). Reference exact file paths and
contract invariants rather than vague prose.

## Decision

State the decision clearly and in the active voice. Include the concrete
mechanism (types, storage tiers, math, error codes) and where it lives in the
repository.

## Alternatives Considered

- **<Alternative A>** — why it was rejected.
- **<Alternative B>** — why it was rejected.

## Consequences

- **Positive:** benefits gained.
- **Negative:** costs, complexity, or migration burden accepted.
- **Neutral:** follow-up work, tooling, or documentation required.

## Security Impact

Describe the security-relevant invariants this decision preserves or
introduces (e.g. Checks-Effects-Interactions ordering, authorization checks,
overflow/rounding guarantees, TTL/archival behavior). Note any residual risk
and how it is mitigated.
