# Admin Contract

Part of the [Cypher GridPay smart contracts](../../../README.md) suite on Stellar/Soroban.

## Purpose

The admin contract gates privileged operations across the other contracts. It acts as a central authority that can coordinate emergency actions — such as pausing the payment, escrow, and refund contracts — in a single Soroban call.

## Role & Permission Model

### Admin Address

- The admin is a single `Address` stored in contract instance storage under the `Admin` data key.
- It is set **once** during `initialize(admin, pauser, payment_contract, escrow_contract, refund_contract)` and cannot be changed after initialization.
- Calling `initialize` a second time returns `Error::AlreadyInitialized`.
- The admin address must authorize the `initialize` call via Soroban authentication (`require_auth()`).

### Pauser Address

- A separate `Pauser` address is stored alongside the admin. Only the pauser can trigger `emergency_pause_all` / `emergency_unpause_all`.
- The pauser address is forwarded to each child contract's `pause_contract` / `unpause_contract`, so it must also be an admin on the payment, escrow, and refund contracts. If any child rejects it, the whole call reverts and nothing is paused.

### Permission Checks

Every privileged function performs two authorization checks:

1. **Authentication** — the caller must pass Soroban's `require_auth()` for the supplied admin/pauser address.
2. **Authorization** — the caller's address must match the stored admin (or pauser) address exactly. A mismatch returns `Error::Unauthorized`.

### Privileged Operations

| Function | Description | Admin Required |
|---|---|---|
| `initialize(admin, pauser, payment_contract, escrow_contract, refund_contract)` | Configures the contract with the admin, pauser, and child contract addresses. | Yes (sets the admin) |
| `emergency_pause_all(pauser, reason)` | Pauses the payment, escrow, and refund contracts in one call. | Pauser |
| `emergency_unpause_all(pauser)` | Unpauses the payment, escrow, and refund contracts in one call. | Pauser |
| `set_payment_contract(admin, payment_contract)` | Proposes a new payment contract address for execution after 48 hours. | Admin |
| `set_escrow_contract(admin, escrow_contract)` | Repoints the orchestrator at a new escrow contract. | Admin |
| `set_refund_contract(admin, refund_contract)` | Repoints the orchestrator at a new refund contract. | Admin |

### Instance TTL

Monitor the orchestrator instance TTL and extend it before expiry. An archived
instance must be restored before issuing administrative calls. Follow the
[storage restoration guide](../../../docs/STORAGE_RESTORATION.md).

### Error Codes

| Code | Constant | Description |
|---|---|---|
| 1 | `AlreadyInitialized` | `initialize` was called more than once. |
| 2 | `NotInitialized` | A privileged function was called before `initialize`, or a managed slot is unset. |
| 3 | `Unauthorized` | The caller's address does not match the stored admin/pauser. |
| 4 | `RotationNotPending` | No proposal exists for the selected contract. |
| 5 | `RotationTimelockActive` | The 48-hour rotation delay is active. |
| 6 | `RotationAlreadyPending` | A pending proposal already exists for the selected contract. |

## Security Considerations

- The admin address should be a **multi-sig** or **governance contract** address, never a single private key, to avoid a single point of failure.
- The pauser is a separate credential from the admin so emergency response does not require the long-term admin key. It should follow the same multi-sig guidance.
- Because `emergency_pause_all` halts all child contracts, the pauser key should be treated as a high-value credential and stored securely (e.g., in a hardware wallet or threshold-signing scheme).
- There is no `transfer_admin` or `renounce_admin` function — the admin role is permanent. Review deployment scripts carefully before calling `initialize`.
- Use `get_system_status()` to query child contract health during incident response.


## Incident Response

See the [Operational Runbook](../../../docs/OPERATIONAL_RUNBOOK.md) for step-by-step Stellar CLI procedures to trigger an emergency pause, verify it, inspect state after an incident, upgrade contracts, and resume operations.

## Testing

```bash
cd orchestrator && cargo test --workspace
```

The suite lives in [`src/test.rs`](src/test.rs).

---

## Lifecycle and operating guides

- **Pause and health** use `emergency_pause_all`, `emergency_unpause_all`,
  and `get_system_status`. See the [runbook](../../../docs/OPERATIONAL_RUNBOOK.md).
- **Contract rotations** use the `set_*_contract` proposal and
  `execute_*_rotation` calls. Inspect or cancel a pending rotation with
  `get_pending_rotation` or `cancel_proposed_rotation`.
- **WASM upgrades** use `configure_upgrade`, `propose_upgrade`,
  `approve_upgrade`, and `execute_upgrade`. Verify the WASM and follow the
  [deployment guide](../../../docs/DEPLOYMENT.md).
- **Policy and disputes** use `sync_protocol_parameters` and
  `resolve_supreme_dispute`. The latter publishes a decision event, so
  operators must independently confirm Refund state and token settlement.

See the [glossary](../../../docs/GLOSSARY.md) and [changelog](../../../CHANGELOG.md).

## See Also

- [Root README](../../../README.md) — architecture overview and workspace setup
- [Operational Runbook](../../../docs/OPERATIONAL_RUNBOOK.md)
- [Payment Contract](../../../core/contracts/payment/README.md)
- [Escrow Contract](../../../core/contracts/escrow/README.md)
- [Refund Contract](../../../core/contracts/refund/README.md)
