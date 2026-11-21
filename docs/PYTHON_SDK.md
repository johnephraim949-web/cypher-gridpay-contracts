# Python SDK

The Python SDK wraps Soroban with `SorobanServerAsync` through Stellar SDK's async contract client. Responses are converted from ScVal/XDR into native Python values and validated with Pydantic v2 models for `Payment`, `Escrow`, `Refund`, and `SystemStatus`.

## Installation

```bash
pip install -e sdk/python

# Optional: shared idempotency storage for FastAPI/Celery workers
pip install -e 'sdk/python[redis]'

# Generate the lower-level contract bindings when contract WASM is built
./scripts/generate-python-bindings.sh
```

Generated bindings are placed under `sdk/python/cypher_gridpay_sdk/bindings`. The maintained async wrapper and models are not overwritten by regeneration. Re-run the script whenever the contract WASM changes; commit the regenerated bindings alongside the contract change.

## Async usage

```python
import asyncio
import os

from stellar_sdk import Keypair
from cypher_gridpay_sdk import Payment, SorobanContractAsyncClient

async def main():
    client = SorobanContractAsyncClient(
        contract_id=os.environ["PAYMENT_CONTRACT_ID"],
        rpc_url="https://soroban-testnet.stellar.org",
        network_passphrase="Test SDF Network ; September 2015",
        signer=Keypair.from_secret(os.environ["STELLAR_SECRET_KEY"]),
    )
    try:
        payment = await client.call("get_payment", 42, result_model=Payment)
        print(payment.status, payment.amount)

        await client.submit(
            "complete_payment",
            client.signer.public_key,
            payment.id,
            idempotency_key="order-42-completion-v1",
        )
    finally:
        await client.close()

asyncio.run(main())
```

`call()` simulates the contract invocation and does not submit a transaction. `submit()` requires a signing key and an idempotency key. The SDK converts Python integers, addresses, bytes, enums, lists, dictionaries, and Pydantic models to Soroban ScVals; pass `argument_types` when an integer's XDR width cannot be inferred from its argument name.

### Async client lifecycle and connection pooling

`SorobanContractAsyncClient` owns an `httpx.AsyncClient` internally. Create **one client per process** and reuse it across requests — do not construct a client per HTTP request, which defeats connection pooling and leaks sockets.

```python
from contextlib import asynccontextmanager
from fastapi import FastAPI
from cypher_gridpay_sdk import SorobanContractAsyncClient

@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.gridpay = SorobanContractAsyncClient(
        contract_id=os.environ["PAYMENT_CONTRACT_ID"],
        rpc_url=os.environ["SOROBAN_RPC_URL"],
        network_passphrase=os.environ["NETWORK_PASSPHRASE"],
        signer=Keypair.from_secret(os.environ["STELLAR_SECRET_KEY"]),
        timeout=15.0,          # per-request RPC timeout in seconds
        max_retries=3,         # retry transient RPC failures
    )
    try:
        yield
    finally:
        await app.state.gridpay.close()

app = FastAPI(lifespan=lifespan)
```

- Always `await client.close()` in a `finally` block or lifespan shutdown hook so the underlying connection pool is drained.
- Tune `timeout` to your RPC provider's p99 latency; the default is conservative for testnet. Lower it for latency-sensitive webhooks and raise it for large simulation payloads.
- `max_retries` retries transient RPC errors with backoff. Retries resubmit the **same signed envelope**; they never build a fresh transaction, so idempotency keys remain authoritative.
- Never share a single client across `asyncio.run()` calls or across event loops — the underlying `httpx` pool is bound to the loop that created it.

## Pydantic v2 models

`Payment`, `Escrow`, and `Refund` mirror the corresponding contract records. `SystemStatus` combines the common pause state with optional refund circuit-breaker fields for service health endpoints. Contract enum variants are represented as strings in the Pydantic models.

```python
from cypher_gridpay_sdk import Payment, Escrow, Refund

payment = await client.call("get_payment", 42, result_model=Payment)
escrow = await client.call("get_escrow", 7, result_model=Escrow)
refund = await client.call("get_refund", 3, result_model=Refund)

# Pydantic v2 serialization
payload = payment.model_dump(mode="json")
```

### i128 stroops and `decimal.Decimal`

All on-chain amounts are `i128` **integer stroops** (1 XLM = 10,000,000 stroops). Keep all arithmetic in `int` stroops and only convert to `decimal.Decimal` at the presentation boundary. Never use `float` for money.

```python
from decimal import Decimal, ROUND_DOWN

STROOPS_PER_UNIT = Decimal(10_000_000)

def stroops_to_decimal(stroops: int) -> Decimal:
    # Exact: integer division into Decimal, no float round-trip.
    return Decimal(stroops) / STROOPS_PER_UNIT

def decimal_to_stroops(amount: Decimal) -> int:
    # Reject sub-stroop precision instead of silently rounding.
    scaled = amount * STROOPS_PER_UNIT
    if scaled != scaled.to_integral_value(rounding=ROUND_DOWN):
        raise ValueError(f"amount {amount} has sub-stroop precision")
    return int(scaled)
```

Pitfalls to avoid:

- `Decimal(float)` inherits binary float error — construct from `int` or `str` only.
- `Decimal` context precision can silently round large `i128` values; the conversion above divides an exact `int` so it stays exact.
- Do not sum `Decimal` amounts and then convert back; sum `int` stroops and convert once.

## FastAPI dependency injection

```python
from fastapi import Depends, FastAPI, Request
from cypher_gridpay_sdk import Payment, SorobanContractAsyncClient

def get_client(request: Request) -> SorobanContractAsyncClient:
    return request.app.state.gridpay

@app.get("/payments/{payment_id}", response_model=Payment)
async def read_payment(
    payment_id: int,
    client: SorobanContractAsyncClient = Depends(get_client),
) -> Payment:
    return await client.call("get_payment", payment_id, result_model=Payment)
```

Because the client is created in the lifespan hook, dependency injection only hands out the shared instance — no per-request construction, no leaked pools.

## Celery background workers

Celery workers are synchronous. Bridge into the async client with a single long-lived event loop per worker process rather than calling `asyncio.run()` per task (which creates and tears down a loop, invalidating the pooled client).

```python
import asyncio
from celery import Celery
from cypher_gridpay_sdk import SorobanContractAsyncClient

celery_app = Celery("gridpay", broker=os.environ["CELERY_BROKER_URL"])

_loop: asyncio.AbstractEventLoop | None = None
_client: SorobanContractAsyncClient | None = None

def _get_loop_and_client():
    global _loop, _client
    if _loop is None:
        _loop = asyncio.new_event_loop()
        _client = SorobanContractAsyncClient(
            contract_id=os.environ["PAYMENT_CONTRACT_ID"],
            rpc_url=os.environ["SOROBAN_RPC_URL"],
            network_passphrase=os.environ["NETWORK_PASSPHRASE"],
            signer=Keypair.from_secret(os.environ["STELLAR_SECRET_KEY"]),
        )
    return _loop, _client

@celery_app.task(bind=True, max_retries=5)
def complete_payment_task(self, payment_id: int, request_id: str):
    loop, client = _get_loop_and_client()
    try:
        return loop.run_until_complete(
            client.submit(
                "complete_payment",
                client.signer.public_key,
                payment_id,
                idempotency_key=f"payment-complete:{request_id}",
            )
        )
    except Exception as exc:
        raise self.retry(exc=exc, countdown=2 ** self.request.retries)
```

Use one Redis-backed idempotency store across worker processes so completed results are shared. The in-memory default is intended for local development and tests only.

```python
from redis.asyncio import Redis
from cypher_gridpay_sdk import RedisIdempotencyStore, SorobanContractAsyncClient

redis = Redis.from_url("redis://localhost:6379/0")
client = SorobanContractAsyncClient(
    contract_id="C...",
    rpc_url="https://soroban-testnet.stellar.org",
    network_passphrase="Test SDF Network ; September 2015",
    signer=Keypair.from_secret("S..."),
    idempotency_store=RedisIdempotencyStore(redis),
)
```

Keep idempotency keys stable across retries and unique to one logical operation. Reusing a key with different function arguments raises `ValueError`. Retries resubmit the same signed transaction envelope; they do not construct a fresh transaction for each attempt.

## Commit-reveal arbitration

Arbitration votes use a commit-reveal scheme: arbitrators first submit a hash of their vote plus a secret nonce, then reveal the vote and nonce. The contract verifies the revealed preimage hashes to the committed digest.

```python
import hashlib
from cypher_gridpay_sdk import SorobanContractAsyncClient

def commit_digest(vote: str, nonce: bytes) -> bytes:
    # Match the contract's preimage encoding exactly: vote bytes || nonce.
    return hashlib.sha256(vote.encode() + nonce).digest()

async def commit_vote(client: SorobanContractAsyncClient, dispute_id: int, vote: str, nonce: bytes):
    digest = commit_digest(vote, nonce)
    await client.submit(
        "commit_vote",
        client.signer.public_key,
        dispute_id,
        digest,
        idempotency_key=f"commit:{dispute_id}:{client.signer.public_key}",
    )
    return digest

async def reveal_vote(client: SorobanContractAsyncClient, dispute_id: int, vote: str, nonce: bytes):
    await client.submit(
        "reveal_vote",
        client.signer.public_key,
        dispute_id,
        vote,
        nonce,
        idempotency_key=f"reveal:{dispute_id}:{client.signer.public_key}",
    )
```

To verify a preimage digest off-chain (e.g. before revealing), recompute `commit_digest(vote, nonce)` and compare it to the digest returned by `get_commitment`. Keep the nonce secret until reveal; store it encrypted at rest.

## Secrets management

Never hardcode Stellar secret seeds (`S...`) in Python source, notebooks, or committed `.env` files. Load them from a secret manager or environment at runtime:

```python
import os
from stellar_sdk import Keypair

# Environment (injected by your orchestrator / KMS sidecar)
secret = os.environ["STELLAR_SECRET_KEY"]

# Or fetch from a KMS / secrets manager and build the keypair in memory only.
signer = Keypair.from_secret(secret)
```

Rotate keys through your KMS, scope them to the minimum contract functions, and never log `Keypair.secret`.

## Private invoices

For private invoices, use `new_invoice_secret()` and
`ephemeral_invoice_commitment(vault_address, secret)` from the SDK. Keep the returned
secret off-chain until `complete_private_payment` reveals it; never reuse a secret.

## Examples

- [examples/python/quickstart.py](../examples/python/quickstart.py) — end-to-end quickstart.
- [examples/python/fastapi_webhook_verifier.py](../examples/python/fastapi_webhook_verifier.py) — FastAPI webhook verification with dependency injection.
- [examples/python/metered_usage_reporter.py](../examples/python/metered_usage_reporter.py) — Celery worker reporting metered usage.
- [examples/python/arbitrator_commit_reveal.py](../examples/python/arbitrator_commit_reveal.py) — commit-reveal arbitration votes.
