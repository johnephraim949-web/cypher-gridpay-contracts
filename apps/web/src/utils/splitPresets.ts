import {
  findDuplicateAddresses,
  isValidStellarAddress,
} from "./stellarAddress.js";

export const SPLIT_PRESET_SCHEMA = "cypher-gridpay/split-preset/v1";
export const DEFAULT_PRESET_MAX_RECIPIENTS = 10;

export interface PresetRecipient {
  address: string;
  share_bps: number;
  isDustSink?: boolean;
}

export interface PresetForwardRule {
  merchant?: string;
  forward_to: string;
  forward_bps: number;
  active: boolean;
}

export interface SplitPreset {
  schema: typeof SPLIT_PRESET_SCHEMA;
  name: string;
  createdAt: string;
  merchantAddress?: string;
  protocolFeeBps?: number;
  recipients: PresetRecipient[];
  forwardingRules: PresetForwardRule[];
}

export function serializeSplitPreset(preset: SplitPreset): string {
  return `${JSON.stringify(preset, null, 2)}\n`;
}

/**
 * Parses and validates a preset from JSON. Throws a descriptive Error when
 * the preset would be rejected by the contract (bad addresses, duplicates,
 * out-of-range bps or a split total that is not exactly 10 000).
 */
export function parseSplitPreset(
  json: string,
  maxRecipients = DEFAULT_PRESET_MAX_RECIPIENTS
): SplitPreset {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("Preset is not valid JSON");
  }

  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new Error("Preset must be a JSON object");
  }
  const preset = raw as Partial<SplitPreset>;
  if (preset.schema !== SPLIT_PRESET_SCHEMA) {
    throw new Error(`Unsupported preset schema (expected ${SPLIT_PRESET_SCHEMA})`);
  }
  if (typeof preset.name !== "string" || preset.name.trim().length === 0) {
    throw new Error("Preset name is required");
  }
  if (!Array.isArray(preset.recipients) || preset.recipients.length === 0) {
    throw new Error("Preset must contain at least one recipient");
  }
  if (preset.recipients.length > maxRecipients) {
    throw new Error(`Preset exceeds the ${maxRecipients}-recipient cap`);
  }

  const total = preset.recipients.reduce((sum, recipient) => {
    if (
      typeof recipient?.share_bps !== "number" ||
      !Number.isInteger(recipient.share_bps) ||
      recipient.share_bps < 0 ||
      recipient.share_bps > 10_000
    ) {
      throw new Error("Every recipient share_bps must be an integer in [0, 10000]");
    }
    return sum + recipient.share_bps;
  }, 0);
  if (total !== 10_000) {
    throw new Error(`Preset split total is ${total} bps; expected exactly 10000`);
  }

  const addresses = preset.recipients.map((r) => String(r?.address ?? ""));
  for (const address of addresses) {
    if (!isValidStellarAddress(address)) {
      throw new Error(`Invalid Stellar recipient address: ${address}`);
    }
  }
  if (findDuplicateAddresses(addresses).size > 0) {
    throw new Error("Preset contains duplicate recipient addresses");
  }

  const forwardingRules = preset.forwardingRules ?? [];
  if (!Array.isArray(forwardingRules)) {
    throw new Error("Preset forwardingRules must be an array");
  }
  for (const rule of forwardingRules) {
    if (!isValidStellarAddress(rule.forward_to)) {
      throw new Error(`Invalid Stellar forwarding address: ${rule.forward_to}`);
    }
    if (
      typeof rule.forward_bps !== "number" ||
      !Number.isInteger(rule.forward_bps) ||
      rule.forward_bps < 0 ||
      rule.forward_bps > 10_000
    ) {
      throw new Error("Every forward_bps must be an integer in [0, 10000]");
    }
  }

  return {
    schema: SPLIT_PRESET_SCHEMA,
    name: preset.name.trim(),
    createdAt: preset.createdAt ?? new Date().toISOString(),
    merchantAddress: preset.merchantAddress,
    protocolFeeBps: preset.protocolFeeBps,
    recipients: preset.recipients.map((r) => ({
      address: r.address.trim(),
      share_bps: r.share_bps,
      isDustSink: Boolean(r.isDustSink),
    })),
    forwardingRules: forwardingRules.map((r) => ({
      merchant: r.merchant?.trim() || preset.merchantAddress,
      forward_to: r.forward_to.trim(),
      forward_bps: r.forward_bps,
      active: r.active !== false,
    })),
  };
}

/** Triggers a JSON file download in the browser. No-op during SSR. */
export function downloadSplitPreset(preset: SplitPreset): void {
  if (typeof document === "undefined") return;
  const blob = new Blob([serializeSplitPreset(preset)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${preset.name.replace(/[^a-z0-9-_]+/gi, "_") || "split-preset"}.json`;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
