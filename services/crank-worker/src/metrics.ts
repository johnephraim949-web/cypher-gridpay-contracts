import { createServer, type Server } from "node:http";
import { Counter, Gauge, Histogram, Registry } from "prom-client";
import type { ExecutionOutcome } from "./types.js";

/**
 * Mandatory correlation fields for the centralized structured JSON log schema.
 * Every log line emitted by the crank worker must carry these so that traces
 * can be joined across Soroban RPC, the indexer, webhooks and the relayer.
 */
export interface LogCorrelation {
  trace_id?: string;
  span_id?: string;
  service?: string;
  network?: string;
  ledger_seq?: number | string;
  tx_hash?: string;
  contract_id?: string;
  payment_id?: string;
  escrow_id?: string;
  refund_id?: string;
}

export interface StructuredLogRecord extends LogCorrelation {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  message: string;
  [key: string]: unknown;
}

const DEFAULT_SERVICE = "crank-worker";

/** Keys whose values must never reach the log backend. */
const REDACTED_KEYS = /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|hmac|hmac[-_]?secret|secret|secret[-_]?key|password|token)$/i;

/** Stellar secret seeds are 56 chars starting with `S`. */
const STELLAR_SECRET_SEED = /\bS[A-Z2-7]{55}\b/g;
const BEARER_TOKEN = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

/**
 * Recursively scrubs sensitive values (Authorization headers, HMAC secrets,
 * API keys and Stellar `S...` secret seeds) from a log payload before export.
 */
export function redactLogValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") {
    return value.replace(STELLAR_SECRET_SEED, "[REDACTED_SEED]").replace(BEARER_TOKEN, "Bearer [REDACTED]");
  }
  if (Array.isArray(value)) return value.map((item) => redactLogValue(item, depth + 1));
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = REDACTED_KEYS.test(key) ? "[REDACTED]" : redactLogValue(entry, depth + 1);
    }
    return out;
  }
  return value;
}

export interface OtlpExportOptions {
  /** OTLP/HTTP base endpoint, e.g. `http://otel-collector:4318`. */
  endpoint?: string;
  /** Per-request timeout in ms; exports are fire-and-forget. */
  timeoutMs?: number;
  service?: string;
  network?: string;
  headers?: Record<string, string>;
}

export class CrankMetrics {
  readonly registry = new Registry();

  private otlp?: OtlpExportOptions;
  private readonly service: string;
  private readonly network: string;
  private readonly logSink: (record: StructuredLogRecord) => void;
  private collectorHealthy = true;
  private lastCollectorWarning = 0;
=======

  private readonly dueDepth = new Gauge({
    name: "crank_due_queue_depth",
    help: "Number of enabled crank tasks whose next_run_at is within the lookahead window",
    registers: [this.registry],
  });

  private readonly latency = new Histogram({
    name: "crank_execution_latency_seconds",
    help: "Time spent simulating and submitting a crank task",
    labelNames: ["action_type", "status"] as const,
    buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
    registers: [this.registry],
  });

  private readonly gas = new Counter({
    name: "crank_gas_spent_stroops_total",
    help: "Resource fees paid for submitted crank transactions, in stroops",
    labelNames: ["action_type"] as const,
    registers: [this.registry],
  });

  private readonly executions = new Counter({
    name: "crank_execution_total",
    help: "Crank task outcomes by action type and status",
    labelNames: ["action_type", "status"] as const,
    registers: [this.registry],
  });

  private readonly permanent = new Counter({
    name: "crank_permanent_failures_total",
    help: "Crank jobs that exhausted their retry budget or reverted deterministically",
    labelNames: ["action_type"] as const,
    registers: [this.registry],
  });

  private readonly skips = new Counter({
    name: "crank_skipped_total",
    help: "Tasks skipped without submitting a transaction",
    labelNames: ["reason"] as const,
    registers: [this.registry],
  });

  constructor(options: { logSink?: (record: StructuredLogRecord) => void; service?: string; network?: string } = {}) {
    this.service = options.service ?? DEFAULT_SERVICE;
    this.network = options.network ?? process.env.STELLAR_NETWORK ?? "testnet";
    this.logSink = options.logSink ?? ((record) => process.stdout.write(`${JSON.stringify(record)}\n`));
  }

  /**
   * Enables OTLP metric export. Failures are swallowed so a temporarily
   * unreachable collector never blocks crank execution.
   */
  configureOtlp(options: OtlpExportOptions): void {
    this.otlp = { timeoutMs: 2000, ...options, service: options.service ?? this.service, network: options.network ?? this.network };
  }

  /** Emits a structured JSON log line with mandatory correlation fields. */
  log(level: StructuredLogRecord["level"], message: string, fields: LogCorrelation & Record<string, unknown> = {}): void {
    const record: StructuredLogRecord = {
      timestamp: new Date().toISOString(),
      level,
      message,
      service: this.service,
      network: this.network,
      ...fields,
    };
    try {
      this.logSink(redactLogValue(record) as StructuredLogRecord);
    } catch {
      // Logging must never break the crank loop.
    }
  }

  /**
   * Pushes the current metric snapshot to the OTel Collector over OTLP/HTTP.
   * Fire-and-forget: any network error is logged once and ignored.
   */
  async exportOtlp(): Promise<void> {
    if (!this.otlp?.endpoint) return;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.otlp.timeoutMs ?? 2000);
    try {
      const body = await this.render();
      const response = await fetch(`${this.otlp.endpoint.replace(/\/$/, "")}/v1/metrics`, {
        method: "POST",
        headers: { "Content-Type": "text/plain; version=0.0.4", ...(this.otlp.headers ?? {}) },
        body,
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`OTLP export failed with status ${response.status}`);
      this.collectorHealthy = true;
    } catch (error) {
      this.collectorHealthy = false;
      const now = Date.now();
      if (now - this.lastCollectorWarning > 60_000) {
        this.lastCollectorWarning = now;
        this.log("warn", "otel_collector_unreachable", { error: error instanceof Error ? error.message : String(error) });
      }
    } finally {
      clearTimeout(timer);
    }
  }

  isCollectorHealthy(): boolean {
    return this.collectorHealthy;
  }

  setDueQueueDepth(depth: number): void {
    this.dueDepth.set(depth);
  }

  observeExecution(actionType: string, status: string, seconds: number): void {
    this.latency.labels(actionType, status).observe(seconds);
  }

  recordGas(actionType: string, gasStroops: number): void {
    if (gasStroops > 0) this.gas.labels(actionType).inc(gasStroops);
  }

  recordOutcome(actionType: string, outcome: ExecutionOutcome, correlation: LogCorrelation = {}): void {
    const status = outcome.status === "failed" ? `failed_${outcome.kind}` : outcome.status;
    this.executions.labels(actionType, status).inc();
    if (outcome.status === "skipped") this.skips.labels(outcome.reason).inc();
    if (outcome.status === "permanent") this.permanent.labels(actionType).inc();
    if (outcome.status === "executed" || outcome.status === "failed" || outcome.status === "permanent") {
      this.recordGas(actionType, outcome.gasStroops ?? 0);
    }
    const level = outcome.status === "failed" || outcome.status === "permanent" ? "error" : "info";
    this.log(level, "crank_execution_outcome", { ...correlation, action_type: actionType, status });
    void this.exportOtlp();
  }

  async render(): Promise<string> {
    return this.registry.metrics();
  }

  async startServer(port: number): Promise<Server> {
    const server = createServer(async (request, response) => {
      if (request.url === "/metrics") {
        response.writeHead(200, { "Content-Type": this.registry.contentType });
        response.end(await this.render());
        return;
      }
      response.writeHead(404);
      response.end();
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(port, resolve);
    });
    return server;
  }
}
