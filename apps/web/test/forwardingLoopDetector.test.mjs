import assert from "node:assert/strict";
import test from "node:test";

import {
  analyzeForwardGraph,
  DEFAULT_MAX_FORWARD_DEPTH,
  detectForwardingLoop,
} from "../dist/utils/forwardingLoopDetector.js";
import { G_A, G_B, G_C, G_D, G_E, G_F, G_G, edge } from "./helpers.mjs";

test("empty graph is valid", () => {
  const result = analyzeForwardGraph({ edges: [] });
  assert.equal(result.isValid, true);
  assert.equal(result.hasCycle, false);
  assert.equal(result.hasTtlBreach, false);
  assert.deepEqual(result.hopChains, []);
});

test("a simple terminating chain is valid and reports hops", () => {
  const result = analyzeForwardGraph({
    edges: [edge(G_A, G_B), edge(G_B, G_C)],
  });
  assert.equal(result.isValid, true);
  assert.equal(result.hopChains.length, 2);
  assert.deepEqual(result.hopChains[0], [G_A, G_B, G_C]);
});

test("detects a self-loop as a cycle", () => {
  const result = analyzeForwardGraph({ edges: [edge(G_A, G_A)] });
  assert.equal(result.hasCycle, true);
  assert.equal(result.isValid, false);
  assert.deepEqual(result.cycles[0], [G_A, G_A]);
  assert.deepEqual(result.highlightedAddresses, [G_A]);
});

test("detects a two-address cycle", () => {
  const result = analyzeForwardGraph({
    edges: [edge(G_A, G_B), edge(G_B, G_A)],
  });
  assert.equal(result.hasCycle, true);
  assert.deepEqual(new Set(result.cycles[0]), new Set([G_A, G_B]));
});

test("detects a three-hop cycle and names every address in order", () => {
  const result = analyzeForwardGraph({
    edges: [edge(G_A, G_B), edge(G_B, G_C), edge(G_C, G_A)],
  });
  assert.equal(result.hasCycle, true);
  assert.equal(result.cycles.length, 1);
  const cycle = result.cycles[0];
  assert.equal(cycle.length, 4);
  assert.equal(cycle[0], cycle[3]);
  assert.deepEqual(new Set(cycle), new Set([G_A, G_B, G_C]));
  assert.match(result.issues[0].message, /Forwarding loop detected/);
});

test("deduplicates the same cycle discovered from different origins", () => {
  const result = analyzeForwardGraph({
    edges: [edge(G_A, G_B), edge(G_B, G_C), edge(G_C, G_A), edge(G_D, G_B)],
  });
  assert.equal(result.cycles.length, 1);
});

test("ignores inactive forwarding edges", () => {
  const result = analyzeForwardGraph({
    edges: [edge(G_A, G_B), edge(G_B, G_A, { active: false })],
  });
  assert.equal(result.hasCycle, false);
  assert.equal(result.isValid, true);
});

test("ignores edges with missing addresses", () => {
  const result = analyzeForwardGraph({
    edges: [edge(G_A, ""), edge("", G_B)],
  });
  assert.equal(result.isValid, true);
  assert.deepEqual(result.hopChains, []);
});

test("flags a hop-TTL breach when the chain exceeds maxDepth", () => {
  const result = analyzeForwardGraph({
    edges: [
      edge(G_A, G_B),
      edge(G_B, G_C),
      edge(G_C, G_D),
      edge(G_D, G_E),
    ],
    maxDepth: 2,
  });
  assert.equal(result.hasCycle, false);
  assert.equal(result.hasTtlBreach, true);
  assert.equal(result.isValid, false);
  assert.deepEqual(result.ttlBreaches[0], [G_A, G_B, G_C, G_D]);
  assert.match(result.issues[0].message, /2-hop limit/);
});

test("allows a chain that terminates exactly at the hop limit", () => {
  const result = analyzeForwardGraph({
    edges: [edge(G_A, G_B), edge(G_B, G_C)],
    maxDepth: 2,
  });
  assert.equal(result.hasTtlBreach, false);
  assert.equal(result.isValid, true);
});

test("uses the contract default depth of five hops", () => {
  assert.equal(DEFAULT_MAX_FORWARD_DEPTH, 5);
  const withinLimit = analyzeForwardGraph({
    edges: [
      edge(G_A, G_B),
      edge(G_B, G_C),
      edge(G_C, G_D),
      edge(G_D, G_E),
      edge(G_E, G_F),
    ],
  });
  assert.equal(withinLimit.hasTtlBreach, false);

  const overLimit = analyzeForwardGraph({
    edges: [
      edge(G_A, G_B),
      edge(G_B, G_C),
      edge(G_C, G_D),
      edge(G_D, G_E),
      edge(G_E, G_F),
      edge(G_F, G_G),
      edge(G_G, G_A, { forward_bps: 1 }),
    ],
  });
  assert.equal(overLimit.hasTtlBreach, true);
});

test("invalid maxDepth falls back to the default", () => {
  const result = analyzeForwardGraph({
    edges: [edge(G_A, G_B), edge(G_B, G_A)],
    maxDepth: 0,
  });
  assert.equal(result.hasCycle, true);
  assert.equal(result.hasTtlBreach, false);
});

test("detectForwardingLoop convenience wrapper reports highlighted addresses", () => {
  assert.equal(detectForwardingLoop([edge(G_A, G_B)]), null);
  assert.deepEqual(
    detectForwardingLoop([edge(G_A, G_B), edge(G_B, G_A)]),
    [G_A, G_B]
  );
});
