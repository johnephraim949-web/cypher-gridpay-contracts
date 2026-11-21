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
