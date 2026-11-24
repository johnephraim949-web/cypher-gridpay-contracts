# Live Stellar Network Status Bar & Persistent Notification Center — UX & Architectural Specification

**Status:** Complete  
**Affected modules:**
- `apps/web/src/components/layout/LedgerStatusIndicator.tsx`
- `apps/web/src/components/notifications/NotificationCenter.tsx`
- `apps/web/src/hooks/useContractEventStream.ts`
- `sdk/typescript/src/events.ts`

---

## 1. Problem & Architectural Context

In Web3 workflows, users and merchants frequently face anxiety and uncertainty around whether:
1. An on-chain transaction has finalized or is stalled in the mempool.
2. A counterparty has funded, completed, or disputed an escrow contract.
3. An arbitrator or merchant has approved a refund claim.
4. A dispute appeal deadline has been triggered.
5. An emergency protocol pause or multisig contract upgrade has been initiated.

To eliminate this uncertainty, Cypher GridPay introduces a dual-layer real-time notification and telemetry system:
1. **`LedgerStatusIndicator`**: A live Stellar network status bar in the top navigation header providing immediate visual confirmation of active network, latest closed ledger sequence, and RPC round-trip latency.
2. **`NotificationCenter`**: A slide-out persistent drawer subscribing to contract events relevant to the connected Stellar wallet address, rendering actionable, human-readable notification items with deep links to corresponding payment, escrow, refund, and admin detail pages.

---

## 2. Technical Architecture & Data Flow

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Stellar Soroban Network                         │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│                Event Stream Transport Layer (SDK / Hook)               │
│                                                                        │
│   ┌───────────────────────────┐      ┌─────────────────────────────┐   │
│   │   WebSocket / SSE Feed    │      │  Cursor Polling Fallback    │   │
│   │   (Primary low-latency)   │      │  (Graceful proxy fallback)  │   │
│   └─────────────┬─────────────┘      └──────────────┬──────────────┘   │
│                 │                                   │                  │
│                 ▼                                   ▼                  │
│       ┌───────────────────────────────────────────────────────┐        │
│       │       Deterministic EventDeduplicator (event.id)       │        │
│       └───────────────────────────┬───────────────────────────┘        │
│                                   │                                    │
│                                   ▼                                    │
│       ┌───────────────────────────────────────────────────────┐        │
│       │         Wallet Address Isolation Guard Filter         │        │
│       │         (isEventRelevantToAddress)                    │        │
│       └───────────────────────────┬───────────────────────────┘        │
│                                   │                                    │
│                                   ▼                                    │
│       ┌───────────────────────────────────────────────────────┐        │
│       │       BatchBurstThrottler (Max 2 toasts + Summary)    │        │
│       └───────────────────────────┬───────────────────────────┘        │
└───────────────────────────────────┼────────────────────────────────────┘
                                    │
                  ┌─────────────────┴─────────────────┐
                  ▼                                   ▼
┌───────────────────────────────────┐ ┌──────────────────────────────────┐
│       LedgerStatusIndicator       │ │        NotificationCenter        │
│                                   │ │                                  │
│ • Network Badge (Main/Test/Local) │ │ • Slide-out Persistent Drawer    │
│ • Latest Closed Ledger Sequence   │ │ • Category Icons & Deep Links    │
│ • Monitored RPC Latency in ms     │ │ • Per-Address Read/Unread State  │
│ • Degraded Connectivity Alert     │ │ • Browser Notification Opt-In    │
└───────────────────────────────────┘ └──────────────────────────────────┘
```

---

## 3. Core Contract Events & Deep Link Mapping

The notification center subscribes to contract events emitted across the core and orchestrator contracts:

| Contract Event | Emitted By | Payload Fields | Severity | Deep Link URL | Notification Description |
|----------------|------------|----------------|----------|---------------|--------------------------|
| `PaymentCompleted` | Payment Contract | `payment_id`, `merchant`, `amount`, `customer` | Success | `/payments/[payment_id]` | Confirms that merchant funds were unlocked and released on-chain. |
| `EscrowDisputed` | Escrow Contract | `escrow_id`, `disputed_by`, `reason` | Warning | `/escrows/[escrow_id]` | Alerts participants that an escrow was contested and requires counterparty action. |
| `RefundApproved` | Refund Contract | `refund_id`, `payment_id`, `customer`, `amount`, `approved_by` | Success | `/refunds/[refund_id]` | Informs customer that refund was authorized and queued for payout. |
| `DisputeAppealFiled` | Escrow Contract | `appeal_id`, `escrow_id`, `appellant`, `appeal_deadline` | Warning | `/escrows/[escrow_id]` | Notifies counterparties that an arbitration appeal has been submitted. |
| `UpgradeProposed` | Admin Contract | `proposal_id`, `contract_address`, `new_wasm_hash`, `proposer` | Info | `/admin/upgrades/[proposal_id]` | Broadcasts governance timelock activation for child contract bytecode rotation. |
| `SystemPaused` | Admin Contract | `paused_by`, `subsystem`, `reason`, `paused_at` | Critical | `/admin/health` | High-priority security alert indicating circuit-breaker activation. |

---

## 4. Edge Cases, Security & Operational Invariants

### 4.1 Deterministic Soroban Event Deduplication
- Across WebSocket reconnections and polling queries, events may be delivered redundantly across boundary windows.
- The `EventDeduplicator` ensures each Soroban event is processed at most once by indexing `event.id` or `pagingToken`.
- Maintains a ring buffer bounded at 5,000 items to avoid unbounded client memory growth during long-running sessions.

### 4.2 Graceful Fallback from Persistent Sockets to Cursor Polling
- When corporate firewalls or transparent HTTP proxies drop WebSocket connections or terminate persistent SSE sockets, `useContractEventStream` automatically transitions from `connected` to `polling`.
- Cursor tracking via `pagingToken` preserves exact replay semantics so no transactions are skipped during transport transitions.
- Latency monitoring identifies degraded RPC responses (>1,000ms) and flags `isDegraded` in the UI.

### 4.3 Strict Account Switching State Isolation
- **Security Invariant**: Under no circumstance may private transaction details, escrow disputes, or notifications from wallet `0xAAA...` be visible to wallet `0xBBB...`.
- Whenever `address` changes in `useContractEventStream`, the in-memory notification list is synchronously cleared and rehydrated strictly from `localStorage.getItem("gridpay_notifs_" + newAddress)`.
- Disconnecting the wallet clears all notifications from active view.

### 4.4 Batch Burst Toast Throttling
- When high-throughput batch operations finalize in a single ledger (e.g. 10 payments or recurring subscriptions cleared in the same ledger block), triggering 10 individual floating toasts would spam the user interface.
- `BatchBurstThrottler` buffers burst arrivals within a 400ms ledger confirmation window:
  - If event count is $\le 2$, individual toasts are displayed.
  - If event count exceeds the burst threshold, the first 2 events receive individual toasts, while remaining events are bundled into a clean summary toast:  
    *“Batch Confirmation: 8 additional transactions finalized in Ledger #1,234,567”*.

### 4.5 Browser Desktop Notifications Opt-In
- Respects user consent via explicit opt-in toggle.
- Uses `Notification.requestPermission()`.
- Dispatches desktop push notifications only when the application tab is unfocused/minimized.

---

## 5. Acceptance Verification

1. **Top Navigation Indicator**:
   - Renders active network pill (Mainnet green / Testnet indigo / Standalone purple).
   - Shows live closed ledger sequence with tabular anti-jitter numbers.
   - Shows live latency with green/amber/red indicator.
   - Shows degraded alert badge when proxy fallback or latency threshold is exceeded.
2. **Notification Center Drawer**:
   - Bell icon with unread count badge.
   - Dedicated filter tabs for Payments, Escrow, Refunds, and System alerts.
   - Clickable deep links to detail pages.
3. **Wallet Account Switching**:
   - Switching active address immediately replaces notifications with the target address's state.
4. **Unit Tests**:
   - 18 automated unit tests in `sdk/typescript/test/` verify event deduplication, burst throttling, polling fallback, account isolation, and notification mapping.
