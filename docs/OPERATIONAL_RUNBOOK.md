# Operational Runbook: Incident Response

This runbook is for the protocol team when a security vulnerability or live exploit affects the Cypher GridPay contracts. It walks through the order of operations: **contain → verify → investigate → recover → upgrade → resume**.

Keep it next to your signing setup. In an incident, the aim is to run the commands below without stopping to look anything up.

> **Related references:**
> - [MAINNET_LAUNCH_CHECKLIST.md](./MAINNET_LAUNCH_CHECKLIST.md) — launch gates, multisig ceremony, severity classification, and status-page templates.
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
| Suspected compromise of the pauser/admin key | Global pause with a **different** key if possible, then treat key rotation as part of recovery ([§7](#7-p0-incident-playbooks)) |

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

---

## 5. Recovery: upgrade and resume

After the root cause is fixed and the new WASM is verified (see [MAINNET_LAUNCH_CHECKLIST.md §1.1](./MAINNET_LAUNCH_CHECKLIST.md#11-reproducible-wasm-build-hash-verification)), upgrade and repoint child contracts, then unpause.

### 5.1 Unpause all

```bash
stellar contract invoke \
  --id $ADMIN_ID \
  --source-account $PAUSER \
  --network $NETWORK \
  -- emergency_unpause_all \
  --pauser $PAUSER_ADDR
```

Verify with [§3](#3-verify-the-pause-took-effect): every contract must show `"globally_paused": false`.

---

## 6. Keeping contracts alive (TTL)

```bash
stellar contract invoke --id $ADMIN_ID --source-account $ADMIN --network $NETWORK -- ping
```

If an entry is archived, restore it before retrying any call:

```bash
stellar contract restore --id $ADMIN_ID --source-account $ADMIN --network $NETWORK
```

See [STORAGE_RESTORATION.md](./STORAGE_RESTORATION.md) for the full decision matrix.

---

## 7. P0 incident playbooks

Each playbook is copy-paste ready. Run verification queries with `--send=no` before and after every state change.

### 7.1 Emergency Pause All / Post-Mortem Unpause

1. Pause: [§2.1](#21-global-emergency-pause-preferred).
2. Verify: [§3](#3-verify-the-pause-took-effect).
3. After the post-mortem is signed off, unpause: [§5.1](#51-unpause-all).

### 7.2 Compromised admin / emergency pauser key rotation

1. Pause with a **different** trusted key if the pauser is compromised ([§2.1](#21-global-emergency-pause-preferred)).
2. Rotate the pauser:

```bash
stellar contract invoke \
  --id $ADMIN_ID \
  --source-account $ADMIN \
  --network $NETWORK \
  -- set_emergency_pauser \
  --pauser $NEW_PAUSER_ADDR
```

3. Propose a new admin (multisig ceremony, see [MAINNET_LAUNCH_CHECKLIST.md §3](./MAINNET_LAUNCH_CHECKLIST.md#3-hardware-wallet-multisig-ceremony)):

```bash
stellar contract invoke \
  --id $ADMIN_ID \
  --source-account $ADMIN \
  --network $NETWORK \
  -- propose_admin \
  --new_admin $NEW_ADMIN_ADDR
```

4. Guardians may veto a malicious proposal before it is accepted. Verify the pending proposal:

```bash
stellar contract invoke --id $ADMIN_ID --source-account $ADMIN --network $NETWORK --send=no \
  -- get_pending_admin
```

### 7.3 Emergency contract rotation

1. Propose the new payment contract:

```bash
stellar contract invoke \
  --id $ADMIN_ID \
  --source-account $ADMIN \
  --network $NETWORK \
  -- set_payment_contract \
  --payment $NEW_PAYMENT_ID
```

2. Execute the rotation once verified:

```bash
stellar contract invoke \
  --id $ADMIN_ID \
  --source-account $ADMIN \
  --network $NETWORK \
  -- execute_payment_rotation
```

3. Abort a bad proposal:

```bash
stellar contract invoke \
  --id $ADMIN_ID \
  --source-account $ADMIN \
  --network $NETWORK \
  -- cancel_proposed_rotation
```

### 7.4 Critical Soroban storage entry archived

Follow the quick-action steps in [STORAGE_RESTORATION.md](./STORAGE_RESTORATION.md): restore the archived entry, then verify inclusion with `verify_archived_record_inclusion` before retrying the failed call.

### 7.5 Oracle feed stale or deviating

1. Check the latest oracle reading and timestamp via the read-only getter (`--send=no`).
2. If the feed is stale or deviates beyond tolerance, pause the affected entry point ([§2.4](#24-targeted-function-level-pause)) until the feed recovers.
3. Escalate to the oracle provider and record the deviation in the incident notes.
