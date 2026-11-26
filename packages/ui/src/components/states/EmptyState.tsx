/**
 * EmptyState.tsx
 *
 * Contextual empty-state cards for the Cypher GridPay UI.
 *
 * Every empty state has four parts:
 *   1. An illustrative icon (SVG, never an img tag so it scales with theme)
 *   2. A concise heading that names *what* is empty
 *   3. One-sentence explanation + optional secondary copy
 *   4. Primary action button + optional secondary link
 *
 * Pre-built variants cover the most common Soroban app surfaces.
 * Use `EmptyState` directly for one-off cases.
 *
 * Exports
 * ───────
 *   EmptyState              – generic base, fully configurable
 *   NoEscrowsEmptyState     – "No escrows yet"
 *   NoPaymentsEmptyState    – "No payments yet"
 *   FilteredEmptyState      – "No matches for current filters"
 *   SearchEmptyState        – "No results for '<query>'"
 *   NoTransactionHistory    – "No transaction history"
 *
 * Issue: #418
 */

import React, { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Dark-mode hook
// ---------------------------------------------------------------------------

function usePrefersDark(): boolean {
  const [dark, setDark] = useState(() =>
    typeof window !== "undefined"
      ? window.matchMedia("(prefers-color-scheme: dark)").matches
      : false
  );
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = (e: MediaQueryListEvent) => setDark(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return dark;
}

// ---------------------------------------------------------------------------
// Theme tokens
// ---------------------------------------------------------------------------

interface EmptyTokens {
  bg: string;
  border: string;
  iconBg: string;
  iconStroke: string;
  heading: string;
  body: string;
  primaryBg: string;
  primaryText: string;
  primaryHoverBg: string;
  secondaryColor: string;
}

function emptyTokens(dark: boolean): EmptyTokens {
  return dark
    ? {
        bg: "#111827",
        border: "#374151",
        iconBg: "#1F2937",
        iconStroke: "#6B7280",
        heading: "#F9FAFB",
        body: "#9CA3AF",
        primaryBg: "#2563EB",
        primaryText: "#FFFFFF",
        primaryHoverBg: "#1D4ED8",
        secondaryColor: "#60A5FA",
      }
    : {
        bg: "#FFFFFF",
        border: "#E5E7EB",
        iconBg: "#F3F4F6",
        iconStroke: "#9CA3AF",
        heading: "#111827",
        body: "#6B7280",
        primaryBg: "#2563EB",
        primaryText: "#FFFFFF",
        primaryHoverBg: "#1D4ED8",
        secondaryColor: "#2563EB",
      };
}

// ---------------------------------------------------------------------------
// SVG icons — inline so they respond to dark/light tokens
// ---------------------------------------------------------------------------

function EscrowIcon({ stroke, bg }: { stroke: string; bg: string }) {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill={bg} />
      <rect x="13" y="14" width="22" height="20" rx="3" stroke={stroke} strokeWidth="1.8" />
      <path d="M13 20h22" stroke={stroke} strokeWidth="1.8" />
      <path d="M18 27h4M26 27h4M18 31h4M26 31h4" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function PaymentIcon({ stroke, bg }: { stroke: string; bg: string }) {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill={bg} />
      <rect x="10" y="17" width="28" height="18" rx="3" stroke={stroke} strokeWidth="1.8" />
      <path d="M10 23h28" stroke={stroke} strokeWidth="1.8" />
      <circle cx="18" cy="30" r="2" fill={stroke} />
    </svg>
  );
}

function FilterIcon({ stroke, bg }: { stroke: string; bg: string }) {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill={bg} />
      <path d="M13 17h22M17 24h14M21 31h6" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function SearchIcon({ stroke, bg }: { stroke: string; bg: string }) {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill={bg} />
      <circle cx="22" cy="22" r="7" stroke={stroke} strokeWidth="1.8" />
      <path d="M27 27l5 5" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function HistoryIcon({ stroke, bg }: { stroke: string; bg: string }) {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill={bg} />
      <circle cx="24" cy="24" r="9" stroke={stroke} strokeWidth="1.8" />
      <path d="M24 19v5l3 3" stroke={stroke} strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function GenericIcon({ stroke, bg }: { stroke: string; bg: string }) {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none" aria-hidden="true" focusable="false">
      <circle cx="24" cy="24" r="22" fill={bg} />
      <path d="M24 16v8M24 28v2" stroke={stroke} strokeWidth="2" strokeLinecap="round" />
      <circle cx="24" cy="24" r="12" stroke={stroke} strokeWidth="1.5" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// EmptyState — base component
// ---------------------------------------------------------------------------

export interface EmptyStateAction {
  label: string;
  onClick: () => void;
  /** If true, renders as a text link instead of a filled button. */
  variant?: "primary" | "secondary";
}

export interface EmptyStateProps {
  /** The illustration / icon node. If omitted a default grey circle is used. */
  icon?: React.ReactNode;
  /** Short heading, e.g. "No escrows yet". */
  heading: string;
  /** One-sentence clarification. Keep under 120 characters. */
  body: string;
  /** Optional secondary copy beneath the body. */
  secondaryCopy?: string;
  /** Primary and optionally secondary actions. */
  actions?: EmptyStateAction[];
  /** Override dark mode (useful in Storybook). */
  dark?: boolean;
  /** Additional container styles. */
  style?: React.CSSProperties;
}

export function EmptyState({
  icon,
  heading,
  body,
  secondaryCopy,
  actions = [],
  dark: darkOverride,
  style,
}: EmptyStateProps) {
  const darkAuto = usePrefersDark();
  const dark = darkOverride ?? darkAuto;
  const tk = emptyTokens(dark);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  const defaultIcon = <GenericIcon stroke={tk.iconStroke} bg={tk.iconBg} />;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        paddingBlock: "40px",
        paddingInline: "24px",
        background: tk.bg,
        border: `1px solid ${tk.border}`,
        borderRadius: 12,
        ...style,
      }}
    >
      {/* Icon */}
      <div style={{ marginBlockEnd: 20 }}>{icon ?? defaultIcon}</div>

      {/* Heading */}
      <h3
        style={{
          margin: 0,
          fontSize: 17,
          fontWeight: 600,
          color: tk.heading,
          marginBlockEnd: 8,
        }}
      >
        {heading}
      </h3>

      {/* Body */}
      <p
        style={{
          margin: 0,
          fontSize: 14,
          color: tk.body,
          lineHeight: 1.6,
          maxWidth: 420,
          marginBlockEnd: secondaryCopy ? 6 : 0,
        }}
      >
        {body}
      </p>

      {/* Optional secondary copy */}
      {secondaryCopy && (
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: tk.body,
            lineHeight: 1.5,
            maxWidth: 380,
            opacity: 0.8,
          }}
        />
      )}

      {/* Actions */}
      {actions.length > 0 && (
        <div
          style={{
            display: "flex",
            gap: 10,
            flexWrap: "wrap",
            justifyContent: "center",
            marginBlockStart: 24,
          }}
        >
          {actions.map((action, i) => {
            const isPrimary = !action.variant || action.variant === "primary";
            return (
              <button
                key={i}
                type="button"
                onClick={action.onClick}
                onMouseEnter={() => setHoveredIndex(i)}
                onMouseLeave={() => setHoveredIndex(null)}
                style={
                  isPrimary
                    ? {
                        paddingBlock: 9,
                        paddingInline: 20,
                        background:
                          hoveredIndex === i ? tk.primaryHoverBg : tk.primaryBg,
                        color: tk.primaryText,
                        border: "none",
                        borderRadius: 7,
                        fontSize: 14,
                        fontWeight: 600,
                        cursor: "pointer",
                        transition: "background 0.15s",
                      }
                    : {
                        paddingBlock: 9,
                        paddingInline: 16,
                        background: "none",
                        border: "none",
                        color: tk.secondaryColor,
                        fontSize: 14,
                        fontWeight: 500,
                        cursor: "pointer",
                        textDecoration: "underline",
                      }
                }
              >
                {action.label}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Pre-built variants
// ---------------------------------------------------------------------------

/** "No escrows yet — Create your first milestone escrow" */
export function NoEscrowsEmptyState({
  onCreateEscrow,
  onLearnMore,
  dark,
}: {
  onCreateEscrow?: () => void;
  onLearnMore?: () => void;
  dark?: boolean;
}) {
  const darkAuto = usePrefersDark();
  const d = dark ?? darkAuto;
  const tk = emptyTokens(d);

  return (
    <EmptyState
      dark={d}
      icon={<EscrowIcon stroke={tk.iconStroke} bg={tk.iconBg} />}
      heading="No escrows yet"
      body="Milestone escrows let you release funds only when agreed conditions are met — protecting both merchant and customer."
      actions={[
        ...(onCreateEscrow
          ? [{ label: "Create your first escrow", onClick: onCreateEscrow }]
          : []),
        ...(onLearnMore
          ? [{ label: "How escrows work", onClick: onLearnMore, variant: "secondary" as const }]
          : []),
      ]}
    />
  );
}

/** "No payments yet" */
export function NoPaymentsEmptyState({
  onCreatePayment,
  dark,
}: {
  onCreatePayment?: () => void;
  dark?: boolean;
}) {
  const darkAuto = usePrefersDark();
  const d = dark ?? darkAuto;
  const tk = emptyTokens(d);

  return (
    <EmptyState
      dark={d}
      icon={<PaymentIcon stroke={tk.iconStroke} bg={tk.iconBg} />}
      heading="No payments yet"
      body="Payments you send or receive will appear here with their on-chain status."
      actions={
        onCreatePayment
          ? [{ label: "Make a payment", onClick: onCreatePayment }]
          : []
      }
    />
  );
}

/** "No matches for current filters — Clear filters" */
export function FilteredEmptyState({
  onClearFilters,
  dark,
}: {
  onClearFilters?: () => void;
  dark?: boolean;
}) {
  const darkAuto = usePrefersDark();
  const d = dark ?? darkAuto;
  const tk = emptyTokens(d);

  return (
    <EmptyState
      dark={d}
      icon={<FilterIcon stroke={tk.iconStroke} bg={tk.iconBg} />}
      heading="No matches for current filters"
      body="Try adjusting or removing the active filters to see more records."
      actions={
        onClearFilters
          ? [{ label: "Clear filters", onClick: onClearFilters }]
          : []
      }
    />
  );
}

/** "No results for '<query>'" */
export function SearchEmptyState({
  query,
  onClearSearch,
  dark,
}: {
  query: string;
  onClearSearch?: () => void;
  dark?: boolean;
}) {
  const darkAuto = usePrefersDark();
  const d = dark ?? darkAuto;
  const tk = emptyTokens(d);
  const displayQuery = query.length > 32 ? `${query.slice(0, 32)}…` : query;

  return (
    <EmptyState
      dark={d}
      icon={<SearchIcon stroke={tk.iconStroke} bg={tk.iconBg} />}
      heading={`No results for "${displayQuery}"`}
      body="Check the spelling, or try a broader search term like a partial address or amount."
      actions={
        onClearSearch
          ? [{ label: "Clear search", onClick: onClearSearch }]
          : []
      }
    />
  );
}

/** "No transaction history" */
export function NoTransactionHistory({
  onRefresh,
  dark,
}: {
  onRefresh?: () => void;
  dark?: boolean;
}) {
  const darkAuto = usePrefersDark();
  const d = dark ?? darkAuto;
  const tk = emptyTokens(d);

  return (
    <EmptyState
      dark={d}
      icon={<HistoryIcon stroke={tk.iconStroke} bg={tk.iconBg} />}
      heading="No transaction history"
      body="Completed payments and escrow releases will appear here once they are confirmed on the Stellar network."
      actions={
        onRefresh
          ? [
              {
                label: "Refresh",
                onClick: onRefresh,
                variant: "secondary" as const,
              },
            ]
          : []
      }
    />
  );
}
