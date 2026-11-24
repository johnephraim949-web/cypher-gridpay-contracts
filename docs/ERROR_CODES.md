# Error Codes Reference

This document catalogs all contract error variants across the Cypher GridPay protocol contracts, providing a standard mapping of error integers to user-friendly messages.

Each error entry carries a structured remediation `action` identifier. The `TransactionReviewDrawer` uses this identifier to render a contextual action button (for example "Restore Archived Entry", "Approve Token Allowance", or "Retry with Higher Fee"). See [Remediation Actions](#remediation-actions) for the full list of identifiers.

## Payment Contract

### BasicError

| Code | Name | Message | Resolution | Action |
|------|------|---------|------------|--------|
| 100 | Unauthorized | Admin authentication required | Ensure the caller is a registered admin | `connect_admin_wallet` |
| 101 | MetadataTooLarge | Payment metadata exceeds size limit | Reduce metadata size | `edit_payment_details` |
| 102 | NotesTooLarge | Payment notes exceed size limit | Reduce notes size | `edit_payment_details` |
| 103 | InvalidCurrency | Unsupported currency specified | Use a supported currency (XLM, USDC, USDT, BTC, ETH) | `select_currency` |
| 104 | InvalidBatchSize | Batch size is invalid | Use a batch size between 1 and 100 | `edit_batch` |
| 105 | BatchPartialFailure | Some payments in batch failed | Check individual payment statuses | `review_batch` |
| 106 | RateLimitExceeded | Rate limit exceeded for this address | Wait for the rate limit window to reset | `retry_later` |
| 107 | DailyVolumeExceeded | Daily volume limit exceeded | Wait for the next day or contact admin | `retry_later` |
| 108 | AddressFlagged | Address has been flagged for suspicious activity | Contact support to resolve flag | `contact_support` |
| 109 | AddressAlreadyFlagged | Address is already flagged | No action needed | `none` |
| 110 | AmountExceedsLimit | Payment amount exceeds maximum allowed | Reduce payment amount | `edit_amount` |
| 111 | MultiSigNotInitialized | Multi-signature not initialized | Initialize multi-sig configuration first | `initialize_multisig` |
| 112 | InsufficientAdmins | Not enough admin signatures required | Collect required number of admin signatures | `collect_signatures` |
| 113 | NotAnAdmin | Caller is not an admin | Use an admin account | `connect_admin_wallet` |
| 114 | AlreadyApproved | Admin has already approved this proposal | No action needed | `none` |
| 115 | OracleCallFailed | Price oracle call failed | Retry or check oracle configuration | `retry` |
| 116 | ContractPaused | Contract is paused | Wait for contract to be unpaused | `retry_later` |
| 117 | FunctionPaused | This function is paused | Use an alternative function | `none` |
| 118 | InvalidTierThresholds | Tier threshold configuration is invalid | Fix tier threshold values | `contact_support` |
| 119 | OracleFeedStale | Oracle price feed is stale | Wait for next oracle update | `retry_later` |
| 120 | OracleNotConfigured | Oracle is not configured | Configure oracle first | `contact_support` |
| 121 | InvalidAmount | Payment amount is invalid | Use a positive amount | `edit_amount` |
| 122 | VerificationLevelNotFound | Verification level not found | Use a valid verification level | `contact_support` |
| 123 | TierLimitsNotConfigured | Tier limits are not configured | Configure tier limits first | `contact_support` |
| 124 | InvalidInterval | Invalid interval specified | Use a valid interval | `edit_payment_details` |
| 125 | InvalidBps | Invalid basis points value | Use bps between 0 and 10000 | `edit_payment_details` |
| 126 | SchemaAlreadyAtTarget | Schema is already at target version | No migration needed | `none` |

## Escrow Contract

### EscrowError

| Code | Name | Message | Resolution | Action |
|------|------|---------|------------|--------|
| 1 | EscrowNotFound | Escrow not found | Verify the escrow ID | `edit_escrow_id` |
| 2 | EscrowAlreadyExists | Escrow already exists | Use a unique escrow ID | `edit_escrow_id` |
| 3 | EscrowExpired | Escrow has expired | Create a new escrow | `create_escrow` |
| 4 | EscrowNotExpired | Escrow has not expired yet | Wait for expiration | `retry_later` |
| 5 | Unauthorized | Not authorized to perform this action | Use an authorized account | `connect_authorized_wallet` |
| 6 | InvalidAmount | Invalid amount specified | Use a positive amount | `edit_amount` |
| 7 | InvalidRecipient | Invalid recipient address | Use a valid address | `edit_recipient` |
| 8 | EscrowNotActive | Escrow is not in active status | Check escrow status | `review_escrow` |
| 9 | EscrowAlreadyReleased | Escrow has already been released | No action needed | `none` |
| 10 | EscrowAlreadyRefunded | Escrow has already been refunded | No action needed | `none` |
| 11 | DisputeWindowClosed | Dispute window has closed | Contact support | `contact_support` |
| 12 | EvidenceSubmissionClosed | Evidence submission is closed | Contact support | `contact_support` |
| 13 | InvalidEvidenceHash | Invalid evidence hash | Provide a valid evidence hash | `edit_evidence` |
| 14 | ReleaseConditionsNotMet | Release conditions not met | Fulfill release conditions | `review_escrow` |
| 15 | TimelockNotExpired | Timelock has not expired | Wait for timelock to expire | `retry_later` |
| 16 | ClawbackInProgress | A clawback is already in progress | Wait for clawback to complete | `retry_later` |
| 17 | ClawbackNotAuthorized | Clawback not authorized | Get admin authorization | `connect_admin_wallet` |
| 18 | BatchSizeExceeded | Batch size exceeds limit | Reduce batch size | `edit_batch` |
| 19 | MultiPartyThresholdNotMet | Multi-party threshold not met | Collect more signatures | `collect_signatures` |
| 20 | VestingNotStarted | Vesting has not started | Wait for vesting start time | `retry_later` |

## Refund Contract

### RefundError

| Code | Name | Message | Resolution | Action |
|------|------|---------|------------|--------|
| 1 | RefundNotFound | Refund not found | Verify the refund ID | `edit_refund_id` |
| 2 | RefundAlreadyProcessed | Refund already processed | No action needed | `none` |
| 3 | RefundNotEligible | Refund not eligible | Check eligibility criteria | `review_refund` |
| 4 | RefundWindowExpired | Refund window has expired | Contact support | `contact_support` |
| 5 | Unauthorized | Not authorized | Use an authorized account | `connect_authorized_wallet` |
| 6 | InvalidAmount | Invalid refund amount | Use a valid amount | `edit_amount` |
| 7 | MerchantNotEligible | Merchant not eligible for refunds | Contact support | `contact_support` |
| 8 | RefundAlreadyExists | Refund already exists for this payment | No action needed | `none` |
| 9 | ArbitrationInProgress | Arbitration is already in progress | Wait for arbitration result | `retry_later` |
| 10 | ArbitrationTimeout | Arbitration has timed out | Contact support | `contact_support` |
| 11 | InsufficientStake | Insufficient arbitration stake | Increase stake amount | `increase_stake` |
| 12 | PolicyNotConfigured | Refund policy not configured | Configure policy first | `contact_support` |
| 13 | CircuitBreakerTripped | Circuit breaker has been tripped | Wait for circuit breaker to reset | `retry_later` |
| 14 | RateLimitExceeded | Rate limit exceeded | Wait for rate limit reset | `retry_later` |
| 15 | CooldownActive | Refund cooldown is active | Wait for cooldown period | `retry_later` |

## Admin Contract

### AdminError

| Code | Name | Message | Resolution | Action |
|------|------|---------|------------|--------|
| 1 | AlreadyInitialized | Contract already initialized | No action needed | `none` |
| 2 | NotInitialized | Contract not initialized | Initialize contract first | `contact_support` |
| 3 | Unauthorized | Admin authentication required | Use an admin account | `connect_admin_wallet` |

## Structured Error Decoding

`decodeGridPayError` (in `sdk/typescript/src/errors.ts`) is the single entry point for turning a raw Soroban simulation or submission error into a structured, renderable object. The `TransactionReviewDrawer` calls it for every failed simulation and submission and renders the result directly.

### Output shape

```typescript
interface DecodedGridPayError {
  /** Contract family the error originated from. */
  category: 'payment' | 'escrow' | 'refund' | 'admin' | 'rpc' | 'unknown';
  /** Numeric contract error code, when one could be extracted. */
  code?: number;
  /** Stable machine-readable name, e.g. "RateLimitExceeded". */
  name?: string;
  /** Human-readable, non-technical message safe to show end users. */
  message: string;
  /** Concrete remediation guidance for the user. */
  resolution: string;
  /** Remediation action identifier driving the drawer's action button. */
  action: RemediationAction;
  /** Optional label override for the action button. */
  actionLabel?: string;
  /** Raw diagnostic payload, redacted before being copied for support. */
  diagnostics?: Record<string, unknown>;
}
```

`category` is derived from the contract ID / error namespace in the diagnostic event. `code` and `name` are resolved against the tables above. Unknown codes fall back to `category: 'unknown'`, a generic `message`, and `action: 'contact_support'`.

## Remediation Actions

The `action` field is a `RemediationAction` string union. The drawer maps each identifier to a button label and handler:

| Action | Button label | Behavior |
|--------|--------------|----------|
| `restore_archived_entry` | Restore Archived Entry | Runs the Restore Footprint step, then re-simulates and re-submits the original call |
| `approve_token_allowance` | Approve Token Allowance | Opens the token `approve` flow, then retries the original call |
| `retry_with_higher_fee` | Retry with Higher Fee | Rebuilds the transaction with a bumped inclusion fee and re-simulates |
| `retry` | Retry | Re-runs simulation and submission |
| `retry_later` | Retry Later | Disables the action until the backoff window elapses |
| `connect_admin_wallet` | Connect Admin Wallet | Prompts wallet connection with an admin account |
| `connect_authorized_wallet` | Connect Authorized Wallet | Prompts wallet connection with an authorized account |
| `collect_signatures` | Collect Signatures | Opens the multi-sig signature collection flow |
| `initialize_multisig` | Initialize Multi-Sig | Opens multi-sig initialization |
| `edit_amount` | Edit Amount | Returns to the amount field |
| `edit_recipient` | Edit Recipient | Returns to the recipient field |
| `edit_payment_details` | Edit Payment Details | Returns to the payment form |
| `edit_batch` | Edit Batch | Returns to the batch editor |
| `edit_escrow_id` | Edit Escrow ID | Returns to the escrow ID field |
| `edit_refund_id` | Edit Refund ID | Returns to the refund ID field |
| `edit_evidence` | Edit Evidence | Returns to the evidence form |
| `select_currency` | Select Currency | Opens the currency selector |
| `review_batch` | Review Batch | Opens the batch status view |
| `review_escrow` | Review Escrow | Opens the escrow detail view |
| `review_refund` | Review Refund | Opens the refund detail view |
| `create_escrow` | Create Escrow | Opens the escrow creation flow |
| `increase_stake` | Increase Stake | Opens the arbitration stake form |
| `contact_support` | Contact Support | Opens the support flow with redacted diagnostics |
| `none` | — | No action button is rendered |

## Restore Footprint Flow

Soroban simulation returns a `restorePreamble` when the transaction touches archived ledger entries. When the drawer detects a non-empty `restorePreamble`, it does not open the wallet signing prompt for the original call. Instead it orchestrates a guided two-step flow:

1. **Restore Footprint** — build and sign a `restoreFootprint` transaction using the `restorePreamble` (min resource fee and footprint), submit it, and wait for confirmation.
2. **Execute Contract Call** — re-simulate the original transaction (the entries are now live), then prompt for signature and submit.

The progress tracker shows both steps. If the restore step fails, the drawer surfaces the decoded error and does not proceed to step 2. The `restore_archived_entry` remediation action re-enters this flow.

## RPC Polling and Backoff

After submission, the drawer polls `getTransaction` until the transaction is confirmed or the timeout elapses. Two transient RPC states are handled with bounded exponential backoff:

- `TRY_AGAIN_LATER` — the RPC node has not yet indexed the transaction. The drawer retries with exponential backoff (base delay 1s, factor 2, capped at 10s) up to a maximum attempt count.
- `NOT_FOUND` — the transaction is not yet visible. Treated like `TRY_AGAIN_LATER` with the same bounded backoff.

If the maximum attempts or overall timeout is reached, polling stops and the drawer renders a timeout recovery state with a `retry` action. Backoff state is reset whenever a new transaction is submitted.

## Client Integration

When building frontend or backend integrations, handle errors by checking the error code and displaying the corresponding message to users. All error codes are deterministic and can be safely used for programmatic handling.

### TypeScript Example

```typescript
import { decodeGridPayError } from '@cypher-gridpay/sdk';

function handleContractError(error: unknown): string {
  const decoded = decodeGridPayError(error);
  // decoded.category, decoded.message, decoded.resolution, decoded.action
  return decoded.message;
}
```

Prefer `decodeGridPayError` over hand-maintained code maps so that new contract error variants and remediation actions are picked up automatically.

### Python Example

```python
ERROR_MESSAGES = {
    106: "Too many requests. Please wait a moment and try again.",
    107: "Daily limit exceeded. Please try again tomorrow.",
    108: "This address has been flagged. Contact support.",
    # ... add more mappings
}

def handle_contract_error(error_code: int) -> str:
    return ERROR_MESSAGES.get(error_code, "An unexpected error occurred. Please try again.")
```
