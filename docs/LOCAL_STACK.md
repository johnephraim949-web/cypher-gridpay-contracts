# Local Stellar Stack

`docker-compose.yml` runs a standalone Stellar network plus Soroban RPC.

```bash
make build            # produce WASM artifacts (needed for seeding)
make localnet-up      # quickstart + soroban-rpc + seed (profile "seed")
make localnet-down
make localnet-reset   # wipe volumes, restart, re-seed
```

- `soroban-rpc` waits for `stellar-quickstart` to be healthy
  (`depends_on: condition: service_healthy`); both have healthchecks
  (HTTP `/` and JSON-RPC `getHealth`).
- Images are pinned by sha256 digest (resolved 2026-11-22). `soroban-rpc` is
  amd64-only, so it runs emulated on Apple Silicon.
- `scripts/seed-local.sh` (service `gridpay-bootstrap`, profile `seed`) deploys
  payment, escrow, refund and admin, initializes them, and writes
  `local-manifest.json` to the `gridpay-shared` volume. It refuses to run for
  non-Standalone passphrases and uses a `STANDALONE-ONLY` identity.

Not yet verified or done: nothing here has been run; the healthchecks assume
`curl` is present in the images; peer-contract cross-registration and test USDC
minting are TODOs in the seed script; the 120s startup target is unmeasured.
