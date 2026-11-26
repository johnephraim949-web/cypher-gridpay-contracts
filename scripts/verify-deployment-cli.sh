#!/usr/bin/env bash
# verify-deployment-cli.sh - read-only post-deploy health verification using the manifest ledger.
# Usage: scripts/verify-deployment-cli.sh --network <net> [--manifest <path>] [--source <identity>]
set -euo pipefail
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
NETWORK=""; MANIFEST=""; SOURCE="${STELLAR_SOURCE:-admin}"
while [[ $# -gt 0 ]]; do
    case "$1" in
        --network) NETWORK="${2:-}"; shift 2 ;;
        --manifest) MANIFEST="${2:-}"; shift 2 ;;
        --source) SOURCE="${2:-}"; shift 2 ;;
        *) echo "unknown argument: $1" >&2; exit 1 ;;
    esac
done
[[ -n "${NETWORK}" ]] || { echo "--network is required" >&2; exit 1; }
MANIFEST="${MANIFEST:-${REPO_ROOT}/deployments/${NETWORK}/manifest.json}"
[[ -f "${MANIFEST}" ]] || { echo "manifest not found: ${MANIFEST}" >&2; exit 1; }

fail=0
ro() { # read-only simulate
    local id="$1"; shift
    stellar contract invoke --id "${id}" --source "${SOURCE}" --network "${NETWORK}" --send=no -- "$@"
}
for c in payment escrow refund admin; do
    id="$(jq -r --arg c "${c}" '.contracts[$c].id // empty' "${MANIFEST}")"
    if [[ -z "${id}" ]]; then echo "FAIL ${c}: not in manifest"; fail=1; continue; fi
    if v="$(ro "${id}" get_schema_version 2>&1)"; then echo "ok   ${c} get_schema_version=${v}"; else echo "FAIL ${c} get_schema_version"; fail=1; fi
done
admin_id="$(jq -r '.contracts.admin.id // empty' "${MANIFEST}")"
if [[ -n "${admin_id}" ]]; then
    if s="$(ro "${admin_id}" get_system_status 2>&1)"; then echo "ok   admin get_system_status=${s}"; else echo "FAIL admin get_system_status"; fail=1; fi
fi
exit "${fail}"
