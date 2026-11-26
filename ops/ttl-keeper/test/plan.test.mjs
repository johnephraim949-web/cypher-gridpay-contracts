import test from "node:test";
import assert from "node:assert/strict";
import { SpendGuard, chunk, selectExpiring, xlmToStroops } from "../dist/plan.js";

test("spend guard halts before breaching cap", () => {
  const g = new SpendGuard(xlmToStroops("1"));
  assert.equal(g.tryReserve(6_000_000n), true);
  assert.equal(g.tryReserve(5_000_000n), false);
  assert.equal(g.totalSpent, 6_000_000n);
  assert.equal(g.tryReserve(4_000_000n), true);
});

test("selectExpiring and chunk", () => {
  const e = [{ keyXdr: "a", label: "a", liveUntilLedgerSeq: 150 }, { keyXdr: "b", label: "b", liveUntilLedgerSeq: 5000 }];
  assert.deepEqual(selectExpiring(e, 100, 1000).map((x) => x.label), ["a"]);
  assert.deepEqual(chunk([1, 2, 3], 2), [[1, 2], [3]]);
});
