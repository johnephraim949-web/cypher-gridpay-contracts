# SDK release pipeline (issue #367)

Workflow: `.github/workflows/release-sdks.yml`. It publishes
`@cypher-gridpay/contracts-sdk` (npm, with provenance) and
`cypher-gridpay-sdk` (PyPI) using OIDC Trusted Publishing, so no registry tokens
are stored in the repository.

## Triggers

- Push of a tag `vX.Y.Z` or `vX.Y.Z-rc.N` (also `-beta.N`, `-alpha.N`): full release.
- `workflow_dispatch` with `version` and `dry_run` (default `true`): builds, tests,
  checks versions and packages, but never publishes or creates a release.

## Stages

1. **Version check** (fails before any publish): `sdk/typescript/package.json`
   must equal the tag version, and `sdk/python/pyproject.toml` must equal its
   PEP 440 form (`1.2.0-rc.1` becomes `1.2.0rc1`).
2. Build the contracts, optimize, and write `checksums.sha256`.
3. Typecheck, test, build and `npm pack` the TS SDK; build and `twine check` the Python SDK.
4. `publish-npm` (environment `npm`): `npm publish --provenance`; pre-releases use dist-tag `next`.
5. `publish-pypi` (environment `pypi`): `pypa/gh-action-pypi-publish`.
6. GitHub Release with `.wasm` files, checksums, tarball, wheel/sdist and generated notes.

## One-time maintainer setup (required before the first real release)

- Create GitHub environments `npm` and `pypi` (add required reviewers if desired).
- npm: on the package settings page, add a Trusted Publisher for repository
  `johnephraim949-web/cypher-gridpay-contracts`, workflow `release-sdks.yml`,
  environment `npm`. The package must exist (or use the scope's first publish
  process) before a trusted publisher can be linked.
- PyPI: add a (pending) Trusted Publisher for project `cypher-gridpay-sdk` with the
  same repository, workflow `release-sdks.yml`, environment `pypi`.

## Known gaps

- The two SDK versions are currently different (`0.1.0` npm, `0.2.0` PyPI), so a
  tag matching both will fail until they are aligned. This is deliberate per the
  issue's lockstep requirement; bump one manifest before the first tag.
- Bindings are not regenerated in CI (the committed `sdk/typescript/src` is used);
  `scripts/generate-*-bindings.sh` take an output directory and were not wired in.
- `sdk/python` has no pytest suite, so only build and `twine check` run for Python.
- The issue asks for OIDC docs in `docs/DEPLOYMENT.md`; this separate file avoids
  edits to a shared doc.
- Nothing here has been executed; expect first-run fixes.
