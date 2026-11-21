# TypeScript SDK Cookbook (`@cypher-gridpay/contracts-sdk`)

Complete integration guide for the GridPay TypeScript SDK. Covers browser (Next.js/Vite) and Node.js backends, transaction lifecycle helpers, typed error decoding, real-time event parsing, and `BigInt` handling.

> See also: [`sdk/typescript/README.md`](../sdk/typescript/README.md) for the quick-start snippet.

## 1. Installation & Environment

```bash
npm install @cypher-gridpay/contracts-sdk @stellar/stellar-sdk
```

`@stellar/stellar-sdk` is a **peer dependency** — install it explicitly so your app and the SDK share a single instance (avoids `instanceof` mismatches).

### ESM / CJS

The SDK ships dual builds:

- **ESM** (`import`) — recommended for Vite, Next.js, and modern Node (`"type": "module"`).
- **CJS** (`require`) — supported for legacy Node backends.

```ts
// ESM
import { PaymentsClient, decodeGridPayError } from "@cypher-gridpay/contracts-sdk";

// CJS
const { PaymentsClient } = require("@cypher-gridpay/contracts-sdk");
```

### Vite / Webpack polyfills

The Stellar SDK relies on Node built-ins (`Buffer`, `process`). In browser bundles add polyfills:

**Vite** (`vite.config.ts`):

```ts
import { defineConfig } from "vite";
import { nodePolyfills } from "vite-plugin-node-polyfills";

export default defineConfig({
  plugins: [nodePolyfills({ globals: { Buffer: true, process: true } })],
});
```

**Webpack** (`next.config.js` / `webpack.config.js`):

```js
config.resolve.fallback = { ...config.resolve.fallback, buffer: require.resolve("buffer/") };
```

## 2. Client Initialization

All clients accept a `server` (Soroban RPC URL), `networkPassphrase`, and `contractId`. Read-only clients need no signer; signing clients require a `signTransaction` callback.

### Read-only (queries, simulation)

```ts
import { PaymentsClient, EscrowClient, RefundClient, AdminClient } from "@cypher-gridpay/contracts-sdk";

const config = {
  server: "https://soroban-testnet.stellar.org",
  networkPassphrase: "Test SDF Network ; September 2015",
  contractId: "C...",
};

const payments = new PaymentsClient(config);
const escrow = new EscrowClient(config);
const refunds = new RefundClient(config);
const admin = new AdminClient(config);
```

### Signing (browser — wallet callback)

**Never bundle secret keys.** In the browser, delegate signing to the user's wallet:

```ts
const payments = new PaymentsClient({
  ...config,
  signTransaction: async (xdr) => {
    // e.g. Freighter / Stellar Wallets Kit
    const { signedTxXdr } = await walletKit.signTransaction(xdr, { networkPassphrase: config.networkPassphrase });
    return signedTxXdr;
  },
});
```

### Signing (Node backend — Keypair)

```ts
import { Keypair } from "@stellar/stellar-sdk";

const signer = Keypair.fromSecret(process.env.STELLAR_SECRET!);
const payments = new PaymentsClient({
  ...config,
  signTransaction: async (xdr) => {
    const tx = TransactionBuilder.fromXDR(xdr, config.networkPassphrase);
    tx.sign(signer);
    return tx.toXDR();
  },
});
```

## 3. Transaction Lifecycle Helpers (`transactions.ts`)

The SDK wraps the full Soroban lifecycle: **simulate → pad resource fees → handle `restorePreamble` → submit → poll for finality**.

```ts
import { buildAndSubmit } from "@cypher-gridpay/contracts-sdk";

const result = await buildAndSubmit({
  client: payments,
  method: "create_payment",
  args: [/* ScVal args */],
  signTransaction: payments.signTransaction,
});
```

What the helper does for you:

1. **Simulation** — runs `simulateTransaction` to compute footprint and resource fees.
2. **Resource fee padding** — applies a safety multiplier so fee spikes don't fail submission.
3. **`restorePreamble` handling** — if simulation returns a `restorePreamble`, the helper automatically submits the restore operation (TTL restoration) before the main transaction.
4. **Polling for finality** — polls `getTransaction` until `SUCCESS`/`FAILED`, returning the decoded result or throwing a typed error.

### Manual control

If you need finer control, use the lower-level helpers directly:

```ts
import { simulate, submitAndPoll } from "@cypher-gridpay/contracts-sdk";

const sim = await simulate(payments, "create_payment", args);
if (sim.restorePreamble) {
  await submitAndPoll(payments, sim.restorePreamble.transactionData);
}
const final = await submitAndPoll(payments, sim.transactionData);
```

## 4. Typed Error Decoding (`errors.ts`)

Contract errors are decoded into typed objects with a `retryable` flag.

```ts
import { decodeGridPayError, PAYMENT_ERRORS } from "@cypher-gridpay/contracts-sdk";

try {
  await payments.createPayment(args);
} catch (err) {
  const decoded = decodeGridPayError(err);
  if (decoded?.retryable) {
    // transient (e.g. TTL expired, fee spike) — safe to retry
  } else if (decoded?.code === PAYMENT_ERRORS.InsufficientBalance) {
    // surface to user
  }
}
```

`PAYMENT_ERRORS` maps contract error codes to readable names. Always branch on `retryable` before retrying — non-retryable errors (e.g. `Unauthorized`) will fail identically on retry.

## 5. Real-time Event Parsing (`events.ts`)

```ts
import { parseContractEvent } from "@cypher-gridpay/contracts-sdk";

const events = await payments.getEvents({
  startLedger: latestLedger,
  filters: [{ type: "contract", contractIds: [config.contractId], topics: [["payment_created"]] }],
});

for (const raw of events) {
  const parsed = parseContractEvent(raw);
  if (parsed?.type === "payment_created") {
    console.log(parsed.data);
  }
}
```

Filter by **contract ID** and **topic** to avoid decoding unrelated events. `parseContractEvent` returns `null` for events it doesn't recognize.

## 6. `BigInt` Serialization

Soroban amounts are `i128` → `BigInt` in JS. `BigInt` is **not** JSON-serializable and breaks React state diffing / TanStack Query caching.

### React state

```ts
const [amount, setAmount] = useState<bigint>(0n); // keep as BigInt in state
```

### TanStack Query

```ts
useQuery({
  queryKey: ["payment", id],
  queryFn: () => payments.getPayment(id),
  // BigInt is fine in-memory; only stringify at the API boundary
});
```

### JSON APIs

```ts
// serialize
const payload = JSON.stringify({ amount: amount.toString() });
// deserialize
const amount = BigInt(payload.amount);
```

Never pass `BigInt` directly to `JSON.stringify` — it throws `TypeError`. Convert at the boundary.

## 7. Regenerating Bindings

When testing against a custom local contract fork, regenerate the TypeScript bindings:

```bash
./scripts/generate-ts-bindings.sh
```

This re-derives the typed client surface from the contract WASM. Commit the regenerated files under `sdk/typescript/src/`.

## 8. Runnable Examples

See [`examples/typescript/`](../examples/typescript/):

- `create-payment.ts` — end-to-end payment creation with signing.
- `escrow-milestone.ts` — escrow milestone release flow.
- `event-listener.ts` — streaming and parsing contract events.

Run with `tsx` or compile with `tsc --noEmit` to type-check.
