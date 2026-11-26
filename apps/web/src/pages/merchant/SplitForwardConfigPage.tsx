/**
 * SplitForwardConfigPage.tsx
 *
 * Merchant page for issue #354. Composes the split allocation editor with
 * on-chain payment-forwarding config discovery (get_forward_config) so the
 * client can pre-flight circular loops and hop-TTL breaches before a user
 * submits a new split/forward configuration.
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  SplitAllocationEditor,
  type SplitAllocationEditorProps,
} from "../../components/splits/SplitAllocationEditor.js";
import {
  DEFAULT_MAX_FORWARD_DEPTH,
  type ForwardEdge,
} from "../../utils/forwardingLoopDetector.js";
import { isValidStellarAddress } from "../../utils/stellarAddress.js";

type SavePayload = Parameters<
  NonNullable<SplitAllocationEditorProps["onSave"]>
>[0];

export interface SplitForwardConfigPageProps {
  merchantAddress: string;
  paymentId?: string;
  maxRecipients?: number;
  protocolFeeBps?: number;
  maxForwardDepth?: number;
  pendingPayoutCount?: number;
  /** Reads one PaymentForwardConfig from the contract (get_forward_config). */
  getForwardConfig?: (address: string) => Promise<ForwardEdge | null>;
  /** Extra destination addresses to include in the pre-flight graph walk. */
  destinationAddresses?: string[];
  onSave?: (payload: SavePayload & { paymentId?: string }) => Promise<void> | void;
  onError?: (error: unknown) => void;
}

type SaveStatus = "idle" | "saving" | "saved" | "error";

const EMPTY_ADDRESSES: string[] = [];

/**
 * Walks get_forward_config links breadth-first across every destination
 * address, stopping on already-visited addresses so malformed on-chain data
 * cannot hang the browser.
 */
async function loadForwardGraph(
  seeds: readonly string[],
  getForwardConfig: (address: string) => Promise<ForwardEdge | null>
): Promise<ForwardEdge[]> {
  const queue = [...seeds];
  const visited = new Set<string>();
  const configs: ForwardEdge[] = [];

  while (queue.length > 0) {
    const address = queue.shift();
    if (!address || visited.has(address)) continue;
    visited.add(address);

    const config = await getForwardConfig(address);
    if (!config) continue;
    configs.push(config);

    const next = config.forward_to.trim();
    if (next && !visited.has(next)) queue.push(next);
  }

  return configs;
}

export function SplitForwardConfigPage({
  merchantAddress,
  paymentId,
  maxRecipients,
  protocolFeeBps,
  maxForwardDepth = DEFAULT_MAX_FORWARD_DEPTH,
  pendingPayoutCount = 0,
  getForwardConfig,
  destinationAddresses = EMPTY_ADDRESSES,
  onSave,
  onError,
}: SplitForwardConfigPageProps) {
  const [forwardConfigs, setForwardConfigs] = useState<ForwardEdge[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle");
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const onErrorRef = useRef(onError);
  onErrorRef.current = onError;

  const seedKey = JSON.stringify([merchantAddress, ...destinationAddresses]);
  const seeds = useMemo(() => {
    const unique = new Set<string>();
    for (const address of [merchantAddress, ...destinationAddresses]) {
      if (isValidStellarAddress(address)) unique.add(address.trim());
    }
    return [...unique];
  }, [seedKey]);

  useEffect(() => {
    if (!getForwardConfig || seeds.length === 0) {
      setForwardConfigs([]);
      return;
    }

    let cancelled = false;
    setLoadError(null);
    loadForwardGraph(seeds, getForwardConfig)
      .then((configs) => {
        if (!cancelled) setForwardConfigs(configs);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setForwardConfigs([]);
        const message =
          error instanceof Error ? error.message : "Unable to load forwarding configs";
        setLoadError(message);
        onErrorRef.current?.(error);
      });

    return () => {
      cancelled = true;
    };
  }, [getForwardConfig, seeds]);

  const handleSave = useCallback(
    async (payload: SavePayload) => {
      if (!onSave) return;
      setSaveStatus("saving");
      setSaveMessage(null);
      try {
        await onSave({ ...payload, paymentId });
        setSaveStatus("saved");
        setSaveMessage("Split and forwarding configuration saved.");
      } catch (error) {
        setSaveStatus("error");
        setSaveMessage(
          error instanceof Error ? error.message : "Failed to save configuration"
        );
        onError?.(error);
      }
    },
    [onSave, paymentId, onError]
  );

  return (
    <main style={{ maxWidth: 1200, margin: "0 auto", padding: 24 }}>
      <header style={{ marginBottom: 16 }}>
        <h1 style={{ fontSize: 22, fontWeight: 700, margin: 0 }}>
          Split Payment &amp; Forwarding Configuration
        </h1>
        <p style={{ fontSize: 13, color: "#6b7280", marginTop: 6 }}>
          Allocate 100.00% of incoming revenue, preview downstream forwarding
          hops, and validate loops before submitting to the payment contract.
        </p>
        <p style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
          Merchant:{" "}
          <code style={{ fontFamily: "monospace" }}>
            {merchantAddress || "—"}
          </code>
          {paymentId ? (
            <>
              {" · Payment: "}
              <code style={{ fontFamily: "monospace" }}>{paymentId}</code>
            </>
          ) : null}
        </p>
      </header>

      {loadError && (
        <div
          role="alert"
          style={{
            background: "#fef2f2",
            border: "1px solid #fca5a5",
            borderRadius: 4,
            padding: "8px 10px",
            fontSize: 12,
            color: "#991b1b",
            marginBottom: 12,
          }}
        >
          Could not load existing forwarding configs: {loadError}. Local rules are
          still checked for loops.
        </div>
      )}

      <SplitAllocationEditor
        merchantAddress={merchantAddress}
        maxRecipients={maxRecipients}
        protocolFeeBps={protocolFeeBps}
        maxForwardDepth={maxForwardDepth}
        pendingPayoutCount={pendingPayoutCount}
        externalForwardConfigs={forwardConfigs}
        onSave={handleSave}
      />

      {saveMessage && (
        <p
          role="status"
          style={{
            marginTop: 12,
            fontSize: 12,
            color: saveStatus === "error" ? "#dc2626" : "#166534",
          }}
        >
          {saveMessage}
        </p>
      )}
    </main>
  );
}

export default SplitForwardConfigPage;
