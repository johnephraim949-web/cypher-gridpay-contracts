# Soroban TTL Renewal (ops/ttl-keeper)

`ops/ttl-keeper` is a Node/TypeScript job that:

1. Reads the instance and executable-code ledger entries of `CONTRACT_IDS` (plus optional indexer-reported keys from
   `EXTRA_KEYS_URL`, expected as `{"keys":["<base64 LedgerKey>"]}`).
2. Selects entries with `liveUntilLedgerSeq - currentLedger < MIN_TTL_THRESHOLD`.
3. Extends them to `TARGET_TTL_LEDGERS` with `extendFootprintTtl`, in chunks of `CHUNK_SIZE`, retrying RPC errors with
   jittered backoff.
4. Halts before any chunk that would exceed `MAX_XLM_PER_RUN` (`SpendGuard` in `src/plan.ts`).
5. `--dry-run` simulates each chunk and prints the exact `minResourceFee` estimate, with no transactions sent.
   It needs `KEEPER_PUBLIC_KEY` (a funded account) for simulation.

Metrics (`ttl_entries_extended_total`, `ttl_xlm_spent_total`, ...) are printed and optionally pushed to
`PUSHGATEWAY_URL`; a summary goes to `SLACK_WEBHOOK_URL` if set.

Deployment: `ops/ttl-keeper/k8s/ttl-keeper-cronjob.yaml` (plain manifest; the repo has no Helm chart so
`deploy/helm/...` from the issue was not created). Replace the placeholder image tag and contract IDs, and create the
`ttl-keeper` Secret.

Not covered / not verified: nothing was built or run. Per-key persistent entries (individual escrow/refund records)
are only covered if the indexer exposes a key-list endpoint, which does not exist today. The contracts'
`batch_bump_critical` (escrow, payment) is not called by this job. No GitHub Actions schedule was added. Unit tests
are in `ops/ttl-keeper/test/` and need `npm install` plus `npm test` to run.
