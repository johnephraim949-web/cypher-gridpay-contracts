import { appendFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { AlertSink, Logger, SponsorshipLedger, SponsorshipRecord } from "./types.js";

function fields(fields?: Record<string, unknown>): Record<string, unknown> {
  return fields ?? {};
}

/**
 * Mandatory correlation fields for the centralized structured log schema.
 * Every emitted log line carries these keys (null when not applicable) so that
 * Loki/ELK queries can join logs across services by `trace_id`.
 */
export interface LogContext {
  trace_id?: string | null;
  span_id?: string | null;
  service?: string | null;
  network?: string | null;
  ledger_seq?: number | string | null;
  tx_hash?: string | null;
  contract_id?: string | null;
  payment_id?: string | null;
  escrow_id?: string | null;
  refund_id?: string | null;
}

const MANDATORY_FIELDS: ReadonlyArray<keyof LogContext> = [
  "trace_id",
  "span_id",
  "service",
  "network",
  "ledger_seq",
  "tx_hash",
  "contract_id",
  "payment_id",
  "escrow_id",
  "refund_id",
];

const REDACTED = "[REDACTED]";

/** Header / key names whose values must never reach the log backend. */
const SENSITIVE_KEY_PATTERN =
  /^(authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|apikey|secret|hmac|hmac[-_]?secret|hmac[-_]?key|signing[-_]?key|private[-_]?key|password|token|access[-_]?token|refresh[-_]?token)$/i;

/** Stellar secret seeds: `S` followed by 55 base32 characters. */
const STELLAR_SECRET_PATTERN = /\bS[A-Z2-7]{55}\b/g;

/** Bearer / Basic credentials embedded in free-form strings. */
const AUTH_HEADER_VALUE_PATTERN = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi;

/** Common API key shapes (sk_live_..., pk_..., long hex/base64 tokens after `key=`). */
const API_KEY_VALUE_PATTERN = /\b(sk|pk|rk)_(live|test)_[A-Za-z0-9]{8,}\b/g;
const QUERY_SECRET_PATTERN = /([?&](?:api[-_]?key|token|secret|hmac)=)[^&\s]+/gi;

/**
 * Recursively scrub sensitive values from an arbitrary value before it is
 * serialized into a log line. Handles nested objects, arrays, and strings that
 * contain embedded Stellar secret seeds or Authorization header values.
 */
export function redact(value: unknown, depth = 0): unknown {
  if (depth > 8) return "[TRUNCATED]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (value instanceof Error) {
    return { name: value.name, message: redactString(value.message), stack: value.stack ? redactString(value.stack) : undefined };
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SENSITIVE_KEY_PATTERN.test(key) ? REDACTED : redact(entry, depth + 1);
    }
    return out;
  }
  return value;
}

function redactString(input: string): string {
  return input
    .replace(STELLAR_SECRET_PATTERN, REDACTED)
    .replace(AUTH_HEADER_VALUE_PATTERN, (_match, scheme: string) => `${scheme} ${REDACTED}`)
    .replace(API_KEY_VALUE_PATTERN, REDACTED)
    .replace(QUERY_SECRET_PATTERN, (_match, prefix: string) => `${prefix}${REDACTED}`);
}

/** Build a log record with all mandatory correlation fields present. */
export function buildLogRecord(
  level: string,
  message: string,
  context: LogContext = {},
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  const record: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    level,
    message,
  };
  for (const key of MANDATORY_FIELDS) {
    record[key] = context[key] ?? null;
  }
  return redact({ ...record, ...fields(extra) }) as Record<string, unknown>;
}

/**
 * Non-blocking OTLP/HTTP exporter. Telemetry is buffered and flushed on a
 * best-effort basis; if the collector is unreachable the batch is dropped and
 * the failure is swallowed so application code never blocks or throws.
 */
export class OtlpExporter {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;

  constructor(
    endpoint: string = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318",
    fetchImpl: typeof fetch = fetch,
    timeoutMs = 1_000,
  ) {
    this.endpoint = endpoint.replace(/\/$/, "");
    this.fetchImpl = fetchImpl;
    this.timeoutMs = timeoutMs;
  }

  /** Fire-and-forget log export. Never throws, never awaits the network. */
  exportLog(record: Record<string, unknown>): void {
    const body = JSON.stringify({ resourceLogs: [{ scopeLogs: [{ logRecords: [{ body: { stringValue: record.message }, attributes: toAttributes(record) }] }] }] });
    void this.post("/v1/logs", body);
  }

  /** Fire-and-forget span export. Never throws, never awaits the network. */
  exportSpan(span: Record<string, unknown>): void {
    const body = JSON.stringify({ resourceSpans: [{ scopeSpans: [{ spans: [span] }] }] });
    void this.post("/v1/traces", body);
  }

  private async post(path: string, body: string): Promise<void> {
    try {
      await this.fetchImpl(`${this.endpoint}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch {
      // Collector unreachable / timed out: drop telemetry silently.
    }
  }
}

function toAttributes(record: Record<string, unknown>): Array<{ key: string; value: Record<string, unknown> }> {
  return Object.entries(record)
    .filter(([key]) => key !== "message")
    .map(([key, value]) => {
      if (typeof value === "number") return { key, value: { intValue: String(value) } };
      if (typeof value === "boolean") return { key, value: { boolValue: value } };
      return { key, value: { stringValue: value === null || value === undefined ? "" : String(value) } };
    });
}

export class ConsoleLogger implements Logger {
  constructor(
    private readonly sink: (line: string) => void = (line) => process.stdout.write(`${line}\n`),
    private readonly context: LogContext = {},
    private readonly exporter?: OtlpExporter,
  ) {}

  private emit(level: string, message: string, extra?: Record<string, unknown>): void {
    const record = buildLogRecord(level, message, this.context, extra);
    this.sink(JSON.stringify(record));
    this.exporter?.exportLog(record);
  }

  info(message: string, extra?: Record<string, unknown>): void {
    this.emit("info", message, extra);
  }

  warn(message: string, extra?: Record<string, unknown>): void {
    this.emit("warn", message, extra);
  }

  error(message: string, extra?: Record<string, unknown>): void {
    this.emit("error", message, extra);
  }
}

export class JsonlSponsorshipLedger implements SponsorshipLedger {
  private readonly path: string;

  constructor(path: string) {
    this.path = resolve(path);
  }

  async record(record: SponsorshipRecord): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true });
    await appendFile(this.path, `${JSON.stringify(record)}\n`, "utf8");
  }
}

export class WebhookAlertSink implements AlertSink {
  constructor(
    private readonly url: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async alert(message: string, details?: Record<string, unknown>): Promise<void> {
    await this.fetchImpl(this.url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, details: redact(fields(details)), timestamp: new Date().toISOString() }),
      signal: AbortSignal.timeout(5_000),
    });
  }
}

export class LoggingAlertSink implements AlertSink {
  constructor(private readonly logger: Logger) {}

  alert(message: string, details?: Record<string, unknown>): void {
    this.logger.error("SRE_ALERT", { message, ...fields(details) });
  }
}

/** Test-only export of the redaction sentinel for assertions. */
export const REDACTION_PLACEHOLDER = REDACTED;
