import test from "node:test";
import assert from "node:assert/strict";
import {
  bigIntReplacer,
  safeStringify,
  generateTsSnippet,
  generatePySnippet,
  generateCliSnippet,
} from "../dist/index.js";

test("bigIntReplacer converts BigInt to string while preserving other types", () => {
  assert.equal(bigIntReplacer("amount", 1000000000000000000n), "1000000000000000000");
  assert.equal(bigIntReplacer("zero", 0n), "0");
  assert.equal(bigIntReplacer("num", 42), 42);
  assert.equal(bigIntReplacer("str", "testnet"), "testnet");
  assert.equal(bigIntReplacer("bool", true), true);
  assert.equal(bigIntReplacer("nullVal", null), null);
});

test("safeStringify safely formats complex payloads with BigInt without throwing TypeError", () => {
  const payload = {
    contract: "Payment",
    payer: "GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H",
    amount: 5000000000n,
    fee: 10000n,
    tags: ["rebate", "energy-subsidy"],
    active: true,
  };

  assert.doesNotThrow(() => {
    const json = safeStringify(payload);
    assert.ok(json.includes('"amount": "5000000000"'));
    assert.ok(json.includes('"fee": "10000"'));
    assert.ok(json.includes('"Payment"'));
  });
});

test("generateTsSnippet generates valid TypeScript SDK invocation code", () => {
  const snippet = generateTsSnippet({
    contract: "Payment",
    method: "initiate_payment",
    args: {
      payer: "G...",
      payee: "G...",
      amount: 1000000n,
    },
    network: "testnet",
  });

  assert.ok(snippet.includes('import { PaymentClient } from "@cypher-gridpay/contracts-sdk";'));
  assert.ok(snippet.includes('const client = new PaymentClient({ network: "testnet" });'));
  assert.ok(snippet.includes('await client.initiate_payment('));
  assert.ok(snippet.includes('"amount": "1000000"'));
});

test("generatePySnippet generates valid Python SDK code with Pythonic booleans and None", () => {
  const snippet = generatePySnippet({
    contract: "Escrow",
    method: "create_escrow",
    args: {
      engagement_id: "ENG-101",
      auto_release: true,
      expiry: null,
      deposit: 5000000n,
    },
    network: "testnet",
  });

  assert.ok(snippet.includes("from cypher_gridpay_sdk import EscrowClient"));
  assert.ok(snippet.includes('client = EscrowClient(network="testnet")'));
  assert.ok(snippet.includes("client.create_escrow(**{"));
  assert.ok(snippet.includes('"auto_release": True'));
  assert.ok(snippet.includes('"expiry": None'));
  assert.ok(snippet.includes('"deposit": "5000000"'));
});

test("generateCliSnippet produces formatted stellar contract invoke command", () => {
  const snippet = generateCliSnippet({
    contract: "Admin",
    method: "set_system_pause",
    args: {
      paused: false,
      reason: "maintenance",
    },
    network: "testnet",
  });

  assert.equal(
    snippet,
    "stellar contract invoke --id <CONTRACT_ID> --source <KEY> --network testnet -- set_system_pause --paused false --reason maintenance"
  );
});

test("generateCliSnippet handles empty args gracefully", () => {
  const snippet = generateCliSnippet({
    contract: "Payment",
    method: "get_version",
    args: {},
    network: "standalone",
  });

  assert.equal(
    snippet,
    "stellar contract invoke --id <CONTRACT_ID> --source <KEY> --network standalone -- get_version"
  );
});
