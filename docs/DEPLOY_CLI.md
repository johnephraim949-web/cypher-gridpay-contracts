# Deployment CLI

`scripts/deploy-cli.sh` is an idempotent, multi-environment wrapper for deploying the
Payment, Escrow, Refund and Admin contracts. `scripts/deploy-testnet.sh` is unchanged.

```bash
scripts/deploy-cli.sh --network testnet --dry-run
scripts/deploy-cli.sh --network testnet --mode fresh --source admin
scripts/deploy-cli.sh --network testnet --mode upgrade --propose-upgrade
scripts/verify-deployment-cli.sh --network testnet
```

- `--dry-run` prints the plan, WASM sizes and SHA-256 hashes and performs no on-chain or manifest writes.
- WASM is auto-detected under `wasm32v1-none` then `wasm32-unknown-unknown`, then `stellar contract optimize` is attempted.
- State ledger: `deployments/<network>/manifest.json` records contract IDs, WASM SHA-256, git SHA, deployer,
  ledger sequence and completed `steps`. Re-running skips completed steps (resume after a timeout).
- `fresh` deploys, initializes, wires and runs read-only health checks (`get_schema_version`, `get_system_status`).
- `upgrade` uploads new WASM, prints hashes and optionally calls `propose_upgrade` on the Admin contract.
- Mainnet: `ADMIN_SECRET` is refused (use a KMS/hardware-backed `stellar keys` identity via `--source`) and an
  interactive confirmation phrase is required for fresh deploys.

Caveats: this was written without being executed. The `propose_upgrade` argument names and the exact
`stellar` CLI flags (`ledger latest`, `--send=no`) should be confirmed against your installed CLI version and
the Admin ABI. Whether `deployments/` should be committed or git-ignored is a maintainer decision.
