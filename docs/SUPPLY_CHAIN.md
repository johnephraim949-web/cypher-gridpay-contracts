# Supply Chain: Provenance and SBOM for Soroban WASM

Workflow: `.github/workflows/release-provenance.yml` (runs on `v*` tags and manually).

## What it produces
- Optimized `.wasm` files from `core/` and `orchestrator/` (built with `--locked` and `--remap-path-prefix`) plus `checksums.sha256`.
- Sigstore keyless attestations via `actions/attest-build-provenance` (verify with `gh attestation verify`).
- SLSA Level 3 generic provenance (`*.intoto.jsonl`) via `slsa-framework/slsa-github-generator` `generator_generic_slsa3.yml@v2.1.0`. SLSA requires the generator to be referenced by tag, not by SHA.
- CycloneDX SBOMs: `cargo-cyclonedx` for the Rust workspaces (`core`, `orchestrator`) and best-effort `@cyclonedx/cyclonedx-npm` / `cyclonedx-py` for the SDKs, attached to the release under `sbom/`.

## Verifying (multisig signers, before `propose_upgrade` / `approve_upgrade`)
```bash
scripts/verify-wasm-provenance.sh path/to/payment.wasm
# SLSA provenance, from the release assets:
slsa-verifier verify-artifact payment.wasm \
  --provenance-path multiple.intoto.jsonl \
  --source-uri github.com/johnephraim949-web/cypher-gridpay-contracts \
  --source-tag vX.Y.Z
```
Also compare `sha256sum payment.wasm` against the WASM hash in the upgrade proposal. A modified binary must make both commands exit non-zero.

## Multisig upgrade checklist step
Add to your upgrade procedure: (1) download the WASM from the release, (2) run the verify script, (3) run `slsa-verifier`, (4) confirm the digest matches the proposal, only then sign.

## Not covered / needs maintainer action
- Nothing here has been run or tested; the first tag push will exercise it. Expect to adjust the SBOM step (cargo-cyclonedx output paths, SDK tool flags) after a first run.
- Subject names in the SLSA generator are relative file names; upload the `.intoto.jsonl` asset name may differ (check the release).
- `ci.yml` and `release-sdks.yml` were deliberately not modified (contended/not present); the existing ci.yml still only uploads `checksums.sha256` unattested. The docs/OPERATIONAL_RUNBOOK.md was not edited; the checklist above is the source until it is linked from there.
- Repository must allow `attestations: write` and public-repo Sigstore (private repos need GitHub Enterprise for attestations).
