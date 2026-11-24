/**
 * LedgerStatusIndicator.tsx
 *
 * Persistent Stellar network telemetry and ledger status bar indicator for Cypher GridPay.
 * Displays:
 *   - Active network environment badge (Mainnet / Testnet / Standalone)
 *   - Latest closed ledger sequence with anti-jitter tabular numbers
 *   - RPC round-trip latency in milliseconds with traffic-light health indicator
 *   - Degraded-connectivity alerts (proxy fallback, socket disconnect, latency spike)
 *   - Expandable telemetry popover with connection diagnostic details
 *
 * Designed for insertion into the top navigation header.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export type StellarNetwork = "mainnet" | "testnet" | "standalone";

export type ConnectionStatus =
  | "connected"
  | "reconnecting"
  | "polling"
  | "degraded"
  | "disconnected";

export interface LedgerStatusIndicatorProps {
  /** Active Stellar network. Defaults to 'testnet'. */
  network?: StellarNetwork;
  /** Latest closed ledger sequence number. */
  latestLedger?: number | null;
  /** Round-trip RPC latency in milliseconds. */
  rpcLatencyMs?: number | null;
  /** Stream/RPC connection state. */
  connectionStatus?: ConnectionStatus;
  /** Explicit degraded flag override. */
  isDegraded?: boolean;
  /** Target Soroban RPC endpoint URL for diagnostic display. */
  rpcUrl?: string;
  /** Optional callback to trigger manual reconnect / telemetry refresh. */
  onRefresh?: () => void;
  /** Compact view for mobile viewports. */
  compact?: boolean;
  /** Optional CSS class name. */
  className?: string;
  /** Optional inline styles. */
  style?: React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Design Tokens & Helpers
// ---------------------------------------------------------------------------

const NETWORK_CONFIG: Record<
  StellarNetwork,
  { label: string; bg: string; text: string; border: string; dot: string }
> = {
  mainnet: {
    label: "Mainnet",
    bg: "rgba(16, 185, 129, 0.12)",
    text: "#059669",
    border: "rgba(16, 185, 129, 0.3)",
    dot: "#10B981",
  },
  testnet: {
    label: "Testnet",
    bg: "rgba(99, 102, 241, 0.12)",
    text: "#4F46E5",
    border: "rgba(99, 102, 241, 0.3)",
    dot: "#6366F1",
  },
  standalone: {
    label: "Standalone",
    bg: "rgba(139, 92, 246, 0.12)",
    text: "#7C3AED",
    border: "rgba(139, 92, 246, 0.3)",
    dot: "#8B5CF6",
  },
};

function getLatencyHealth(
  latencyMs: number | null,
  status: ConnectionStatus,
): { color: string; label: string; text: string } {
  if (status === "disconnected") {
    return { color: "#EF4444", label: "Offline", text: "Offline" };
  }
  if (status === "reconnecting") {
    return { color: "#F59E0B", label: "Reconnecting", text: "Reconnecting" };
  }
  if (latencyMs === null) {
    return { color: "#9CA3AF", label: "Benchmarking…", text: "Checking…" };
  }
  if (latencyMs < 300) {
    return { color: "#10B981", label: "Optimal (<300ms)", text: `${latencyMs}ms` };
  }
  if (latencyMs <= 1000) {
    return { color: "#F59E0B", label: "Fair (300–1000ms)", text: `${latencyMs}ms` };
  }
  return { color: "#EF4444", label: "High Latency (>1000ms)", text: `${latencyMs}ms` };
}

export function LedgerStatusIndicator({
  network = "testnet",
  latestLedger,
  rpcLatencyMs = null,
  connectionStatus = "connected",
  isDegraded = false,
  rpcUrl,
  onRefresh,
  compact = false,
  className,
  style,
}: LedgerStatusIndicatorProps): React.JSX.Element {
  const popoverId = useId();
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [isPulsing, setIsPulsing] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const prevLedgerRef = useRef<number | null | undefined>(latestLedger);

  // Pulse animation on ledger sequence update
  useEffect(() => {
    if (
      latestLedger &&
      prevLedgerRef.current !== undefined &&
      latestLedger !== prevLedgerRef.current
    ) {
      setIsPulsing(true);
      const timer = setTimeout(() => setIsPulsing(false), 800);
      return () => clearTimeout(timer);
    }
    prevLedgerRef.current = latestLedger;
  }, [latestLedger]);

  // Close popover on Outside Click & Escape key
  useEffect(() => {
    if (!popoverOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setPopoverOpen(false);
        buttonRef.current?.focus();
      }
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        buttonRef.current &&
        !buttonRef.current.contains(e.target as Node)
      ) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [popoverOpen]);

  const netConfig = NETWORK_CONFIG[network] || NETWORK_CONFIG.testnet;
  const latencyHealth = getLatencyHealth(rpcLatencyMs, connectionStatus);
  const isEffectivelyDegraded =
    isDegraded ||
    connectionStatus === "degraded" ||
    connectionStatus === "polling" ||
    (rpcLatencyMs !== null && rpcLatencyMs > 1000);

  const formattedLedger = latestLedger
    ? `#${latestLedger.toLocaleString()}`
    : "Syncing…";

  return (
    <div
      className={className}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        fontSize: "13px",
        ...style,
      }}
      role="status"
      aria-live="polite"
    >
      {/* Main Status Capsule Trigger */}
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={popoverOpen}
        aria-controls={popoverId}
        aria-label={`Stellar Network Status: ${netConfig.label}, Latest Ledger ${formattedLedger}, Latency ${latencyHealth.text}${isEffectivelyDegraded ? ", Connection Degraded" : ""}`}
        onClick={() => setPopoverOpen((prev) => !prev)}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "8px",
          padding: compact ? "4px 8px" : "5px 12px",
          background: "var(--color-bg-card, #FFFFFF)",
          border: `1px solid ${isEffectivelyDegraded ? "#F59E0B" : "var(--color-border-subtle, #E5E7EB)"}`,
          borderRadius: "9999px",
          cursor: "pointer",
          color: "var(--color-text-primary, #1F2937)",
          outline: "none",
          transition: "border-color 0.15s ease, box-shadow 0.15s ease",
          boxShadow: "0 1px 2px rgba(0, 0, 0, 0.05)",
        }}
      >
        {/* Network Badge Pill */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            padding: "2px 7px",
            borderRadius: "9999px",
            backgroundColor: netConfig.bg,
            border: `1px solid ${netConfig.border}`,
            color: netConfig.text,
            fontWeight: 600,
            fontSize: "11px",
            letterSpacing: "0.02em",
          }}
        >
          <span
            style={{
              width: "6px",
              height: "6px",
              borderRadius: "50%",
              backgroundColor: netConfig.dot,
              display: "inline-block",
            }}
          />
          {netConfig.label}
        </span>

        {/* Closed Ledger Sequence */}
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 600,
            color: "var(--color-text-primary, #111827)",
            fontSize: "12px",
            padding: "1px 4px",
            borderRadius: "4px",
            backgroundColor: isPulsing ? "rgba(99, 102, 241, 0.18)" : "transparent",
            transition: "background-color 0.4s ease",
          }}
        >
          {formattedLedger}
        </span>

        {/* Separator */}
        <span style={{ color: "#D1D5DB", userSelect: "none" }}>|</span>

        {/* Latency Metric */}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "5px",
            fontVariantNumeric: "tabular-nums",
            fontWeight: 500,
            color: "var(--color-text-secondary, #4B5563)",
            fontSize: "12px",
          }}
        >
          <span
            style={{
              width: "7px",
              height: "7px",
              borderRadius: "50%",
              backgroundColor: latencyHealth.color,
              display: "inline-block",
            }}
            title={latencyHealth.label}
          />
          {!compact && <span>{latencyHealth.text}</span>}
        </span>

        {/* Degraded Alert Badge / Icon */}
        {isEffectivelyDegraded && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "3px",
              padding: "2px 6px",
              borderRadius: "4px",
              backgroundColor: "rgba(245, 158, 11, 0.15)",
              color: "#D97706",
              fontSize: "11px",
              fontWeight: 600,
            }}
            title={
              connectionStatus === "polling"
                ? "Persistent WebSocket blocked by corporate proxy; polling fallback active"
                : "Degraded RPC connectivity detected"
            }
          >
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
              <line x1="12" y1="9" x2="12" y2="13" />
              <line x1="12" y1="17" x2="12.01" y2="17" />
            </svg>
            {!compact && <span>Degraded</span>}
          </span>
        )}

        {/* Down Chevron */}
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
          style={{
            transform: popoverOpen ? "rotate(180deg)" : "rotate(0deg)",
            transition: "transform 0.15s ease",
            color: "#9CA3AF",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Expandable Diagnostic Telemetry Popover */}
      {popoverOpen && (
        <div
          id={popoverId}
          ref={popoverRef}
          role="region"
          aria-label="Stellar Network Diagnostic Details"
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            zIndex: 100,
            width: "320px",
            backgroundColor: "var(--color-bg-card, #FFFFFF)",
            border: "1px solid var(--color-border-subtle, #E5E7EB)",
            borderRadius: "12px",
            boxShadow:
              "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            padding: "16px",
            color: "var(--color-text-primary, #1F2937)",
            fontSize: "12px",
          }}
        >
          {/* Header */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "12px",
              borderBottom: "1px solid #F3F4F6",
              paddingBottom: "8px",
            }}
          >
            <span style={{ fontWeight: 700, fontSize: "13px", color: "#111827" }}>
              Network & Node Health
            </span>
            <span
              style={{
                fontSize: "11px",
                padding: "2px 6px",
                borderRadius: "4px",
                backgroundColor: netConfig.bg,
                color: netConfig.text,
                fontWeight: 600,
              }}
            >
              {netConfig.label}
            </span>
          </div>

          {/* Telemetry Metrics Table */}
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#6B7280" }}>Latest Closed Ledger:</span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontWeight: 600,
                  color: "#111827",
                }}
              >
                {latestLedger ? `#${latestLedger.toLocaleString()}` : "Syncing…"}
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#6B7280" }}>RPC Round-Trip:</span>
              <span
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  fontWeight: 600,
                  color: latencyHealth.color,
                }}
              >
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor: latencyHealth.color,
                  }}
                />
                {latencyHealth.text} ({latencyHealth.label})
              </span>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between" }}>
              <span style={{ color: "#6B7280" }}>Feed Transport:</span>
              <span style={{ fontWeight: 500, color: "#374151" }}>
                {connectionStatus === "connected"
                  ? "WebSocket Live Stream"
                  : connectionStatus === "polling"
                  ? "Cursor Polling (Fallback)"
                  : connectionStatus === "reconnecting"
                  ? "Reconnecting…"
                  : connectionStatus === "degraded"
                  ? "Degraded Connectivity"
                  : "Disconnected"}
              </span>
            </div>

            {rpcUrl && (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                  marginTop: "4px",
                }}
              >
                <span style={{ color: "#6B7280" }}>Soroban RPC Endpoint:</span>
                <span
                  style={{
                    fontFamily: "monospace",
                    fontSize: "11px",
                    color: "#4B5563",
                    wordBreak: "break-all",
                    background: "#F9FAFB",
                    padding: "4px 6px",
                    borderRadius: "4px",
                    border: "1px solid #E5E7EB",
                  }}
                >
                  {rpcUrl}
                </span>
              </div>
            )}
          </div>

          {/* Degraded Alert Explanation */}
          {isEffectivelyDegraded && (
            <div
              style={{
                marginTop: "12px",
                padding: "8px 10px",
                backgroundColor: "rgba(245, 158, 11, 0.1)",
                border: "1px solid rgba(245, 158, 11, 0.3)",
                borderRadius: "6px",
                color: "#92400E",
                fontSize: "11px",
                lineHeight: "1.4",
              }}
            >
              {connectionStatus === "polling"
                ? "Corporate proxy or network policy blocked persistent sockets. Gracefully degraded to cursor-based getEvents polling."
                : "Soroban RPC response latency is higher than expected. Submissions may experience minor confirmation delay."}
            </div>
          )}

          {/* Action Row */}
          {onRefresh && (
            <div style={{ marginTop: "12px", paddingTop: "8px", borderTop: "1px solid #F3F4F6" }}>
              <button
                type="button"
                onClick={() => {
                  onRefresh();
                  setPopoverOpen(false);
                }}
                style={{
                  width: "100%",
                  padding: "6px 12px",
                  backgroundColor: "#F3F4F6",
                  border: "1px solid #E5E7EB",
                  borderRadius: "6px",
                  fontSize: "12px",
                  fontWeight: 500,
                  color: "#374151",
                  cursor: "pointer",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: "6px",
                }}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <polyline points="23 4 23 10 17 10" />
                  <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                </svg>
                Retry Stream Connection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default LedgerStatusIndicator;
