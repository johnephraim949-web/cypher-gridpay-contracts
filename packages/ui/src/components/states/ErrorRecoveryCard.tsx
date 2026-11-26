/**
 * ErrorRecoveryCard.tsx
 *
 * Structured error recovery UI for Cypher GridPay.
 *
 * Design invariants (issue #418)
 * ───────────────────────────────
 * • NEVER show raw HostError codes (e.g. "HostError: Error(Contract, #104)")
 *   as the primary user-facing message.
 * • Every error maps to a human-readable heading, a plain-English explanation,
 *   and — where possible — a concrete remediation action.
 * • Distinguish retryable vs. non-retryable errors:
 *     Retryable    — transient network/RPC issue: "Try again"
 *     NonRetryable — contract invariant violated: different action or contact
 * • The raw diagnostic code is available but hidden behind "Show details"
 *   to assist support, not to confuse users.
 *
 * Error catalogue
 * ───────────────
 * GridPay uses structured multi-enum error codes:
 *   100–132  BasicError     (admin, auth, rate limits)
 *   200–236  PaymentError   (payment lifecycle)
 *   300–323  SubscriptionError
 *   400–406  ProposalError  (multisig)
 *   500–542  FeatureError   (escrow bridge, channels, splits)
 *   Network  RPC/simulation errors from the Stellar SDK
 *
 * Exports
 * ───────
 *   ErrorRecoveryCard       – main component, takes a GridPayError
 *   parseGridPayError       – maps raw error to a GridPayError descriptor
 *   GRIDPAY_ERROR_CATALOGUE – full error → copy mapping (tree-shakeable)
 *
 * Issue: #418
 */

import React, { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Error domain types
// ---------------------------------------------------------------------------

export type ErrorSeverity = "critical" | "warning" | "info";
export type ErrorRetryability = "retryable" | "non-retryable" | "unknown";

/** Fully decoded error descriptor. */
export interface GridPayError {
  /** Short human-readable title shown as the card heading. */
  title: string;
  /** One or two sentence plain-English explanation. No jargon, no codes. */
  explanation: string;
  /** What the user should do next. */
  remediation: string;
  /** Category — drives colour scheme. */
  severity: ErrorSeverity;
  /** Whether retrying the same action is likely to succeed. */
  retryability: ErrorRetryability;
  /** Label for the primary action button. */
  primaryActionLabel?: string;
  /** Raw diagnostic code shown in the collapsed detail panel. */
  diagnosticCode?: string;
  /** Category tag shown in the badge. */
  category?: string;
}

// ---------------------------------------------------------------------------
// Error catalogue
// ---------------------------------------------------------------------------

/** Maps numeric contract error codes to human-readable descriptors. */
export const GRIDPAY_ERROR_CATALOGUE: Record<number, GridPayError> = {
  // ── BasicError ────────────────────────────────────────────────────────────
  100: {
    title: "Authentication required",
    explanation: "This action requires admin permission. Make sure you're connected with an authorised admin wallet.",
    remediation: "Reconnect with an admin-authorised wallet and try again.",
    severity: "critical",
    retryability: "non-retryable",
    primaryActionLabel: "Reconnect wallet",
    category: "Auth",
  },
  106: {
    title: "Too many requests",
    explanation: "You've sent too many transactions in a short window. The protocol imposes rate limits to protect network stability.",
    remediation: "Wait a few minutes before trying again.",
    severity: "warning",
    retryability: "retryable",
    primaryActionLabel: "Try again later",
    category: "Rate limit",
  },
  116: {
    title: "Contract is paused",
    explanation: "Cypher GridPay is temporarily paused for maintenance or a safety review. No funds are at risk.",
    remediation: "Check the status banner at the top of the page for an estimated resumption time.",
    severity: "critical",
    retryability: "retryable",
    primaryActionLabel: "Check status",
    category: "Protocol",
  },
  121: {
    title: "Invalid amount",
    explanation: "The payment amount entered is zero, negative, or not a valid number.",
    remediation: "Enter a positive amount and try again.",
    severity: "warning",
    retryability: "non-retryable",
    primaryActionLabel: "Edit amount",
    category: "Validation",
  },
  129: {
    title: "Reentrant call blocked",
    explanation: "A second transaction attempted to execute before the first completed. This is a safety guard.",
    remediation: "Wait for the current transaction to finalise on-chain, then retry.",
    severity: "warning",
    retryability: "retryable",
    primaryActionLabel: "Retry",
    category: "Security",
  },

  // ── PaymentError ──────────────────────────────────────────────────────────
  200: {
    title: "Payment not found",
    explanation: "No payment with this ID exists on the current network. It may belong to a different account or network.",
    remediation: "Verify the payment ID and check that your wallet is on the correct Stellar network.",
    severity: "warning",
    retryability: "non-retryable",
    category: "Payment",
  },
  201: {
    title: "Invalid payment status",
    explanation: "This action cannot be performed because the payment is in an incompatible state (for example, trying to refund a pending payment).",
    remediation: "Check the payment status and use the correct action for its current state.",
    severity: "warning",
    retryability: "non-retryable",
    category: "Payment",
  },
  202: {
    title: "Payment already processed",
    explanation: "This payment has already been completed or cancelled. No further action is needed.",
    remediation: "Review the payment history to confirm the transaction was processed correctly.",
    severity: "info",
    retryability: "non-retryable",
    category: "Payment",
  },
  203: {
    title: "Payment expired",
    explanation: "The payment window closed before the transaction was completed. The hold has been released back to your wallet.",
    remediation: "Create a new payment to try again.",
    severity: "warning",
    retryability: "non-retryable",
    primaryActionLabel: "Create new payment",
    category: "Payment",
  },
  206: {
    title: "Token transfer failed",
    explanation: "The token could not be transferred. This usually means insufficient balance or a missing trustline.",
    remediation: "Check your USDC balance and ensure the trustline is active, then retry.",
    severity: "critical",
    retryability: "retryable",
    primaryActionLabel: "Check balance",
    category: "Payment",
  },
  224: {
    title: "Token not allowed",
    explanation: "The token you selected is not on the protocol whitelist for this contract.",
    remediation: "Use an approved token such as USDC or XLM, or contact support if you believe this is an error.",
    severity: "warning",
    retryability: "non-retryable",
    category: "Payment",
  },
  230: {
    title: "Pre-authorisation not found",
    explanation: "No active payment hold with this ID was found. It may have already been captured or voided.",
    remediation: "Check the hold ID and status before retrying.",
    severity: "warning",
    retryability: "non-retryable",
    category: "Pre-auth",
  },
  233: {
    title: "Pre-authorisation expired",
    explanation: "The payment hold window passed before the merchant captured funds. The locked amount has been returned to your wallet.",
    remediation: "If you still need to proceed, ask the merchant to create a new authorisation.",
    severity: "warning",
    retryability: "non-retryable",
    category: "Pre-auth",
  },
  235: {
    title: "Capture amount exceeds hold",
    explanation: "The merchant tried to capture more than the original authorised amount. This is not permitted.",
    remediation: "Contact the merchant — the captured amount must be equal to or less than the original hold.",
    severity: "critical",
    retryability: "non-retryable",
    category: "Pre-auth",
  },

  // ── SubscriptionError ─────────────────────────────────────────────────────
  300: {
    title: "Subscription not found",
    explanation: "No subscription with this ID exists. It may have been cancelled or created on a different account.",
    remediation: "Verify the subscription ID and check the connected wallet.",
    severity: "warning",
    retryability: "non-retryable",
    category: "Subscription",
  },
  303: {
    title: "Too many failed retries",
    explanation: "The subscription has exhausted its automatic retry attempts after a failed payment.",
    remediation: "Update your payment method and contact support to reactivate the subscription.",
    severity: "critical",
    retryability: "non-retryable",
    primaryActionLabel: "Contact support",
    category: "Subscription",
  },

  // ── ProposalError ─────────────────────────────────────────────────────────
  404: {
    title: "Multi-signature required",
    explanation: "This action exceeds the single-admin threshold and requires approval from multiple admins.",
    remediation: "Submit a proposal and collect the required admin signatures before executing.",
    severity: "warning",
    retryability: "non-retryable",
    primaryActionLabel: "Open proposals",
    category: "Governance",
  },
  405: {
    title: "Insufficient approvals",
    explanation: "The proposal does not yet have enough admin signatures to execute.",
    remediation: "Share the proposal with other admins and wait for the required number of approvals.",
    severity: "warning",
    retryability: "retryable",
    primaryActionLabel: "View proposal",
    category: "Governance",
  },

  // ── FeatureError ──────────────────────────────────────────────────────────
  502: {
    title: "Fee configuration missing",
    explanation: "The protocol fee settings have not been configured for this contract.",
    remediation: "An admin must configure fee settings before payments can be processed.",
    severity: "critical",
    retryability: "non-retryable",
    primaryActionLabel: "Open admin panel",
    category: "Config",
  },
  513: {
    title: "Invalid signature",
    explanation: "The cryptographic signature provided does not match the expected value for this operation.",
    remediation: "Re-sign the transaction with your connected wallet and try again.",
    severity: "critical",
    retryability: "retryable",
    primaryActionLabel: "Retry",
    category: "Security",
  },
  527: {
    title: "Spend limit exceeded",
    explanation: "This transaction would take your spending over the configured daily or monthly limit.",
    remediation: "Wait for the limit period to reset, or contact an admin to adjust the limit.",
    severity: "warning",
    retryability: "non-retryable",
    category: "Limits",
  },
};

/** Fallback for unknown contract error codes. */
const UNKNOWN_ERROR: GridPayError = {
  title: "An unexpected error occurred",
  explanation: "Something went wrong while processing this request. The issue has been logged.",
  remediation: "Try again. If the problem persists, contact GridPay support with the diagnostic code shown below.",
  severity: "critical",
  retryability: "unknown",
  primaryActionLabel: "Try again",
  category: "Unknown",
};

/** Network / RPC error descriptors (not numeric contract codes). */
const NETWORK_ERROR: GridPayError = {
  title: "Network connection issue",
  explanation: "Unable to reach the Stellar network right now. This is usually a temporary connectivity problem.",
  remediation: "Check your internet connection and try again in a moment.",
  severity: "warning",
  retryability: "retryable",
  primaryActionLabel: "Retry",
  category: "Network",
  diagnosticCode: "RPC_TIMEOUT",
};

const SIMULATION_ERROR: GridPayError = {
  title: "Transaction simulation failed",
  explanation: "Stellar simulated the transaction before sending and found a problem. No funds were moved.",
  remediation: "Review the transaction parameters and try again. If the issue continues, the diagnostic code below may help support identify the cause.",
  severity: "warning",
  retryability: "retryable",
  primaryActionLabel: "Edit and retry",
  category: "Simulation",
};

// ---------------------------------------------------------------------------
// parseGridPayError
// ---------------------------------------------------------------------------

export type RawError =
  | { type: "contract"; code: number; raw?: string }
  | { type: "network"; raw?: string }
  | { type: "simulation"; raw?: string }
  | { type: "unknown"; raw?: string };

/**
 * Maps a raw Soroban / Stellar SDK error to a fully decoded `GridPayError`.
 *
 * Usage:
 *   const descriptor = parseGridPayError({ type: 'contract', code: 206, raw: 'HostError: Error(Contract, #206)' });
 */
export function parseGridPayError(err: RawError): GridPayError {
  if (err.type === "network") {
    return { ...NETWORK_ERROR, diagnosticCode: err.raw ?? "RPC_ERROR" };
  }
  if (err.type === "simulation") {
    return { ...SIMULATION_ERROR, diagnosticCode: err.raw ?? "SIM_FAILED" };
  }
  if (err.type === "contract") {
    const base = GRIDPAY_ERROR_CATALOGUE[err.code] ?? UNKNOWN_ERROR;
    return {
      ...base,
      // Always include the raw code in diagnosticCode so support can reference it,
      // but it is hidden behind "Show details" in the UI.
      diagnosticCode: err.raw ?? `Contract error #${err.code}`,
    };
  }
  return { ...UNKNOWN_ERROR, diagnosticCode: err.raw ?? "UNKNOWN" };
}

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const h = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", h);
    return () => mq.removeEventListener("change", h);
  }, []);
  return dark;
}

interface ErrorTokens {
  bg: string;
  accentBorder: string;
  badgeBg: string;
  badgeText: string;
  headingColor: string;
  bodyColor: string;
  mutedColor: string;
  primaryBg: string;
  primaryHoverBg: string;
  primaryText: string;
  codeBlockBg: string;
  codeBlockText: string;
  border: string;
}

function errorTokens(severity: ErrorSeverity, dark: boolean): ErrorTokens {
  if (severity === "critical") {
    return dark
      ? { bg: "#450A0A", accentBorder: "#F87171", badgeBg: "#7F1D1D", badgeText: "#FEE2E2", headingColor: "#FEE2E2", bodyColor: "#FECACA", mutedColor: "#9CA3AF", primaryBg: "#EF4444", primaryHoverBg: "#DC2626", primaryText: "#FFFFFF", codeBlockBg: "#111827", codeBlockText: "#9CA3AF", border: "#7F1D1D" }
      : { bg: "#FEF2F2", accentBorder: "#EF4444", badgeBg: "#FEE2E2", badgeText: "#7F1D1D", headingColor: "#7F1D1D", bodyColor: "#991B1B", mutedColor: "#6B7280", primaryBg: "#EF4444", primaryHoverBg: "#DC2626", primaryText: "#FFFFFF", codeBlockBg: "#F9FAFB", codeBlockText: "#374151", border: "#FCA5A5" };
  }
  if (severity === "warning") {
    return dark
      ? { bg: "#422006", accentBorder: "#F59E0B", badgeBg: "#713F12", badgeText: "#FEF3C7", headingColor: "#FEF3C7", bodyColor: "#FDE68A", mutedColor: "#9CA3AF", primaryBg: "#D97706", primaryHoverBg: "#B45309", primaryText: "#FFFFFF", codeBlockBg: "#111827", codeBlockText: "#9CA3AF", border: "#713F12" }
      : { bg: "#FEFCE8", accentBorder: "#EAB308", badgeBg: "#FEF9C3", badgeText: "#713F12", headingColor: "#713F12", bodyColor: "#92400E", mutedColor: "#6B7280", primaryBg: "#D97706", primaryHoverBg: "#B45309", primaryText: "#FFFFFF", codeBlockBg: "#F9FAFB", codeBlockText: "#374151", border: "#FDE047" };
  }
  // info
  return dark
    ? { bg: "#0C1A2E", accentBorder: "#3B82F6", badgeBg: "#172554", badgeText: "#BFDBFE", headingColor: "#DBEAFE", bodyColor: "#93C5FD", mutedColor: "#6B7280", primaryBg: "#2563EB", primaryHoverBg: "#1D4ED8", primaryText: "#FFFFFF", codeBlockBg: "#111827", codeBlockText: "#9CA3AF", border: "#1E3A5F" }
    : { bg: "#EFF6FF", accentBorder: "#3B82F6", badgeBg: "#DBEAFE", badgeText: "#1E40AF", headingColor: "#1E3A8A", bodyColor: "#1E40AF", mutedColor: "#6B7280", primaryBg: "#2563EB", primaryHoverBg: "#1D4ED8", primaryText: "#FFFFFF", codeBlockBg: "#F9FAFB", codeBlockText: "#374151", border: "#BFDBFE" };
}

// ---------------------------------------------------------------------------
// SVG icons
// ---------------------------------------------------------------------------

function AlertIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function InfoIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  );
}

function ChevronDown({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronUp({ color }: { color: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ErrorRecoveryCard
// ---------------------------------------------------------------------------

export interface ErrorRecoveryCardProps {
  /** Pre-parsed error descriptor. Use `parseGridPayError` to produce this. */
  error: GridPayError;
  /**
   * Called when the user clicks the primary action button.
   * For retryable errors this is "Retry"; for others it may be
   * "Contact support", "Edit amount", etc.
   */
  onPrimaryAction?: () => void;
  /**
   * Called when the user clicks the optional secondary action
   * (e.g. "Go back" or "Contact support").
   */
  onSecondaryAction?: () => void;
  /** Label for secondary action button. */
  secondaryActionLabel?: string;
  /** Override dark mode for Storybook. */
  dark?: boolean;
  /** Additional container styles. */
  style?: React.CSSProperties;
}

export function ErrorRecoveryCard({
  error,
  onPrimaryAction,
  onSecondaryAction,
  secondaryActionLabel,
  dark: darkOverride,
  style,
}: ErrorRecoveryCardProps) {
  const darkAuto = usePrefersDark();
  const dark = darkOverride ?? darkAuto;
  const tk = errorTokens(error.severity, dark);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [primaryHovered, setPrimaryHovered] = useState(false);

  const SeverityIcon = error.severity === "info" ? InfoIcon : AlertIcon;
  const detailsId = `err-details-${Math.random().toString(36).slice(2, 8)}`;

  return (
    <div
      role="alert"
      aria-live="assertive"
      aria-atomic="true"
      style={{
        display: "flex",
        gap: 14,
        paddingBlock: 16,
        paddingInline: 20,
        background: tk.bg,
        border: `1px solid ${tk.border}`,
        borderInlineStart: `4px solid ${tk.accentBorder}`,
        borderRadius: "0 10px 10px 0",
        ...style,
      }}
    >
      {/* Severity icon */}
      <span style={{ paddingBlockStart: 2 }}>
        <SeverityIcon color={tk.accentBorder} />
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Category badge */}
        {error.category && (
          <span
            style={{
              display: "inline-block",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              paddingBlock: 2,
              paddingInline: 7,
              background: tk.badgeBg,
              color: tk.badgeText,
              borderRadius: 4,
              marginBlockEnd: 7,
            }}
          >
            {error.category}
            {error.retryability === "retryable" && (
              <span style={{ marginInlineStart: 5, opacity: 0.7 }}>· Retryable</span>
            )}
            {error.retryability === "non-retryable" && (
              <span style={{ marginInlineStart: 5, opacity: 0.7 }}>· Requires action</span>
            )}
          </span>
        )}

        {/* Heading */}
        <h4
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: tk.headingColor,
            marginBlockEnd: 6,
          }}
        >
          {error.title}
        </h4>

        {/* Plain-English explanation */}
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: tk.bodyColor,
            lineHeight: 1.6,
            marginBlockEnd: 8,
          }}
        >
          {error.explanation}
        </p>

        {/* Remediation */}
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 13,
            color: tk.bodyColor,
            lineHeight: 1.5,
            fontStyle: "italic",
          }}
        >
          {error.remediation}
        </p>

        {/* Action buttons */}
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            alignItems: "center",
            marginBlockEnd: error.diagnosticCode ? 12 : 0,
          }}
        >
          {onPrimaryAction && error.primaryActionLabel && (
            <button
              type="button"
              onClick={onPrimaryAction}
              onMouseEnter={() => setPrimaryHovered(true)}
              onMouseLeave={() => setPrimaryHovered(false)}
              style={{
                paddingBlock: 7,
                paddingInline: 18,
                background: primaryHovered ? tk.primaryHoverBg : tk.primaryBg,
                color: tk.primaryText,
                border: "none",
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 0.15s",
              }}
            >
              {error.primaryActionLabel}
            </button>
          )}

          {onSecondaryAction && secondaryActionLabel && (
            <button
              type="button"
              onClick={onSecondaryAction}
              style={{
                paddingBlock: 7,
                paddingInline: 14,
                background: "none",
                border: "none",
                color: tk.accentBorder,
                fontSize: 13,
                fontWeight: 500,
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              {secondaryActionLabel}
            </button>
          )}
        </div>

        {/* Collapsible diagnostic details */}
        {error.diagnosticCode && (
          <div>
            <button
              type="button"
              onClick={() => setDetailsOpen((o) => !o)}
              aria-expanded={detailsOpen}
              aria-controls={detailsId}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 5,
                background: "none",
                border: "none",
                cursor: "pointer",
                color: tk.mutedColor,
                fontSize: 12,
                fontWeight: 500,
                paddingBlock: 0,
                paddingInline: 0,
              }}
            >
              {detailsOpen ? (
                <ChevronUp color={tk.mutedColor} />
              ) : (
                <ChevronDown color={tk.mutedColor} />
              )}
              {detailsOpen ? "Hide details" : "Show diagnostic details"}
            </button>

            <div
              id={detailsId}
              hidden={!detailsOpen}
              style={{ marginBlockStart: 8 }}
            >
              {/* Explicit instruction to never share raw codes publicly */}
              <p
                style={{
                  margin: "0 0 6px",
                  fontSize: 11,
                  color: tk.mutedColor,
                  fontStyle: "italic",
                }}
              >
                Share this code with GridPay support when reporting the issue.
              </p>
              <code
                style={{
                  display: "block",
                  padding: "8px 12px",
                  background: tk.codeBlockBg,
                  color: tk.codeBlockText,
                  fontSize: 12,
                  fontFamily: "ui-monospace, 'SF Mono', Menlo, monospace",
                  borderRadius: 5,
                  wordBreak: "break-all",
                  userSelect: "all",
                }}
                // dir="ltr" so hex / code strings don't reorder in RTL docs
                dir="ltr"
              >
                {error.diagnosticCode}
              </code>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Convenience wrapper — takes a RawError directly
// ---------------------------------------------------------------------------

export interface RawErrorRecoveryCardProps extends Omit<ErrorRecoveryCardProps, "error"> {
  rawError: RawError;
}

/**
 * Convenience wrapper: pass the raw Soroban SDK error and it decodes it
 * automatically before rendering `ErrorRecoveryCard`.
 */
export function RawErrorRecoveryCard({ rawError, ...rest }: RawErrorRecoveryCardProps) {
  const error = parseGridPayError(rawError);
  return <ErrorRecoveryCard error={error} {...rest} />;
}
