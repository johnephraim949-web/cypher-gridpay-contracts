# Merchant Integration Guide

A progressive ~30-minute walkthrough for onboarding a merchant account, accepting
payments, handling escrowed orders, verifying completion server-side, and
reconciling scheduled payouts with Cypher GridPay.

- **TypeScript SDK:** `@cypher-gridpay/contracts-sdk` (`sdk/typescript`)
- **Python SDK:** `cypher_gridpay_sdk` (`sdk/python`)

> All snippets target the current generated bindings. Amounts are always `i128`
> base units (stroops for 7-decimal SEP-41 tokens) — never floats.

---

## Step 1 — Merchant account setup & verification tiers

Register the merchant, whitelist the SEP-41 tokens you accept, and read the
verification tier limits that cap per-transaction and daily volume.

### TypeScript

```ts
import { PaymentsClient } from "@cypher-gridpay/contracts-sdk";
import { Keypair, Networks, Server } from "@stellar/stellar-sdk";

const server = new Server(Networks.TESTNET);
const merchant = Keypair.fromSecret(process.env.MERCHANT_SECRET!);

const client = new PaymentsClient({
  contractId: process.env.PAYMENT_CONTRACT_ID!,
  publicKey: merchant.publicKey(),
  server,
  networkPassphrase: Networks.TESTNET,
  source: merchant,
});

// Whitelist the SEP-41 token(s) this merchant accepts.
await client.addAllowedToken({ token: process.env.USDC_SAC_ID! });

// Read the merchant's verification level and the limits it unlocks.
const level = await client.getMerchantVerificationLevel({ merchant: merchant.publicKey() });
const limits = await client.getTierLimits({ level });
console.log({ level, perTx: limits.perTransaction, daily: limits.dailyVolume });
```

### Python

```python
import os
from stellar_sdk import Keypair, Network, SorobanServer
from cypher_gridpay_sdk import PaymentsClient

server = SorobanServer("https://soroban-testnet.stellar.org")
merchant = Keypair.from_secret(os.environ["MERCHANT_SECRET"])

client = PaymentsClient(
    contract_id=os.environ["PAYMENT_CONTRACT_ID"],
    public_key=merchant.public_key,
    server=server,
    network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
    source=merchant,
)

client.add_allowed_token(token=os.environ["USDC_SAC_ID"])
level = client.get_merchant_verification_level(merchant=merchant.public_key)
limits = client.get_tier_limits(level=level)
print(level, limits)
```

---

## Step 2 — Standard & escrowed payments with correlation IDs

Always attach a structured `PaymentMemo` so you can correlate on-chain payments
with your internal order IDs. Use `create_payment` for immediate capture and
`create_escrowed_payment` when funds must be held until delivery.

### TypeScript

```ts
import { nativeToScVal } from "@stellar/stellar-sdk";

const memo = {
  orderId: "ORD-2024-0001",
  customerRef: "cust_9f2a",
};

// Standard payment: captured immediately.
const standard = await client.createPayment({
  merchant: merchant.publicKey(),
  payer: customerPublicKey,
  token: process.env.USDC_SAC_ID!,
  amount: 25_0000000n, // 25.0000000 USDC in base units (i128)
  memo,
});

// Escrowed payment: held until you release or refund it.
const escrowed = await client.createEscrowedPayment({
  merchant: merchant.publicKey(),
  payer: customerPublicKey,
  token: process.env.USDC_SAC_ID!,
  amount: 25_0000000n,
  memo,
  releaseAfter: Math.floor(Date.now() / 1000) + 7 * 24 * 3600,
});
```

### Python

```python
memo = {"orderId": "ORD-2024-0001", "customerRef": "cust_9f2a"}

standard = client.create_payment(
    merchant=merchant.public_key,
    payer=customer_public_key,
    token=os.environ["USDC_SAC_ID"],
    amount=25_0000000,  # i128 base units
    memo=memo,
)

escrowed = client.create_escrowed_payment(
    merchant=merchant.public_key,
    payer=customer_public_key,
    token=os.environ["USDC_SAC_ID"],
    amount=25_0000000,
    memo=memo,
    release_after=int(__import__("time").time()) + 7 * 24 * 3600,
)
```

---

## Step 3 — Confirming completion: events or webhooks

Never trust a submitted transaction — wait for a **finalized** ledger. You can
poll on-chain events with the SDK or verify HMAC-SHA256 webhooks dispatched by
the backend.

### On-chain events (TypeScript)

```ts
import { pollContractEvents } from "@cypher-gridpay/contracts-sdk";

await pollContractEvents({
  server,
  contractId: process.env.PAYMENT_CONTRACT_ID!,
  startLedger: lastSeenLedger,
  onEvent: async (event) => {
    if (event.type === "payment_completed") {
      await markOrderPaid(event.memo.orderId, event.paymentId);
    }
  },
});
```

### HMAC-SHA256 webhooks (server-side verification)

```ts
import { createHmac, timingSafeEqual } from "node:crypto";

function verifyWebhook(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "hex");
  const b = Buffer.from(signature, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}
```

```python
import hashlib, hmac

def verify_webhook(raw_body: bytes, signature: str, secret: str) -> bool:
    expected = hmac.new(secret.encode(), raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)
```

---

## Step 4 — Payout schedules, splits & refund policy

Configure how settled funds are paid out, how a payment is split across
recipients, and the refund policy applied to escrowed orders.

### TypeScript

```ts
// Scheduled payouts (e.g. daily at 02:00 UTC).
await client.setPayoutSchedule({
  merchant: merchant.publicKey(),
  intervalSeconds: 86_400,
  startAt: Math.floor(Date.now() / 1000),
});

// Split a payment across recipients (basis points must sum to 10_000).
const split: PaymentSplitConfig = {
  recipients: [
    { address: merchant.publicKey(), bps: 9_000 },
    { address: platformPublicKey, bps: 1_000 },
  ],
};
await client.setPaymentSplit({ merchant: merchant.publicKey(), config: split });

// Refund policy for escrowed orders.
await client.setRefundPolicy({
  merchant: merchant.publicKey(),
  windowSeconds: 30 * 86_400,
  reasonCodes: ["customer_request", "not_delivered"],
});
```

### Python

```python
client.set_payout_schedule(
    merchant=merchant.public_key,
    interval_seconds=86_400,
    start_at=int(__import__("time").time()),
)

client.set_payment_split(
    merchant=merchant.public_key,
    config={
        "recipients": [
            {"address": merchant.public_key, "bps": 9_000},
            {"address": platform_public_key, "bps": 1_000},
        ]
    },
)

client.set_refund_policy(
    merchant=merchant.public_key,
    window_seconds=30 * 86_400,
    reason_codes=["customer_request", "not_delivered"],
)
```

---

## Step 5 — Testing on Testnet & local Quickstart

Run against Stellar Testnet first, then a local Quickstart node for full
control over ledger timing and edge cases.

```bash
# Local Stellar Quickstart (see docker-compose.yml)
docker compose up -d stellar-quickstart

# Point the SDK at the local network
#   RPC:        http://localhost:8000/soroban/rpc
#   Passphrase: Standalone Network ; February 2017
```

Exercise these edge cases before going live:

- **Expired payments** — check `is_payment_expired` before completing; do not
  attempt to complete a payment whose window has elapsed.
- **Escrow release/refund** — verify both the release and refund paths, and
  always supply a `RefundReasonCode`.
- **Split rounding** — confirm basis points sum to `10_000`.
- **Replay/duplicate webhooks** — dedupe on `paymentId` + `memo.orderId`.

---

## Common integration pitfalls

- **Relying on unfinalized transactions.** A submitted tx is not a settled one.
  Only act on `SUCCESS` in a finalized ledger (or a verified webhook).
- **Parsing `i128` amounts as IEEE-754 floats.** `i128` exceeds JS `Number`
  precision. Use `bigint` (TS) / `int` (Python) and format for display only.
- **Ignoring `is_payment_expired`.** Completing an expired payment reverts;
  check expiry first and surface a clear error to the customer.
- **Omitting `RefundReasonCode`.** Refunds without a reason code are rejected
  or fail reconciliation — always pass one from your configured policy.

---

## Go-Live Mainnet Readiness Checklist

- [ ] Merchant account registered and verification tier confirmed via
      `get_merchant_verification_level` / `get_tier_limits`.
- [ ] All accepted SEP-41 tokens whitelisted (`add_allowed_token`).
- [ ] `PaymentMemo` correlation IDs populated on every payment.
- [ ] Completion driven by finalized events or verified HMAC-SHA256 webhooks
      (never by submission alone).
- [ ] Webhook signatures verified with constant-time comparison; duplicates
      deduped.
- [ ] `i128` amounts handled as `bigint`/`int` end-to-end.
- [ ] `is_payment_expired` checked before completion.
- [ ] Payout schedule, split config (bps sum `10_000`), and refund policy set.
- [ ] `RefundReasonCode` supplied on every refund.
- [ ] Full flow rehearsed on Testnet and local Quickstart.
- [ ] Error handling wired to the typed `ErrorCode` / `decodeGridPayError`
      decoders.
