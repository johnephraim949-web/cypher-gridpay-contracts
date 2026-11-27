/**
 * useWallet.ts
 *
 * Minimal wallet hook stub for the GridPay web app.
 * Integrations with actual wallet adapters (Freighter, WalletConnect, etc.)
 * are wired up at the application shell level; this module provides the
 * shared interface consumed by all pages and components.
 *
 * Replace the stub implementation with the real adapter when the wallet
 * integration layer is added (see issue #355 and companion issues).
 */

import { useState } from "react";

export interface UseWalletResult {
  /** Connected Stellar account public key (G...), or undefined when not connected. */
  address: string | undefined;
  /** True when a wallet is connected and the address is available. */
  connected: boolean;
}

/** Returns the active wallet state from the nearest WalletProvider context. */
export function useWallet(): UseWalletResult {
  // Stub: always disconnected until a real provider is wired up.
  const [address] = useState<string | undefined>(undefined);
  return { address, connected: Boolean(address) };
}
