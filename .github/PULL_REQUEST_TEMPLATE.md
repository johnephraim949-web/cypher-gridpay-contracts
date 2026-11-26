## Summary

- What changed?
- Why is this needed?
- Any relevant context or linked issues?

## Test Plan

- [ ] I ran `cargo test --workspace`
- [ ] I reviewed the diff for unintended changes
- [ ] I added or updated tests where appropriate

> Reminder: please run `cargo test --workspace` before submitting this PR.

## Security Checklist

> **Mandatory** when this PR modifies `core/contracts/**` or `orchestrator/**`.
> The `pr-hygiene` workflow will block merging until every item below is checked.
> If this PR does not touch those paths, leave the section unchecked and it will be ignored.

- [ ] I have reviewed the changes for security implications (reentrancy, access control, arithmetic safety, input validation)
- [ ] I have considered and documented any new attack surface introduced by this change
- [ ] I have verified that no secrets, private keys, or sensitive credentials are committed
- [ ] I have confirmed that access control / authorization checks are correct and complete
- [ ] I have confirmed that external calls and state mutations follow the checks-effects-interactions pattern
- [ ] I have added or updated tests covering the security-sensitive behavior
- [ ] I have requested review from the designated code owners for the affected security-sensitive paths

## PR Title Convention

> PR titles must follow the [Conventional Commits](https://www.conventionalcommits.org/) format, e.g. `feat(payment): ...`, `fix(escrow): ...`, `devops: ...`.
> The `pr-hygiene` workflow validates the title and auto-applies domain labels based on changed paths.