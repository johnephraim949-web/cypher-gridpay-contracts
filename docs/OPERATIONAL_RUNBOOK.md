# Operational Runbook: Incident Response

This runbook is for the protocol team when a security vulnerability or live exploit affects the Cypher GridPay contracts. It walks through the order of operations: **contain → verify → investigate → recover → upgrade → resume**.

Keep it next to your signing setup. In an incident, the aim is to run the commands below without stopping to look anything up.

> **Related references:**
> - [STORAGE_VERSIONING.md](./STORAGE_VERSIONING.md) — complete storage key inventory, chunked `migrate_schema_step` runbook, and XDR compatibility pitfalls.
> - [STORAGE_RESTORATION.md](./STORAGE_RESTORATION.md) — decision matrix for automated `restorePreamble` vs. manual keeper/admin restoration, and `verify_archived_record_inclusion`.
> - [ARCHITECTURE.md](./ARCHITECTURE.md) — contract topology and storage tiers.

---

## 0. Before an incident: preparation checklist

Do these ahead of time. During an incident there is no time to set up keys.

- [ ] The **pauser** identity for the admin (orchestrator) contract is available to at least two on-call engineers (hardware wallet or multisig signer).
- [ ] The pauser address is a member of the multisig admin list on the **payment** and **escrow** contracts, and is the admin of the **refund** contract. `emergency_pause_all` forwards the pauser address to each child contract. If any child rejects it, **the whole call reverts and nothing is paused** (see [§2.3](#23-fallback-pause-each-contract-directly)).
- [ ] The **admin** identity for the admin contract (used to repoint child contracts after an upgrade) is available.
- [ ] Contract IDs are recorded below and in the team password manager.
- [ ] A keeper or cron job calls `ping` on the admin contract at least every few weeks so its instance TTL never lapses (see [§6](#6-keeping-contracts-alive-ttl)).
- [ ] Storage layout and archival recovery procedures reviewed against [STORAGE_VERSIONING.md](./STORAGE_VERSIONING.md) and [STORAGE_RESTORATION.md](./STORAGE_RESTORATION.md).

### Environment variables used in this runbook

```bash
export NETWORK=testnet                 # or: mainnet
export PAUSER=pauser                   # stellar keys identity name of the pauser
export ADMIN=admin                     # stellar keys identity name of the orchestrator admin

export ADMIN_ID=C...                   # admin / orchestrator contract
export PAYMENT_ID=C...                 # payment contract
export ESCROW_ID=C...                  # escrow contract
export REFUND_ID=C...                  # refund contract

export PAUSER_ADDR=$(stellar keys address $PAUSER)
export ADMIN_ADDR=$(stellar keys address $ADMIN)
```

To add identities, use `stellar keys add <name> --secret-key` (you will be prompted) or `stellar keys add <name> --seed-phrase`. Never paste secrets into shell history or chat.

---

## 1. Triage (first 5 minutes)

1. **Declare the incident** in the private security channel and name an incident lead. From this point, only the lead decides when to pause and when to resume.
2. **Record the facts:** the time, the suspected contract(s), the transaction hashes, and the attacker addresses.
3. **Decide the pause scope:**

| Situation | Action |
|---|---|
| Active exploit, or root cause unknown | **Global emergency pause** ([§2.1](#21-global-emergency-pause-preferred)) |
| Bug confined to one entry point, funds not at immediate risk | Function-level pause on the affected contract ([§2.4](#24-targeted-function-level-pause)) |
| Suspected compromise of the pauser/admin key | Global pause with a **different** key if possible, then treat key rotation as part of recovery |

When in doubt, pause everything. Resuming is cheap. Lost funds usually cannot be recovered.

---

## 2. Containment: triggering the pause

### 2.1 Global emergency pause (preferred)

This pauses payment, escrow, and refund in a single atomic transaction:

```bash
stellar contract invoke \
  --id $ADMIN_ID \
  --source-account $PAUSER \
  --network $NETWORK \
  -- emergency_pause_all \
  --pauser $PAUSER_ADDR \
  --reason "INC-2026-XX: <short description>"
```

The `reason` string is written to each child contract's `PauseState` and pause history. Put the incident ID in it.

### 2.2 Common failures

| Error | Meaning | Fix |
|---|---|---|
| `Error(Contract, #2)` `NotInitialized` | Admin contract was never initialized | Use [§2.3](#23-fallback-pause-each-contract-directly) |
| `Error(Contract, #3)` `Unauthorized` | `--pauser` is not the stored pauser | Check `$PAUSER_ADDR`, use the correct identity |
| Auth / signature error | Source account didn't sign for the pauser | Make sure `--source-account` is the pauser identity |
| Child contract error (e.g. `Unauthorized`, `MultiSigNotInitialized`) | Pauser is not an admin on that child | The whole transaction reverted. Use [§2.3](#23-fallback-pause-each-contract-directly) |
| Entry archived | Admin contract instance TTL lapsed | `stellar contract restore --id $ADMIN_ID ...`, then retry (see [§6](#6-keeping-contracts-alive-ttl) and [STORAGE_RESTORATION.md](./STORAGE_RESTORATION.md)) |

### 2.3 Fallback: pause each contract directly

If the orchestrator is unavailable, call `pause_contract` on each child with an identity that is an admin there. Run all three commands, even if one of them fails:

```bash
for ID in $PAYMENT_ID $ESCROW_ID $REFUND_ID; do
  stellar contract invoke \
    --id $ID \
    --source-account $PAUSER \
    --network $NETWORK \
    -- pause_contract \
    --admin $PAUSER_ADDR \
    --reason "INC-2026-XX: <short description>"
done
```

### 2.4 Targeted function-level pause

For a narrowly scoped bug, pause only the affected entry point. Each child contract supports this:

```bash
stellar contract invoke \
  --id $PAYMENT_ID \
  --source-account $PAUSER \
  --network $NETWORK \
  -- pause_function \
  --admin $PAUSER_ADDR \
  --function_name "<function_name>" \
  --reason "INC-2026-XX: <short description>"
```

---

## 3. Verify the pause took effect

Do not assume the pause worked. Check every contract. View calls use `--send=no`, so they simulate without submitting a transaction:

```bash
for ID in $PAYMENT_ID $ESCROW_ID $REFUND_ID; do
  echo "== $ID"
  stellar contract invoke --id $ID --source-account $PAUSER --network $NETWORK --send=no \
    -- get_pause_state
done
```

Each result must show `"globally_paused": true`. For a function-level pause, the function must appear in `paused_functions`. Also check that `paused_by` and `pause_reason` match what you submitted.

Escrow also keeps a queryable pause history:

```bash
stellar contract invoke --id $ESCROW_ID --source-account $PAUSER --network $NETWORK --send=no \
  -- get_pause_history --limit 10 --offset 0
```

As a final check, try a state-changing call as a regular user in simulation (for example `create_payment` with `--send=no`). It should be rejected while paused.

---

## 4. Post-incident inspection

Once the contracts are paused, the goal is to understand what happened **without changing state**.

### 4.1 Collect on-chain evidence

```bash
# Contract events emitted since a given ledger (payment, escrow, refund, admin)
stellar events --network $NETWORK --start-ledger <LEDGER_BEFORE_INCIDENT> \
  --id $PAYMENT_ID --id $ESCROW_ID --id $REFUND_ID --id $ADMIN_ID --output json > incident-events.json
```

For individual transactions, look up each suspicious hash in a block explorer (e.g. stellar.expert) or query it through RPC `getTransaction`. Save the full result XDR with the incident notes.

### 4.2 Snapshot affected state

Record the state of every affected record before any recovery action. Use the read-only getters, for example:

```bash
stellar contract invoke --id $PAYMENT_ID --source-account $PAUSER --network $NETWORK --send=no \
  -- get_payment --payment_id <ID>
stellar contract invoke --id $ESCROW_ID  --source-account $PAUSER --network $NETWORK --send=no \
  -- get_escrow --escrow_id <ID>
stellar contract invoke --id $REFUND_ID  --source-account $PAUSER --network $NETWORK --send=no \
  -- get_refund --refund_id <ID>
```

Also record the schema version of each contract (`get_schema_version`) and the wasm hash currently deployed:

```bash
stellar contract fetch --id $PAYMENT_ID --network $NETWORK -o payment-deployed.wasm
sha256sum payment-deployed.wasm
```

Use `stellar contract info interface --id <ID> --network $NETWORK` to confirm which interface is live.

### 4.3 Checklist

- [ ] Root cause identified and reproduced in a unit test (`cargo test` in `core/` or `orchestrator/`)
- [ ] Complete list of affected payment / escrow / refund IDs
- [ ] Token balances held by each contract reconciled against the stored records
- [ ] Deci

- [Admin contract README](../orchestrator/contracts/admin/README.md)
- [Storage versioning](./STORAGE_VERSIONING.md)
- [Deployment](./DEPLOYMENT.md)
- [Security policy](../SECURITY.md)
- [Multi-Asset & Oracle Configuration Guide](./MULTI_ASSET_AND_ORACLES.md) — token delisting, oracle staleness and manual fallback procedures
- [Economic invariants & balance conservation](./ECONOMIC_INVARIANTS.md)
/* … truncated 5097 chars — edit only what you need near the top … */


---

# Part II — Off-Chain Database Backup, PITR & Disaster Recovery Drill Automation

> **Scope:** This section covers off-chain PostgreSQL disaster recovery (issue #379).
> Part I above covers on-chain contract incident response. The two are independent:
> on-chain truth lives on the Stellar ledger; off-chain indexed data lives in PostgreSQL
> and must be backed up and recovered separately.

**Issue:** [#379](https://github.com/johnephraim949-web/cypher-gridpay-contracts/issues/379)
**Last Updated:** 2026-11-22

---

## Table of Contents (Part II)

1. [Overview & Architecture](#overview--architecture)
2. [Scope: What Lives Where](#scope-what-lives-where)
3. [Backup Configuration](#backup-configuration)
4. [Retention Policy](#retention-policy)
5. [DR Drill Automation](#dr-drill-automation)
6. [DR Drill Metrics](#dr-drill-metrics)
7. [Alerting](#alerting)
8. [Manual Recovery Procedures](#manual-recovery-procedures)
9. [DR Drill Troubleshooting](#dr-drill-troubleshooting)
10. [Security Invariants & Hard Rules](#security-invariants--hard-rules)
11. [Acceptance Criteria Matrix](#acceptance-criteria-matrix)

---

## Overview & Architecture

While canonical financial truth lives on the Stellar ledger, Cypher GridPay's off-chain
PostgreSQL database stores indexed event history, webhook subscriptions, encrypted evidence
metadata, merchant settings, and reconciliation snapshots. Corruption or accidental data loss
without *tested* recovery procedures would break merchant integrations and compliance reporting.

This section documents:

- **Automated encrypted daily logical snapshots** of the PostgreSQL cluster.
- **Continuous WAL archiving** enabling Point-in-Time Recovery (PITR) with an RPO < 5 minutes.
- **Cross-region object storage** with 35-day retention and object-lock immutability.
- **Automated monthly DR verification** (`ops/dr-drill/verify-restore.sh`) that restores the
  latest staging backup into an isolated ephemeral instance, validates schema integrity, and
  confirms the Soroban Event Indexer can catch up from the restored cursor to ledger tip.
- **Prometheus metrics & alerts** that fire if no successful DR drill has occurred in 35 days.

### Architecture Diagram (text)

```
┌──────────────────────────┐        ┌──────────────────────────────┐
│  Production PostgreSQL   │  WAL   │  Object Storage (cross-region)│
│  (gridpay DB cluster)    │──────▶│  gridpay-pitr-backups          │
│                          │ stream │  ├─ base-backups/ (daily)      │
│  pg_basebackup (daily)   │──────▶│  └─ wal-archive/  (continuous) │
└──────────────────────────┘        │  [object-lock: 35d immutable] │
                                    └──────────────┬───────────────┘
                                                   │ (read-only pull)
                                    ┌──────────────▼───────────────┐
                                    │  DR Drill CronJob (monthly)  │
                                    │  ops/dr-drill/verify-restore │
                                    │  ┌────────────────────────┐  │
                                    │  │ Ephemeral PG (isolated) │  │
                                    │  │ WEBHOOK=off, no egress  │  │
                                    │  └───────────┬────────────┘  │
                                    │              │ cursor resume  │
                                    │  ┌───────────▼────────────┐  │
                                    │  │ Soroban Event Indexer  │  │
                                    │  │ catch-up → ledger tip  │  │
                                    │  └──────────────────────┘  │
                                    └──────────────┬───────────────┘
                                                   │ metrics
                                    ┌──────────────▼───────────────┐
                                    │  Prometheus Pushgateway      │
                                    │  gridpay_dr_* metrics        │
                                    └──────────────────────────────┘
```

---

## Scope: What Lives Where

| Data | Location | Recovery source |
|---|---|---|
| Canonical financial truth (balances, escrow state) | Stellar ledger (on-chain) | Soroban RPC + ledger replay |
| Indexed event history | PostgreSQL `event_history` | PITR from object storage |
| Webhook subscriptions | PostgreSQL `webhook_subscriptions` | PITR |
| Encrypted evidence metadata | PostgreSQL `evidence_metadata` | PITR |
| Merchant settings | PostgreSQL `merchant_settings` | PITR |
| Reconciliation snapshots | PostgreSQL `reconciliation_snapshots` | PITR |
| Indexed ledger cursor | PostgreSQL `indexed_ledger_cursor` | PITR (indexer resumes from this) |

---

## Backup Configuration

### Daily Logical Snapshots

A full `pg_basebackup` (physical base backup) is taken once per day at 02:00 UTC via the
PostgreSQL operator's backup sidecar (or `pgbackrest`/`barman` if self-managed).

**Configuration (PostgreSQL):**

```conf
# postgresql.conf — PITR / WAL archiving
wal_level = replica
archive_mode = on
archive_command = 'aws s3 cp %p s3://gridpay-pitr-backups/wal-archive/%f --region us-east-1 --no-progress'
max_wal_senders = 5
wal_keep_size = '4GB'
checkpoint_timeout = '15min'
archive_timeout = '5min'   # force a segment switch every 5 min → RPO <= 5 min on idle days
```

The daily base backup is encrypted client-side before upload (see
[Encryption & Key Separation](#security-invariants--hard-rules)).

### Continuous WAL Archiving (PITR)

`archive_command` streams every WAL segment to cross-region object storage immediately on
segment switch. `archive_timeout = '5min'` forces a segment switch at least every 5 minutes
even under low write load, bounding the RPO at <= 5 minutes.

### Cross-Region Object Storage & Object-Lock

| Property | Value |
|---|---|
| Bucket | `gridpay-pitr-backups` |
| Region | `us-east-1` (primary DB in `us-west-2`) |
| Object-lock mode | `COMPLIANCE` |
| Object-lock retention | 35 days (immutable; cannot be deleted even by root) |
| Versioning | Enabled |
| Default encryption | SSE-KMS with a bucket-key separate from the backup key |
| Public access block | All public access blocked |

Object-lock immutability means even a compromised production credential cannot delete or
overwrite a backup within its retention window — it is tamper-proof evidence.

---

## Retention Policy

| Artifact | Retention | Mechanism |
|---|---|---|
| Daily base backups | 35 days | Object-lock + lifecycle `EXPIRE` after lock expires |
| WAL archive segments | 35 days | Same object-lock; `archive_timeout=5min` bounds volume |
| Monthly DR drill history | Last 3 success + last 3 fail | CronJob `successful/failedJobsHistoryLimit` |

The 35-day window aligns with the DR-stale alert: if no successful drill has run in 35 days,
the oldest useful backup would already be expiring — the alert ensures we always verify the
*current* retention window is recoverable.

---

## DR Drill Automation

### verify-restore.sh

**File:** `ops/dr-drill/verify-restore.sh`

The automated monthly DR verification job. It:

1. **Preflight** — asserts `WEBHOOK_DELIVERY_ENABLED=false` (refuses to run otherwise), checks
   for the encryption key source, removes stale drill containers.
2. **Fetch encryption key** — pulls the key from a separate secret store (Vault / KMS / age
   file) into an in-memory variable only; masks it in logs; aborts if key material is found
   on disk in `/tmp`.
3. **Download latest backup** — pulls the newest base backup + all WAL archive segments from
   cross-region object storage into an isolated restore data dir.
4. **Start ephemeral PostgreSQL** — a `--network none` Docker container so the restored DB
   cannot reach any merchant endpoint; `WEBHOOK_DELIVERY_ENABLED=false` is enforced at the
   container environment level.
5. **Restore + PITR** — replaces the ephemeral PGDATA with the base backup, configures
   `restore_command` + `recovery.signal`, and restarts so PostgreSQL replays WAL to the
   latest consistent point and promotes.
6. **Schema integrity checks**:
   - `pg_amcheck` — heap + index corruption scan across all relations.
   - Row counts for 6 critical tables (`event_history`, `webhook_subscriptions`,
     `evidence_metadata`, `merchant_settings`, `reconciliation_snapshots`,
     `indexed_ledger_cursor`) — each must be > 0.
   - Latest indexed ledger cursor — `indexed_ledger_cursor.last_indexed_ledger` must be a
     valid positive integer; this is the resume point for the indexer catch-up test.
7. **Soroban Event Indexer catch-up** — starts the indexer in a sidecar pointed at the
   restored DB (webhooks disabled), polls its `/health` endpoint until `caught_up: true` or
   `INDEXER_CATCHUP_TIMEOUT_S` (default 600s) elapses.
8. **RTO/RPO checks** — total restore duration must be < 1800s (30 min); newest WAL segment
   age must be < 300s (5 min).
9. **Emit metrics** — pushes to the Prometheus pushgateway (always, even on failure).
10. **Cleanup** — the `trap` removes all ephemeral containers, scrubs the restore data dir,
    and `unset`s the in-memory encryption key.

**Manual invocation:**

```bash
# Run a one-off DR drill locally (with all safety invariants enforced).
WEBHOOK_DELIVERY_ENABLED=false \
VAULT_ADDR=https://vault.gridpay.internal \
VAULT_SECRET_PATH=secret/data/gridpay/db-backup/encryption-key \
BACKUP_SOURCE_BUCKET=gridpay-pitr-backups \
BACKUP_SOURCE_REGION=us-east-1 \
bash ops/dr-drill/verify-restore.sh
```

### Monthly CronJob

**File:** `deploy/helm/gridpay/templates/dr-drill-cronjob.yaml`

- **Schedule:** `0 3 1 * *` (03:00 UTC on the 1st of each month — low-traffic window).
- **concurrencyPolicy:** `Forbid` — never run two drills concurrently.
- **backoffLimit:** `0` — failures must **not** silently retry; they must surface as alerts.
- **activeDeadlineSeconds:** `2700` (45 min) — 30 min RTO + 15 min indexer + slack.
- **Hard safety:** `WEBHOOK_DELIVERY_ENABLED=false` is hard-coded in the env block and is
  intentionally **not** overridable via Helm values, so a misconfiguration can never replay
  webhooks.
- **Encryption key** is mounted from a separate Kubernetes Secret (`db-backup-encryption-key`,
  in a different namespace), `defaultMode: 0400`, read-only.
- **Pod security:** non-root (UID 65532), read-only root filesystem, all capabilities dropped,
  `seccompProfile: RuntimeDefault`.
- **Network isolation:** the pod's egress is allow-listed by a NetworkPolicy to only the
  object-storage endpoint and the pushgateway — it **cannot** reach merchant webhook targets
  or the production DB service.
- **Bundles the script** as a ConfigMap (`verify-restore.sh`) so the chart and the script are
  version-controlled together and immutable per release.

---

## DR Drill Metrics

All metrics are namespaced `gridpay_dr_*` and pushed to the pushgateway by `verify-restore.sh`:

| Metric | Type | Meaning |
|---|---|---|
| `gridpay_dr_restore_duration_seconds` | gauge | Total wall-clock time of the restore phase (seconds) |
| `gridpay_dr_last_success_timestamp` | gauge | Unix epoch of the last **successful** drill (0 = never / last failed) |
| `gridpay_dr_drill_success` | gauge | 1 if the last drill passed, 0 if it failed |
| `gridpay_dr_rpo_observed_seconds` | gauge | Observed RPO (age of newest WAL segment) for the last drill |

`gridpay_dr_last_success_timestamp` is the key metric for the 35-day-stale alert: it is only
updated on a **pass**. On failure the script pushes `0`, which the alert rule interprets as
"stale/never-succeeded" so the on-call engineer is paged immediately rather than waiting 35
days.

---

## Alerting

The Helm chart deploys a `PrometheusRule` with four alerts:

| Alert | Severity | Condition | Action |
|---|---|---|---|
| `GridpayDRDrillStale` | critical | `time() - gridpay_dr_last_success_timestamp > 35d` **or** `== 0` | No successful drill in 35 days (or ever). Page platform on-call. |
| `GridpayDRDrillFailed` | warning | `gridpay_dr_drill_success == 0` | The last drill failed. Investigate CronJob logs within the day. |
| `GridpayDRDrillRTOExceeded` | warning | `gridpay_dr_restore_duration_seconds > 1800` | Restore exceeded the 30-min RTO. Check backup size growth / object-storage throughput. |
| `GridpayDRDrillRPOExceeded` | warning | `gridpay_dr_rpo_observed_seconds > 300` | Observed RPO exceeded 5 min. WAL archiving may be lagging — check `archive_command` errors. |

**On-call response for `GridpayDRDrillStale`:** this is the highest-priority DR alert because it
means the documented recovery window is *unverified*. Treat as a P1 even though no user-facing
outage is occurring. Steps in [DR Drill Troubleshooting](#dr-drill-troubleshooting).

---

## Manual Recovery Procedures

These are for an actual production incident (not a drill). They reuse the same encrypted
artifacts and the same key separation.

### Point-in-Time Recovery (PITR)

When you need to recover to a specific timestamp (e.g., just before a destructive migration):

```bash
# 1. Provision a fresh PostgreSQL instance in the recovery environment.

# 2. Fetch the latest base backup (decryption key from the separate secret store).
aws s3 cp s3://gridpay-pitr-backups/base-backups/<latest>.tar.gz /tmp/base.tar.gz \
  --region us-east-1

# 3. Decrypt + extract into the new PGDATA (key from Vault/KMS, never on disk).
age --decrypt --identity <key-file> /tmp/base.tar.gz | tar -xz -C $PGDATA

# 4. Configure PITR to the target timestamp.
echo "" > $PGDATA/recovery.signal
cat > $PGDATA/postgresql.auto.conf <<EOF
restore_command = 'aws s3 cp s3://gridpay-pitr-backups/wal-archive/%f /wal-archive/%f --region us-east-1 --no-progress && cp /wal-archive/%f %p'
recovery_target_time = '2026-11-22T14:30:00+00:00'
recovery_target_action = 'promote'
EOF

# 5. Start PostgreSQL; it replays WAL to the target time and promotes.
pg_ctl -D $PGDATA start

# 6. CRITICAL: set WEBHOOK_DELIVERY_ENABLED=false during the recovery window
#    until you have confirmed the data is consistent, to avoid replaying
#    historical webhooks to live merchants.
export WEBHOOK_DELIVERY_ENABLED=false
```

### Full Restore from Base Backup

If PITR is not needed (full restore to the latest consistent point), omit `recovery_target_time`
and use `recovery_target_timeline = 'latest'` (this is what `verify-restore.sh` does). The
procedure is otherwise identical.

---

## DR Drill Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `GridpayDRDrillStale` fires | CronJob not scheduled, or all runs failing for 35+ days | `kubectl get cronjob -n <ns> gridpay-dr-drill`; check `failedJobsHistoryLimit` pods' logs; run `verify-restore.sh` manually |
| Script aborts: "WEBHOOK_DELIVERY_ENABLED must be 'false'" | Env var misconfigured | Confirm the Helm values do not override `WEBHOOK_DELIVERY_ENABLED`; it is hard-coded in the template |
| `fetch_encryption_key` fails | Vault/KMS unreachable, or SA lacks read permission | Verify the DR pod's service account has the `db-backup-decrypt` Vault policy / IRSA role; check Vault audit log |
| "encryption key material detected in /tmp" | Key leaked to disk somewhere in the pipeline | Security incident — rotate the key; audit the script + image for stray `echo`/`tee` of env vars |
| `pg_amcheck` FAIL | Restored data has heap/index corruption | Re-download the base backup (object-lock protects it); if it fails on a fresh download, escalate — the production DB may be corrupt |
| Row count FAIL for a table | Table empty in the backup (possible partial backup) | Check the base backup timestamp vs. expected; verify `pg_basebackup` completed cleanly in production |
| Indexer catch-up timeout | RPC endpoint slow, or restored cursor too far behind tip | Increase `INDEXER_CATCHUP_TIMEOUT_S`; verify `SOROBAN_RPC_URL` is reachable from the drill pod's allow-listed egress |
| RTO exceeded (>30 min) | Backup too large, or object-storage throughput low | Check backup size growth; consider increasing parallelism in `aws s3 sync`; review retention (35d may be too large for the volume) |
| RPO exceeded (>5 min) | WAL archiving lagging | Check production `archive_command` error rate in CloudWatch/Prometheus; verify `archive_timeout=5min` is set; check object-storage write latency |
| Metrics not appearing in Prometheus | Pushgateway unreachable from the drill pod | Verify the pushgateway URL env var; check the NetworkPolicy allows egress to pushgateway on port 9091 |

---

## Security Invariants & Hard Rules

These are non-negotiable. Any change that weakens them must be reviewed by the platform
security lead.

1. **Webhook delivery is disabled in every DR context.** `WEBHOOK_DELIVERY_ENABLED=false` is
   hard-coded in the CronJob template (not overridable), asserted in `verify-restore.sh`
   preflight (refuses to run otherwise), and re-asserted against the restored instance after
   restore. This guarantees **zero webhook side effects** during restore testing.
2. **Encryption keys live separately from the DB cluster.** The backup key is in Vault/KMS or a
   Secret in a *different namespace* from the database workload. The DB cluster has no read
   access to the decrypt key.
3. **Encryption keys are never logged.** `verify-restore.sh` masks the key in all log output
   (`mask_secret`), holds it only in an in-memory env var, and aborts if key material is found
   on disk in `/tmp`.
4. **Restored instances are network-isolated.** The ephemeral PG runs with `--network none`;
   the drill pod's egress is allow-listed to object storage + pushgateway only — no path to
   merchant endpoints or the production DB.
5. **Object-lock immutability.** Backups in `gridpay-pitr-backups` are under 35-day compliance
   object-lock and cannot be deleted even by root until the lock expires.
6. **DR drill failures alert, never silently retry.** `backoffLimit: 0` on the CronJob means a
   failure is a single, surfaced event that pages on-call, not a quiet retry loop.
7. **Cleanup is guaranteed.** The `trap cleanup EXIT INT TERM` in `verify-restore.sh` always
   tears down ephemeral containers, scrubs the restore data dir, and `unset`s the in-memory key.

---

## Acceptance Criteria Matrix

| Issue acceptance criterion | Where it is satisfied | How to verify |
|---|---|---|
| Automated PITR backup + restore script completes within RTO < 30 min and RPO < 5 min on staging data | `ops/dr-drill/verify-restore.sh` → `check_rto_rpo`; `GridpayDRDrillRTOExceeded` / `GridpayDRDrillRPOExceeded` alerts | Run the drill on staging; confirm `gridpay_dr_restore_duration_seconds < 1800` and `gridpay_dr_rpo_observed_seconds < 300` |
| DR verification confirms zero webhook side effects during restore testing | Hard-coded `WEBHOOK_DELIVERY_ENABLED=false` in CronJob + script preflight + post-restore assertion + `--network none` isolation | Inspect the restored instance env (`printenv WEBHOOK_DELIVERY_ENABLED` → `false`); confirm no webhook delivery logs in the indexer sidecar |
| Alert triggers if no successful DR verification has occurred in 35 days | `gridpay_dr_last_success_timestamp` metric + `GridpayDRDrillStale` PrometheusRule (`time() - gridpay_dr_last_success_timestamp > 35d` or `== 0`) | Temporarily stop the CronJob for 35+ days (or push `last_success_timestamp=0`) and confirm the alert fires in Alertmanager |

---

## File Reference (Part II)

| File | Purpose |
|---|---|
| `ops/dr-drill/verify-restore.sh` | Automated DR verification job (restore, integrity, indexer catch-up, metrics) |
| `deploy/helm/gridpay/templates/dr-drill-cronjob.yaml` | Monthly CronJob + ConfigMap + PrometheusRule (alerting) |
| `docs/OPERATIONAL_RUNBOOK.md` (Part II) | This section — procedures, troubleshooting, security invariants |
