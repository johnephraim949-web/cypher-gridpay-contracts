#!/usr/bin/env bash
# deploy-cli.sh - idempotent multi-environment deployment CLI for Cypher GridPay.
# Complements (does not replace) scripts/deploy-testnet.sh.
#
# Usage:
#   scripts/deploy-cli.sh --network <standalone|testnet|futurenet|mainnet> \
#       [--mode fresh|upgrade] [--dry-run] [--manifest <path>] [--source <identity>] \
#       [--no-build] [--propose-upgrade]
#
# State ledger: deployments/<network>/manifest.json (see docs/DEPLOY_CLI.md).
# Each step is recorded in .steps[]; re-running resumes after the last completed step.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

NETWORK=""
MODE="fresh"
DRY_RUN=0
MANIFEST=""
SOURCE="${STELLAR_SOURCE:-admin}"
BUILD=1
PROPOSE=0

log()  { echo "[deploy-cli] $*"; }
err()  { echo "[deploy-cli][error] $*" >&2; }
die()  { err "$*"; exit 1; }

usage() { sed -n '2,12p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit "${1:-0}"; }

while [[ $# -gt 0 ]]; do
    case "$1" in
        --network)  NETWORK="${2:-}"; shift 2 ;;
        --mode)     MODE="${2:-}"; shift 2 ;;
        --manifest) MANIFEST="${2:-}"; shift 2 ;;
        --source)   SOURCE="${2:-}"; shift 2 ;;
        --dry-run)  DRY_RUN=1; shift ;;
        --no-build) BUILD=0; shift ;;
        --propose-upgrade) PROPOSE=1; shift ;;
        -h|--help)  usage 0 ;;
        *) err "unknown argument: $1"; usage 1 ;;
    esac
done

case "${NETWORK}" in
    standalone|testnet|futurenet|mainnet) ;;
    *) die "--network must be one of standalone|testnet|futurenet|mainnet" ;;
esac
case "${MODE}" in fresh|upgrade) ;; *) die "--mode must be fresh or upgrade" ;; esac

MANIFEST="${MANIFEST:-${REPO_ROOT}/deployments/${NETWORK}/manifest.json}"

command -v jq >/dev/null 2>&1 || die "jq is required"
command -v sha256sum >/dev/null 2>&1 || die "sha256sum is required"
if [[ "${DRY_RUN}" -eq 0 ]]; then
    command -v stellar >/dev/null 2>&1 || die "stellar CLI is required (cargo install --locked stellar-cli)"
fi

# ── Mainnet guards ─────────────────────────────────────────────────────────
if [[ "${NETWORK}" == "mainnet" ]]; then
    [[ -z "${ADMIN_SECRET:-}" ]] || die "ADMIN_SECRET must not be set for mainnet; use a hardware/KMS-backed stellar identity via --source"
    if [[ "${MODE}" == "fresh" && "${DRY_RUN}" -eq 0 ]]; then
        [[ -t 0 ]] || die "mainnet requires an interactive terminal for confirmation"
        read -r -p "Type 'deploy gridpay to mainnet' to continue: " phrase
        [[ "${phrase}" == "deploy gridpay to mainnet" ]] || die "confirmation phrase mismatch"
    fi
fi

# Run (or just print, in dry-run mode) a mutating command.
mutate() {
    if [[ "${DRY_RUN}" -eq 1 ]]; then
        log "DRY-RUN would run: $*"
        return 0
    fi
    "$@"
}

# ── WASM discovery ─────────────────────────────────────────────────────────
# find_wasm <workspace-dir> <name>: prefer wasm32v1-none, fall back to wasm32-unknown-unknown.
find_wasm() {
    local dir="$1" name="$2" target
    for target in wasm32v1-none wasm32-unknown-unknown; do
        local p="${REPO_ROOT}/${dir}/target/${target}/release/${name}.wasm"
        [[ -f "${p}" ]] && { echo "${p}"; return 0; }
    done
    return 1
}

if [[ "${BUILD}" -eq 1 && "${DRY_RUN}" -eq 0 ]]; then
    log "building contracts (make build)"
    (cd "${REPO_ROOT}/core" && make build)
    (cd "${REPO_ROOT}/orchestrator" && make build)
fi

CONTRACTS=(payment escrow refund admin)
declare -A WASM_PATH WASM_HASH
for c in "${CONTRACTS[@]}"; do
    ws="core"; [[ "${c}" == "admin" ]] && ws="orchestrator"
    if p="$(find_wasm "${ws}" "${c}")"; then
        if [[ "${DRY_RUN}" -eq 0 ]] && command -v stellar >/dev/null 2>&1; then
            stellar contract optimize --wasm "${p}" >/dev/null 2>&1 || log "optimize skipped for ${c}"
            [[ -f "${p%.wasm}.optimized.wasm" ]] && p="${p%.wasm}.optimized.wasm"
        fi
        WASM_PATH[${c}]="${p}"
        WASM_HASH[${c}]="$(sha256sum "${p}" | cut -d' ' -f1)"
    else
        WASM_PATH[${c}]=""
        WASM_HASH[${c}]=""
    fi
done

if [[ "${DRY_RUN}" -eq 1 ]]; then
    log "== deployment plan =="
    log "network=${NETWORK} mode=${MODE} source=${SOURCE} manifest=${MANIFEST}"
    for c in "${CONTRACTS[@]}"; do
        if [[ -n "${WASM_PATH[${c}]}" ]]; then
            log "${c}: ${WASM_PATH[${c}]} size=$(wc -c < "${WASM_PATH[${c}]}")B sha256=${WASM_HASH[${c}]}"
        else
            log "${c}: WASM not built yet (run 'make build' in core/ and orchestrator/)"
        fi
    done
    if [[ "${MODE}" == "fresh" ]]; then
        log "steps: deploy payment,escrow,refund,admin -> initialize each -> wire admin -> verify"
    else
        log "steps: upload new WASM for each contract -> print hashes$([[ ${PROPOSE} -eq 1 ]] && echo ' -> admin.propose_upgrade')"
    fi
    log "dry-run: no on-chain or manifest mutations performed"
    exit 0
fi

for c in "${CONTRACTS[@]}"; do
    [[ -n "${WASM_PATH[${c}]}" ]] || die "WASM for ${c} not found; build first"
done

# ── Manifest ledger helpers ────────────────────────────────────────────────
mkdir -p "$(dirname "${MANIFEST}")"
if [[ ! -f "${MANIFEST}" ]]; then
    jq -n --arg n "${NETWORK}" '{schema:1, network:$n, contracts:{}, steps:[], history:[]}' > "${MANIFEST}"
fi
manifest_set() { # jq filter with --arg passthrough; atomic write
    local tmp; tmp="$(mktemp "${MANIFEST}.XXXXXX")"
    jq "$@" "${MANIFEST}" > "${tmp}" && mv "${tmp}" "${MANIFEST}"
}
step_done() { jq -e --arg s "$1" '.steps | index($s)' "${MANIFEST}" >/dev/null 2>&1; }
mark_step() { manifest_set --arg s "$1" '.steps += [$s] | .steps |= unique'; }
contract_id() { jq -r --arg c "$1" '.contracts[$c].id // empty' "${MANIFEST}"; }

DEPLOYER="$(stellar keys address "${SOURCE}" 2>/dev/null || echo "${SOURCE}")"
GIT_SHA="$(git -C "${REPO_ROOT}" rev-parse HEAD 2>/dev/null || echo unknown)"
LEDGER_SEQ="$(stellar ledger latest --network "${NETWORK}" 2>/dev/null | grep -Eo '[0-9]+' | head -1 || true)"
manifest_set --arg d "${DEPLOYER}" --arg g "${GIT_SHA}" --arg l "${LEDGER_SEQ:-0}" --arg m "${MODE}" \
    '.deployer=$d | .git_sha=$g | .ledger_sequence=($l|tonumber) | .mode=$m | .updated_at=(now|todate)'

invoke() { local id="$1"; shift; stellar contract invoke --id "${id}" --source "${SOURCE}" --network "${NETWORK}" -- "$@"; }

if [[ "${MODE}" == "fresh" ]]; then
    for c in "${CONTRACTS[@]}"; do
        if step_done "deploy:${c}"; then log "skip deploy:${c} (already in ledger)"; continue; fi
        id="$(stellar contract deploy --wasm "${WASM_PATH[${c}]}" --source "${SOURCE}" --network "${NETWORK}" --alias "${c}" | tail -1)"
        [[ -n "${id}" ]] || die "deploy of ${c} returned no contract id"
        manifest_set --arg c "${c}" --arg id "${id}" --arg h "${WASM_HASH[${c}]}" \
            '.contracts[$c]={id:$id, wasm_sha256:$h}'
        mark_step "deploy:${c}"
        log "deployed ${c}: ${id}"
    done
    for c in payment escrow refund; do
        step_done "init:${c}" && { log "skip init:${c}"; continue; }
        invoke "$(contract_id "${c}")" initialize --admin "${DEPLOYER}"
        mark_step "init:${c}"
    done
    if ! step_done "init:admin"; then
        invoke "$(contract_id admin)" initialize --admin "${DEPLOYER}" --pauser "${DEPLOYER}" \
            --payment_contract "$(contract_id payment)" --escrow_contract "$(contract_id escrow)" \
            --refund_contract "$(contract_id refund)"
        mark_step "init:admin"
    fi
    if ! step_done "wire:payment-escrow"; then
        invoke "$(contract_id payment)" set_escrow_contract --escrow_contract "$(contract_id escrow)" \
            || log "set_escrow_contract unavailable; skipping"
        mark_step "wire:payment-escrow"
    fi
    "${SCRIPT_DIR}/verify-deployment-cli.sh" --network "${NETWORK}" --manifest "${MANIFEST}" --source "${SOURCE}"
    mark_step "verify"
else
    for c in "${CONTRACTS[@]}"; do
        [[ -n "$(contract_id "${c}")" ]] || die "upgrade mode needs ${c} in the manifest; run --mode fresh first"
        hash="$(stellar contract upload --wasm "${WASM_PATH[${c}]}" --source "${SOURCE}" --network "${NETWORK}" | tail -1)"
        [[ "${hash}" == "${WASM_HASH[${c}]}" ]] || log "warning: uploaded hash ${hash} differs from local sha256 ${WASM_HASH[${c}]}"
        log "${c}: uploaded wasm hash ${hash}"
        manifest_set --arg c "${c}" --arg h "${hash}" '.contracts[$c].pending_wasm_hash=$h'
        if [[ "${PROPOSE}" -eq 1 ]]; then
            # AdminContract::propose_upgrade argument names must be confirmed against the contract ABI.
            invoke "$(contract_id admin)" propose_upgrade --contract "$(contract_id "${c}")" --new_wasm_hash "${hash}"
        fi
    done
fi
log "done; ledger at ${MANIFEST}"
