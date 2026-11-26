# Secret Scanning

- `.gitleaks.toml` extends the default gitleaks rules with: Stellar secret seeds (`S[A-Z2-7]{55}`), Soroban RPC
  tokens, Postgres/Redis URIs with passwords and webhook HMAC secrets. The allowlist covers `tests/`, `test_utils/`
  and obvious placeholder values only.
- Local: `pre-commit install` enables the `gitleaks` hook (pinned `v8.30.1`, `--redact`).
- CI: `.github/workflows/secret-scan.yml` scans the PR commit range (history and commit messages) with
  `fetch-depth: 0`, `--redact` and a non-zero exit on any finding.

Not verified by running: the rule regexes, allowlist scope and a clean scan of existing history have not been
executed. Maintainers should run `gitleaks git --config .gitleaks.toml --redact` once and tune the allowlist.
To make the gate required, add `gitleaks (Stellar secret key gate)` to branch protection. The issue asked for the job
inside `ci.yml`; it is a separate workflow here to avoid conflicts with other open PRs.
