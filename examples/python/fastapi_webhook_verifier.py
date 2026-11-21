"""FastAPI webhook verifier for Cypher GridPay payment events.

Demonstrates:
  * Loading the Stellar secret seed from the environment (never hardcode it).
  * Reusing a single async Soroban client across requests via FastAPI DI.
  * Verifying an incoming payment against on-chain state before trusting it.
  * Keeping all on-chain math in integer stroops (no float/Decimal drift).

Run with:
    uvicorn examples.python.fastapi_webhook_verifier:app --reload

Environment:
    GRIDPAY_SECRET_SEED   Stellar secret seed (S...) for the verifier account.
    GRIDPAY_RPC_URL       Soroban RPC endpoint (defaults to testnet).
    GRIDPAY_CONTRACT_ID   Deployed GridPay contract id.
"""

from __future__ import annotations

import os
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Request
from pydantic import BaseModel, Field

from cypher_gridpay_sdk import AsyncGridPayClient

RPC_URL = os.environ.get("GRIDPAY_RPC_URL", "https://soroban-testnet.stellar.org")
CONTRACT_ID = os.environ.get("GRIDPAY_CONTRACT_ID", "")


class PaymentWebhook(BaseModel):
    """Payload delivered by the GridPay indexer when a payment settles."""

    payment_id: str = Field(..., description="On-chain payment id (hex).")
    amount_stroops: int = Field(..., ge=0, description="Amount in i128 stroops.")
    payer: str
    recipient: str


@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncIterator[None]:
    """Open one pooled client for the whole app lifetime."""
    seed = os.environ.get("GRIDPAY_SECRET_SEED")
    if not seed:
        raise RuntimeError("GRIDPAY_SECRET_SEED must be set (use a KMS-backed loader in prod)")

    async with AsyncGridPayClient(
        rpc_url=RPC_URL,
        contract_id=CONTRACT_ID,
        secret_seed=seed,
        timeout=10.0,
        max_retries=3,
    ) as client:
        app.state.gridpay = client
        yield


app = FastAPI(title="GridPay Webhook Verifier", lifespan=lifespan)


async def get_client(request: Request) -> AsyncGridPayClient:
    """FastAPI dependency that hands out the shared async client."""
    client: AsyncGridPayClient | None = getattr(request.app.state, "gridpay", None)
    if client is None:
        raise HTTPException(status_code=503, detail="GridPay client not ready")
    return client


@app.post("/webhooks/payment")
async def verify_payment(
    payload: PaymentWebhook,
    client: AsyncGridPayClient = Depends(get_client),
) -> dict[str, object]:
    """Confirm the webhook matches the authoritative on-chain payment."""
    try:
        payment = await client.get_payment(payload.payment_id)
    except Exception as exc:  # noqa: BLE001 - surface RPC failures as 502
        raise HTTPException(status_code=502, detail=f"RPC error: {exc}") from exc

    if payment is None:
        raise HTTPException(status_code=404, detail="payment not found on-chain")

    # Compare integer stroops directly; never round-trip through float.
    if int(payment.amount) != payload.amount_stroops:
        raise HTTPException(status_code=409, detail="amount mismatch")
    if payment.payer != payload.payer or payment.recipient != payload.recipient:
        raise HTTPException(status_code=409, detail="party mismatch")

    return {"verified": True, "payment_id": payload.payment_id}
