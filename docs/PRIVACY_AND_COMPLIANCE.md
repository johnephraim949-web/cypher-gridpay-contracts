# Privacy, compliance, and audit exports

## Classify data before submission

| Public on Stellar | Restricted off-chain |
| --- | --- |
| Transaction envelope, source, operations, authorization, transaction memo, contract arguments, ledger changes and emitted events | Customer names, emails, street addresses, invoice line-item names, tax identifiers and card data |
| Payment IDs, amounts, assets, timestamps, statuses, and addresses disclosed by payment or settlement | Identity-to-address mapping, structured remittance, memo salts, unrevealed routing secrets and dispute evidence |
| An opaque random reference and a salted commitment when reconciliation requires them | Reference lookup table, original memo bytes, encryption keys and auditor disclosures |

Use an allowlisted schema for notes, metadata, memo references, dispute
arguments and event fields. Reject raw personal data before building a
transaction. Avoid public document URLs and predictable IDs. A public
commitment, address or transaction may still be linkable to a person.

## Commit to structured remittance

Validate the ISO 20022 message against your integration's message profile and
retain the exact agreed byte representation. For XML, agree on canonicalized
UTF-8 or retain the original validated bytes and verify those same bytes.
[SEP-29](https://github.com/stellar/stellar-protocol/blob/master/ecosystem/sep-0029.md)
describes an account's Stellar transaction memo requirement. Follow the
recipient's routing instructions and use an opaque routing value where
supported. The transaction memo and the contract's `PaymentMemo` are
separate fields.

Generate an independent cryptographically random salt of at least 128 bits
for each payment and keep it in restricted storage with the memo. Hashing a
sequential invoice number or email without such a salt enables dictionary
and rainbow-table attacks. Reusing salts or publishing low-entropy fields in
a reference enables correlation. Keep the salt private to prevent per-record
guessing and disclose it only with the minimum authorized evidence.

The Python example commits to the exact validated bytes using a versioned
prefix and a fixed-length salt. Send the resulting 32 bytes as `memo_hash`
to `set_payment_memo` with an opaque random `memo_ref`. An authorized
customer, merchant or admin can set the memo. Subsequent versions can update
the reference while the original hash remains fixed. The contract's
`verify_memo_integrity` compares digests. Compute the digest off-chain and
keep the bytes and salt out of transaction calls.

```python
from hashlib import sha256
from hmac import compare_digest
from secrets import token_bytes

DOMAIN = b"gridpay:iso20022-memo:v1\x00"
SALT_BYTES = 32

def memo_commitment(memo_bytes: bytes, salt: bytes) -> bytes:
    if len(salt) != SALT_BYTES:
        raise ValueError("expected a 32-byte salt")
    return sha256(DOMAIN + salt + memo_bytes).digest()

def verify_memo(memo_bytes: bytes, salt: bytes, on_chain_hash: bytes) -> bool:
    return compare_digest(memo_commitment(memo_bytes, salt), on_chain_hash)

# A synthetic remittance fragment. Use validated bytes in production.
memo = b"<RmtInf><Ustrd>demo-001</Ustrd></RmtInf>"
salt = token_bytes(SALT_BYTES)
digest = memo_commitment(memo, salt)
assert verify_memo(memo, salt, digest)
assert not verify_memo(memo + b" ", salt, digest)
assert not verify_memo(memo, token_bytes(SALT_BYTES), digest)
```

## Private invoice routing

1. The merchant chooses the vault and generates a single-use random 32-byte
   secret. Compute SHA-256 of the concatenation of the Soroban `ScVal` XDR
   of the vault address and the `ScVal` XDR of the 32-byte secret. Use the
   same representation as the contract's two `to_xdr` calls. Deliver the
   commitment with the invoice over an authenticated channel and keep the
   secret private until settlement.
2. The customer authorizes `create_private_payment` with the commitment,
   token, currency, amount, expiry and PII-free metadata. Save the returned
   payment ID. Creation records a pending payment using the Payment contract
   address in the merchant field. A commitment can only be used once.
3. The vault authorizes `complete_private_payment(vault, secret, payment_id)`.
   The contract checks the reveal, records the vault as merchant and consumes
   the route. Check the final state and token-transfer evidence. Amounts above
   the configured threshold enter the large-payment approval flow, which
   requires separate execution before reporting settlement.
4. Creation hides the vault from the invoice record until reveal. The vault,
   reveal, and resulting transaction are public at completion. The customer,
   token, amount, and timing can be observable throughout. An ephemeral
   invoice route does not provide confidential transfers.

## Export and independently verify audit evidence

This revision has no `export_escrow_audit_digest` entrypoint or protocol
receipt format. Export an off-chain signed manifest from the indexer and
attach the underlying ledger evidence. Distinguish a merchant-signed
proof-of-payment receipt from evidence obtained independently from Stellar.

1. Include the network passphrase, deployed contract IDs, payment/escrow IDs,
   transaction hash, ledger sequence, event identifiers, and the expected
   token, parties, base-unit amount, and outcome. Define a versioned encoding
   for the manifest and sign it with the exporter's audit key.
2. Verify the export signature against the trusted audit key and recompute the
   manifest digest. Independently fetch the transaction envelope, successful
   result and transaction metadata from Stellar RPC or an archival source.
   Check network and ledger, recompute the transaction hash from the envelope
   for that network, and check the contract ID and decoded events and ledger
   changes. Use historical evidence for the settlement ledger because current
   state may have changed.
3. Reconcile the expected outcome with actual token movements and contract
   state. Distinguish creation, proposal, release, dispute, refund and
   cancellation. For a settled receipt, check the recipient, amount, asset,
   and any recorded fee or split against the successful settlement execution.
4. For authorized memo verification, compare a locally recomputed digest to
   the committed `memo_hash`. Check the on-chain reference linkage
   `SHA-256(payment_id as 8-byte big-endian || ":" || memo_hash)`. Exchange
   the salt and memo separately through a restricted channel.

See the [accounting export specification](FINANCIAL_ACCOUNTING_AND_AUDIT_EXPORTS.md) for proposed export formats.

A signed export authenticates the exporter and its contents. Independent
ledger evidence establishes the reported transaction outcome.

## Retention and erasure

Set retention by record purpose, jurisdiction and legitimate legal hold.
Encrypt dispute evidence and identity mappings with scoped access and keep
a log of access without copying evidence into logs. For an approved erasure
request, delete or de-identify off-chain records, indexes, mappings, salts,
caches and prior exports where required. Propagate deletion to processors,
expire backups on schedule, and prevent restored backups from recreating
deleted records. For encrypted evidence, remove all retained copies or destroy
the dedicated keys and verify that recovery copies cannot decrypt the data.
If a lawful hold applies, restrict access, record its basis, and revisit it
when the hold ends. Public ledger history survives off-chain erasure.
See [GDPR Article 17](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng).

Keep card collection in the designated processor environment and exclude
card data from ledgers, audit exports and dispute uploads. Merchants must
discard sensitive authentication data after authorization, even when
encrypted. Confirm scope and controls with your compliance team.
See the [PCI SSC guidance](https://www.pcisecuritystandards.org/faqs/1154/).
