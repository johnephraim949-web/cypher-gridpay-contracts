# Storage Restoration Guide

Soroban ledger entries have a limited time-to-live (TTL). When a contract's
persistent entries are not touched for long enough, they are **archived**: the
entry data is moved out of the live ledger state and must be restored before the
contract can read or write it again.

This guide explains how to detect archived entries and how to restore them with
the Stellar CLI before invoking a contract.

## When restoration is needed

- A contract invocation fails because a required ledger entry is archived
  (its TTL expired after a period of inactivity).
- You are about to invoke a contract whose persistent state has not been used
  for a long time and you want to avoid a failed call.
- You are recovering a contract after a long period of inactivity.

Archived entries are **not lost** — the data still exists and can be restored.
However, the contract cannot use an archived entry until it has been restored,
so **state must be restored before contract invocation**.

## Prerequisites

- Stellar CLI installed (`stellar --version`).
- The contract ID of the contract you are operating on.
- The ledger key(s) you need to restore.
- A funded source identity for the network you are targeting.

## 1. Inspect contract data

List the entries stored by a contract to find the keys you need:

```bash
stellar contract data \
  --id <CONTRACT_ID> \
  --network testnet
```

Inspect a specific ledger key, including its durability (persistent vs.
temporary) and current TTL:

```bash
stellar contract data \
  --id <CONTRACT_ID> \
  --key <LEDGER_KEY_XDR> \
  --network testnet
```

If an entry is archived, it will not appear in the live data listing and
invocations that depend on it will fail until it is restored.

## 2. Restore archived entries

Restore one or more archived ledger keys for a contract:

```bash
stellar contract restore \
  --id <CONTRACT_ID> \
  --key <LEDGER_KEY_XDR> \
  --network testnet \
  --source <IDENTITY>
```

Restore multiple keys in a single call by repeating `--key`:

```bash
stellar contract restore \
  --id <CONTRACT_ID> \
  --key <LEDGER_KEY_XDR_1> \
  --key <LEDGER_KEY_XDR_2> \
  --network testnet \
  --source <IDENTITY>
```

### Required arguments

| Argument    | Description                                                        |
| ----------- | ------------------------------------------------------------------ |
| `--id`      | Contract ID whose entries are being restored.                      |
| `--key`     | Ledger key (XDR) to restore. Repeat for multiple keys.             |
| `--network` | Target network (`testnet`, `mainnet`, or a custom network config). |
| `--source`  | Source identity used to sign and pay for the restore operation.    |

## 3. Verify and invoke

After restoring, re-run the inspection command to confirm the entry is live,
then proceed with your contract invocation:

```bash
stellar contract data \
  --id <CONTRACT_ID> \
  --key <LEDGER_KEY_XDR> \
  --network testnet

stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <IDENTITY> \
  -- <FUNCTION> <ARGS>
```

## Restoration decision matrix

Not every archived entry needs the same recovery path. Use the matrix below to
decide whether the automated SDK `restorePreamble` is sufficient or whether a
manual keeper/admin restoration is required.

| Scenario | Entry tier | Automated SDK `restorePreamble` | Manual keeper/admin restoration |
| -------- | ---------- | ------------------------------- | ------------------------------- |
| Normal user invocation touches a recently-expired `Persistent` entry | `Persistent` | ✅ Sufficient — the SDK builds a restore preamble and the host restores the entry as part of the same transaction | Not required |
| `Instance` entry archived (contract config, admin, counters) | `Instance` | ⚠️ Only if the caller already knows the instance key; the preamble must include the contract instance ledger key | ✅ Recommended — admin/keeper restores the instance entry before any user traffic |
| `Temporary` entry archived (short-lived caches, nonces) | `Temporary` | ❌ Not applicable — temporary entries are expected to expire and are recreated by the contract | Not required; let the contract recreate the entry |
| Bulk recovery after a long outage (many keys archived) | `Persistent` / `Instance` | ❌ Impractical — one preamble per transaction | ✅ Required — batch restore with `stellar contract restore` (repeat `--key`) |
| Archived record must be proven to exist before restore | any | ❌ Not covered | ✅ Required — verify inclusion with `verify_archived_record_inclusion` (see below) |
| Cross-contract dependency archived (e.g. escrow ↔ payment) | `Persistent` | ⚠️ Only for the entry the current call touches | ✅ Recommended — restore all dependent contract entries first |

### Using `restorePreamble` (automated)

When the SDK detects that a ledger entry required by an invocation is archived,
it attaches a `restorePreamble` to the transaction. The host restores the entry
and then executes the invocation in the same transaction. This is the default
path for routine user traffic and requires no operator action.

Use it when:

- The archived entry is `Persistent` and is touched directly by the invocation.
- The caller can enumerate the exact ledger keys the call depends on.
- The number of archived keys is small (fits in a single transaction).

#### Automated two-step flow in the web app

The web app implements the automated path as a guided two-step flow inside the
`TransactionReviewDrawer` (`apps/web/src/components/tx/TransactionReviewDrawer.tsx`),
driven by the `useGridPayTransaction` hook
(`apps/web/src/hooks/useGridPayTransaction.ts`):

1. **Detect.** Before the wallet signing prompt is shown, the drawer runs
   `simulateTransaction` (via `sdk/typescript/src/transactions.ts`). If the
   simulation response contains a `restorePreamble`, the drawer flags the
   transaction as requiring restoration and surfaces the
   **"Restore Archived Entry"** remediation action. The affected contract
   addresses and the archived ledger keys are listed in the operation summary.
2. **Restore.** Selecting **"Restore Archived Entry"** submits the restore
   operation built from the `restorePreamble` (the same ledger keys the
   simulation reported). The progress tracker shows `Simulating` →
   `Awaiting Signature` → `Submitted` → `Confirmed on Ledger #X`, with a
   Stellar Expert explorer link for each submitted transaction.
3. **Re-simulate.** Once the restore transaction is confirmed, the drawer
   automatically re-runs `simulateTransaction` for the original contract call.
   The re-simulation is expected to return without a `restorePreamble`; the
   drawer then advances to the normal signing step for the contract invocation.
4. **Execute.** The original contract call is submitted and tracked to
   confirmation as usual.

If the re-simulation still reports a `restorePreamble` (for example, additional
keys were archived or the restore did not cover every dependency), the drawer
keeps the remediation action visible and prompts the operator to escalate to
[manual keeper/admin restoration](#manual-keeperadmin-restoration).

#### Error remediation in the drawer

When simulation or submission fails, the drawer maps the contract error code
through `decodeGridPayError` (`sdk/typescript/src/errors.ts`) and renders the
structured `category`, `message`, and `resolution`, along with a contextual
action button. Archived-entry failures map to the **"Restore Archived Entry"**
action described above; other categories surface their own actions (for
example, **"Approve Token Allowance"** or **"Retry with Higher Fee"**).

RPC polling states `TRY_AGAIN_LATER` and `NOT_FOUND` are retried with bounded
exponential backoff and a timeout, after which the drawer reports a recoverable
error rather than hanging. When the user selects **"Copy Debug Diagnostics"**,
sensitive memo and auth payload fields are redacted before the diagnostics are
copied for a support ticket.

### Manual keeper/admin restoration

Escalate to manual restoration when the automated preamble cannot cover the
case — bulk recovery, `Instance` entries, or cross-contract dependencies. Use
`stellar contract restore` (see [section 2](#2-restore-archived-entries)) with
repeated `--key` flags to restore many entries in one operation.

## Verifying archived record inclusion

Before restoring (or to prove a record still exists in the archive), verify that
the archived record is included in the archive using the contract's
`verify_archived_record_inclusion` entrypoint. This confirms the record hash and
key match the archived state, so a restore will succeed and the data is intact.

```bash
stellar contract invoke \
  --id <CONTRACT_ID> \
  --network testnet \
  --source <IDENTITY> \
  -- verify_archived_record_inclusion \
  --record_key <LEDGER_KEY_XDR>
```

A successful return confirms the record is present in the archive and can be
restored. A failure indicates the key is wrong or the record was never archived
under that key — re-inspect contract data before retrying the restore.

## Step-by-step summary

1. Identify the failing or at-risk contract and its contract ID.
2. Inspect contract data to locate the archived ledger key(s).
3. Consult the [restoration decision matrix](#restoration-decision-matrix) to
   choose automated `restorePreamble` vs. manual restoration.
4. (Optional) Verify inclusion with `verify_archived_record_inclusion`.
5. Run `stellar contract restore` with the contract ID, key(s), network, and
   source identity (manual path), or rely on the SDK preamble (automated path).
6. Verify the entry is live with `stellar contract data`.
7. Invoke the contract only after restoration succeeds.

## Related documentation

- [Storage Versioning Guide](STORAGE_VERSIONING.md)
- [Operational Runbook](OPERATIONAL_RUNBOOK.md)
- [Architecture Overview](ARCHITECTURE.md)
