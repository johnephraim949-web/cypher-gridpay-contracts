/**
 * useContract.ts
 *
 * Minimal contract hook stub for the GridPay web app.
 *
 * Provides a typed interface for the on-chain contract client and the
 * most-recently synced ledger timestamp.  The real implementation is wired
 * up at the application shell level via a ContractProvider.
 *
 * Replace the stub implementation with the real Soroban contract client
 * when the contract integration layer is added.
 */

import { useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type ContractClient = Record<string, (...args: any[]) => Promise<any>>;

export interface UseContractResult {
  /**
   * The instantiated contract client.
   * null when the wallet is not connected or the contract has not been
   * initialised yet.
   */
  contract: ContractClient | null;
  /**
   * The ledger close timestamp (unix seconds) from the most recent Soroban
   * RPC simulation or ledger event.  Used to guard time-sensitive operations
   * such as loyalty-point expiry checks.
   */
  ledgerTimestamp: number | undefined;
}

/** Returns the active contract client and ledger timestamp. */
export function useContract(): UseContractResult {
  // Stub: no live contract until a real provider is wired up.
  const [contract] = useState<ContractClient | null>(null);
  const [ledgerTimestamp] = useState<number | undefined>(undefined);
  return { contract, ledgerTimestamp };
}
