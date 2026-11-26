# CI caching and fast lint (issue #364)

## What was added

- `.github/actions/setup-rust-cached/action.yml`: composite action that installs
  Rust, restores `Swatinem/rust-cache` for `core`, `orchestrator` and
  `tests/e2e` (`cache-on-failure: true`), and installs a **pinned**
  `stellar-cli` (v30.0.1) whose tarball SHA-256 is verified, with the binary
  cached by OS, arch and version.
- `.github/workflows/ci-fast-lint.yml`: Linux fmt + clippy job using the action,
  with a `concurrency` group that cancels superseded PR runs but never runs on
  `main`/`develop` or tags.

## What is NOT done (needs a change in `ci.yml`)

`ci.yml` was intentionally not edited (it is contended by other PRs), so these
parts of the issue still require maintainers to change it:

1. In `matrix-test` and `security-scan`, replace the "Install Rust" and
   "Install Stellar CLI" (`curl ... install.sh | sh`) steps with:

   ```yaml
   - uses: ./.github/actions/setup-rust-cached
     with:
       components: clippy, rustfmt
   ```
2. Add at workflow top level:

   ```yaml
   concurrency:
     group: ${{ github.workflow }}-${{ github.ref }}
     cancel-in-progress: ${{ github.event_name == 'pull_request' }}
   ```
3. Add `needs: [lint]` semantics (or reuse the lint job from `ci-fast-lint.yml`)
   so the macOS matrix waits for a green lint. Cross-workflow `needs` is not
   possible; move the lint job into `ci.yml` to gate the matrix.

The >50% runtime target and warm-cache measurement have not been verified.

## Bumping stellar-cli

Update `stellar-cli-version` and the per-platform checksums in the action. Digests
are shown on the GitHub release asset page (or `gh api repos/stellar/stellar-cli/releases/tags/vX.Y.Z`).
