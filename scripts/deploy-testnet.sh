#!/usr/bin/env bash
# deploy-testnet.sh — Automated deployment helper for Cypher GridPay contracts
# Deploys Payment, Escrow, Refund, and Admin contracts to Stellar Testnet.
# Usage: ./scripts/deploy-testnet.sh [network]
#   network: testnet (default) | futurenet

set -euo pipefail

NETWORK="${1:-testnet}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST_FILE="${REPO_ROOT}/deployment-manifest.json"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log_info()  { echo -e "${GREEN}[INFO]${NC} $*"; }
log_warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
log_error() { echo -e "${RED}[ERROR]${NC} $*" >&2; }

# ── Mainnet Guard ──────────────────────────────────────────────────────────
# This script must never target Stellar Mainnet. Abort if the network name,
# network passphrase, or RPC URL resolves to Mainnet.
MAINNET_PASSPHRASE="Public Global Stellar Network ; September 2015"
MAINNET_RPC_HOST="soroban-mainnet.stellar.org"

assert_not_mainnet() {
    local network_name="${1:-}"
    local passphrase="${2:-${STELLAR_NETWORK_PASSPHRASE:-}}"
    local rpc_url="${3:-${SOROBAN_RPC_URL:-${STELLAR_RPC_URL:-}}}"

    if [[ "${network_name}" == "mainnet" || "${network_name}" == "public" ]]; then
        log_error "Refusing to run against Stellar Mainnet (network='${network_name}')."
        exit 1
    fi

    if [[ -n "${passphrase}" && "${passphrase}" == "${MAINNET_PASSPHRASE}" ]]; then
        log_error "Refusing to run: STELLAR_NETWORK_PASSPHRASE matches Stellar Mainnet."
        exit 1
    fi

    if [[ -n "${rpc_url}" && "${rpc_url}" == *"${MAINNET_RPC_HOST}"* ]]; then
        log_error "Refusing to run: RPC URL '${rpc_url}' points at Stellar Mainnet."
        exit 1
    fi
}

assert_not_mainnet "${NETWORK}"
=======

# ── Prerequisites ──────────────────────────────────────────────────────────
command -v stellar >/dev/null 2>&1 || { log_error "Stellar CLI not found. Install: cargo install --locked stellar-cli --features opt"; exit 1; }
command -v jq >/dev/null 2>&1 || { log_error "jq not found. Install: brew install jq / apt-get install jq"; exit 1; }

# ── Configuration ──────────────────────────────────────────────────────────
ADMIN_ADDRESS="${ADMIN_ADDRESS:-}"
ADMIN_SECRET="${ADMIN_SECRET:-}"

if [[ -z "${ADMIN_ADDRESS}" ]]; then
    log_error "ADMIN_ADDRESS environment variable is required."
    exit 1
fi

if [[ -z "${ADMIN_SECRET}" ]]; then
    log_warn "ADMIN_SECRET not set. Using Stellar CLI identity 'admin'."
    ADMIN_SECRET=$(stellar keys show admin --network "${NETWORK}" 2>/dev/null || echo "")
fi

log_info "Deploying to network: ${NETWORK}"
log_info "Admin address: ${ADMIN_ADDRESS}"

# ── Build Contracts ────────────────────────────────────────────────────────
log_info "Building contracts..."
cd "${REPO_ROOT}/core"
make build

cd "${REPO_ROOT}/orchestrator"
make build

# ── Deploy Payment Contract ────────────────────────────────────────────────
log_info "Deploying Payment contract..."
PAYMENT_WASM="${REPO_ROOT}/core/target/wasm32v1-none/release/payment.wasm"
if [[ ! -f "${PAYMENT_WASM}" ]]; then
    log_error "Payment WASM not found at ${PAYMENT_WASM}"
    exit 1
fi

PAYMENT_ID=$(stellar contract deploy \
    --wasm "${PAYMENT_WASM}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    --alias payment 2>&1 | tail -1)
log_info "Payment contract deployed: ${PAYMENT_ID}"

# ── Deploy Escrow Contract ─────────────────────────────────────────────────
log_info "Deploying Escrow contract..."
ESCROW_WASM="${REPO_ROOT}/core/target/wasm32v1-none/release/escrow.wasm"
ESCROW_ID=$(stellar contract deploy \
    --wasm "${ESCROW_WASM}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    --alias escrow 2>&1 | tail -1)
log_info "Escrow contract deployed: ${ESCROW_ID}"

# ── Deploy Refund Contract ─────────────────────────────────────────────────
log_info "Deploying Refund contract..."
REFUND_WASM="${REPO_ROOT}/core/target/wasm32v1-none/release/refund.wasm"
REFUND_ID=$(stellar contract deploy \
    --wasm "${REFUND_WASM}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    --alias refund 2>&1 | tail -1)
log_info "Refund contract deployed: ${REFUND_ID}"

# ── Deploy Admin Contract ──────────────────────────────────────────────────
log_info "Deploying Admin contract..."
ADMIN_WASM="${REPO_ROOT}/orchestrator/target/wasm32v1-none/release/admin.wasm"
ADMIN_CONTRACT_ID=$(stellar contract deploy \
    --wasm "${ADMIN_WASM}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    --alias admin 2>&1 | tail -1)
log_info "Admin contract deployed: ${ADMIN_CONTRACT_ID}"

# ── Initialize Admin Contract ──────────────────────────────────────────────
log_info "Initializing Admin contract with deployed addresses..."
stellar contract invoke \
    --id "${ADMIN_CONTRACT_ID}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    -- initialize \
    --admin "${ADMIN_ADDRESS}" \
    --pauser "${ADMIN_ADDRESS}" \
    --payment_contract "${PAYMENT_ID}" \
    --escrow_contract "${ESCROW_ID}" \
    --refund_contract "${REFUND_ID}" 2>&1

# ── Initialize Payment Contract ────────────────────────────────────────────
log_info "Initializing Payment contract..."
stellar contract invoke \
    --id "${PAYMENT_ID}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    -- initialize \
    --admin "${ADMIN_ADDRESS}" 2>&1

# ── Initialize Escrow Contract ─────────────────────────────────────────────
log_info "Initializing Escrow contract..."
stellar contract invoke \
    --id "${ESCROW_ID}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    -- initialize \
    --admin "${ADMIN_ADDRESS}" 2>&1

# ── Initialize Refund Contract ─────────────────────────────────────────────
log_info "Initializing Refund contract..."
stellar contract invoke \
    --id "${REFUND_ID}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    --initialize \
    --admin "${ADMIN_ADDRESS}" 2>&1

# ── Cross-register contracts ───────────────────────────────────────────────
log_info "Cross-registering contracts..."
# Register escrow contract address in payment contract
stellar contract invoke \
    --id "${PAYMENT_ID}" \
    --source "${ADMIN_SECRET}" \
    --network "${NETWORK}" \
    --set_escrow_contract \
    --escrow_contract "${ESCROW_ID}" 2>&1 || log_warn "set_escrow_contract not available, skipping"

# ── Generate Deployment Manifest ───────────────────────────────────────────
log_info "Generating deployment manifest..."
cat > "${MANIFEST_FILE}" <<EOF
{
  "network": "${NETWORK}",
  "deployed_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "admin_address": "${ADMIN_ADDRESS}",
  "contracts": {
    "payment": "${PAYMENT_ID}",
    "escrow": "${ESCROW_ID}",
    "refund": "${REFUND_ID}",
    "admin": "${ADMIN_CONTRACT_ID}"
  }
}
EOF

# Validate manifest JSON before reporting success
jq . "${MANIFEST_FILE}" >/dev/null || { log_error "Failed to write valid deployment manifest JSON"; exit 1; }

log_info "Deployment manifest written to: ${MANIFEST_FILE}"
log_info "Deployment complete!"
echo ""
echo "Contract Addresses:"
echo "  Payment: ${PAYMENT_ID}"
echo "  Escrow:  ${ESCROW_ID}"
echo "  Refund:  ${REFUND_ID}"
echo "  Admin:   ${ADMIN_CONTRACT_ID}"

# ── Canary Helper Subcommands ──────────────────────────────────────────────
# These helpers are invoked by .github/workflows/testnet-canary-upgrade.yml so
# the canary pipeline reuses the same deployment logic. They are dispatched
# when the first argument is a known subcommand.
#
#   deploy-testnet.sh dry-run-migrate <contract-id> [--chunk-size N]
#   deploy-testnet.sh migrate-step    <contract-id> [--chunk-size N]
#   deploy-testnet.sh migrate-until-complete <contract-id> [--chunk-size N]
#   deploy-testnet.sh emergency-pause-all
#
# All helpers enforce the Mainnet guard before touching the network.

resolve_contract_id() {
    local name="$1"
    if [[ -z "${name}" ]]; then
        log_error "Contract name/ID is required."
        exit 1
    fi
    # Allow either a raw contract ID or a manifest key (payment/escrow/refund/admin).
    if [[ -f "${MANIFEST_FILE}" ]]; then
        local resolved
        resolved=$(jq -r --arg k "${name}" '.contracts[$k] // empty' "${MANIFEST_FILE}" 2>/dev/null || true)
        if [[ -n "${resolved}" ]]; then
            echo "${resolved}"
            return 0
        fi
    fi
    echo "${name}"
}

require_admin_secret() {
    if [[ -z "${ADMIN_SECRET}" ]]; then
        log_error "ADMIN_SECRET (or a Stellar CLI 'admin' identity) is required for this operation."
        exit 1
    fi
}

cmd_dry_run_migrate() {
    local contract_ref="$1"; shift || true
    local chunk_size="100"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --chunk-size) chunk_size="$2"; shift 2 ;;
            *) log_error "Unknown argument: $1"; exit 1 ;;
        esac
    done
    assert_not_mainnet "${NETWORK}"
    local contract_id
    contract_id=$(resolve_contract_id "${contract_ref}")
    log_info "Dry-run schema migration on ${contract_id} (chunk_size=${chunk_size})..."
    stellar contract invoke \
        --id "${contract_id}" \
        --source "${ADMIN_SECRET}" \
        --network "${NETWORK}" \
        -- dry_run_migrate_schema \
        --chunk_size "${chunk_size}" 2>&1
}

cmd_migrate_step() {
    local contract_ref="$1"; shift || true
    local chunk_size="100"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --chunk-size) chunk_size="$2"; shift 2 ;;
            *) log_error "Unknown argument: $1"; exit 1 ;;
        esac
    done
    assert_not_mainnet "${NETWORK}"
    require_admin_secret
    local contract_id
    contract_id=$(resolve_contract_id "${contract_ref}")
    log_info "Running migrate_schema_step on ${contract_id} (chunk_size=${chunk_size})..."
    stellar contract invoke \
        --id "${contract_id}" \
        --source "${ADMIN_SECRET}" \
        --network "${NETWORK}" \
        -- migrate_schema_step \
        --chunk_size "${chunk_size}" 2>&1
}

cmd_migrate_until_complete() {
    local contract_ref="$1"; shift || true
    local chunk_size="100"
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --chunk-size) chunk_size="$2"; shift 2 ;;
            *) log_error "Unknown argument: $1"; exit 1 ;;
        esac
    done
    assert_not_mainnet "${NETWORK}"
    require_admin_secret
    local contract_id
    contract_id=$(resolve_contract_id "${contract_ref}")
    local max_iterations="${MIGRATION_MAX_ITERATIONS:-1000}"
    local iteration=0
    while (( iteration < max_iterations )); do
        iteration=$((iteration + 1))
        log_info "Migration step ${iteration} on ${contract_id}..."
        stellar contract invoke \
            --id "${contract_id}" \
            --source "${ADMIN_SECRET}" \
            --network "${NETWORK}" \
            -- migrate_schema_step \
            --chunk_size "${chunk_size}" 2>&1

        local cursor
        cursor=$(stellar contract invoke \
            --id "${contract_id}" \
            --source "${ADMIN_SECRET}" \
            --network "${NETWORK}" \
            -- get_migration_cursor 2>&1 | tail -1)
        log_info "Migration cursor: ${cursor}"
        # Cursor is considered complete when it reports a terminal/complete state.
        if [[ "${cursor}" == *"complete"* || "${cursor}" == *"Complete"* || "${cursor}" == "0" ]]; then
            log_info "Migration completed after ${iteration} step(s)."
            return 0
        fi
    done
    log_error "Migration did not complete within ${max_iterations} iterations."
    exit 1
}

cmd_emergency_pause_all() {
    assert_not_mainnet "${NETWORK}"
    require_admin_secret
    local admin_id
    admin_id=$(resolve_contract_id "admin")
    log_warn "Triggering emergency_pause_all on Admin contract ${admin_id}..."
    stellar contract invoke \
        --id "${admin_id}" \
        --source "${ADMIN_SECRET}" \
        --network "${NETWORK}" \
        -- emergency_pause_all 2>&1
}

# Dispatch subcommands (only when the first arg is a known helper).
case "${NETWORK}" in
    dry-run-migrate)
        shift
        cmd_dry_run_migrate "$@"
        exit $?
        ;;
    migrate-step)
        shift
        cmd_migrate_step "$@"
        exit $?
        ;;
    migrate-until-complete)
        shift
        cmd_migrate_until_complete "$@"
        exit $?
        ;;
    emergency-pause-all)
        cmd_emergency_pause_all
        exit $?
        ;;
esac
