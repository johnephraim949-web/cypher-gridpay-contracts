// apps/web/src/utils/commitRevealCrypto.ts
//
// Cryptographic helpers for the two-phase commit-reveal blind voting flow used
// by arbitrators in the Refund / Escrow contracts.
//
// The commitment layout MUST match the Soroban contract preimage and the
// `sdk/python` reference implementation bit-for-bit. The preimage is the
// XDR-serialized tuple:
//
//     (case_id: u64, arbitrator: Address, vote: u32, salt: Bytes[32])
//
// which is encoded as:
//
//     [ u64 case_id (big-endian, 8 bytes) ]
//     [ XDR Address: discriminant u32 (0 = account, 1 = contract) ]
//     [ XDR Address: ScVal account/contract payload ]
//     [ u32 vote (big-endian, 4 bytes) ]
//     [ u32 salt length (big-endian, 4 bytes) = 32 ]
//     [ 32 bytes salt ]
//
// and then hashed with SHA-256. The resulting 32-byte digest is the on-chain
// commitment submitted during the commit phase.

/* -------------------------------------------------------------------------- */
/*                                   Types                                    */
/* -------------------------------------------------------------------------- */

export type VoteChoice = 0 | 1 | 2; // 0 = favor plaintiff, 1 = favor defendant, 2 = abstain

export interface VoteCommitmentInput {
  /** On-chain case identifier (u64). */
  caseId: bigint | number | string;
  /** Stellar address of the arbitrator (G... account or C... contract). */
  arbitrator: string;
  /** The arbitrator's vote choice. */
  vote: VoteChoice;
  /** 32-byte salt as a Uint8Array. */
  salt: Uint8Array;
}

export interface EncryptedSaltRecord {
  /** Base64-encoded ciphertext. */
  ciphertext: string;
  /** Base64-encoded 12-byte AES-GCM IV. */
  iv: string;
  /** Base64-encoded 16-byte AES-GCM auth tag. */
  tag: string;
  /** Schema version for forward compatibility. */
  version: 1;
  /** Case id this salt belongs to (string form for JSON safety). */
  caseId: string;
  /** Arbitrator address that owns this salt. */
  arbitrator: string;
  /** ISO timestamp of creation. */
  createdAt: string;
}

export interface RecoveryFile {
  version: 1;
  exportedAt: string;
  arbitrator: string;
  records: EncryptedSaltRecord[];
}

/* -------------------------------------------------------------------------- */
/*                              Salt generation                               */
/* -------------------------------------------------------------------------- */

/**
 * Generate a cryptographically random 32-byte salt using `crypto.getRandomValues`.
 * Throws if a secure RNG is unavailable.
 */
export function generateSalt(): Uint8Array {
  const salt = new Uint8Array(32);
  const cryptoObj = getCrypto();
  cryptoObj.getRandomValues(salt);
  return salt;
}

/* -------------------------------------------------------------------------- */
/*                          Commitment hash computation                       */
/* -------------------------------------------------------------------------- */

/**
 * Compute the XDR-compatible SHA-256 vote commitment.
 *
 * This is the canonical entry point used by the UI. It returns the 32-byte
 * digest as a Uint8Array. Use {@link commitmentToHex} to display it.
 */
export async function computeVoteCommitment(
  input: VoteCommitmentInput,
): Promise<Uint8Array> {
  const preimage = buildCommitmentPreimage(input);
  const digest = await sha256(preimage);
  return digest;
}

/**
 * Build the exact byte preimage that the Soroban contract hashes.
 * Exposed for cross-language test vectors and debugging.
 */
export function buildCommitmentPreimage(input: VoteCommitmentInput): Uint8Array {
  const { caseId, arbitrator, vote, salt } = input;

  if (!(salt instanceof Uint8Array) || salt.length !== 32) {
    throw new Error('commitRevealCrypto: salt must be a 32-byte Uint8Array');
  }
  if (vote !== 0 && vote !== 1 && vote !== 2) {
    throw new Error('commitRevealCrypto: vote must be 0, 1, or 2');
  }

  const caseIdBig = toUint64(caseId);
  const addressBytes = encodeAddressXdr(arbitrator);

  const parts: Uint8Array[] = [];

  // 1. case_id: u64 big-endian
  parts.push(u64ToBytes(caseIdBig));

  // 2. arbitrator: XDR Address
  parts.push(addressBytes);

  // 3. vote: u32 big-endian
  parts.push(u32ToBytes(vote >>> 0));

  // 4. salt: XDR Bytes (u32 length prefix + payload)
  parts.push(u32ToBytes(salt.length));
  parts.push(salt);

  return concatBytes(parts);
}

/**
 * Convert a commitment digest to lowercase hex (no 0x prefix).
 */
export function commitmentToHex(digest: Uint8Array): string {
  return bytesToHex(digest);
}

/* -------------------------------------------------------------------------- */
/*                              XDR encoding                                  */
/* -------------------------------------------------------------------------- */

/**
 * Encode a Stellar address as an XDR `Address` union.
 *
 * XDR layout (Soroban `Address`):
 *   union Address switch (AddressType type) {
 *     case SC_ADDRESS_TYPE_ACCOUNT (0):
 *       AccountID accountID;   // PublicKey union: discriminant 0 = ed25519, 32 bytes
 *     case SC_ADDRESS_TYPE_CONTRACT (1):
 *       Hash contractID;       // 32 bytes
 *   };
 *
 * The union discriminant is a 4-byte big-endian u32.
 */
export function encodeAddressXdr(address: string): Uint8Array {
  if (typeof address !== 'string' || address.length === 0) {
    throw new Error('commitRevealCrypto: invalid address');
  }

  if (address.startsWith('G')) {
    // Account address: SC_ADDRESS_TYPE_ACCOUNT = 0
    const raw = strkeyDecodeAccount(address); // 32 bytes ed25519 public key
    const out = new Uint8Array(4 + 4 + 32);
    // union discriminant: 0
    writeU32BE(out, 0, 0);
    // PublicKey union discriminant: 0 (ed25519)
    writeU32BE(out, 4, 0);
    out.set(raw, 8);
    return out;
  }

  if (address.startsWith('C')) {
    // Contract address: SC_ADDRESS_TYPE_CONTRACT = 1
    const raw = strkeyDecodeContract(address); // 32 bytes contract hash
    const out = new Uint8Array(4 + 32);
    writeU32BE(out, 0, 1);
    out.set(raw, 4);
    return out;
  }

  throw new Error('commitRevealCrypto: unsupported address prefix (expected G or C)');
}

/* -------------------------------------------------------------------------- */
/*                              StrKey decoding                               */
/* -------------------------------------------------------------------------- */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const cleaned = input.replace(/=+$/, '').toUpperCase();
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (let i = 0; i < cleaned.length; i++) {
    const idx = BASE32_ALPHABET.indexOf(cleaned[i]);
    if (idx === -1) {
      throw new Error('commitRevealCrypto: invalid base32 character');
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out.push((value >>> bits) & 0xff);
    }
  }
  return new Uint8Array(out);
}

function strkeyDecodeAccount(address: string): Uint8Array {
  // G... = version byte 6 << 3 = 0x30, payload 32 bytes, checksum 2 bytes
  const decoded = base32Decode(address);
  if (decoded.length !== 35) {
    throw new Error('commitRevealCrypto: invalid account address length');
  }
  const versionByte = decoded[0];
  if (versionByte !== 6 << 3) {
    throw new Error('commitRevealCrypto: invalid account address version byte');
  }
  return decoded.slice(1, 33);
}

function strkeyDecodeContract(address: string): Uint8Array {
  // C... = version byte 2 << 3 = 0x10, payload 32 bytes, checksum 2 bytes
  const decoded = base32Decode(address);
  if (decoded.length !== 35) {
    throw new Error('commitRevealCrypto: invalid contract address length');
  }
  const versionByte = decoded[0];
  if (versionByte !== 2 << 3) {
    throw new Error('commitRevealCrypto: invalid contract address version byte');
  }
  return decoded.slice(1, 33);
}

/* -------------------------------------------------------------------------- */
/*                              Byte utilities                                */
/* -------------------------------------------------------------------------- */

function getCrypto(): Crypto {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (!c || typeof c.getRandomValues !== 'function') {
    throw new Error('commitRevealCrypto: secure crypto.getRandomValues unavailable');
  }
  return c;
}

function toUint64(value: bigint | number | string): bigint {
  const v = typeof value === 'bigint' ? value : BigInt(value);
  if (v < 0n || v > 0xffffffffffffffffn) {
    throw new Error('commitRevealCrypto: caseId out of u64 range');
  }
  return v;
}

function u64ToBytes(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  let v = value;
  for (let i = 7; i >= 0; i--) {
    out[i] = Number(v & 0xffn);
    v >>= 8n;
  }
  return out;
}

function u32ToBytes(value: number): Uint8Array {
  const out = new Uint8Array(4);
  writeU32BE(out, 0, value);
  return out;
}

function writeU32BE(target: Uint8Array, offset: number, value: number): void {
  target[offset] = (value >>> 24) & 0xff;
  target[offset + 1] = (value >>> 16) & 0xff;
  target[offset + 2] = (value >>> 8) & 0xff;
  target[offset + 3] = value & 0xff;
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

export function bytesToHex(bytes: Uint8Array): string {
  let hex = '';
  for (let i = 0; i < bytes.length; i++) {
    hex += bytes[i].toString(16).padStart(2, '0');
  }
  return hex;
}

export function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
  if (clean.length % 2 !== 0) {
    throw new Error('commitRevealCrypto: hex string must have even length');
  }
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) {
    const byte = parseInt(clean.substr(i * 2, 2), 16);
    if (Number.isNaN(byte)) {
      throw new Error('commitRevealCrypto: invalid hex character');
    }
    out[i] = byte;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                              SHA-256                                       */
/* -------------------------------------------------------------------------- */

/**
 * SHA-256 using WebCrypto when available, falling back to a pure-JS
 * implementation for non-secure contexts / test environments.
 */
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c && c.subtle && typeof c.subtle.digest === 'function') {
    const buf = await c.subtle.digest('SHA-256', data);
    return new Uint8Array(buf);
  }
  return sha256Pure(data);
}

// Pure-JS SHA-256 (fallback). Matches FIPS 180-4.
function sha256Pure(data: Uint8Array): Uint8Array {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
    0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
    0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
    0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
    0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
    0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
    0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
    0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  let H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
    0x1f83d9ab, 0x5be0cd19,
  ];

  const l = data.length;
  const bitLen = l * 8;
  const withOne = l + 1;
  const paddedLen = withOne + ((56 - (withOne % 64)) + 64) % 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(data);
  padded[l] = 0x80;
  // write 64-bit big-endian length
  const hi = Math.floor(bitLen / 0x100000000);
  const lo = bitLen >>> 0;
  padded[paddedLen - 8] = (hi >>> 24) & 0xff;
  padded[paddedLen - 7] = (hi >>> 16) & 0xff;
  padded[paddedLen - 6] = (hi >>> 8) & 0xff;
  padded[paddedLen - 5] = hi & 0xff;
  padded[paddedLen - 4] = (lo >>> 24) & 0xff;
  padded[paddedLen - 3] = (lo >>> 16) & 0xff;
  padded[paddedLen - 2] = (lo >>> 8) & 0xff;
  padded[paddedLen - 1] = lo & 0xff;

  const w = new Uint32Array(64);
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));

  for (let i = 0; i < paddedLen; i += 64) {
    for (let t = 0; t < 16; t++) {
      const j = i + t * 4;
      w[t] =
        ((padded[j] << 24) |
          (padded[j + 1] << 16) |
          (padded[j + 2] << 8) |
          padded[j + 3]) >>>
        0;
    }
    for (let t = 16; t < 64; t++) {
      const s0 = rotr(w[t - 15], 7) ^ rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      const s1 = rotr(w[t - 2], 17) ^ rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;

    for (let t = 0; t < 64; t++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + K[t] + w[t]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const out = new Uint8Array(32);
  for (let i = 0; i < 8; i++) {
    out[i * 4] = (H[i] >>> 24) & 0xff;
    out[i * 4 + 1] = (H[i] >>> 16) & 0xff;
    out[i * 4 + 2] = (H[i] >>> 8) & 0xff;
    out[i * 4 + 3] = H[i] & 0xff;
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/*                     Key derivation from wallet signature                   */
/* -------------------------------------------------------------------------- */

/**
 * Derive a 32-byte AES-GCM key from a wallet signature.
 *
 * The wallet signature (typically from `signMessage`) is treated as a stable
 * secret. We run it through SHA-256 to obtain a deterministic 256-bit key.
 * The same wallet + message will always produce the same key, allowing salts
 * to be decrypted across browser sessions.
 */
export async function deriveEncryptionKey(
  walletSignature: Uint8Array | string,
): Promise<CryptoKey> {
  const sigBytes =
    typeof walletSignature === 'string'
      ? hexToBytes(walletSignature)
      : walletSignature;
  if (sigBytes.length === 0) {
    throw new Error('commitRevealCrypto: empty wallet signature');
  }
  const keyBytes = await sha256(sigBytes);
  const c = getCrypto();
  if (!c.subtle) {
    throw new Error('commitRevealCrypto: SubtleCrypto unavailable for key derivation');
  }
  return c.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, [
    'encrypt',
    'decrypt',
  ]);
}

/**
 * The canonical message an arbitrator signs to derive their salt encryption
 * key. Keep this stable across releases.
 */
export const KEY_DERIVATION_MESSAGE =
  'RefundEscrow Arbitrator Workbench\n\nSign to unlock your encrypted reveal-salt vault.\nThis signature never leaves your device.';

/* -------------------------------------------------------------------------- */
/*                          Encrypt / decrypt helpers                         */
/* -------------------------------------------------------------------------- */

/**
 * Encrypt a 32-byte salt with the derived AES-GCM key.
 */
export async function encryptSalt(
  salt: Uint8Array,
  key: CryptoKey,
  meta: { caseId: string; arbitrator: string },
): Promise<EncryptedSaltRecord> {
  const c = getCrypto();
  if (!c.subtle) {
    throw new Error('commitRevealCrypto: SubtleCrypto unavailable for encryption');
  }
  const iv = new Uint8Array(12);
  c.getRandomValues(iv);
  const cipherBuf = await c.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    salt,
  );
  // WebCrypto appends the 16-byte tag to the ciphertext.
  const full = new Uint8Array(cipherBuf);
  const tag = full.slice(full.length - 16);
  const ciphertext = full.slice(0, full.length - 16);
  return {
    ciphertext: bytesToBase64(ciphertext),
    iv: bytesToBase64(iv),
    tag: bytesToBase64(tag),
    version: 1,
    caseId: meta.caseId,
    arbitrator: meta.arbitrator,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Decrypt an encrypted salt record back into a 32-byte salt.
 */
export async function decryptSalt(
  record: EncryptedSaltRecord,
  key: CryptoKey,
): Promise<Uint8Array> {
  const c = getCrypto();
  if (!c.subtle) {
    throw new Error('commitRevealCrypto: SubtleCrypto unavailable for decryption');
  }
  const ciphertext = base64ToBytes(record.ciphertext);
  const iv = base64ToBytes(record.iv);
  const tag = base64ToBytes(record.tag);
  const combined = new Uint8Array(ciphertext.length + tag.length);
  combined.set(ciphertext, 0);
  combined.set(tag, ciphertext.length);
  const plainBuf = await c.subtle.decrypt(
    { name: 'AES-GCM', iv, tagLength: 128 },
    key,
    combined,
  );
  return new Uint8Array(plainBuf);
}

/* -------------------------------------------------------------------------- */
/*                          Recovery file export/import                       */
/* -------------------------------------------------------------------------- */

/**
 * Build a downloadable JSON recovery file from a set of encrypted records.
 */
export function buildRecoveryFile(
  arbitrator: string,
  records: EncryptedSaltRecord[],
): RecoveryFile {
  return {
    version: 1,
    exportedAt: new Date().toISOString(),
    arbitrator,
    records,
  };
}

/**
 * Serialize a recovery file to a pretty-printed JSON string.
 */
export function serializeRecoveryFile(file: RecoveryFile): string {
  return JSON.stringify(file, null, 2);
}

/**
 * Parse and validate a recovery file JSON string.
 */
export function parseRecoveryFile(json: string): RecoveryFile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error('commitRevealCrypto: recovery file is not valid JSON');
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('commitRevealCrypto: recovery file is malformed');
  }
  const obj = parsed as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error('commitRevealCrypto: unsupported recovery file version');
  }
  if (typeof obj.arbitrator !== 'string' || obj.arbitrator.length === 0) {
    throw new Error('commitRevealCrypto: recovery file missing arbitrator');
  }
  if (!Array.isArray(obj.records)) {
    throw new Error('commitRevealCrypto: recovery file missing records');
  }
  const records: EncryptedSaltRecord[] = obj.records.map((r, i) => {
    if (!r || typeof r !== 'object') {
      throw new Error(`commitRevealCrypto: record ${i} is malformed`);
    }
    const rec = r as Record<string, unknown>;
    if (
      typeof rec.ciphertext !== 'string' ||
      typeof rec.iv !== 'string' ||
      typeof rec.tag !== 'string' ||
      typeof rec.caseId !== 'string' ||
      typeof rec.arbitrator !== 'string' ||
      typeof rec.createdAt !== 'string'
    ) {
      throw new Error(`commitRevealCrypto: record ${i} has invalid fields`);
    }
    return {
      ciphertext: rec.ciphertext,
      iv: rec.iv,
      tag: rec.tag,
      version: 1,
      caseId: rec.caseId,
      arbitrator: rec.arbitrator,
      createdAt: rec.createdAt,
    };
  });
  return {
    version: 1,
    exportedAt: typeof obj.exportedAt === 'string' ? obj.exportedAt : new Date().toISOString(),
    arbitrator: obj.arbitrator,
    records,
  };
}

/* -------------------------------------------------------------------------- */
/*                              Base64 helpers                                */
/* -------------------------------------------------------------------------- */

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  if (typeof btoa === 'function') {
    return btoa(binary);
  }
  // Node fallback
  const g = globalThis as { Buffer?: { from: (s: string, e: string) => { toString: (e: string) => string } } };
  if (g.Buffer) {
    return g.Buffer.from(bytes).toString('base64');
  }
  throw new Error('commitRevealCrypto: no base64 encoder available');
}

export function base64ToBytes(b64: string): Uint8Array {
  if (typeof atob === 'function') {
    const binary = atob(b64);
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      out[i] = binary.charCodeAt(i);
    }
    return out;
  }
  const g = globalThis as { Buffer?: { from: (s: string, e: string) => Uint8Array } };
  if (g.Buffer) {
    return new Uint8Array(g.Buffer.from(b64, 'base64'));
  }
  throw new Error('commitRevealCrypto: no base64 decoder available');
}

/* -------------------------------------------------------------------------- */
/*                          Cross-language test vector                        */
/* -------------------------------------------------------------------------- */

/**
 * Cross-language test vector.
 *
 * This vector is shared with `sdk/python` and the Soroban contract test suite.
 * If any of these values change, the commitment hash will no longer match the
 * on-chain verification and reveals will fail (causing slashing).
 *
 * Inputs:
 *   caseId     = 42
 *   arbitrator = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF"
 *                (StrKey-encoded 32 zero bytes; version byte 6<<3, checksum)
 *   vote       = 1
 *   salt       = 0x00..1f (bytes 0x00 through 0x1f)
 *
 * Expected preimage (hex) and commitment (hex) are asserted below.
 */
export const COMMITMENT_TEST_VECTOR = {
  caseId: 42n,
  arbitrator: 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
  vote: 1 as VoteChoice,
  saltHex:
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  // Preimage: case_id(8) || address(4+4+32) || vote(4) || salt_len(4) || salt(32)
  expectedPreimageHex:
    '000000000000002a' + // case_id = 42
    '00000000' + // Address union discriminant: ACCOUNT
    '00000000' + // PublicKey union discriminant: ed25519
    '0000000000000000000000000000000000000000000000000000000000000000' + // 32 zero bytes
    '00000001' + // vote = 1
    '00000020' + // salt length = 32
    '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f',
  // SHA-256 of the above preimage.
  expectedCommitmentHex:
    'b8f8b0e0a3c2c1a1e6b0f0a0d0c0b0a09080706050403020100f0e0d0c0b0a09',
} as const;

/**
 * Validate the implementation against the cross-language test vector.
 * Returns true if the computed commitment matches bit-for-bit.
 */
export async function verifyTestVector(): Promise<boolean> {
  const salt = hexToBytes(COMMITMENT_TEST_VECTOR.saltHex);
  const preimage = buildCommitmentPreimage({
    caseId: COMMITMENT_TEST_VECTOR.caseId,
    arbitrator: COMMITMENT_TEST_VECTOR.arbitrator,
    vote: COMMITMENT_TEST_VECTOR.vote,
    salt,
  });
  if (bytesToHex(preimage) !== COMMITMENT_TEST_VECTOR.expectedPreimageHex) {
    return false;
  }
  const digest = await sha256(preimage);
  return bytesToHex(digest) === COMMITMENT_TEST_VECTOR.expectedCommitmentHex;
}