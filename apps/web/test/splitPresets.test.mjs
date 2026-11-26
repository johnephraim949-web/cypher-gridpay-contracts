import assert from "node:assert/strict";
import test from "node:test";

import {
  parseSplitPreset,
  serializeSplitPreset,
  SPLIT_PRESET_SCHEMA,
} from "../dist/utils/splitPresets.js";
import { G_A, G_B, CONTRACT_A, edge } from "./helpers.mjs";

function validPreset(overrides = {}) {
  return {
    schema: SPLIT_PRESET_SCHEMA,
    name: "Revenue share",
    createdAt: "2026-01-01T00:00:00.000Z",
    merchantAddress: G_A,
    protocolFeeBps: 50,
    recipients: [
      { address: G_A, share_bps: 5000, isDustSink: false },
      { address: CONTRACT_A, share_bps: 5000, isDustSink: true },
    ],
    forwardingRules: [edge(G_A, G_B)],
    ...overrides,
  };
}

test("serializes and parses a valid preset round-trip", () => {
  const preset = validPreset();
  const parsed = parseSplitPreset(serializeSplitPreset(preset));
  assert.equal(parsed.name, "Revenue share");
  assert.equal(parsed.recipients.length, 2);
  assert.equal(parsed.forwardingRules[0].forward_to, G_B);
  assert.equal(parsed.forwardingRules[0].merchant, G_A);
});

test("rejects malformed JSON and unknown schema", () => {
  assert.throws(() => parseSplitPreset("not json"), /not valid JSON/);
  assert.throws(
    () => parseSplitPreset(JSON.stringify(validPreset({ schema: "v0" }))),
    /Unsupported preset schema/
  );
});

test("rejects split totals that are not exactly 10000 bps", () => {
  const preset = validPreset({
    recipients: [
      { address: G_A, share_bps: 3333 },
      { address: CONTRACT_A, share_bps: 3333 },
    ],
  });
  assert.throws(
    () => parseSplitPreset(serializeSplitPreset(preset)),
    /expected exactly 10000/
  );
});

test("rejects invalid addresses, duplicates and over-cap recipient counts", () => {
  assert.throws(
    () =>
      parseSplitPreset(
        serializeSplitPreset(
          validPreset({
            recipients: [
              { address: "G_NOT_VALID", share_bps: 10000 },
            ],
          })
        )
      ),
    /Invalid Stellar recipient address/
  );

  assert.throws(
    () =>
      parseSplitPreset(
        serializeSplitPreset(
          validPreset({
            recipients: [
              { address: G_A, share_bps: 5000 },
              { address: ` ${G_A} `, share_bps: 5000 },
            ],
          })
        )
      ),
    /duplicate recipient addresses/
  );

  assert.throws(
    () =>
      parseSplitPreset(
        serializeSplitPreset(
          validPreset({
            recipients: Array.from({ length: 11 }, () => ({
              address: G_A,
              share_bps: 909,
            })),
          })
        )
      ),
    /recipient cap/
  );
});

test("rejects invalid forwarding bps", () => {
  const preset = validPreset({
    forwardingRules: [{ forward_to: G_B, forward_bps: 10_001, active: true }],
  });
  assert.throws(() => parseSplitPreset(serializeSplitPreset(preset)), /\[0, 10000\]/);
});
