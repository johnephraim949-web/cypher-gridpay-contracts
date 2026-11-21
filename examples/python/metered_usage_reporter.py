"""Metered usage reporter example for the Cypher GridPay Python SDK.

Demonstrates reporting metered usage (in integer stroops) to an escrow using
``cypher_gridpay_sdk``. All on-chain amounts are kept as integer stroops; we
only convert to ``decimal.Decimal`` for display, never for arithmetic that is
sent on-chain.

Run with::

    python examples/python/metered_usage_reporter.py

Secrets are loaded from the environment (or a KMS in production). Never
hardcode Stellar secret seeds in source.
"""

from __future__ import annotations

import asyncio
import os
from decimal import Decimal

from cypher_gridpay_sdk import AsyncGridPayClient
from cypher_gridpay_sdk.models import Payment

# 1 XLM == 10_000_000 stroops (i128 on-chain).
STROOPS_PER_UNIT = 10_000_000


def stroops_to_decimal(stroops: int) -> Decimal:
    """Convert integer stroops to a Decimal for display only.

    Always keep on-chain math in integer stroops. ``Decimal`` is used purely
    for human-readable output to avoid float precision pitfalls.
    """
    return Decimal(stroops) / Decimal(STROOPS_PER_UNIT)


def load_secret_seed() -> str:
    """Load the signing secret from the environment (or KMS in production)."""
    seed = os.environ.get("GRIDPAY_SECRET_SEED")
    if not seed:
        raise RuntimeError(
            "GRIDPAY_SECRET_SEED is not set. Load it from a secret manager "
            "(e.g. AWS KMS / Vault) instead of hardcoding it in source."
        )
    return seed


async def report_usage(escrow_id: str, units_used: int) -> Payment:
    """Report metered usage against an escrow in integer stroops."""
    amount_stroops = units_used * STROOPS_PER_UNIT

    async with AsyncGridPayClient.from_secret(load_secret_seed()) as client:
        payment = await client.report_usage(
            escrow_id=escrow_id,
            amount_stroops=amount_stroops,
        )

    print(
        f"Reported {units_used} units "
        f"({amount_stroops} stroops = {stroops_to_decimal(amount_stroops)} XLM) "
        f"for escrow {escrow_id}: payment {payment.id}"
    )
    return payment


async def main() -> None:
    escrow_id = os.environ.get("GRIDPAY_ESCROW_ID", "escrow-demo")
    units_used = int(os.environ.get("GRIDPAY_UNITS_USED", "3"))
    await report_usage(escrow_id, units_used)


if __name__ == "__main__":
    asyncio.run(main())
