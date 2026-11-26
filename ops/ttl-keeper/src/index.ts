// TTL keeper: finds expiring Soroban ledger entries and extends them (or estimates rent in --dry-run).
import {
  Address,
  Keypair,
  Operation,
  SorobanDataBuilder,
  TransactionBuilder,
  rpc,
  xdr,
} from "@stellar/stellar-sdk";
import { EntryTtl, SpendGuard, backoffMs, chunk, selectExpiring, xlmToStroops } from "./plan.js";

const env = (k: string, d?: string): string => {
  const v = process.env[k] ?? d;
  if (v === undefined) throw new Error(`missing env ${k}`);
  return v;
};

const DRY_RUN = process.argv.includes("--dry-run") || process.env.DRY_RUN === "true";
const RPC_URL = env("SOROBAN_RPC_URL");
const PASSPHRASE = env("NETWORK_PASSPHRASE");
const CONTRACT_IDS = env("CONTRACT_IDS").split(",").map((s) => s.trim()).filter(Boolean);
const MIN_TTL = Number(env("MIN_TTL_THRESHOLD", "518400"));
const TARGET_TTL = Number(env("TARGET_TTL_LEDGERS", "3110400"));
const CHUNK_SIZE = Number(env("CHUNK_SIZE", "20")); // stay well below per-tx footprint limits
const MAX_STROOPS = xlmToStroops(env("MAX_XLM_PER_RUN", "10"));
const EXTRA_KEYS_URL = process.env.EXTRA_KEYS_URL; // optional indexer endpoint: {"keys":["<base64 LedgerKey>"]}
const PUSHGATEWAY_URL = process.env.PUSHGATEWAY_URL; // optional Prometheus pushgateway
const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;

const server = new rpc.Server(RPC_URL, { allowHttp: RPC_URL.startsWith("http://") });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry<T>(fn: () => Promise<T>, attempts = 5): Promise<T> {
  for (let i = 0; ; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i >= attempts - 1) throw e;
      await sleep(backoffMs(i));
    }
  }
}

function instanceKey(contractId: string): xdr.LedgerKey {
  return xdr.LedgerKey.contractData(
    new xdr.LedgerKeyContractData({
      contract: new Address(contractId).toScAddress(),
      key: xdr.ScVal.scvLedgerKeyContractInstance(),
      durability: xdr.ContractDataDurability.persistent(),
    }),
  );
}

async function collectEntries(): Promise<EntryTtl[]> {
  const out: EntryTtl[] = [];
  const keys: { key: xdr.LedgerKey; label: string }[] = CONTRACT_IDS.map((id) => ({ key: instanceKey(id), label: `instance:${id}` }));
  const res = await retry(() => server.getLedgerEntries(...keys.map((k) => k.key)));
  for (const e of res.entries) {
    out.push({ keyXdr: e.key.toXDR("base64"), label: `instance:${e.key.contractData().contract().toString()}`, liveUntilLedgerSeq: e.liveUntilLedgerSeq ?? 0 });
    // Also track the executable code entry referenced by the instance.
    const exec = e.val.contractData().val().instance().executable();
    if (exec.switch().name === "contractExecutableWasm") {
      const codeKey = xdr.LedgerKey.contractCode(new xdr.LedgerKeyContractCode({ hash: exec.wasmHash() }));
      const code = await retry(() => server.getLedgerEntries(codeKey));
      for (const c of code.entries) out.push({ keyXdr: codeKey.toXDR("base64"), label: `code:${exec.wasmHash().toString("hex")}`, liveUntilLedgerSeq: c.liveUntilLedgerSeq ?? 0 });
    }
  }
  if (EXTRA_KEYS_URL) {
    const body = (await (await fetch(EXTRA_KEYS_URL)).json()) as { keys: string[] };
    const extra = body.keys.map((k) => xdr.LedgerKey.fromXDR(k, "base64"));
    for (let i = 0; i < extra.length; i += 100) {
      const r = await retry(() => server.getLedgerEntries(...extra.slice(i, i + 100)));
      for (const e of r.entries) out.push({ keyXdr: e.key.toXDR("base64"), label: "indexer-key", liveUntilLedgerSeq: e.liveUntilLedgerSeq ?? 0 });
    }
  }
  return out;
}

async function buildChunkTx(account: Awaited<ReturnType<typeof server.getAccount>>, keys: xdr.LedgerKey[], extendTo: number) {
  const data = new SorobanDataBuilder().setReadOnly(keys).build();
  const tx = new TransactionBuilder(account, { fee: "100", networkPassphrase: PASSPHRASE })
    .addOperation(Operation.extendFootprintTtl({ extendTo }))
    .setSorobanData(data)
    .setTimeout(60)
    .build();
  const sim = await retry(() => server.simulateTransaction(tx));
  if (rpc.Api.isSimulationError(sim)) throw new Error(`simulation failed: ${sim.error}`);
  return { prepared: rpc.assembleTransaction(tx, sim).build(), cost: BigInt(sim.minResourceFee) };
}

async function main() {
  const latest = await retry(() => server.getLatestLedger());
  const entries = await collectEntries();
  const expiring = selectExpiring(entries, latest.sequence, MIN_TTL);
  console.log(`ledger=${latest.sequence} tracked=${entries.length} expiring=${expiring.length} dryRun=${DRY_RUN}`);
  for (const e of expiring) console.log(`  expiring ${e.label} liveUntil=${e.liveUntilLedgerSeq} remaining=${e.liveUntilLedgerSeq - latest.sequence}`);

  const keypair = DRY_RUN ? Keypair.random() : Keypair.fromSecret(env("KEEPER_SECRET"));
  const account = DRY_RUN
    ? undefined
    : await retry(() => server.getAccount(keypair.publicKey()));
  const guard = new SpendGuard(MAX_STROOPS);
  let extended = 0;
  let estimated = 0n;
  const extendTo = TARGET_TTL;

  for (const group of chunk(expiring, CHUNK_SIZE)) {
    const keys = group.map((g) => xdr.LedgerKey.fromXDR(g.keyXdr, "base64"));
    if (DRY_RUN) {
      // Estimation needs a funded source for simulation; use KEEPER_PUBLIC_KEY when provided.
      const pub = env("KEEPER_PUBLIC_KEY");
      const acct = await retry(() => server.getAccount(pub));
      const { cost } = await buildChunkTx(acct, keys, extendTo);
      estimated += cost;
      console.log(`  dry-run chunk entries=${group.length} estimatedRent=${cost} stroops`);
      continue;
    }
    const { prepared, cost } = await buildChunkTx(account!, keys, extendTo);
    if (!guard.tryReserve(cost)) {
      console.error(`spend cap reached (cap=${MAX_STROOPS} stroops); halting before chunk costing ${cost}`);
      break;
    }
    prepared.sign(keypair);
    const sent = await retry(() => server.sendTransaction(prepared));
    if (sent.status === "ERROR") throw new Error(`send failed: ${JSON.stringify(sent.errorResult)}`);
    extended += group.length;
    account!.incrementSequenceNumber();
  }

  const spent = DRY_RUN ? estimated : guard.totalSpent;
  const metrics = [
    `ttl_entries_expiring ${expiring.length}`,
    `ttl_entries_extended_total ${extended}`,
    `ttl_xlm_spent_total ${Number(spent) / 1e7}`,
    `ttl_dry_run ${DRY_RUN ? 1 : 0}`,
  ].join("\n") + "\n";
  console.log(metrics);
  if (PUSHGATEWAY_URL) await fetch(`${PUSHGATEWAY_URL}/metrics/job/ttl-keeper`, { method: "POST", body: metrics });
  if (SLACK_WEBHOOK_URL) {
    await fetch(SLACK_WEBHOOK_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: `TTL keeper${DRY_RUN ? " (dry-run)" : ""}: expiring=${expiring.length} extended=${extended} xlm=${Number(spent) / 1e7}` }),
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
