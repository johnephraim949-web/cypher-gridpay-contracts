import { StrKey } from "@stellar/stellar-sdk";

/**
 * Validates a Stellar StrKey using the canonical SDK implementation.
 *
 * Accepts:
 *   - G…  ed25519 public keys (StrKey.isValidEd25519PublicKey)
 *   - C…  contract IDs          (StrKey.isValidContract)
 *
 * Rejects secret seeds (S…), muxed accounts (M…), signed payloads,
 * malformed base32, bad checksums, wrong lengths and empty values.
 */
export function isValidStellarAddress(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const address = value.trim();
  if (address.length === 0) return false;
  return (
    StrKey.isValidEd25519PublicKey(address) ||
    StrKey.isValidContract(address)
  );
}

/**
 * Returns the set of non-empty addresses that occur more than once.
 * Comparison is performed on the trimmed value; StrKey base32 is
 * case-sensitive, so no lower-casing is applied.
 */
export function findDuplicateAddresses(
  addresses: readonly string[]
): Set<string> {
  const counts = new Map<string, number>();
  for (const raw of addresses) {
    const address = raw.trim();
    if (address.length === 0) continue;
    counts.set(address, (counts.get(address) ?? 0) + 1);
  }
  const duplicates = new Set<string>();
  for (const [address, count] of counts) {
    if (count > 1) duplicates.add(address);
  }
  return duplicates;
}

/** Trims an address for storage/comparison. */
export function normalizeAddress(value: string): string {
  return value.trim();
}
