/**
 * ArchivedEntryBanner.tsx
 *
 * Dedicated UI state for Soroban Archived Ledger Entries.
 *
 * Background
 * ──────────
 * On Stellar/Soroban every contract storage entry has a Time-To-Live (TTL)
 * measured in ledger closings (~5 s each). When a TTL expires the entry is
 * *archived* — it moves off the hot ledger state into a cold archival layer.
 * No funds are lost, but the entry cannot be read or written until a
 * "restore footprint" transaction re-pays the rent and brings it back live.
 *
 * UX invariants
 * ─────────────
 * • Never use the word "expired" for an archived entry — it implies the
 *   data or funds are gone. Use "archived" or "stored offline".
 * • Never show raw HostError codes as the primary message.
 * • Show an estimated XLM fee before asking the user to sign.
 * • Give a "Learn more" escape hatch to the Stellar docs.
 *
 * Exports
 * ───────
 *   ArchivedEntryBanner   – full banner with restore CTA
 *   ArchivedInlineBadge   – compact badge for use inside a table row or card
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

interface ArchiveTokens {
  bg: string;
  border: string;
  accentBorder: string;
  iconColor: string;
  heading: string;
  body: string;
  muted: string;
  restoreBg: string;
  restoreText: string;
  restoreHoverBg: string;
  badgeBg: string;
  badgeText: string;
  badgeBorder: string;
}

function archiveTokens(dark: boolean): ArchiveTokens {
  return dark
    ? {
        bg: "#0C1A2E",
        border: "#1E3A5F",
        accentBorder: "#2563EB",
        iconColor: "#60A5FA",
        heading: "#DBEAFE",
        body: "#93C5FD",
        muted: "#6B7280",
        restoreBg: "#2563EB",
        restoreText: "#FFFFFF",
        restoreHoverBg: "#1D4ED8",
        badgeBg: "#172554",
        badgeText: "#93C5FD",
        badgeBorder: "#1E40AF",
      }
    : {
        bg: "#EFF6FF",
        border: "#BFDBFE",
        accentBorder: "#2563EB",
        iconColor: "#2563EB",
        heading: "#1E3A8A",
        body: "#1E40AF",
        muted: "#6B7280",
        restoreBg: "#2563EB",
        restoreText: "#FFFFFF",
        restoreHoverBg: "#1D4ED8",
        badgeBg: "#DBEAFE",
        badgeText: "#1E40AF",
        badgeBorder: "#93C5FD",
      };
}

// ---------------------------------------------------------------------------
// Archive box SVG icon
// ---------------------------------------------------------------------------

function ArchiveBoxIcon({ color }: { color: string }) {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      {/* Box lid */}
      <rect x="3" y="4" width="18" height="4" rx="1" />
      {/* Box body */}
      <path d="M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" />
      {/* Latch / handle */}
      <path d="M9 12h6" />
    </svg>
  );
}

function ExternalLinkIcon({ color }: { color: string }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      style={{ flexShrink: 0 }}
    >
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ArchivedEntryBannerProps {
  /**
   * Type of archived entry — used to tailor the heading and body copy.
   * Default "generic".
   */
  entryType?: "payment" | "escrow" | "subscription" | "generic";

  /**
   * Estimated XLM cost to restore this entry.
   * Pass undefined if the fee estimation is still loading.
   */
  estimatedRestoreFeeXlm?: number;

  /**
   * Whether the restore transaction is currently in-flight.
   * Shows a spinner on the button when true.
   */
  restoring?: boolean;

  /**
   * Called when the user clicks "Restore Record".
   * Should trigger a Soroban `restoreFootprint` transaction.
   */
  onRestore?: () => void | Promise<void>;

  /** URL for a "Learn more" link. Defaults to Stellar state archival docs. */
  learnMoreUrl?: string;

  /** Override dark mode for Storybook. */
  dark?: boolean;

  /** Additional container styles. */
  style?: React.CSSProperties;
}

// ---------------------------------------------------------------------------
// Copy helpers
// ---------------------------------------------------------------------------

function entryHeading(type: ArchivedEntryBannerProps["entryType"]): string {
  switch (type) {
    case "payment":      return "This payment record is stored offline";
    case "escrow":       return "This escrow is stored offline";
    case "subscription": return "This subscription is stored offline";
    default:             return "This record is stored offline";
  }
}

function entryBody(type: ArchivedEntryBannerProps["entryType"]): string {
  switch (type) {
    case "payment":
      return "Stellar periodically moves older payment records to cold archival storage to keep the network efficient. Your funds are fully safe and have not moved. Restoring this record brings it back online so you can view the full details or interact with it again.";
    case "escrow":
      return "Stellar periodically moves inactive escrow entries to cold archival storage to keep the network efficient. The locked funds are fully secure and have not moved. Restoring this escrow brings it back online so milestones can be released or disputed.";
    case "subscription":
      return "Stellar periodically moves inactive subscription records to cold archival storage. No payments have been missed or lost. Restoring this record allows the subscription cycle to continue as normal.";
    default:
      return "Stellar periodically moves older ledger entries to cold archival storage to keep the network efficient. Your data and any associated funds are fully safe. Restoring this record re-pays a small ledger rent and brings it back online in one transaction.";
  }
}

// ---------------------------------------------------------------------------
// ArchivedEntryBanner
// ---------------------------------------------------------------------------

/**
 * Full-width banner explaining the Soroban archival state and offering a
 * one-click restore path.
 */
export function ArchivedEntryBanner({
  entryType = "generic",
  estimatedRestoreFeeXlm,
  restoring = false,
  onRestore,
  learnMoreUrl = "https://developers.stellar.org/docs/learn/encyclopedia/storage/state-archival",
  dark: darkOverride,
  style,
}: ArchivedEntryBannerProps) {
  const darkAuto = usePrefersDark();
  const dark = darkOverride ?? darkAuto;
  const tk = archiveTokens(dark);
  const [hovered, setHovered] = useState(false);

  const feeLabel =
    estimatedRestoreFeeXlm === undefined
      ? "Estimating fee…"
      : `~${estimatedRestoreFeeXlm.toFixed(4)} XLM to restore`;

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        display: "flex",
        gap: 14,
        paddingBlock: 16,
        paddingInline: 20,
        background: tk.bg,
        border: `1px solid ${tk.border}`,
        // Accent stripe on the inline-start edge
        borderInlineStart: `4px solid ${tk.accentBorder}`,
        borderRadius: "0 10px 10px 0",
        ...style,
      }}
    >
      {/* Icon */}
      <span style={{ paddingBlockStart: 2 }}>
        <ArchiveBoxIcon color={tk.iconColor} />
      </span>

      {/* Content */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {/* Badge */}
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
            border: `1px solid ${tk.badgeBorder}`,
            borderRadius: 4,
            marginBlockEnd: 7,
          }}
        >
          Archived
        </span>

        {/* Heading */}
        <h4
          style={{
            margin: 0,
            fontSize: 15,
            fontWeight: 600,
            color: tk.heading,
            marginBlockEnd: 6,
          }}
        >
          {entryHeading(entryType)}
        </h4>

        {/* Body */}
        <p
          style={{
            margin: 0,
            fontSize: 13,
            color: tk.body,
            lineHeight: 1.6,
            maxWidth: 640,
            marginBlockEnd: 14,
          }}
        >
          {entryBody(entryType)}
        </p>

        {/* Fee note */}
        <p
          style={{
            margin: "0 0 14px",
            fontSize: 12,
            color: tk.muted,
            fontFamily: "monospace",
          }}
        >
          {feeLabel}
          {estimatedRestoreFeeXlm !== undefined && (
            <span style={{ marginInlineStart: 6, fontFamily: "inherit", fontStyle: "italic" }}>
              — this is ledger rent, not a service fee
            </span>
          )}
        </p>

        {/* Actions */}
        <div style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" }}>
          {onRestore && (
            <button
              type="button"
              onClick={onRestore}
              disabled={restoring || estimatedRestoreFeeXlm === undefined}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => setHovered(false)}
              aria-busy={restoring}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                paddingBlock: 8,
                paddingInline: 18,
                background:
                  restoring || estimatedRestoreFeeXlm === undefined
                    ? (dark ? "#374151" : "#D1D5DB")
                    : hovered
                    ? tk.restoreHoverBg
                    : tk.restoreBg,
                color:
                  restoring || estimatedRestoreFeeXlm === undefined
                    ? (dark ? "#6B7280" : "#9CA3AF")
                    : tk.restoreText,
                border: "none",
                borderRadius: 7,
                fontSize: 13,
                fontWeight: 600,
                cursor:
                  restoring || estimatedRestoreFeeXlm === undefined
                    ? "not-allowed"
                    : "pointer",
                transition: "background 0.15s",
                opacity:
                  restoring || estimatedRestoreFeeXlm === undefined ? 0.6 : 1,
              }}
            >
              {restoring ? (
                <>
                  <SpinnerIcon color={dark ? "#6B7280" : "#9CA3AF"} />
                  Restoring…
                </>
              ) : (
                "Restore Record"
              )}
            </button>
          )}

          <a
            href={learnMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 13,
              color: tk.iconColor,
              textDecoration: "underline",
              fontWeight: 500,
            }}
          >
            What is archival?
            <ExternalLinkIcon color={tk.iconColor} />
          </a>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// SpinnerIcon (used while restoring)
// ---------------------------------------------------------------------------

function SpinnerIcon({ color }: { color: string }) {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth="2.5"
      strokeLinecap="round"
      aria-hidden="true"
      focusable="false"
      style={{ animation: "cgp-spin 0.8s linear infinite", flexShrink: 0 }}
    >
      <style>{`@keyframes cgp-spin { to { transform: rotate(360deg); } }`}</style>
      <circle cx="12" cy="12" r="9" strokeOpacity="0.25" />
      <path d="M12 3a9 9 0 019 9" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// ArchivedInlineBadge — compact variant for table rows / card headers
// ---------------------------------------------------------------------------

export interface ArchivedInlineBadgeProps {
  /** Called when user clicks the badge / restore link. */
  onRestore?: () => void;
  dark?: boolean;
}

/**
 * Compact inline badge that surfaces the archived state inside a table row
 * or detail card header without taking up full-width banner space.
 * Clicking it opens the full ArchivedEntryBanner in a sheet or modal —
 * the caller is responsible for that transition.
 */
export function ArchivedInlineBadge({ onRestore, dark: darkOverride }: ArchivedInlineBadgeProps) {
  const darkAuto = usePrefersDark();
  const dark = darkOverride ?? darkAuto;
  const tk = archiveTokens(dark);

  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.07em",
        textTransform: "uppercase",
        paddingBlock: 2,
        paddingInline: 7,
        background: tk.badgeBg,
        color: tk.badgeText,
        border: `1px solid ${tk.badgeBorder}`,
        borderRadius: 4,
        cursor: onRestore ? "pointer" : "default",
      }}
      role={onRestore ? "button" : undefined}
      tabIndex={onRestore ? 0 : undefined}
      onClick={onRestore}
      onKeyDown={
        onRestore
          ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onRestore(); } }
          : undefined
      }
      aria-label={onRestore ? "Archived — click to restore" : "Archived"}
    >
      <ArchiveBoxIcon color={tk.iconColor} />
      Archived
      {onRestore && (
        <span style={{ color: tk.iconColor, fontSize: 10, marginInlineStart: 2 }}>
          Restore →
        </span>
      )}
    </span>
  );
}
