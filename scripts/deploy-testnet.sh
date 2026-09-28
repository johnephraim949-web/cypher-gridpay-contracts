#!/usr/bin/env bash
# ==============================================================================
# scripts/deploy-testnet.sh
# Cypher GridPay Smart Contracts Testnet Deployment Script
#
# Automates:
# 1. Building all contract WASM artifacts
# 2. Deploying Payment, Escrow, Refund, and Admin contracts to Stellar Testnet
# 3. Initializing Admin contract with deployed contract addresses
# 4. Generating deployment manifest JSON
# ==============================================================================

set -euo pipefail

NETWORK="${NETWORK:-testnet}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
IDENTITY="${IDENTITY:-deployer}"
OUTPUT_MANIFEST="${OUTPUT_MANIFEST:-deployment-manifest.json}"

echo "=========================================================="
echo " Starting Cypher GridPay Testnet Deployment"
echo " Network:           ${NETWORK}"
echo " RPC URL:           ${RPC_URL}"
echo " Deployer Identity: ${IDENTITY}"
echo " Manifest Output:   ${OUTPUT_MANIFEST}"
echo "=========================================================="

# 1. Check prerequisites
command -v stellar >/dev/null 2>&1 || {
    echo "ERROR: stellar CLI is not installed. Install via: cargo install --locked stellar-cli" >&2
    exit 1
}

command -v jq >/dev/null 2>&1 || {
    echo "ERROR: jq is not installed. Please install jq." >&2
    exit 1
}

# 2. Setup / verify deployer identity
if ! stellar keys address "${IDENTITY}" >/dev/null 2>&1; then
    echo "Creating new deployer identity: ${IDENTITY}..."
    stellar keys generate --network "${NETWORK}" "${IDENTITY}"
fi

DEPLOYER_ADDRESS=$(stellar keys address "${IDENTITY}")
echo "Deployer Address: ${DEPLOYER_ADDRESS}"

echo "Ensuring deployer account is funded via Friendbot..."
stellar keys fund "${IDENTITY}" --network "${NETWORK}" || echo "Deployer already funded."

# 3. Build WASM artifacts
echo "Building smart contracts..."
make build

PAYMENT_WASM="core/target/wasm32v1-none/release/gridpay_payment.wasm"
ESCROW_WASM="core/target/wasm32v1-none/release/gridpay_escrow.wasm"
REFUND_WASM="core/target/wasm32v1-none/release/gridpay_refund.wasm"
ADMIN_WASM="orchestrator/target/wasm32v1-none/release/gridpay_admin.wasm"

# 4. Deploy contracts
echo "Deploying Payment contract..."
PAYMENT_ID=$(stellar contract deploy \
    --wasm "${PAYMENT_WASM}" \
    --source "${IDENTITY}" \
    --network "${NETWORK}")
echo " Payment Contract ID: ${PAYMENT_ID}"

echo "Deploying Escrow contract..."
ESCROW_ID=$(stellar contract deploy \
    --wasm "${ESCROW_WASM}" \
    --source "${IDENTITY}" \
    --network "${NETWORK}")
echo " Escrow Contract ID:  ${ESCROW_ID}"

echo "Deploying Refund contract..."
REFUND_ID=$(stellar contract deploy \
    --wasm "${REFUND_WASM}" \
    --source "${IDENTITY}" \
    --network "${NETWORK}")
echo " Refund Contract ID:  ${REFUND_ID}"

echo "Deploying Admin Orchestrator contract..."
ADMIN_ID=$(stellar contract deploy \
    --wasm "${ADMIN_WASM}" \
    --source "${IDENTITY}" \
    --network "${NETWORK}")
echo " Admin Contract ID:   ${ADMIN_ID}"

# 5. Initialize Admin Contract with cross-registered addresses
echo "Initializing Admin orchestrator contract..."
stellar contract invoke \
    --id "${ADMIN_ID}" \
    --source "${IDENTITY}" \
    --network "${NETWORK}" \
    -- \
    initialize \
    --admin "${DEPLOYER_ADDRESS}" \
    --payment "${PAYMENT_ID}" \
    --escrow "${ESCROW_ID}" \
    --refund "${REFUND_ID}" || echo "Note: Initialized or already configured."

# 6. Generate deployment manifest JSON
TIMESTAMP=$(date -u +"%Y-%m-%dT%H:%M:%SZ")

cat <<EOF > "${OUTPUT_MANIFEST}"
{
  "network": "${NETWORK}",
  "rpc_url": "${RPC_URL}",
  "network_passphrase": "${NETWORK_PASSPHRASE}",
  "deployer": "${DEPLOYER_ADDRESS}",
  "deployed_at": "${TIMESTAMP}",
  "contracts": {
    "admin": "${ADMIN_ID}",
    "payment": "${PAYMENT_ID}",
    "escrow": "${ESCROW_ID}",
    "refund": "${REFUND_ID}"
  }
}
EOF

echo "=========================================================="
echo " Deployment Complete!"
echo " Deployment manifest written to ${OUTPUT_MANIFEST}"
cat "${OUTPUT_MANIFEST}"
echo "=========================================================="
