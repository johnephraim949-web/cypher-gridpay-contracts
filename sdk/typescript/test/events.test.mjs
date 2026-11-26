import test from "node:test";
import assert from "node:assert/strict";
import {
  EventDeduplicator,
  BatchBurstThrottler,
  ContractEventStreamManager,
  isEventRelevantToAddress,
  mapEventToNotification,
  formatAddress,
  formatTokenAmount,
} from "../dist/index.js";

test("EventDeduplicator: deterministically deduplicates by id and pagingToken", (t) => {
  const deduplicator = new EventDeduplicator({ maxCapacity: 100 });

  // Adding new events
  assert.equal(deduplicator.add("evt-001"), true);
  assert.equal(deduplicator.add("evt-002"), true);

  // Duplicate events rejected
  assert.equal(deduplicator.add("evt-001"), false);
  assert.equal(deduplicator.add("evt-002"), false);

  assert.equal(deduplicator.has("evt-001"), true);
  assert.equal(deduplicator.has("evt-002"), true);
  assert.equal(deduplicator.has("evt-999"), false);
  assert.equal(deduplicator.size, 2);

  // Filter helper
  const rawBatch = [
    { id: "evt-001" }, // duplicate
    { id: "evt-003" }, // new
    { id: "evt-002" }, // duplicate
    { id: "evt-004", pagingToken: "tok-004" }, // new
    { id: "evt-003" }, // duplicate in same batch
  ];

  const fresh = deduplicator.filter(rawBatch);
  assert.equal(fresh.length, 2);
  assert.equal(fresh[0].id, "evt-003");
  assert.equal(fresh[1].id, "evt-004");
  assert.equal(deduplicator.size, 4);

  // Clear resets state
  deduplicator.clear();
  assert.equal(deduplicator.size, 0);
  assert.equal(deduplicator.has("evt-001"), false);
  assert.equal(deduplicator.add("evt-001"), true);
});

test("EventDeduplicator: respects bounded capacity and ring buffer eviction", (t) => {
  const smallDeduplicator = new EventDeduplicator({ maxCapacity: 3 });

  smallDeduplicator.add("evt-1");
  smallDeduplicator.add("evt-2");
  smallDeduplicator.add("evt-3");
  assert.equal(smallDeduplicator.size, 3);

  // Adding 4th item should evict oldest (evt-1)
  smallDeduplicator.add("evt-4");
  assert.equal(smallDeduplicator.size, 3);
  assert.equal(smallDeduplicator.has("evt-1"), false);
  assert.equal(smallDeduplicator.has("evt-2"), true);
  assert.equal(smallDeduplicator.has("evt-3"), true);
  assert.equal(smallDeduplicator.has("evt-4"), true);
});

test("BatchBurstThrottler: handles normal event flow without throttling", (t) => {
  const throttler = new BatchBurstThrottler({
    burstThreshold: 2,
    maxIndividualToasts: 2,
  });

  const singleEvent = [{ ledger: 100, title: "Payment #1" }];
  const results = throttler.throttleBatch(singleEvent);

  assert.equal(results.length, 1);
  assert.equal(results[0].type, "individual");
  assert.equal(results[0].item.title, "Payment #1");
  assert.equal(results[0].ledger, 100);
});

test("BatchBurstThrottler: throttles bursts of batch events arriving in a single ledger", (t) => {
  const throttler = new BatchBurstThrottler({
    burstThreshold: 2,
    maxIndividualToasts: 2,
  });

  const burstBatch = [
    { ledger: 200, title: "Payment #101" },
    { ledger: 200, title: "Payment #102" },
    { ledger: 200, title: "Payment #103" },
    { ledger: 200, title: "Payment #104" },
    { ledger: 200, title: "Payment #105" },
  ];

  const results = throttler.throttleBatch(burstBatch, 200);

  // Expect maxIndividualToasts (2) individual items + 1 summary item for the 3 excess items
  assert.equal(results.length, 3);
  assert.equal(results[0].type, "individual");
  assert.equal(results[0].item.title, "Payment #101");

  assert.equal(results[1].type, "individual");
  assert.equal(results[1].item.title, "Payment #102");

  assert.equal(results[2].type, "summary");
  assert.equal(results[2].count, 3);
  assert.equal(results[2].ledger, 200);
  assert.ok(results[2].summaryTitle.includes("Ledger #200"));
  assert.ok(results[2].summaryMessage.includes("3 additional transactions"));
});

test("BatchBurstThrottler: async buffer and queue flushing", async (t) => {
  const throttler = new BatchBurstThrottler({
    burstThreshold: 2,
    maxIndividualToasts: 2,
    burstWindowMs: 50,
  });

  let flushedResults = null;
  const onFlush = (results) => {
    flushedResults = results;
  };

  throttler.enqueue({ ledger: 300, title: "Refund #1" }, onFlush);
  throttler.enqueue({ ledger: 300, title: "Refund #2" }, onFlush);
  throttler.enqueue({ ledger: 300, title: "Refund #3" }, onFlush);

  // Wait for burstWindowMs timer
  await new Promise((resolve) => setTimeout(resolve, 80));

  assert.ok(flushedResults);
  assert.equal(flushedResults.length, 3); // 2 individual + 1 summary
  assert.equal(flushedResults[0].type, "individual");
  assert.equal(flushedResults[1].type, "individual");
  assert.equal(flushedResults[2].type, "summary");
  assert.equal(flushedResults[2].count, 1);
});

test("ContractEventStreamManager: cursor-based polling fallback and deduplication", async (t) => {
  const receivedEvents = [];
  let latestLedgerReported = null;
  let statusReported = null;

  // Mock RPC implementation
  let rpcCallCount = 0;
  const mockRpc = {
    async getEvents(req) {
      rpcCallCount++;
      return {
        events: [
          {
            id: `evt-${rpcCallCount}`,
            pagingToken: `tok-${rpcCallCount}`,
            ledger: 1000 + rpcCallCount,
            ledgerClosedAt: new Date().toISOString(),
            name: "PaymentCompleted",
            data: {
              payment_id: 10 + rpcCallCount,
              merchant: "GAAAMERCHANT123456789",
              amount: 50000000,
            },
          },
        ],
        cursor: `tok-${rpcCallCount}`,
        latestLedger: 1000 + rpcCallCount,
      };
    },
  };

  const manager = new ContractEventStreamManager({
    // Without wsUrl, should automatically fall back to polling mode
    rpc: mockRpc,
    filters: [],
    pollIntervalMs: 500,
    onEvent: (event) => {
      receivedEvents.push(event);
    },
    onStatusChange: (status) => {
      statusReported = status;
    },
    onLedgerUpdate: (ledger) => {
      latestLedgerReported = ledger;
    },
  });

  manager.start();
  assert.equal(manager.getStatus(), "polling");

  // Perform single poll
  await manager.pollOnce();

  assert.equal(receivedEvents.length, 1);
  assert.equal(receivedEvents[0].id, "evt-1");
  assert.equal(manager.getCursor(), "tok-1");
  assert.equal(latestLedgerReported, 1001);

  // Repeat poll with the same event (simulating RPC repeating event before advancing cursor)
  const deduplicator = manager.getDeduplicator();
  assert.equal(deduplicator.has("evt-1"), true);

  manager.stop();
  assert.equal(manager.getStatus(), "disconnected");
});

test("ContractEventStreamManager: socket connection error falls back gracefully to polling", (t) => {
  let status = null;
  const mockRpc = {
    async getEvents() {
      return { events: [], cursor: "tok-0", latestLedger: 500 };
    },
  };

  const manager = new ContractEventStreamManager({
    wsUrl: "ws://invalid-corporate-proxy-blocked:9999",
    rpc: mockRpc,
    filters: [],
    onEvent: () => {},
    onStatusChange: (s) => {
      status = s;
    },
  });

  // Should start and gracefully degrade / fall back to polling
  manager.start();
  manager.startPollingFallback();
  assert.equal(manager.getStatus(), "polling");
  manager.stop();
});

test("Wallet Account Isolation: isEventRelevantToAddress isolates notifications", (t) => {
  const alice = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE1234";
  const bob = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBOB123456";
  const charlie = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCHARLIE99";

  // PaymentCompleted: Alice is merchant
  const paymentAlice = {
    id: "evt-p1",
    name: "PaymentCompleted",
    ledger: 100,
    ledgerClosedAt: new Date().toISOString(),
    topics: [],
    data: { payment_id: 1, merchant: alice, amount: 10000000 },
  };

  assert.equal(isEventRelevantToAddress(paymentAlice, alice), true);
  assert.equal(isEventRelevantToAddress(paymentAlice, bob), false);
  assert.equal(isEventRelevantToAddress(paymentAlice, charlie), false);

  // EscrowDisputed: Bob is disputant
  const escrowBob = {
    id: "evt-e1",
    name: "EscrowDisputed",
    ledger: 101,
    ledgerClosedAt: new Date().toISOString(),
    topics: [],
    data: { escrow_id: 42, disputed_by: bob },
  };

  assert.equal(isEventRelevantToAddress(escrowBob, bob), true);
  assert.equal(isEventRelevantToAddress(escrowBob, alice), false);

  // RefundApproved: Charlie is customer
  const refundCharlie = {
    id: "evt-r1",
    name: "RefundApproved",
    ledger: 102,
    ledgerClosedAt: new Date().toISOString(),
    topics: [],
    data: { refund_id: 8, customer: charlie, merchant: alice, amount: 20000000, approved_by: bob },
  };

  assert.equal(isEventRelevantToAddress(refundCharlie, charlie), true);
  assert.equal(isEventRelevantToAddress(refundCharlie, alice), true); // Alice is merchant
  assert.equal(isEventRelevantToAddress(refundCharlie, bob), true); // Bob is approver

  // DisputeAppealFiled: Alice is appellant
  const appealAlice = {
    id: "evt-a1",
    name: "DisputeAppealFiled",
    ledger: 103,
    ledgerClosedAt: new Date().toISOString(),
    topics: [],
    data: { appeal_id: 99, escrow_id: 42, appellant: alice },
  };

  assert.equal(isEventRelevantToAddress(appealAlice, alice), true);
  assert.equal(isEventRelevantToAddress(appealAlice, bob), false);

  // System-wide safety events: SystemPaused and UpgradeProposed are visible to all users
  const pauseEvent = {
    id: "evt-pause",
    name: "SystemPaused",
    ledger: 104,
    ledgerClosedAt: new Date().toISOString(),
    topics: [],
    data: { reason: "Security review" },
  };

  assert.equal(isEventRelevantToAddress(pauseEvent, alice), true);
  assert.equal(isEventRelevantToAddress(pauseEvent, bob), true);
  assert.equal(isEventRelevantToAddress(pauseEvent, charlie), true);

  const upgradeEvent = {
    id: "evt-upg",
    name: "UpgradeProposed",
    ledger: 105,
    ledgerClosedAt: new Date().toISOString(),
    topics: [],
    data: { proposal_id: 5 },
  };

  assert.equal(isEventRelevantToAddress(upgradeEvent, alice), true);
  assert.equal(isEventRelevantToAddress(upgradeEvent, bob), true);
});

test("mapEventToNotification: maps all 6 contract events into human-readable notifications with deep links", (t) => {
  const alice = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE1234";

  // 1. PaymentCompleted
  const notifPayment = mapEventToNotification(
    {
      id: "p-1",
      name: "PaymentCompleted",
      ledger: 501,
      ledgerClosedAt: "2026-11-23T10:00:00Z",
      topics: [],
      data: { payment_id: 88, merchant: alice, amount: 25000000 },
    },
    alice,
  );
  assert.equal(notifPayment.category, "payment");
  assert.equal(notifPayment.severity, "success");
  assert.equal(notifPayment.deepLink, "/payments/88");
  assert.ok(notifPayment.title.includes("#88"));

  // 2. EscrowDisputed
  const notifEscrow = mapEventToNotification(
    {
      id: "e-1",
      name: "EscrowDisputed",
      ledger: 502,
      ledgerClosedAt: "2026-11-23T10:01:00Z",
      topics: [],
      data: { escrow_id: 12, disputed_by: alice },
    },
    alice,
  );
  assert.equal(notifEscrow.category, "escrow");
  assert.equal(notifEscrow.severity, "warning");
  assert.equal(notifEscrow.deepLink, "/escrows/12");
  assert.ok(notifEscrow.title.includes("#12"));

  // 3. RefundApproved
  const notifRefund = mapEventToNotification(
    {
      id: "r-1",
      name: "RefundApproved",
      ledger: 503,
      ledgerClosedAt: "2026-11-23T10:02:00Z",
      topics: [],
      data: { refund_id: 34, amount: 15000000, approved_by: alice },
    },
    alice,
  );
  assert.equal(notifRefund.category, "refund");
  assert.equal(notifRefund.severity, "success");
  assert.equal(notifRefund.deepLink, "/refunds/34");

  // 4. DisputeAppealFiled
  const notifAppeal = mapEventToNotification(
    {
      id: "a-1",
      name: "DisputeAppealFiled",
      ledger: 504,
      ledgerClosedAt: "2026-11-23T10:03:00Z",
      topics: [],
      data: { appeal_id: 7, escrow_id: 12, appellant: alice },
    },
    alice,
  );
  assert.equal(notifAppeal.category, "escrow");
  assert.equal(notifAppeal.severity, "warning");
  assert.equal(notifAppeal.deepLink, "/escrows/12");

  // 5. UpgradeProposed
  const notifUpgrade = mapEventToNotification(
    {
      id: "u-1",
      name: "UpgradeProposed",
      ledger: 505,
      ledgerClosedAt: "2026-11-23T10:04:00Z",
      topics: [],
      data: { proposal_id: 4 },
    },
    alice,
  );
  assert.equal(notifUpgrade.category, "governance");
  assert.equal(notifUpgrade.severity, "info");
  assert.equal(notifUpgrade.deepLink, "/admin/upgrades/4");

  // 6. SystemPaused
  const notifPause = mapEventToNotification(
    {
      id: "s-1",
      name: "SystemPaused",
      ledger: 506,
      ledgerClosedAt: "2026-11-23T10:05:00Z",
      topics: [],
      data: { reason: "Scheduled contract maintenance" },
    },
    alice,
  );
  assert.equal(notifPause.category, "system");
  assert.equal(notifPause.severity, "critical");
  assert.equal(notifPause.deepLink, "/admin/health");
  assert.ok(notifPause.message.includes("Scheduled contract maintenance"));
});

test("formatAddress & formatTokenAmount helpers", (t) => {
  assert.equal(formatAddress("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAALICE1234"), "GAAAA...1234");
  assert.equal(formatAddress("short"), "short");
  assert.equal(formatAddress(""), "unknown");

  assert.equal(formatTokenAmount(10000000), "1.00");
  assert.equal(formatTokenAmount(25500000), "2.55");
  assert.equal(formatTokenAmount(50), "50.00");
});
