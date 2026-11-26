import assert from "node:assert/strict";
import test from "node:test";

import { StrKey } from "@stellar/stellar-sdk";
import {
  findDuplicateAddresses,
  isValidStellarAddress,
} from "../dist/utils/stellarAddress.js";
import {
  CONTRACT_A,
  G_A,
  G_B,
  corruptChecksum,
} from "./helpers.mjs";

test("accepts valid ed25519 (G...) public keys", () => {
  assert.equal(isValidStellarAddress(G_A), true);
});

test("accepts valid contract (C...) StrKeys", () => {
  assert.equal(CONTRACT_A.startsWith("C"), true);
  assert.equal(isValidStellarAddress(CONTRACT_A), true);
});

test("trims surrounding whitespace before validating", () => {
  assert.equal(isValidStellarAddress(`  ${G_A}\n`), true);
});

test("rejects empty and whitespace-only values", () => {
  assert.equal(isValidStellarAddress(""), false);
  assert.equal(isValidStellarAddress("   "), false);
  assert.equal(isValidStellarAddress(null), false);
  assert.equal(isValidStellarAddress(undefined), false);
  assert.equal(isValidStellarAddress(12345), false);
});

test("rejects secret seeds, muxed accounts and signed payloads", () => {
  const seed = StrKey.encodeEd25519SecretSeed(Buffer.alloc(32, 9));
  assert.equal(seed.startsWith("S"), true);
  assert.equal(isValidStellarAddress(seed), false);

  const muxedPayload = Buffer.concat([
    Buffer.alloc(32, 1),
    Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]),
  ]);
  const muxed = StrKey.encodeMed25519PublicKey(muxedPayload);
  assert.equal(muxed.startsWith("M"), true);
  assert.equal(isValidStellarAddress(muxed), false);
});

test("rejects bad checksums", () => {
  const bad = corruptChecksum(G_A);
  assert.notEqual(bad, G_A);
  assert.equal(StrKey.isValidEd25519PublicKey(bad), false);
  assert.equal(isValidStellarAddress(bad), false);
});

test("rejects wrong length and invalid base32 characters", () => {
  assert.equal(isValidStellarAddress(G_A.slice(0, 55)), false);
  assert.equal(isValidStellarAddress(`${G_A}0`), false);
  assert.equal(isValidStellarAddress(G_A.toLowerCase()), false);
  assert.equal(isValidStellarAddress(`${G_A.slice(0, 10)}0189${G_A.slice(15)}`), false);
});

test("finds duplicate addresses after trimming", () => {
  const duplicates = findDuplicateAddresses([G_A, ` ${G_A} `, G_B, "", CONTRACT_A]);
  assert.deepEqual([...duplicates], [G_A]);
});

test("does not flag distinct valid addresses", () => {
  assert.equal(findDuplicateAddresses([G_A, G_B, CONTRACT_A]).size, 0);
});
