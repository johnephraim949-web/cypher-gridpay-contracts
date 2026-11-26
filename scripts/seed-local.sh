#!/usr/bin/env bash
# seed-local.sh: deploy the 4 GridPay contracts to a LOCAL STANDALONE network
# and write local-manifest.json (issue #363). Run by the `gridpay-bootstrap`
# compose service, or manually with the env vars below.
# Never runs against Testnet/Mainnet: refuses on a matching passphrase.
# NOT EXECUTED by the author: mirrors scripts/deploy-testnet.sh invocations.
set -euo pipefail

NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Standalone Network ; February 2017}"
RPC_URL="${RPC_URL:-http://localhost:8001}"
FRIENDBOT_URL="${FRIENDBOT_URL:-http://localhost:8000/friendbot}"
SHARED_DIR="${SHARED_DIR:-./local-shared}"
CORE_DIR="${WASM_DIR_CORE:-core/target/wasm32v1-none/release}"
ORCH_DIR="${WASM_DIR_ORCH:-orchestrator/target/wasm32v1-none/release}"
IDENTITY="gridpay-local-STANDALONE-ONLY"

case "${NETWORK_PASSPHRASE}" in
  *"Test SDF Network"*|*"Public Global Stellar Network"*)
    echo "[ERROR] Refusing to run: NETWORK_PASSPHRASE is Testnet/Mainnet." >&2; exit 1 ;;
esac
[[ "${NETWORK_PASSPHRASE}" == Standalone\ Network* ]] || {
  echo "[ERROR] Refusing to run: not a Standalone network passphrase." >&2; exit 1; }

command -v stellar >/dev/null || { echo "[ERROR] stellar CLI required" >&2; exit 1; }
for w in "${CORE_DIR}/payment.wasm" "${CORE_DIR}/escrow.wasm" "${CORE_DIR}/refund.wasm" "${ORCH_DIR}/admin.wasm"; do
  [[ -f "$w" ]] || { echo "[ERROR] missing WASM: $w (run 'make build')" >&2; exit 1; }
done

NET=(--rpc-url "${RPC_URL}" --network-passphrase "${NETWORK_PASSPHRASE}")

# Deterministic-by-name dev identity; funded from friendbot. Local only.
stellar keys generate "${IDENTITY}" --fund "${NET[@]}" 2>/dev/null \
  || stellar keys fund "${IDENTITY}" "${NET[@]}" 2>/dev/null || true
ADMIN_ADDRESS="$(stellar keys address "${IDENTITY}")"

deploy() { stellar contract deploy --wasm "$1" --source "${IDENTITY}" "${NET[@]}" | tail -1; }
invoke() { local id="$1"; shift; stellar contract invoke --id "$id" --source "${IDENTITY}" "${NET[@]}" -- "$@"; }

PAYMENT_ID="$(deploy "${CORE_DIR}/payment.wasm")"
ESCROW_ID="$(deploy "${CORE_DIR}/escrow.wasm")"
REFUND_ID="$(deploy "${CORE_DIR}/refund.wasm")"
ADMIN_ID="$(deploy "${ORCH_DIR}/admin.wasm")"

invoke "${ADMIN_ID}" initialize --admin "${ADMIN_ADDRESS}" --pauser "${ADMIN_ADDRESS}" \
  --payment_contract "${PAYMENT_ID}" --escrow_contract "${ESCROW_ID}" --refund_contract "${REFUND_ID}"
invoke "${PAYMENT_ID}" initialize --admin "${ADMIN_ADDRESS}"
invoke "${ESCROW_ID}" initialize --admin "${ADMIN_ADDRESS}"
invoke "${REFUND_ID}" initialize --admin "${ADMIN_ADDRESS}"
# TODO: cross-register peer contract IDs and mint test USDC (see deploy-testnet.sh).

mkdir -p "${SHARED_DIR}"
cat > "${SHARED_DIR}/local-manifest.json" <<JSON
{
  "network": "standalone",
  "warning": "STANDALONE-ONLY keys. Never reuse on Testnet/Mainnet.",
  "rpc_url": "${RPC_URL}",
  "admin_address": "${ADMIN_ADDRESS}",
  "contracts": {
    "payment": "${PAYMENT_ID}",
    "escrow": "${ESCROW_ID}",
    "refund": "${REFUND_ID}",
    "admin": "${ADMIN_ID}"
  }
}
JSON
echo "[INFO] wrote ${SHARED_DIR}/local-manifest.json"
