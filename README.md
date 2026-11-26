# GridPay Contracts

Soroban smart contracts and SDKs for the GridPay payment, escrow, and refund platform on Stellar.

## Documentation

- [Mainnet Launch Checklist](docs/MAINNET_LAUNCH_CHECKLIST.md)
- [Operational Runbook](docs/OPERATIONAL_RUNBOOK.md)
- [TypeScript SDK Cookbook & Browser/Node Integration Guide](docs/TYPESCRIPT_SDK.md)
- [TypeScript SDK README](sdk/typescript/README.md)

## SDKs

- TypeScript: [`@cypher-gridpay/contracts-sdk`](sdk/typescript/README.md) — see the [full cookbook](docs/TYPESCRIPT_SDK.md) for transaction lifecycle helpers, typed error decoding, event parsing, and browser/Node integration.
- Python: [`sdk/python`](sdk/python/README.md)

## Examples

Runnable TypeScript examples live in [`examples/typescript/`](examples/typescript/):

- `create-payment.ts` — create a payment with simulation and TTL restoration
- `escrow-milestone.ts` — release an escrow milestone
- `event-listener.ts` — stream and parse contract events

## Development

See the individual SDK READMEs and the operational runbook for local development, binding regeneration (`./scripts/generate-ts-bindings.sh`), and deployment workflows.
## 🚀 Quick Start

### Build All Contracts

```bash
# From root directory
make
```

### Run Tests

```bash
# Run all workspace tests (core + orchestrator)
make test

# Core workspace (escrow, payments, refund)
cargo test --workspace      # from inside core/

# Orchestrator workspace (admin)
cargo test --workspace      # from inside orchestrator/

# Test a single test file or function within a contract
cargo test -p refund test_arbitration_fees   # from inside core/
cargo test -p escrow test_dispute_resolution # from inside core/

# Run tests matching a pattern
cargo test -p payments test_fee # from inside core/
```

### Gasless Relayer Service

```bash
# Typecheck, build and test the fee-bump relayer (Node 18+)
make relayer-test
```

See [`services/relayer/README.md`](services/relayer/README.md) for the `POST /v1/relayer/sponsor` API, policy engine, channel pool and configuration.

## 📂 Contract Overview

| Contract | Responsibilities |
| --- | --- |
| [Payment](core/contracts/payment/README.md) | Payment creation and settlement, private invoice routing, subscriptions and dunning, streaming channels, token allowlists and conversion rates. |
| [Escrow](core/contracts/escrow/README.md) | Conditional custody, hold periods, child escrows, dispute voting, release, swaps and emergency clawback. |
| [Refund](core/contracts/refund/README.md) | Refund policy, caps and settlement, dispute evidence, appeals, arbitrator staking and reputation. |
| [Admin Orchestrator](orchestrator/contracts/admin/README.md) | Coordinated pauses, contract address rotations, WASM upgrades, policy synchronization and supreme dispute decisions. |

### Refund Reason Code Migration (Breaking)

`request_refund()` now requires a `reason_code: RefundReasonCode` argument in addition to free-text `reason`.

- Old call shape: `request_refund(..., reason, payment_created_at)`
- New call shape: `request_refund(..., reason, reason_code, payment_created_at)`

Recommended migration path:
1. Update all callers to pass a concrete enum value (`ProductDefect`, `NonDelivery`, `DuplicateCharge`, `Unauthorized`, `CustomerRequest`, `Other`).
2. For unknown/legacy flows, pass `Other` first and backfill specific codes in your upstream app logic.
3. If upgrading a deployed instance with existing data, plan a storage/data migration for historical refunds before reading them as the new `Refund` shape.

## 🧩 Client SDK (TypeScript)

Type-safe client bindings for all four contracts are generated from the
compiled WASM and published as `@cypher-gridpay/contracts-sdk`:

```bash
# Generate bindings (builds the contracts first)
./scripts/generate-ts-bindings.sh

# Build and pack the package
cd sdk/typescript
npm install
npm run build
npm pack          # -> cypher-gridpay-contracts-sdk-<version>.tgz
```

```ts
import { PaymentsClient } from "@cypher-gridpay/contracts-sdk";

const client = new PaymentsClient({
  contractId: paymentContractId,
  publicKey: viewerPublicKey,
  server,
  networkPassphrase: Networks.TESTNET,
});

const payment = await client.getPayment(paymentId);
```

Pass no `source` for a read-only client. Re-run the generator after any contract
interface change — the generated `.d.ts` turns a breaking change into a compile
error in your app. See [sdk/typescript/README.md](sdk/typescript/README.md).

## ⚙️ Crank Worker (TypeScript)

Soroban contracts cannot self-execute on a timer. `services/crank-worker/` is the off-chain
automation worker for due scheduled payments, recurring subscriptions, dunning retries, trial
conversion notices, payment expiry, arbitration timeouts and stale-escrow cleanup. It reads
indexed PostgreSQL schedules, simulates before submitting (zero gas for already-executed items),
uses sequence-number channel accounts with TTL restoration, and exposes Prometheus metrics.

```bash
make crank-install
psql "$DATABASE_URL" -f services/crank-worker/sql/001_crank_schedule.sql
make crank-test
```

See [services/crank-worker/README.md](services/crank-worker/README.md) for configuration and
deployment details.

## 🔄 Development Workflow

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Write tests for your changes
4. Ensure all tests pass (`cargo test --workspace`)
5. Commit your changes (`git commit -m 'Add amazing feature'`)
6. Push to your branch (`git push origin feature/amazing-feature`)
7. Open a Pull Request

## Documentation Index

| Guide |
| --- |
| [Architecture](docs/ARCHITECTURE.md) |
| [Deployment](docs/DEPLOYMENT.md) |
| [Economic invariants](docs/ECONOMIC_INVARIANTS.md) |
| [Error codes](docs/ERROR_CODES.md) |
| [Gas and WASM optimization](docs/GAS_AND_WASM_OPTIMIZATION.md) |
| [Glossary](docs/GLOSSARY.md) |
| [Merchant integration](docs/MERCHANT_INTEGRATION_GUIDE.md) |
| [Multi-asset and oracle configuration](docs/MULTI_ASSET_AND_ORACLES.md) |
| [Operational runbook](docs/OPERATIONAL_RUNBOOK.md) |
| [Privacy and compliance](docs/PRIVACY_AND_COMPLIANCE.md) |
| [Python SDK](docs/PYTHON_SDK.md) |
| [Storage restoration](docs/STORAGE_RESTORATION.md) |
| [Storage versioning](docs/STORAGE_VERSIONING.md) |
| [Testing](docs/TESTING_GUIDE.md) |
| [Admin orchestrator UX](docs/ux/admin-orchestrator-safety-ux.md) |
| [Analytics visualization UX](docs/ux/analytics-dataviz-spec.md) |
| [Streaming channels UX](docs/ux/streaming-channels-ux.md) |
| [Wallet onboarding UX](docs/ux/wallet-onboarding-ux.md) |
| [Backend services architecture](docs/BACKEND_SERVICES_ARCHITECTURE.md) |
| [Dispute evidence storage](docs/DISPUTE_EVIDENCE_STORAGE.md) |
| [Escape hatch and governance timelock](docs/ESCAPE_HATCH_AND_GOVERNANCE_TIMELOCK.md) |
| [Escrow extensions and arbitration](docs/ESCROW_EXTENSIONS_AND_ARBITRATION.md) |
| [Event indexer architecture](docs/EVENT_INDEXER_ARCHITECTURE.md) |
| [Financial accounting and audit exports](docs/FINANCIAL_ACCOUNTING_AND_AUDIT_EXPORTS.md) |
| [Ledger reconciliation](docs/LEDGER_RECONCILIATION.md) |
| [Multisig proposal coordination](docs/MULTISIG_PROPOSAL_COORDINATION.md) |
| [Payment channel watchtower service](docs/PAYMENT_CHANNEL_WATCHTOWER_SERVICE.md) |
| [Preflight compliance and fraud screening](docs/PREFLIGHT_COMPLIANCE_AND_FRAUD_SCREENING.md) |
| [Smart meter ingestion gateway](docs/SMART_METER_INGESTION_GATEWAY.md) |
| [Soroban RPC load balancer](docs/SOROBAN_RPC_LOAD_BALANCER.md) |
| [Webhook events](docs/WEBHOOK_EVENTS.md) |
| [Split forwarding configurator](docs/ux/split-forwarding-configurator.md) |
| [System status banners](docs/ux/system-status-banners.md) |
| [TypeScript SDK](sdk/typescript/README.md) |
| [Design tokens](packages/design-tokens/README.md) |
| [Payment validation](PAYMENT_VALIDATION_FEATURES.md) |
| [Security policy](SECURITY.md) |
| [Contributor guide](CONTRIBUTING.md) |
| [Changelog](CHANGELOG.md) |

Community chat is available on Telegram at https://t.me/+afM9uh7GGtVkYmZk.
## 🔗 Links

- [Merchant Integration Guide](docs/MERCHANT_INTEGRATION_GUIDE.md)
- [TypeScript SDK](sdk/typescript/README.md)
- [Python SDK](docs/PYTHON_SDK.md)
- [Storage Versioning Guide](docs/STORAGE_VERSIONING.md)
- [Storage Restoration Guide](docs/STORAGE_RESTORATION.md)
- [Subscriptions, Metered Billing, Dunning & Streaming Guide](docs/SUBSCRIPTIONS_AND_STREAMING_GUIDE.md)
- Telegram: https://t.me/+afM9uh7GGtVkYmZk
- [API Repository](https://github.com/cypher-gridpay/cypher-gridpay-api)
- [SDK Repository](https://github.com/cypher-gridpay/cypher-gridpay-sdk)


## License

This project is licensed under the [MIT License](LICENSE).
