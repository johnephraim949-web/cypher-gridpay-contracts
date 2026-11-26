// Pure planning helpers (no network): expiry selection, chunking and spend-cap enforcement.

export const STROOPS_PER_XLM = 10_000_000n;

export interface EntryTtl {
  keyXdr: string; // base64 LedgerKey
  label: string;
  liveUntilLedgerSeq: number;
}

/** Entries whose remaining TTL is below the threshold. */
export function selectExpiring(entries: EntryTtl[], currentLedger: number, minTtl: number): EntryTtl[] {
  return entries.filter((e) => e.liveUntilLedgerSeq - currentLedger < minTtl);
}

export function chunk<T>(items: T[], size: number): T[][] {
  if (size < 1) throw new Error("chunk size must be >= 1");
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Tracks cumulative spend and refuses any chunk that would breach the cap.
 * Costs are in stroops (bigint).
 */
export class SpendGuard {
  private spent = 0n;
  constructor(private readonly capStroops: bigint) {}
  get totalSpent(): bigint {
    return this.spent;
  }
  /** Returns true and records the cost if it fits under the cap; false (no change) otherwise. */
  tryReserve(costStroops: bigint): boolean {
    if (costStroops < 0n) throw new Error("negative cost");
    if (this.spent + costStroops > this.capStroops) return false;
    this.spent += costStroops;
    return true;
  }
}

export function xlmToStroops(xlm: string): bigint {
  const [whole, frac = ""] = xlm.split(".");
  return BigInt(whole || "0") * STROOPS_PER_XLM + BigInt((frac + "0000000").slice(0, 7));
}

/** Full-jitter exponential backoff delay in ms. */
export function backoffMs(attempt: number, baseMs = 500, maxMs = 15_000, rand = Math.random): number {
  return Math.floor(rand() * Math.min(maxMs, baseMs * 2 ** attempt));
}
