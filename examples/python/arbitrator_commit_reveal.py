"""Commit-reveal arbitration vote example for the Cypher GridPay Python SDK.

Demonstrates the two-phase commit-reveal flow used by arbitrators:

1. ``commit``: publish ``sha256(preimage)`` on-chain before the deadline.
2. ``reveal``: publish the preimage; the contract verifies the digest.

Run with ``python examples/python/arbitrator_commit_reveal.py`` after setting
``STELLAR_SECRET_SEED`` (or wiring a KMS-backed signer).
"""

from __future__ import annotations

import asyncio
import hashlib
import os
import secrets
from dataclasses import dataclass

from cypher_gridpay_sdk import AsyncCypherGridPayClient


@dataclass(frozen=True)
class CommitRevealVote:
    """A single arbitrator vote in the commit-reveal scheme."""

    escrow_id: int
    vote: bool
    salt: bytes
    preimage: bytes
    digest: bytes

    @classmethod
    def build(cls, escrow_id: int, vote: bool) -> "CommitRevealVote":
        # Salt keeps the preimage unpredictable so the digest cannot be
        # brute-forced from the (boolean) vote before the reveal phase.
        salt = secrets.token_bytes(32)
        preimage = salt + (b"\x01" if vote else b"\x00")
        digest = hashlib.sha256(preimage).digest()
        return cls(
            escrow_id=escrow_id,
            vote=vote,
            salt=salt,
            preimage=preimage,
            digest=digest,
        )

    def verify(self) -> bool:
        """Recompute the digest locally before submitting the reveal."""
        return hashlib.sha256(self.preimage).digest() == self.digest


async def run(escrow_id: int, vote: bool) -> None:
    # Never hardcode secret seeds in source. Load from the environment or a
    # KMS-backed signer in production.
    secret_seed = os.environ["STELLAR_SECRET_SEED"]

    vote_record = CommitRevealVote.build(escrow_id=escrow_id, vote=vote)
    if not vote_record.verify():
        raise RuntimeError("local preimage digest verification failed")

    async with AsyncCypherGridPayClient.from_secret(secret_seed) as client:
        # Phase 1: commit the digest. The contract stores it keyed by
        # (escrow_id, arbitrator).
        commit_tx = await client.commit_arbitration_vote(
            escrow_id=vote_record.escrow_id,
            digest=vote_record.digest,
        )
        print(f"commit submitted: {commit_tx.hash}")

        # Phase 2: reveal the preimage. The contract recomputes
        # sha256(preimage) and compares it against the stored digest.
        reveal_tx = await client.reveal_arbitration_vote(
            escrow_id=vote_record.escrow_id,
            preimage=vote_record.preimage,
        )
        print(f"reveal submitted: {reveal_tx.hash}")


def main() -> None:
    asyncio.run(run(escrow_id=1, vote=True))


if __name__ == "__main__":
    main()
