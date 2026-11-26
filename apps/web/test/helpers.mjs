import { StrKey } from "@stellar/stellar-sdk";

export const G_A = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 1));
export const G_B = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 2));
export const G_C = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 3));
export const G_D = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 4));
export const G_E = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 5));
export const G_F = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 6));
export const G_G = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 7));
export const CONTRACT_A = StrKey.encodeContract(Buffer.alloc(32, 8));

export function corruptChecksum(address) {
  const last = address.slice(-1);
  return `${address.slice(0, -1)}${last === "A" ? "B" : "A"}`;
}

export function edge(merchant, forward_to, overrides = {}) {
  return {
    merchant,
    forward_to,
    forward_bps: 5000,
    active: true,
    ...overrides,
  };
}
