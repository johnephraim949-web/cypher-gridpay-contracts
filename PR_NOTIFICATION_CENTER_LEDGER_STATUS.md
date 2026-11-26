## Title
feat(ui): persistent notification center drawer & live Stellar network status bar

## Summary

Resolves the issue where Web3 users experience uncertainty around whether on-chain actions have finalized or whether counterparties have taken action on escrows, disputes, refunds, or governance proposals.

Leveraging `sdk/typescript/src/events.ts` and real-time streaming feeds with cursor-based RPC polling fallback, this PR introduces:
1. **`LedgerStatusIndicator` (`apps/web/src/components/layout/LedgerStatusIndicator.tsx`)**:
   - Pinned capsule component for top navigation bars.
   - Live network badge (Mainnet emerald / Testnet indigo / Standalone violet).
   - Real-time closed ledger sequence with anti-jitter tabular numbers (`#1,234,567`) and pulse animation on new block close.
   - Round-trip RPC latency benchmark with traffic-light indicator (green `<300ms`, amber `300–1000ms`, red `>1000ms`).
   - Degraded-connectivity alerts for corporate proxy socket blocks or RPC lag.
   - Interactive diagnostic popover with network parameters, transport type, and reconnect trigger.

2. **`NotificationCenter` (`apps/web/src/components/notifications/NotificationCenter.tsx`)**:
   - Slide-out persistent drawer triggered by a bell icon with dynamic unread count badge.
   - Filters events by category (Payments, Escrow, Refunds, Safety/System, Unread, All).
   - Maps raw Soroban contract events into human-readable notifications with direct deep links to `/payments/[id]`, `/escrows/[id]`, `/refunds/[id]`, `/admin/upgrades/[id]`, and `/admin/health`.
   - Per-address notification persistence with strict account switching isolation (never leaks notifications from a previously connected account).
   - Configurable browser desktop notification opt-in (`Notification.requestPermission()`).
   - Throttled floating toasts for batch bursts.

3. **`useContractEventStream` (`apps/web/src/hooks/useContractEventStream.ts`)**:
   - Custom React hook managing streaming, deduplication, latency benchmarking, and account-isolated storage.
   - Seamless fallback from WebSocket/SSE persistent sockets to cursor-based `getEvents` RPC polling when proxies or network barriers block sockets.
   - Deterministic event deduplication across reconnects and polling cycles.
   - Single-ledger batch burst throttling via `BatchBurstThrottler`.

4. **SDK Primitives in `sdk/typescript/src/events.ts`**:
   - `EventDeduplicator`: Deterministic event deduplication keyed by `event.id` / `pagingToken` with bounded 5,000-item ring buffer.
   - `BatchBurstThrottler`: Groups rapid events within a single ledger, emitting up to 2 individual toasts and bundling excess events into an aggregated summary toast.
   - `ContractEventStreamManager`: Full connection lifecycle manager handling WebSocket streaming and cursor-based `pollContractEvents` fallback.
   - `isEventRelevantToAddress`: Strict address filtering ensuring zero cross-account leakage.
   - `mapEventToNotification`: Human-readable formatting and deep-link generation for all 6 target contract events (`PaymentCompleted`, `EscrowDisputed`, `RefundApproved`, `DisputeAppealFiled`, `UpgradeProposed`, `SystemPaused`).

5. **Design Specification & Unit Tests**:
   - Detailed UX specification in `docs/ux/live-status-and-notifications-ux.md`.
   - Comprehensive test suite in `sdk/typescript/test/events.test.mjs` (18 passing tests covering deduplication, burst throttling, polling fallback, account isolation, and event mapping).

## Verification

```bash
cd sdk/typescript
npm run build
npm test
```

### Test Output
```text
TAP version 13
# Subtest: Error Maps Completeness
ok 1 - Error Maps Completeness
# Subtest: extractErrorCode handles multiple error representations
ok 2 - extractErrorCode handles multiple error representations
# Subtest: decodeGridPayError decodes payment errors accurately
ok 3 - decodeGridPayError decodes payment errors accurately
# Subtest: decodeGridPayError decodes escrow errors with hint
ok 4 - decodeGridPayError decodes escrow errors with hint
# Subtest: decodeGridPayError decodes refund errors
ok 5 - decodeGridPayError decodes refund errors
# Subtest: decodeGridPayError decodes admin errors
ok 6 - decodeGridPayError decodes admin errors
# Subtest: isContractError & isRetryableError helpers
ok 7 - isContractError & isRetryableError helpers
# Subtest: formatDiagnosticError outputs clean actionable diagnostics
ok 8 - formatDiagnosticError outputs clean actionable diagnostics
# Subtest: EventDeduplicator: deterministically deduplicates by id and pagingToken
ok 9 - EventDeduplicator: deterministically deduplicates by id and pagingToken
# Subtest: EventDeduplicator: respects bounded capacity and ring buffer eviction
ok 10 - EventDeduplicator: respects bounded capacity and ring buffer eviction
# Subtest: BatchBurstThrottler: handles normal event flow without throttling
ok 11 - BatchBurstThrottler: handles normal event flow without throttling
# Subtest: BatchBurstThrottler: throttles bursts of batch events arriving in a single ledger
ok 12 - BatchBurstThrottler: throttles bursts of batch events arriving in a single ledger
# Subtest: BatchBurstThrottler: async buffer and queue flushing
ok 13 - BatchBurstThrottler: async buffer and queue flushing
# Subtest: ContractEventStreamManager: cursor-based polling fallback and deduplication
ok 14 - ContractEventStreamManager: cursor-based polling fallback and deduplication
# Subtest: ContractEventStreamManager: socket connection error falls back gracefully to polling
ok 15 - ContractEventStreamManager: socket connection error falls back gracefully to polling
# Subtest: Wallet Account Isolation: isEventRelevantToAddress isolates notifications
ok 16 - Wallet Account Isolation: isEventRelevantToAddress isolates notifications
# Subtest: mapEventToNotification: maps all 6 contract events into human-readable notifications with deep links
ok 17 - mapEventToNotification: maps all 6 contract events into human-readable notifications with deep links
# Subtest: formatAddress & formatTokenAmount helpers
ok 18 - formatAddress & formatTokenAmount helpers
1..18
# tests 18
# suites 0
# pass 18
# fail 0
```
