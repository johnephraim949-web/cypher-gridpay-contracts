import { Contract, StrKey } from "@stellar/stellar-sdk";
import { BadRequestError } from "./errors.js";
import type { RelayerConfig, SponsorRequest } from "./types.js";

export const DEFAULT_OTEL_SERVICE_NAME = "gridpay-relayer";
export const DEFAULT_OTEL_TRACES_SAMPLER = "parentbased_traceidratio";

const DEFAULT_ENTRYPOINTS = [
  "create_payment",
  "pay_installment",
  "authorize_trial_conversion_amount",
  "claim_rebate",
  "approve_release",
  "claim_fee_rebate",
  "claim_relayer_stipend",
];

export function normalizeContractId(value: string): string {
  const trimmed = value.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  try {
    return new Contract(trimmed).contractId().toLowerCase();
  } catch {
    throw new Error(`Invalid GridPay contract id: ${value}`);
  }
}

function csv(value: string | undefined): string[] {
  if (value === undefined) return [];
  return value
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readInt(
  env: NodeJS.ProcessEnv,
  key: string,
  fallback: number,
  minimum: number,
  maximum = Number.MAX_SAFE_INTEGER,
): number {
  const raw = env[key];
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${key} must be an integer between ${minimum} and ${maximum}`);
  }
  return value;
}

function readBool(env: NodeJS.ProcessEnv, key: string, fallback: boolean): boolean {
  const raw = env[key]?.trim().toLowerCase();
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  throw new Error(`${key} must be a boolean`);
}

function readOptionalUrl(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === "") return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    throw new Error(`${key} must be an http(s) URL`);
  }
  return raw;
}

function readUrl(env: NodeJS.ProcessEnv, key: string): string {
  const raw = env[key]?.trim();
  if (raw === undefined || raw === "") throw new Error(`${key} is required`);
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("bad protocol");
  } catch {
    throw new Error(`${key} must be an http(s) URL`);
  }
  return raw;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): RelayerConfig {
  const contractValues = csv(env.RELAYER_CONTRACT_IDS);
  if (contractValues.length === 0) {
    throw new Error("RELAYER_CONTRACT_IDS must contain at least one GridPay contract id");
  }
  const entrypointValues = csv(env.RELAYER_APPROVED_ENTRYPOINTS);
  const channelValues = csv(env.RELAYER_CHANNEL_ACCOUNTS);
  if (channelValues.length === 0) {
    throw new Error("RELAYER_CHANNEL_ACCOUNTS must contain at least one fee-source account");
  }
  const kmsSignUrl = readUrl(env, "RELAYER_KMS_SIGN_URL");
  const channels = channelValues.map((entry) => {
    const [accountId, rawSequence] = entry.split(":");
    if (!accountId || !StrKey.isValidEd25519PublicKey(accountId)) {
      throw new Error(`Invalid channel account: ${entry}`);
    }
    const sequence = readInt({ CHANNEL_SEQUENCE: rawSequence ?? "0" }, "CHANNEL_SEQUENCE", 0, 0);
    return { accountId, sequence: String(sequence) };
  });
  let kmsKeys: Record<string, string> = {};
  if (env.RELAYER_KMS_KEYS) {
    try {
      const parsed: unknown = JSON.parse(env.RELAYER_KMS_KEYS);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("must be an object");
      }
      kmsKeys = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
      );
    } catch (error) {
      throw new Error(`RELAYER_KMS_KEYS ${String(error)}`);
    }
  }
  for (const channel of channels) {
    if (!kmsKeys[channel.accountId]) {
      throw new Error(`RELAYER_KMS_KEYS is missing a key id for channel ${channel.accountId}`);
    }
  }
  let kmsHeaders: Record<string, string> = {};
  if (env.RELAYER_KMS_HEADERS) {
    try {
      const parsed: unknown = JSON.parse(env.RELAYER_KMS_HEADERS);
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("must be an object");
      }
      kmsHeaders = Object.fromEntries(
        Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]),
      );
    } catch (error) {
      throw new Error(`RELAYER_KMS_HEADERS ${String(error)}`);
    }
  }

  return {
    port: readInt(env, "PORT", 8080, 1, 65535),
    rpcUrl: readUrl(env, "STELLAR_RPC_URL"),
    networkPassphrase: env.STELLAR_NETWORK_PASSPHRASE?.trim() ?? "",
    allowedContracts: new Set(contractValues.map(normalizeContractId)),
    allowedEntrypoints: new Set(entrypointValues.length > 0 ? entrypointValues : DEFAULT_ENTRYPOINTS),
    maxSponsoredStroops: readInt(env, "MAX_SPONSORED_STROOPS", 200_000, 100),
    feeBumpBaseFeeStroops: readInt(env, "RELAYER_FEE_BUMP_BASE_FEE_STROOPS", 100, 100),
    safetyFloorStroops: readInt(env, "RELAYER_SAFETY_FLOOR_STROOPS", 10_000_000, 0),
    customerDailyLimit: readInt(env, "RELAYER_CUSTOMER_DAILY_LIMIT", 10, 0),
    merchantDailyLimit: readInt(env, "RELAYER_MERCHANT_DAILY_LIMIT", 1_000, 0),
    channels,
    redisUrl: env.REDIS_URL?.trim() || undefined,
    redisKeyPrefix: env.RELAYER_REDIS_PREFIX?.trim() || "relayer:quota",
    kmsSignUrl,
    kmsKeys,
    kmsTimeoutMs: readInt(env, "RELAYER_KMS_TIMEOUT_MS", 5_000, 100),
    kmsHeaders,
    confirmationTimeoutMs: readInt(env, "RELAYER_CONFIRMATION_TIMEOUT_MS", 30_000, 100),
    pollIntervalMs: readInt(env, "RELAYER_POLL_INTERVAL_MS", 500, 10),
    acquireTimeoutMs: readInt(env, "RELAYER_ACQUIRE_TIMEOUT_MS", 10_000, 100),
    accountingLogPath: env.RELAYER_ACCOUNTING_LOG?.trim() || "sponsorships.jsonl",
    alertWebhookUrl: env.RELAYER_ALERT_WEBHOOK_URL?.trim() || undefined,
    maxBodyBytes: readInt(env, "RELAYER_MAX_BODY_BYTES", 1_048_576, 1024),
    maxXdrChars: readInt(env, "RELAYER_MAX_XDR_CHARS", 262_144, 1024),
    otel: {
      enabled: readBool(env, "OTEL_ENABLED", false),
      endpoint: readOptionalUrl(env, "OTEL_EXPORTER_OTLP_ENDPOINT"),
      serviceName: env.OTEL_SERVICE_NAME?.trim() || DEFAULT_OTEL_SERVICE_NAME,
      tracesSampler: env.OTEL_TRACES_SAMPLER?.trim() || DEFAULT_OTEL_TRACES_SAMPLER,
    },
  };
}

export function parseSponsorRequest(payload: unknown, maxXdrChars: number): SponsorRequest {
  if (payload === null || typeof payload !== "object" || Array.isArray(payload)) {
    throw new BadRequestError("INVALID_REQUEST", "Request body must be a JSON object");
  }
  const body = payload as Record<string, unknown>;
  if (typeof body.transactionXdr !== "string" || body.transactionXdr.trim() === "") {
    throw new BadRequestError("INVALID_REQUEST", "transactionXdr must be a non-empty string");
  }
  if (body.transactionXdr.length > maxXdrChars) {
    throw new BadRequestError("INVALID_REQUEST", "transactionXdr exceeds the configured size limit");
  }
  const optional = (key: string): string | undefined => {
    const value = body[key];
    if (value === undefined) return undefined;
    if (typeof value !== "string" || value.trim() === "") {
      throw new BadRequestError("INVALID_REQUEST", `${key} must be a non-empty string when provided`);
    }
    return value.trim();
  };
  return {
    transactionXdr: body.transactionXdr.trim(),
    customerId: optional("customerId"),
    merchantId: optional("merchantId"),
  };
}
