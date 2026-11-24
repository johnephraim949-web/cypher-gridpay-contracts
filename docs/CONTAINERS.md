# Container images and signing

- `docker/crank-worker.Dockerfile` (build context: repo root) and `ops/ttl-keeper/Dockerfile` (context
  `ops/ttl-keeper`): multi-stage builds, base images pinned by digest (`node:22-alpine`,
  `gcr.io/distroless/nodejs22-debian12:nonroot`), runtime `USER 65532:65532`, only production dependencies copied.
- `.github/workflows/container-release.yml` builds, Trivy-scans (HIGH,CRITICAL, fails) a local amd64 image, then pushes
  `linux/amd64,linux/arm64` to `ghcr.io/<owner>/gridpay-<image>` tagged `sha-<short>` and semver on `v*.*.*` tags
  (no `latest`), signs the pushed digest with Cosign keyless OIDC and attaches an SPDX SBOM attestation.
  All actions are pinned to commit SHAs; permissions are job-scoped (`packages: write`, `id-token: write`).

Verify: `cosign verify ghcr.io/<owner>/gridpay-crank-worker@<digest> --certificate-identity-regexp
'https://github.com/<owner>/<repo>/.github/workflows/container-release.yml@.*' --certificate-oidc-issuer
https://token.actions.githubusercontent.com`.

Not covered / not verified: nothing was built, scanned or signed. The relayer package has no entrypoint
(library only) and `apps/web` has no `package.json`, so no Dockerfiles exist for them; the indexer, watchtower,
evidence-storage and telemetry-gateway directories contain only READMEs. Image/base digests will need periodic bumps
(Dependabot is not configured here). `npm ci` assumes `services/crank-worker/package-lock.json` is in sync. The issue
named `build-containers.yml`, `api/indexer/web.Dockerfile`; those services do not exist in this repo, so names differ.
Maintainers should confirm GHCR package visibility and the Trivy results on first run.
