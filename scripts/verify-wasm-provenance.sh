#!/usr/bin/env bash
# Verify a release WASM against its Sigstore build-provenance attestation.
# Usage: scripts/verify-wasm-provenance.sh <artifact.wasm> [owner/repo]
# Requires: gh >= 2.49 (gh attestation verify). Run before signing
# propose_upgrade / approve_upgrade. Exits non-zero on any failure.
set -euo pipefail

ARTIFACT="${1:-}"
REPO="${2:-johnephraim949-web/cypher-gridpay-contracts}"
[ -n "$ARTIFACT" ] && [ -f "$ARTIFACT" ] || { echo "usage: $0 <artifact.wasm> [owner/repo]" >&2; exit 2; }
command -v gh >/dev/null || { echo "gh CLI is required" >&2; exit 2; }

# Bind to the canonical repo and to the release workflow, then to a tag or main.
OUT=$(gh attestation verify "$ARTIFACT" \
  --repo "$REPO" \
  --signer-workflow "$REPO/.github/workflows/release-provenance.yml" \
  --format json) || { echo "FAIL: attestation verification failed for $ARTIFACT" >&2; exit 1; }

if ! echo "$OUT" | grep -Eq "refs/(tags/v|heads/main)"; then
  echo "FAIL: attestation is not bound to refs/tags/v* or refs/heads/main" >&2
  exit 1
fi

echo "OK: $ARTIFACT sha256=$(sha256sum "$ARTIFACT" | cut -d' ' -f1)"
echo "Built from $REPO by release-provenance.yml; compare the digest with the on-chain wasm hash before signing."
