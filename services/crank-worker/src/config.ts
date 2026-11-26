import type { CircuitBreakerConfig } from "./circuit-breaker.js";

export interface CrankConfig extends CircuitBreakerConfig {
  databaseUrl: string;
  rpcUrl: string;
  networkPassphrase: string;
  contractIds: { payment: string; escrow: string; refund: string };
  channelSecrets: string[];
  merchantSecrets: string[];
  lookaheadMs: number;
  batchSize: number;
  pollIntervalMs: number;
  lockTtlMs: number;
  metricsPort?: number;
  baseRetryMs: number;
  maxRetryMs: number;
  baseFeeStroops: string;
  pollAttempts: number;
  pollInitialDelayMs: number;
  pollMaxDelayMs: number;
  maxRestoreAttempts: number;
  otel: OtelConfig;
}

export interface OtelConfig {
  enabled: boolean;
  endpoint?: string;
  serviceName: string;
  tracesSampler: string;
}

function integer(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function csv(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value.split(/[,;\s]+/).map((item) => item.trim()).filter((item) => item.length > 0);
}

function required(value: string | undefined, name: string): string {
  if (value === undefined || value.trim() === "") throw new Error(`Missing required environment variable ${name}`);
  return value.trim();
}

function boolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim() === "") return fallback;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function optional(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function loadOtelConfig(env: NodeJS.ProcessEnv): OtelConfig {
  const endpoint = optional(env.OTEL_EXPORTER_OTLP_ENDPOINT);
  // Tracing is opt-in: when no endpoint is configured we default to disabled so
  // services run without an OTel Collector present.
  const enabled = boolean(env.OTEL_ENABLED, endpoint !== undefined);
  return {
    enabled,
    endpoint,
    serviceName: optional(env.OTEL_SERVICE_NAME) ?? "crank-worker",
    tracesSampler: optional(env.OTEL_TRACES_SAMPLER) ?? "parentbased_traceidratio",
  };
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): CrankConfig {
  const databaseUrl = required(env.DATABASE_URL, "DATABASE_URL");
  const rpcUrl = required(env.CRANK_RPC_URL ?? env.SOROBAN_RPC_URL, "CRANK_RPC_URL");
  const networkPassphrase = required(env.NETWORK_PASSPHRASE, "NETWORK_PASSPHRASE");
  const channelSecrets = csv(env.CRANK_CHANNEL_SECRETS ?? env.CRANK_CHANNEL_SECRET);
  if (channelSecrets.length === 0) {
    throw new Error("Missing required environment variable CRANK_CHANNEL_SECRETS");
  }
  const baseRetryMs = integer(env.CRANK_BASE_RETRY_MS, 5_000, "CRANK_BASE_RETRY_MS");
  const maxRetryMs = integer(env.CRANK_MAX_RETRY_MS, 3_600_000, "CRANK_MAX_RETRY_MS");
  const baseBackoffMs = integer(env.CRANK_CIRCUIT_BASE_MS, 60_000, "CRANK_CIRCUIT_BASE_MS");
  const maxBackoffMs = integer(env.CRANK_CIRCUIT_MAX_MS, 3_600_000, "CRANK_CIRCUIT_MAX_MS");
  const failureThreshold = integer(env.CRANK_CIRCUIT_THRESHOLD, 3, "CRANK_CIRCUIT_THRESHOLD");
  if (failureThreshold < 1) throw new Error("CRANK_CIRCUIT_THRESHOLD must be at least 1");
  const metricsPortValue = env.CRANK_METRICS_PORT;
  const metricsPort = metricsPortValue === undefined || metricsPortValue.trim() === ""
    ? undefined
    : integer(metricsPortValue, 0, "CRANK_METRICS_PORT");

  return {
    databaseUrl,
    rpcUrl,
    networkPassphrase,
    contractIds: {
      payment: required(env.PAYMENT_CONTRACT_ID, "PAYMENT_CONTRACT_ID"),
      escrow: required(env.ESCROW_CONTRACT_ID, "ESCROW_CONTRACT_ID"),
      refund: required(env.REFUND_CONTRACT_ID, "REFUND_CONTRACT_ID"),
    },
    channelSecrets,
    merchantSecrets: csv(env.CRANK_MERCHANT_SECRETS),
    lookaheadMs: integer(env.CRANK_LOOKAHEAD_MS, 60_000, "CRANK_LOOKAHEAD_MS"),
    batchSize: integer(env.CRANK_BATCH_SIZE, 50, "CRANK_BATCH_SIZE"),
    pollIntervalMs: integer(env.CRANK_POLL_INTERVAL_MS, 1_000, "CRANK_POLL_INTERVAL_MS"),
    lockTtlMs: integer(env.CRANK_LOCK_TTL_MS, 120_000, "CRANK_LOCK_TTL_MS"),
    metricsPort,
    baseRetryMs,
    maxRetryMs,
    baseBackoffMs,
    maxBackoffMs,
    failureThreshold,
    baseFeeStroops: env.CRANK_BASE_FEE_STROOPS ?? "10000",
    pollAttempts: integer(env.CRANK_POLL_ATTEMPTS, 12, "CRANK_POLL_ATTEMPTS"),
    pollInitialDelayMs: integer(env.CRANK_POLL_INITIAL_DELAY_MS, 500, "CRANK_POLL_INITIAL_DELAY_MS"),
    pollMaxDelayMs: integer(env.CRANK_POLL_MAX_DELAY_MS, 5_000, "CRANK_POLL_MAX_DELAY_MS"),
    maxRestoreAttempts: integer(env.CRANK_MAX_RESTORE_ATTEMPTS, 2, "CRANK_MAX_RESTORE_ATTEMPTS"),
    otel: loadOtelConfig(env),
  };
}

export function retryDelayMs(
  attempts: number,
  config: Pick<CrankConfig, "baseRetryMs" | "maxRetryMs">,
  deterministic: boolean,
): number {
  const exponent = Math.max(0, attempts - 1);
  const multiplier = deterministic ? Math.pow(2, exponent) : 1;
  return Math.min(config.baseRetryMs * multiplier, config.maxRetryMs);
}
