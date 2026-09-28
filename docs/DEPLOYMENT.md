# Deploying Smart Contracts to Stellar Testnet

This guide walks you through building, configuring identities, deploying all four Cypher GridPay smart contracts (`admin`, `payment`, `escrow`, and `refund`) to the Stellar Testnet, and initializing cross-contract bindings.

---

## Prerequisites

Ensure you have the following installed and configured:

1. **Rust & `wasm32` Target**:
   ```bash
   rustup target add wasm32-unknown-unknown
   ```

2. **Stellar CLI**:
   ```bash
   cargo install --locked stellar-cli --features opt
   ```

3. **`jq` (for JSON processing)**:
   ```bash
   sudo apt-get install jq # Ubuntu/Debian
   brew install jq         # macOS
   ```

4. **Stellar Testnet Network Configuration**:
   ```bash
   stellar network add \
     --rpc-url https://soroban-testnet.stellar.org \
     --network-passphrase "Test SDF Network ; September 2015" \
     testnet
   ```

---

## Option 1: Automated Deployment (`scripts/deploy-testnet.sh`)

We provide an automated deployment script that builds, deploys, cross-registers contracts, and writes an output deployment manifest.

### Run Automated Deployment

```bash
# Basic run with defaults (creates/uses identity 'deployer' on testnet)
./scripts/deploy-testnet.sh
```

### Custom Configuration via Environment Variables

```bash
export NETWORK="testnet"
export RPC_URL="https://soroban-testnet.stellar.org"
export IDENTITY="my-deployer-account"
export OUTPUT_MANIFEST="my-deployment-manifest.json"

./scripts/deploy-testnet.sh
```

### Deployment Manifest Output

Upon completion, `deployment-manifest.json` is generated:

```json
{
  "network": "testnet",
  "rpc_url": "https://soroban-testnet.stellar.org",
  "network_passphrase": "Test SDF Network ; September 2015",
  "deployer": "GBZXDV4KL7WV5N4E5QJ8L6M3A2B1C0D9E8F7G6H5I4J3K2L1M0N",
  "deployed_at": "2026-09-28T10:05:00Z",
  "contracts": {
    "admin": "CBIXG4KL7WV5N4E5QJ8L6M3A2B1C0D9E8F7G6H5I4J3K2L1M0N",
    "payment": "CAIXG4KL7WV5N4E5QJ8L6M3A2B1C0D9E8F7G6H5I4J3K2L1M0N",
    "escrow": "CCIXG4KL7WV5N4E5QJ8L6M3A2B1C0D9E8F7G6H5I4J3K2L1M0N",
    "refund": "CDIXG4KL7WV5N4E5QJ8L6M3A2B1C0D9E8F7G6H5I4J3K2L1M0N"
  }
}
```

---

## Option 2: Manual Step-by-Step Deployment

If you prefer deploying step-by-step or deploying to custom private networks, follow these instructions:

### Step 1: Create and Fund Deployer Identity

```bash
# Generate keypair
stellar keys generate --network testnet deployer

# Obtain public key address
DEPLOYER_ADDR=$(stellar keys address deployer)

# Fund account via testnet Friendbot
stellar keys fund deployer --network testnet
```

### Step 2: Build Contract WASM Artifacts

```bash
# Build core contracts (payment, escrow, refund)
make -C core build

# Build orchestrator contract (admin)
make -C orchestrator build
```

WASM artifacts are produced in:
- `core/target/wasm32v1-none/release/gridpay_payment.wasm`
- `core/target/wasm32v1-none/release/gridpay_escrow.wasm`
- `core/target/wasm32v1-none/release/gridpay_refund.wasm`
- `orchestrator/target/wasm32v1-none/release/gridpay_admin.wasm`

### Step 3: Deploy the Contracts

```bash
# 1. Deploy Payment contract
PAYMENT_ID=$(stellar contract deploy \
  --wasm core/target/wasm32v1-none/release/gridpay_payment.wasm \
  --source deployer \
  --network testnet)

# 2. Deploy Escrow contract
ESCROW_ID=$(stellar contract deploy \
  --wasm core/target/wasm32v1-none/release/gridpay_escrow.wasm \
  --source deployer \
  --network testnet)

# 3. Deploy Refund contract
REFUND_ID=$(stellar contract deploy \
  --wasm core/target/wasm32v1-none/release/gridpay_refund.wasm \
  --source deployer \
  --network testnet)

# 4. Deploy Admin contract
ADMIN_ID=$(stellar contract deploy \
  --wasm orchestrator/target/wasm32v1-none/release/gridpay_admin.wasm \
  --source deployer \
  --network testnet)
```

### Step 4: Initialize Contracts

```bash
# Initialize Admin orchestrator with core contract addresses
stellar contract invoke \
  --id "${ADMIN_ID}" \
  --source deployer \
  --network testnet \
  -- \
  initialize \
  --admin "${DEPLOYER_ADDR}" \
  --payment "${PAYMENT_ID}" \
  --escrow "${ESCROW_ID}" \
  --refund "${REFUND_ID}"
```

### Step 5: Verify Deployment

Verify contract state on testnet:

```bash
# Query admin contract status
stellar contract invoke \
  --id "${ADMIN_ID}" \
  --source deployer \
  --network testnet \
  -- \
  get_contracts
```
