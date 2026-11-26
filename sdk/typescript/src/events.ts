import { scValToNative, xdr } from "@stellar/stellar-sdk";

export type SorobanEventRecord = {
  id: string;
  pagingToken?: string;
  type: string;
  ledger: number;
  ledgerClosedAt: string;
  contractId?: string | { toString(): string };
  topic: xdr.ScVal[];
  value: xdr.ScVal;
};

export type ParsedContractEvent<T = Record<string, unknown>> = {
  id: string;
  contractId?: string;
  ledger: number;
  ledgerClosedAt: string;
  name: string;
  topics: unknown[];
  data: T;
};

export function parseContractEvent<T = Record<string, unknown>>(
  event: SorobanEventRecord,
): ParsedContractEvent<T> {
  const decodedTopics = event.topic.map((topic) => scValToNative(topic));
  const eventName = decodedTopics[0];
  if (typeof eventName !== "string") {
    throw new TypeError("Soroban contract event is missing its event-name topic");
  }

  const decodedValue: unknown = scValToNative(event.value);
  const data = decodedValue instanceof Map
    ? Object.fromEntries(decodedValue.entries())
    : decodedValue;

  if (data === null || typeof data !== "object" || Array.isArray(data)) {
    throw new TypeError(`Soroban event ${eventName} has a non-struct value`);
  }

  return {
    id: event.id,
    contractId: event.contractId?.toString(),
    ledger: event.ledger,
    ledgerClosedAt: event.ledgerClosedAt,
    name: eventName,
    topics: decodedTopics.slice(1),
    data: data as T,
  };
}

export type ContractEventFilter = {
  type?: "contract" | "system" | "diagnostic";
  contractIds?: string[];
  topics?: string[][];
};

/**
 * Payment lifecycle event names emitted by the `Payment` contract.
 */
export const PAYMENT_EVENT_NAMES = [
  "PaymentCreated",
  "PaymentCompleted",
  "PaymentRefunded",
] as const;

export type PaymentEventName = (typeof PAYMENT_EVENT_NAMES)[number];

/**
 * Decoded `PaymentMemo` metadata attached to a payment event.
 */
export type PaymentMemo = {
  memoType?: string;
  memo?: string;
  [key: string]: unknown;
};

/**
 * Shared shape for all payment lifecycle events. Monetary amounts are
 * decoded as `bigint` (i128) so consumers never lose precision by routing
 * them through JavaScript `Number`.
 */
export type PaymentEventBase = {
  paymentId: string;
  customer: string;
  token: string;
  amount: bigint;
  status: string;
  memo?: PaymentMemo;
};

export type PaymentCreatedEvent = PaymentEventBase & {
  name: "PaymentCreated";
};

export type PaymentCompletedEvent = PaymentEventBase & {
  name: "PaymentCompleted";
};

export type PaymentRefundedEvent = PaymentEventBase & {
  name: "PaymentRefunded";
};

export type PaymentEvent =
  | PaymentCreatedEvent
  | PaymentCompletedEvent
  | PaymentRefundedEvent;

export function isPaymentEventName(value: unknown): value is PaymentEventName {
  return (
    typeof value === "string" &&
    (PAYMENT_EVENT_NAMES as readonly string[]).includes(value)
  );
}

/**
 * Coerce an i128-like value into a `bigint` without ever passing through
 * `Number`. Accepts bigint, integer strings, and objects exposing a
 * `toString()` (e.g. `i128` wrappers from the SDK).
 */
export function toBigIntAmount(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!/^-?\d+$/.test(trimmed)) {
      throw new TypeError(`Cannot decode i128 amount from string "${value}"`);
    }
    return BigInt(trimmed);
  }
  if (typeof value === "number") {
    if (!Number.isInteger(value)) {
      throw new TypeError(`Cannot decode i128 amount from non-integer ${value}`);
    }
    if (!Number.isSafeInteger(value)) {
      throw new TypeError(
        `Refusing to decode i128 amount ${value}: exceeds Number.MAX_SAFE_INTEGER`,
      );
    }
    return BigInt(value);
  }
  if (value !== null && typeof value === "object") {
    const asString = value.toString();
    if (asString !== "[object Object]") {
      return toBigIntAmount(asString);
    }
  }
  throw new TypeError(`Cannot decode i128 amount from ${typeof value}`);
}

function pickField(
  data: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (data[key] !== undefined && data[key] !== null) {
      return data[key];
    }
  }
  return undefined;
}

function asAddress(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (value !== null && typeof value === "object") {
    return value.toString();
  }
  throw new TypeError("Payment event is missing an address field");
}

function decodeMemo(value: unknown): PaymentMemo | undefined {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (value instanceof Map) {
    return Object.fromEntries(value.entries()) as PaymentMemo;
  }
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as PaymentMemo;
  }
  return { memo: String(value) };
}

/**
 * Normalize a parsed contract event into a strongly-typed payment event.
 * Returns `undefined` for unrelated events or malformed payloads.
 */
export function parsePaymentEvent(
  event: ParsedContractEvent<Record<string, unknown>>,
): PaymentEvent | undefined {
  if (!isPaymentEventName(event.name)) {
    return undefined;
  }

  const data = event.data ?? {};
  try {
    const paymentId = pickField(data, ["payment_id", "paymentId", "id"]);
    const customer = pickField(data, ["customer", "payer", "from"]);
    const token = pickField(data, ["token", "asset", "token_address"]);
    const amount = pickField(data, ["amount", "net_amount", "value"]);
    const status = pickField(data, ["status", "state"]);

    if (paymentId === undefined || customer === undefined || token === undefined) {
      return undefined;
    }
    if (amount === undefined) {
      return undefined;
    }

    const base: PaymentEventBase = {
      paymentId: String(paymentId),
      customer: asAddress(customer),
      token: asAddress(token),
      amount: toBigIntAmount(amount),
      status: status === undefined ? event.name.replace("Payment", "") : String(status),
      memo: decodeMemo(pickField(data, ["memo", "metadata"])),
    };

    return { ...base, name: event.name } as PaymentEvent;
  } catch {
    return undefined;
  }
}

/**
 * Filter and parse payment lifecycle events out of a raw Soroban event batch.
 */
export function parsePaymentEvents(
  events: SorobanEventRecord[],
): PaymentEvent[] {
  const parsed: PaymentEvent[] = [];
  for (const event of events) {
    let contractEvent: ParsedContractEvent<Record<string, unknown>>;
    try {
      contractEvent = parseContractEvent<Record<string, unknown>>(event);
    } catch {
      continue;
    }
    const paymentEvent = parsePaymentEvent(contractEvent);
    if (paymentEvent) {
      parsed.push(paymentEvent);
    }
  }
  return parsed;
}

/**
 * Build a Soroban topic filter matching the payment lifecycle events for a
 * given Payment contract.
 */
export function paymentEventFilter(contractId: string): ContractEventFilter {
  return {
    type: "contract",
    contractIds: [contractId],
    topics: [[...PAYMENT_EVENT_NAMES]],
  };
}

/**
 * Subscribe to real-time payment events by wrapping `pollContractEvents` with
 * a Payment-contract topic filter. The callback is invoked once per parsed
 * payment event; amounts are always `bigint`.
 */
export async function subscribePaymentEvents(options: {
  rpc: EventRpc;
  checkpoints: EventCheckpointStore;
  contractId: string;
  startLedger?: number;
  limit?: number;
  onEvent(event: PaymentEvent): Promise<void> | void;
}): Promise<{ cursor?: string; latestLedger: number; eventsProcessed: number }> {
  let eventsProcessed = 0;
  const result = await pollContractEvents<Record<string, unknown>>({
    rpc: options.rpc,
    checkpoints: options.checkpoints,
    filters: [paymentEventFilter(options.contractId)],
    startLedger: options.startLedger,
    limit: options.limit,
    onEvent: async (event) => {
      const paymentEvent = parsePaymentEvent(event);
      if (paymentEvent) {
        eventsProcessed += 1;
        await options.onEvent(paymentEvent);
      }
    },
  });

  return { ...result, eventsProcessed };
}

export type GetEventsRequest = {
  startLedger?: number;
  endLedger?: number;
  cursor?: string;
  limit?: number;
  filters: ContractEventFilter[];
};

export type GetEventsResponse = {
  events: SorobanEventRecord[];
  cursor: string;
  latestLedger: number;
};

export interface EventRpc {
  getEvents(request: GetEventsRequest): Promise<GetEventsResponse>;
}

export interface EventCheckpointStore {
  get(): Promise<string | undefined>;
  set(cursor: string): Promise<void>;
}

export async function pollContractEvents<T = Record<string, unknown>>(options: {
  rpc: EventRpc;
  checkpoints: EventCheckpointStore;
  filters: ContractEventFilter[];
  startLedger?: number;
  limit?: number;
  onEvent(event: ParsedContractEvent<T>): Promise<void> | void;
}): Promise<{ cursor?: string; latestLedger: number; eventsProcessed: number }> {
  const cursor = await options.checkpoints.get();
  const response = await options.rpc.getEvents({
    startLedger: options.startLedger,
    filters: options.filters,
    cursor,
    limit: options.limit,
  });

  for (const event of response.events) {
    await options.onEvent(parseContractEvent<T>(event));
  }

  const lastEvent = response.events[response.events.length - 1];
  const nextCursor = response.cursor || lastEvent?.pagingToken || cursor;
  if (nextCursor !== undefined && nextCursor !== cursor) {
    await options.checkpoints.set(nextCursor);
  }

  return {
    cursor: nextCursor,
    latestLedger: response.latestLedger,
    eventsProcessed: response.events.length,
  };
}

// ---------------------------------------------------------------------------
// Strongly-Typed Contract Event Data Interfaces
// ---------------------------------------------------------------------------

export interface PaymentCompletedEventData {
  payment_id: number | string | bigint;
  merchant: string;
  amount: number | string | bigint;
  customer?: string;
  [key: string]: unknown;
}

export interface EscrowDisputedEventData {
  escrow_id: number | string | bigint;
  disputed_by: string;
  reason?: string;
  customer?: string;
  merchant?: string;
  [key: string]: unknown;
}

export interface RefundApprovedEventData {
  refund_id: number | string | bigint;
  payment_id?: number | string | bigint;
  customer: string;
  merchant: string;
  amount: number | string | bigint;
  reason_code?: number | string;
  approved_by: string;
  approved_at?: number | string | bigint;
  [key: string]: unknown;
}

export interface DisputeAppealFiledEventData {
  appeal_id: number | string | bigint;
  escrow_id: number | string | bigint;
  appellant: string;
  filed_at?: number | string | bigint;
  appeal_deadline?: number | string | bigint;
  [key: string]: unknown;
}

export interface UpgradeProposedEventData {
  proposal_id: number | string | bigint;
  contract_address?: string;
  new_wasm_hash?: string;
  expected_post_schema_version?: number;
  proposer?: string;
  admin?: string;
  expires_at?: number | string | bigint;
  [key: string]: unknown;
}

export interface SystemPausedEventData {
  paused_by?: string;
  pauser?: string;
  subsystem?: string;
  scope?: string;
  reason?: string;
  paused_at?: number | string | bigint;
  [key: string]: unknown;
}

// ---------------------------------------------------------------------------
// Human-Readable Notification Types & Deep Link Mapping
// ---------------------------------------------------------------------------

export type NotificationCategory =
  | "payment"
  | "escrow"
  | "refund"
  | "governance"
  | "system";

export type NotificationSeverity =
  | "info"
  | "success"
  | "warning"
  | "critical";

export interface ContractNotificationItem {
  id: string;
  eventId: string;
  pagingToken?: string;
  eventName: string;
  title: string;
  message: string;
  category: NotificationCategory;
  severity: NotificationSeverity;
  deepLink: string;
  ledger: number;
  ledgerClosedAt: string;
  timestamp: number;
  read: boolean;
  targetAddress?: string;
  rawEvent?: unknown;
}

/**
 * Truncates a Stellar address to GABCD...1234 format.
 */
export function formatAddress(address?: string): string {
  if (!address) return "unknown";
  if (address.length <= 10) return address;
  return `${address.slice(0, 5)}...${address.slice(-4)}`;
}

/**
 * Formats a stroop or numeric amount with 2 decimal places.
 */
export function formatTokenAmount(amount?: number | string | bigint): string {
  if (amount === undefined || amount === null) return "0.00";
  try {
    const raw = typeof amount === "bigint" ? Number(amount) : Number(amount);
    if (isNaN(raw)) return String(amount);
    const val = raw >= 10_000_000 ? raw / 10_000_000 : raw;
    return val.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 4,
    });
  } catch {
    return String(amount);
  }
}

/**
 * Checks whether a parsed contract event involves a specific Stellar address.
 * System-wide events (SystemPaused, UpgradeProposed) are relevant to all users.
 */
export function isEventRelevantToAddress(
  event: ParsedContractEvent,
  address?: string,
): boolean {
  if (!address) return false;
  const target = address.trim().toLowerCase();
  const eventName = event.name.toLowerCase();

  // System-wide protocol events are always relevant
  if (
    eventName === "systempaused" ||
    eventName === "emergency_pause_all" ||
    eventName === "contract_paused" ||
    eventName === "upgradeproposed" ||
    eventName === "upgrade_proposed"
  ) {
    return true;
  }

  const data = (event.data || {}) as Record<string, unknown>;
  const addressFields = [
    "merchant",
    "customer",
    "disputed_by",
    "appellant",
    "approved_by",
    "pauser",
    "paused_by",
    "proposer",
    "admin",
    "account",
    "user",
  ];

  for (const field of addressFields) {
    const val = data[field];
    if (typeof val === "string" && val.trim().toLowerCase() === target) {
      return true;
    }
  }

  if (Array.isArray(event.topics)) {
    for (const t of event.topics) {
      if (typeof t === "string" && t.trim().toLowerCase() === target) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Maps a parsed Soroban contract event into a human-readable notification item
 * with deep links to the corresponding Payment, Escrow, Refund, or Admin detail page.
 */
export function mapEventToNotification(
  event: ParsedContractEvent,
  activeAddress?: string,
): ContractNotificationItem {
  const normName = event.name;
  const data = (event.data || {}) as Record<string, unknown>;
  const eventId = event.id;
  const ledger = event.ledger;
  const ledgerClosedAt = event.ledgerClosedAt || new Date().toISOString();
  const timestamp = Date.parse(ledgerClosedAt) || Date.now();

  let title = "Contract Event";
  let message = `Event ${normName} recorded in ledger #${ledger}.`;
  let category: NotificationCategory = "system";
  let severity: NotificationSeverity = "info";
  let deepLink = "/";

  const lowerName = normName.toLowerCase();

  if (lowerName === "paymentcompleted" || lowerName === "escrowedpaymentcompleted" || lowerName === "payment_completed") {
    const paymentId = data.payment_id ?? data.id ?? "unknown";
    const amountStr = formatTokenAmount(data.amount as number | string | bigint);
    const merchantStr = formatAddress(data.merchant as string);
    title = `Payment #${paymentId} Completed`;
    message = `Payment of ${amountStr} USDC to ${merchantStr} was confirmed on-chain.`;
    category = "payment";
    severity = "success";
    deepLink = `/payments/${paymentId}`;
  } else if (lowerName === "escrowdisputed" || lowerName === "escrow_disputed") {
    const escrowId = data.escrow_id ?? "unknown";
    const disputedBy = formatAddress(data.disputed_by as string);
    title = `Escrow #${escrowId} Disputed`;
    message = `A dispute was opened by ${disputedBy} for escrow #${escrowId}. Action required.`;
    category = "escrow";
    severity = "warning";
    deepLink = `/escrows/${escrowId}`;
  } else if (
    lowerName === "refundapproved" ||
    lowerName === "refundapprovedevent" ||
    lowerName === "refund_approved_event"
  ) {
    const refundId = data.refund_id ?? "unknown";
    const amountStr = formatTokenAmount(data.amount as number | string | bigint);
    const approver = formatAddress(data.approved_by as string);
    title = `Refund #${refundId} Approved`;
    message = `Refund of ${amountStr} USDC was approved by ${approver} and queued for settlement.`;
    category = "refund";
    severity = "success";
    deepLink = `/refunds/${refundId}`;
  } else if (
    lowerName === "disputeappealfiled" ||
    lowerName === "dispute_appeal_filed" ||
    lowerName === "appealfiledevent" ||
    lowerName === "appeal_filed_event"
  ) {
    const appealId = data.appeal_id ?? "unknown";
    const escrowId = data.escrow_id ?? "unknown";
    const appellant = formatAddress(data.appellant as string);
    title = `Dispute Appeal Filed (Escrow #${escrowId})`;
    message = `Appeal #${appealId} was lodged by ${appellant}. Escalated to arbitration panel.`;
    category = "escrow";
    severity = "warning";
    deepLink = `/escrows/${escrowId}`;
  } else if (
    lowerName === "upgradeproposed" ||
    lowerName === "upgrade_proposed"
  ) {
    const proposalId = data.proposal_id ?? "unknown";
    title = `Contract Upgrade Proposal #${proposalId}`;
    message = `Governance upgrade proposal #${proposalId} submitted. Timelock and multisig approval initiated.`;
    category = "governance";
    severity = "info";
    deepLink = `/admin/upgrades/${proposalId}`;
  } else if (
    lowerName === "systempaused" ||
    lowerName === "emergency_pause_all" ||
    lowerName === "contract_paused"
  ) {
    const reason = (data.reason as string) || "Emergency safeguard activated";
    title = "System Paused (Circuit Breaker)";
    message = `Emergency pause active: ${reason}. Transactions temporarily suspended; funds secure.`;
    category = "system";
    severity = "critical";
    deepLink = "/admin/health";
  }

  return {
    id: eventId,
    eventId,
    eventName: normName,
    title,
    message,
    category,
    severity,
    deepLink,
    ledger,
    ledgerClosedAt,
    timestamp,
    read: false,
    targetAddress: activeAddress,
    rawEvent: event,
  };
}

// ---------------------------------------------------------------------------
// Event Deduplication
// ---------------------------------------------------------------------------

export interface DeduplicatorOptions {
  maxCapacity?: number;
}

/**
 * Deterministic Soroban event deduplicator by event.id / pagingToken.
 * Maintains bounded memory and preserves deduplication across reconnects and polling fallbacks.
 */
export class EventDeduplicator {
  private readonly seenIds: Set<string>;
  private readonly idRing: string[];
  private readonly maxCapacity: number;

  constructor(options?: DeduplicatorOptions) {
    this.maxCapacity = options?.maxCapacity ?? 5000;
    this.seenIds = new Set<string>();
    this.idRing = [];
  }

  public static getKey(event: { id?: string; pagingToken?: string }): string {
    return event.id || event.pagingToken || "";
  }

  public has(key: string): boolean {
    if (!key) return false;
    return this.seenIds.has(key);
  }

  public add(key: string): boolean {
    if (!key) return false;
    if (this.seenIds.has(key)) {
      return false;
    }
    if (this.idRing.length >= this.maxCapacity) {
      const oldest = this.idRing.shift();
      if (oldest) {
        this.seenIds.delete(oldest);
      }
    }
    this.seenIds.add(key);
    this.idRing.push(key);
    return true;
  }

  public filter<E extends { id?: string; pagingToken?: string }>(
    events: E[],
    getKey?: (item: E) => string,
  ): E[] {
    const fresh: E[] = [];
    for (const item of events) {
      const key = getKey ? getKey(item) : EventDeduplicator.getKey(item);
      if (key && this.add(key)) {
        fresh.push(item);
      }
    }
    return fresh;
  }

  public clear(): void {
    this.seenIds.clear();
    this.idRing.length = 0;
  }

  public get size(): number {
    return this.seenIds.size;
  }
}

// ---------------------------------------------------------------------------
// Burst / Batch Event Throttling
// ---------------------------------------------------------------------------

export interface BurstThrottlerOptions {
  burstThreshold?: number;
  maxIndividualToasts?: number;
  burstWindowMs?: number;
}

export interface ThrottledToastResult<T> {
  type: "individual" | "summary";
  item?: T;
  count?: number;
  ledger?: number;
  summaryTitle?: string;
  summaryMessage?: string;
}

/**
 * Throttles burst notifications when multiple events arrive in a single ledger
 * or within a rapid time window. Emits up to maxIndividualToasts individual toasts
 * and aggregates the rest into a clean summary toast.
 */
export class BatchBurstThrottler<T extends { ledger?: number; title?: string }> {
  private readonly burstThreshold: number;
  private readonly maxIndividualToasts: number;
  private readonly burstWindowMs: number;
  private buffer: T[] = [];
  private timer: unknown = null;

  constructor(options?: BurstThrottlerOptions) {
    this.burstThreshold = options?.burstThreshold ?? 2;
    this.maxIndividualToasts = options?.maxIndividualToasts ?? 2;
    this.burstWindowMs = options?.burstWindowMs ?? 400;
  }

  public throttleBatch(events: T[], ledger?: number): ThrottledToastResult<T>[] {
    if (events.length === 0) return [];
    const effectiveLedger = ledger ?? events[0]?.ledger;

    if (events.length <= this.burstThreshold) {
      return events.map((item) => ({
        type: "individual" as const,
        item,
        ledger: effectiveLedger,
      }));
    }

    const results: ThrottledToastResult<T>[] = [];
    const individualCount = Math.min(this.maxIndividualToasts, events.length);
    for (let i = 0; i < individualCount; i++) {
      const item = events[i];
      if (item) {
        results.push({
          type: "individual",
          item,
          ledger: effectiveLedger,
        });
      }
    }

    const excess = events.length - individualCount;
    if (excess > 0) {
      results.push({
        type: "summary",
        count: excess,
        ledger: effectiveLedger,
        summaryTitle: `Batch Confirmation (Ledger #${effectiveLedger || "latest"})`,
        summaryMessage: `${excess} additional transaction${excess > 1 ? "s" : ""} finalized on-chain`,
      });
    }

    return results;
  }

  public enqueue(
    item: T,
    onFlush: (results: ThrottledToastResult<T>[]) => void,
  ): void {
    this.buffer.push(item);
    if (!this.timer) {
      const g = globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown };
      if (typeof g.setTimeout === "function") {
        this.timer = g.setTimeout(() => {
          const batch = [...this.buffer];
          this.buffer = [];
          this.timer = null;
          const results = this.throttleBatch(batch);
          onFlush(results);
        }, this.burstWindowMs);
      }
    }
  }

  public flush(): T[] {
    if (this.timer) {
      const g = globalThis as { clearTimeout?: (t: unknown) => void };
      if (typeof g.clearTimeout === "function") {
        g.clearTimeout(this.timer);
      }
      this.timer = null;
    }
    const batch = [...this.buffer];
    this.buffer = [];
    return batch;
  }

  public reset(): void {
    if (this.timer) {
      const g = globalThis as { clearTimeout?: (t: unknown) => void };
      if (typeof g.clearTimeout === "function") {
        g.clearTimeout(this.timer);
      }
      this.timer = null;
    }
    this.buffer = [];
  }
}

// ---------------------------------------------------------------------------
// Stream & Polling Fallback Manager
// ---------------------------------------------------------------------------

export type StreamConnectionStatus =
  | "connected"
  | "reconnecting"
  | "polling"
  | "degraded"
  | "disconnected";

export interface StreamManagerOptions {
  wsUrl?: string;
  rpc: EventRpc;
  filters: ContractEventFilter[];
  startCursor?: string;
  pollIntervalMs?: number;
  onEvent: (event: ParsedContractEvent) => void | Promise<void>;
  onStatusChange?: (status: StreamConnectionStatus) => void;
  onLedgerUpdate?: (ledger: number) => void;
  onLatencyUpdate?: (latencyMs: number) => void;
}

/**
 * Manages WebSocket/SSE streaming with graceful cursor-based polling fallback
 * when persistent sockets are blocked or disconnected.
 */
export class ContractEventStreamManager {
  private readonly options: StreamManagerOptions;
  private readonly deduplicator: EventDeduplicator;
  private status: StreamConnectionStatus = "disconnected";
  private cursor?: string;
  private isRunning = false;
  private pollTimer: unknown = null;
  private socket: any = null;

  constructor(options: StreamManagerOptions) {
    this.options = options;
    this.deduplicator = new EventDeduplicator();
    this.cursor = options.startCursor;
  }

  public getStatus(): StreamConnectionStatus {
    return this.status;
  }

  public getCursor(): string | undefined {
    return this.cursor;
  }

  public setCursor(cursor: string): void {
    this.cursor = cursor;
  }

  private setStatus(newStatus: StreamConnectionStatus): void {
    if (this.status !== newStatus) {
      this.status = newStatus;
      this.options.onStatusChange?.(newStatus);
    }
  }

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;

    if (this.options.wsUrl) {
      this.connectSocket();
    } else {
      this.startPollingFallback();
    }
  }

  public stop(): void {
    this.isRunning = false;
    if (this.pollTimer) {
      const g = globalThis as { clearTimeout?: (t: unknown) => void };
      g.clearTimeout?.(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.socket) {
      try {
        if (typeof this.socket.close === "function") {
          this.socket.close();
        }
      } catch {
        // ignore close error
      }
      this.socket = null;
    }
    this.setStatus("disconnected");
  }

  private connectSocket(): void {
    try {
      this.setStatus("reconnecting");
      const g = globalThis as { WebSocket?: new (url: string) => any; setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (t: unknown) => void };
      if (typeof g.WebSocket === "undefined") {
        this.startPollingFallback();
        return;
      }

      const ws = new g.WebSocket(this.options.wsUrl!);
      this.socket = ws;

      const connectTimeout = g.setTimeout?.(() => {
        if (ws.readyState !== 1) { // 1 = OPEN
          try { ws.close(); } catch { /* ignore */ }
          this.startPollingFallback();
        }
      }, 5000);

      ws.onopen = () => {
        if (connectTimeout) g.clearTimeout?.(connectTimeout);
        this.setStatus("connected");
      };

      ws.onmessage = (event: { data: unknown }) => {
        try {
          const raw = JSON.parse(typeof event.data === "string" ? event.data : String(event.data));
          if (raw.type === "ledger" && typeof raw.ledger === "number") {
            this.options.onLedgerUpdate?.(raw.ledger);
          } else if (raw.event) {
            this.handleIncomingRawEvent(raw.event);
          }
        } catch {
          // ignore unparseable socket message
        }
      };

      ws.onerror = () => {
        if (connectTimeout) g.clearTimeout?.(connectTimeout);
        this.startPollingFallback();
      };

      ws.onclose = () => {
        if (connectTimeout) g.clearTimeout?.(connectTimeout);
        if (this.isRunning && this.status !== "polling") {
          this.startPollingFallback();
        }
      };
    } catch {
      this.startPollingFallback();
    }
  }

  public startPollingFallback(): void {
    if (!this.isRunning) return;
    this.setStatus("polling");
    this.scheduleNextPoll(100);
  }

  private scheduleNextPoll(delayMs: number): void {
    if (!this.isRunning) return;
    const g = globalThis as { setTimeout?: (fn: () => void, ms: number) => unknown; clearTimeout?: (t: unknown) => void };
    if (this.pollTimer) g.clearTimeout?.(this.pollTimer);
    this.pollTimer = g.setTimeout?.(async () => {
      await this.pollOnce();
      if (this.isRunning) {
        this.scheduleNextPoll(this.options.pollIntervalMs ?? 3000);
      }
    }, delayMs);
  }

  public async pollOnce(): Promise<void> {
    if (!this.isRunning) return;
    const startTime = Date.now();
    try {
      const response = await this.options.rpc.getEvents({
        cursor: this.cursor,
        filters: this.options.filters,
        limit: 50,
      });

      const latency = Date.now() - startTime;
      this.options.onLatencyUpdate?.(latency);

      if (response.latestLedger) {
        this.options.onLedgerUpdate?.(response.latestLedger);
      }

      for (const event of response.events) {
        this.handleIncomingRawEvent(event);
      }

      if (response.cursor) {
        this.cursor = response.cursor;
      } else if (response.events.length > 0) {
        const last = response.events[response.events.length - 1];
        if (last && (last.pagingToken || last.id)) {
          this.cursor = last.pagingToken || last.id;
        }
      }

      // If latency is high, signal degraded state
      if (latency > 1000 && this.status === "polling") {
        this.setStatus("degraded");
      } else if (this.status === "degraded" && latency <= 1000) {
        this.setStatus("polling");
      }
    } catch {
      this.setStatus("degraded");
    }
  }

  private handleIncomingRawEvent(eventRecord: any): void {
    const key = eventRecord.id || eventRecord.pagingToken;
    if (!key || !this.deduplicator.add(key)) {
      return; // Deduplicated
    }

    try {
      let parsed: ParsedContractEvent;
      if (eventRecord.name && eventRecord.data) {
        parsed = eventRecord as ParsedContractEvent;
      } else {
        parsed = parseContractEvent(eventRecord);
      }
      this.options.onEvent(parsed);
    } catch {
      // Ignore unparseable event
    }
  }

  public getDeduplicator(): EventDeduplicator {
    return this.deduplicator;
  }
}
