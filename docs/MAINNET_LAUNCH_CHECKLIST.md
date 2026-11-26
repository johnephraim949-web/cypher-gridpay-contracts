# Mainnet Launch Checklist

This checklist is the authoritative go/no-go gate for deploying Cypher GridPay to
Stellar Mainnet. Every item must be checked and signed off by the on-call
release captain before the multisig ceremony begins. See
[`OPERATIONAL_RUNBOOK.md`](./OPERATIONAL_RUNBOOK.md) for incident playbooks and
[`DEPLOYMENT.md`](./DEPLOYMENT.md) for the deployment mechanics.

> **Invariant:** Mainnet contracts are immutable. There is no `upgrade` path —
> only `configure_upgrade` (governed) and emergency contract rotation. Treat every
> deploy as final.

---

## 0. Severity & Escalation Reference

| Severity | Definition | Ack SLA | Escalation |
| --- | --- | --- | --- |
| **P0** | Funds at risk, contract paused, key compromise, storage archived | 5 min | Page on-call + security lead + exec; open status page incident |
| **P1** | Degraded payments, oracle stale > 15 min, elevated error rate | 15 min | Page on-call; notify security lead |
| **P2** | Non-critical feature degraded, no fund risk | 1 hour | On-call triage during business hours |
| **P3** | Cosmetic / docs / minor bug | Next business day | Backlog |

Escalation ladder: **On-call engineer → Security lead → Engineering manager →
Executive sponsor**. P0 requires a written post-mortem within 5 business days.

---

## 1. Pre-Flight Verification

### 1.1 Reproducible WASM build hash

- [ ] Build from a clean checkout of the tagged release commit:
  ```bash
  git checkout <release-tag>
  cd core && make build && cd ..
  cd orchestrator && make build && cd ..
  ```
- [ ] Record SHA-256 of every artifact and compare against the published
  SEP-42 / Sigstore attestation:
  ```bash
  sha256sum core/target/wasm32v1-none/release/*.wasm \
            orchestrator/target/wasm32v1-none/release/*.wasm
  ```
- [ ] Verify the Sigstore attestation bundle matches the recorded hashes:
  ```bash
  cosign verify-blob-attestation \
      --bundle attestations/<contract>.wasm.sigstore.json \
      --type slsaprovenance \
      --certificate-identity-regexp '^https://github.com/<org>/<repo>/.github/workflows/.*$' \
      --certificate-oidc-issuer https://token.actions.githubusercontent.com \
      core/target/wasm32v1-none/release/<contract>.wasm
  ```
- [ ] **Abort** if any hash differs from the attested value — do not proceed.

### 1.2 Audit sign-off

- [ ] External audit report received and all Critical/High findings resolved.
- [ ] Audit remediation commit hash recorded in the release notes.
- [ ] Security lead has signed off in the release ticket.

### 1.3 Testnet canary upgrade report

- [ ] Full deploy + initialize cycle executed on Testnet from the same WASM.
- [ ] `get_system_status` returns all contracts `active` on Testnet.
- [ ] Canary ran for ≥ 72 hours with no P0/P1 incidents.
- [ ] Canary report attached to the release ticket.

### 1.4 Monitoring & alerting dry-run

- [ ] Prometheus alerting rules loaded; every alert annotation links to a
  section in `OPERATIONAL_RUNBOOK.md`.
- [ ] Fire a synthetic `ContractPaused` and `OracleStale` alert; confirm routing
  to PagerDuty and status page.
- [ ] Dashboards show live Testnet data for all four contracts.
- [ ] Backup/KMS signer access verified (see §5).

---

## 2. Hardware-Wallet Multisig Ceremony

All privileged operations (`initialize`, `set_*_contract`, `configure_upgrade`)
are executed via an M-of-N multisig. **Never** sign with a hot key on Mainnet.

### 2.1 Generate the unsigned XDR

Build the transaction without submitting it, using a throwaway source account:

```bash
stellar contract invoke \
    --id $ADMIN_ID \
    --source-account $MULTISIG_ACCOUNT \
    --network mainnet \
    --build-only \
    -- initialize \
    --admin $MULTISIG_ACCOUNT \
    --pauser $PAUSER_ACCOUNT \
    --payment_contract $PAYMENT_ID \
    --escrow_contract $ESCROW_ID \
    --refund_contract $REFUND_ID \
    > unsigned-initialize.xdr
```

Repeat with `--build-only` for each `set_payment_contract`,
`set_escrow_contract`, `set_refund_contract`, and `configure_upgrade` call.

### 2.2 Independently verify the XDR payload hash

Every signer MUST independently decode and verify the XDR before signing:

```bash
# Each signer runs this on their own machine
stellar tx decode --xdr-file unsigned-initialize.xdr
sha256sum unsigned-initialize.xdr
```

- [ ] Confirm the decoded contract ID, function name, and every argument match
  the approved change request.
- [ ] Compare the SHA-256 across all M-of-N signers — **all must match**.
- [ ] **Abort** if any signer's hash differs or the decoded payload is unexpected.

### 2.3 Collect signatures

Each signer signs with their hardware wallet (Ledger) and returns only the
signed envelope:

```bash
stellar tx sign \
    --xdr-file unsigned-initialize.xdr \
    --sign-with-ledger \
    --network mainnet \
    > signed-initialize.<signer>.xdr
```

### 2.4 Broadcast

Once M-of-N signatures are collected, combine and submit:

```bash
stellar tx sign \
    --xdr-file unsigned-initialize.xdr \
    --sign-with-key <cosigner-secret> \
    --network mainnet \
    > combined.xdr

stellar tx submit --xdr-file combined.xdr --network mainnet
```

Verify on-chain state after broadcast:

```bash
stellar contract invoke --id $ADMIN_ID --network mainnet -- get_admin
stellar contract invoke --id $ADMIN_ID --network mainnet -- get_system_status
```

### 2.5 Rollback / abort

- If a signature is wrong or a signer's hash mismatches: **discard the XDR**,
  regenerate from a clean build, and restart the ceremony.
- If a wrong WASM hash is proposed in `configure_upgrade`: do **not** sign;
  open a P0 ticket and re-run §1.1 before regenerating the XDR.
- If the transaction fails mid-ceremony (e.g. `tx_bad_auth`): the transaction is
  not applied — regenerate and re-collect signatures. No on-chain rollback is
  needed because failed transactions are atomic.

---

## 3. Contract Deployment Order

- [ ] Deploy `payment`, `escrow`, `refund` (core), then `admin` (orchestrator).
- [ ] Initialize `admin` with the three child contract IDs.
- [ ] Initialize each child contract with the multisig admin.
- [ ] `set_escrow_contract` on `payment`.
- [ ] Confirm `get_system_status` reports all contracts `active`.

---

## 4. SDKs & Client Release

- [ ] TypeScript SDK published and pinned to the Mainnet contract IDs.
- [ ] Python SDK published and pinned to the Mainnet contract IDs.
- [ ] SDK integration tests pass against Mainnet read-only endpoints.
- [ ] `deployment-manifest.json` committed with Mainnet contract IDs.

---

## 5. Monitoring, Backups & KMS Signers

- [ ] Prometheus + Grafana dashboards live for all four contracts.
- [ ] Alert routing verified (PagerDuty + status page).
- [ ] Soroban storage snapshot taken and archived off-chain.
- [ ] KMS signer keys created, access-logged, and M-of-N policy enforced.
- [ ] Emergency pauser key held in cold storage by a separate custodian.

---

## 6. Go / No-Go Sign-Off

| Role | Name | Signature | Date |
| --- | --- | --- | --- |
| Release captain | | | |
| Security lead | | | |
| Engineering manager | | | |

**No-go** if any pre-flight item is unchecked, any hash mismatches, or the
canary report is missing.
