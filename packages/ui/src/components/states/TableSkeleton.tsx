/**
 * TableSkeleton.tsx
 *
 * Shape-matched shimmer skeleton loaders for the Cypher GridPay UI.
 *
 * Prevents Cumulative Layout Shift (CLS) by holding the exact dimensions of
 * the real content before data arrives. Screen-reader friendly:
 *   - A single aria-busy="true" / aria-label="Loading…" container
 *     announces the loading state once.
 *   - All shimmer placeholder nodes are aria-hidden="true" so they are
 *     invisible to assistive technology.
 *
 * Exports
 * ───────
 *   SkeletonBase          – primitive shimmer rect, all others build on this
 *   KpiCardSkeleton       – single KPI tile (label + big number + delta badge)
 *   KpiCardGridSkeleton   – 1–4 KPI tiles side by side
 *   PaymentTableSkeleton  – n-row payment / transaction table
 *   EscrowTimelineSkeleton– vertical milestone timeline
 *   DetailHeaderSkeleton  – page-header with avatar / title / meta row
 *
 * Issue: #418
 */

import React, { useEffect, useState } from "react";

// ---------------------------------------------------------------------------
// Dark-mode hook (self-contained so this file has no peer dependencies)
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

interface ShimmerTokens {
  bg: string;      // base colour of the shimmer track
  highlight: string; // lighter colour at the peak of the animation
  border: string;
  cardBg: string;
}

function shimmerTokens(dark: boolean): ShimmerTokens {
  return dark
    ? { bg: "#1F2937", highlight: "#374151", border: "#374151", cardBg: "#111827" }
    : { bg: "#E5E7EB", highlight: "#F3F4F6", border: "#E5E7EB", cardBg: "#FFFFFF" };
}

// ---------------------------------------------------------------------------
// Global keyframe (injected once per document)
// ---------------------------------------------------------------------------

const KEYFRAME_ID = "cgp-skeleton-keyframe";

function ensureKeyframe() {
  if (typeof document === "undefined") return;
  if (document.getElementById(KEYFRAME_ID)) return;
  const style = document.createElement("style");
  style.id = KEYFRAME_ID;
  style.textContent = `
    @keyframes cgp-shimmer {
      0%   { background-position: -400px 0; }
      100% { background-position: 400px 0;  }
    }
  `;
  document.head.appendChild(style);
}

// ---------------------------------------------------------------------------
// SkeletonBase — the primitive
// ---------------------------------------------------------------------------

export interface SkeletonBaseProps {
  /** Width in CSS units, e.g. "100%", "120px". Default "100%". */
  width?: string | number;
  /** Height in CSS units. Default 16. */
  height?: string | number;
  /** Border radius. Default 4. */
  radius?: string | number;
  /** Additional inline styles. */
  style?: React.CSSProperties;
}

/**
 * A single shimmer rectangle. All skeleton shapes are composed from this.
 *
 * Marked aria-hidden="true" — the parent container carries the ARIA
 * announcement so screen readers are not spammed with empty nodes.
 */
export function SkeletonBase({ width = "100%", height = 16, radius = 4, style }: SkeletonBaseProps) {
  const dark = usePrefersDark();
  const tk = shimmerTokens(dark);
  ensureKeyframe();

  return (
    <div
      aria-hidden="true"
      style={{
        width,
        height,
        borderRadius: radius,
        background: `linear-gradient(90deg, ${tk.bg} 25%, ${tk.highlight} 50%, ${tk.bg} 75%)`,
        backgroundSize: "800px 100%",
        animation: "cgp-shimmer 1.4s ease-in-out infinite",
        flexShrink: 0,
        ...style,
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// KpiCardSkeleton
// ---------------------------------------------------------------------------

export interface KpiCardSkeletonProps {
  /** Override dark mode for Storybook. */
  dark?: boolean;
}

/**
 * Matches the layout of a standard KPI card:
 *   [ label ]
 *   [ large number      ] [ delta badge ]
 *   [ sub-label         ]
 */
export function KpiCardSkeleton({ dark: darkOverride }: KpiCardSkeletonProps) {
  const darkAuto = usePrefersDark();
  const dark = darkOverride ?? darkAuto;
  const tk = shimmerTokens(dark);
  ensureKeyframe();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading KPI data…"
      style={{
        background: tk.cardBg,
        border: `1px solid ${tk.border}`,
        borderRadius: 10,
        padding: "16px 20px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        minWidth: 160,
      }}
    >
      {/* Label line */}
      <SkeletonBase width="55%" height={12} radius={3} />
      {/* Value + delta row */}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SkeletonBase width="50%" height={28} radius={4} />
        <SkeletonBase width="22%" height={18} radius={12} />
      </div>
      {/* Sub-label */}
      <SkeletonBase width="40%" height={11} radius={3} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// KpiCardGridSkeleton
// ---------------------------------------------------------------------------

export interface KpiCardGridSkeletonProps {
  /** Number of KPI tiles to render. Default 4. */
  count?: number;
  dark?: boolean;
}

/**
 * Renders `count` KpiCardSkeleton tiles in a responsive grid.
 * The parent container carries the single aria-busy announcement.
 */
export function KpiCardGridSkeleton({ count = 4, dark }: KpiCardGridSkeletonProps) {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading dashboard metrics…"
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${Math.min(count, 4)}, minmax(140px, 1fr))`,
        gap: 16,
      }}
    >
      {Array.from({ length: count }).map((_, i) => (
        // aria-hidden on each child — the grid container already announced it
        <div key={i} aria-hidden="true">
          <KpiCardSkeleton dark={dark} />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// PaymentTableSkeleton
// ---------------------------------------------------------------------------

export interface PaymentTableSkeletonProps {
  /** Number of body rows. Default 6. */
  rows?: number;
  /** Number of columns. Default 5. */
  cols?: number;
  dark?: boolean;
}

/**
 * Shape-matched skeleton for a payment / transaction table.
 * Column widths roughly mimic a real table: narrow ID, wide description,
 * medium amount, medium date, narrow status badge.
 */
export function PaymentTableSkeleton({ rows = 6, cols = 5, dark: darkOverride }: PaymentTableSkeletonProps) {
  const darkAuto = usePrefersDark();
  const dark = darkOverride ?? darkAuto;
  const tk = shimmerTokens(dark);
  ensureKeyframe();

  // Column width pattern — cycle if cols > pattern length
  const colWidths = ["35%", "100%", "70%", "65%", "45%"];
  const colHeights = [12, 13, 12, 12, 16]; // status badge is a bit taller
  const colRadii = [3, 3, 3, 3, 10];       // status badge is pill-shaped

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading payment records…"
      style={{
        background: dark ? "#111827" : "#FFFFFF",
        border: `1px solid ${tk.border}`,
        borderRadius: 8,
        overflow: "hidden",
      }}
    >
      {/* Table header row */}
      <div
        aria-hidden="true"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: 12,
          padding: "10px 16px",
          background: dark ? "#1F2937" : "#F9FAFB",
          borderBlockEnd: `1px solid ${tk.border}`,
        }}
      >
        {Array.from({ length: cols }).map((_, ci) => (
          <SkeletonBase
            key={ci}
            width={colWidths[ci % colWidths.length]}
            height={11}
            radius={3}
          />
        ))}
      </div>

      {/* Body rows */}
      {Array.from({ length: rows }).map((_, ri) => (
        <div
          key={ri}
          aria-hidden="true"
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${cols}, 1fr)`,
            gap: 12,
            padding: "11px 16px",
            alignItems: "center",
            borderBlockEnd: ri < rows - 1 ? `1px solid ${tk.border}` : undefined,
          }}
        >
          {Array.from({ length: cols }).map((_, ci) => (
            <SkeletonBase
              key={ci}
              width={colWidths[ci % colWidths.length]}
              height={colHeights[ci % colHeights.length]}
              radius={colRadii[ci % colRadii.length]}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// EscrowTimelineSkeleton
// ---------------------------------------------------------------------------

export interface EscrowTimelineSkeletonProps {
  /** Number of milestone nodes. Default 4. */
  milestones?: number;
  dark?: boolean;
}

/**
 * Vertical timeline skeleton for escrow milestone sequences.
 * Each node has a circle connector, a title, and a date chip.
 */
export function EscrowTimelineSkeleton({ milestones = 4, dark: darkOverride }: EscrowTimelineSkeletonProps) {
  const darkAuto = usePrefersDark();
  const dark = darkOverride ?? darkAuto;
  const tk = shimmerTokens(dark);
  ensureKeyframe();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading escrow timeline…"
      style={{ display: "flex", flexDirection: "column", gap: 0 }}
    >
      {Array.from({ length: milestones }).map((_, i) => (
        <div
          key={i}
          aria-hidden="true"
          style={{ display: "flex", gap: 14, alignItems: "flex-start" }}
        >
          {/* Left gutter: circle + vertical connector */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              width: 24,
              flexShrink: 0,
            }}
          >
            <SkeletonBase width={20} height={20} radius="50%" style={{ flexShrink: 0 }} />
            {i < milestones - 1 && (
              <SkeletonBase
                width={2}
                height={40}
                radius={1}
                style={{ marginBlockStart: 2 }}
              />
            )}
          </div>
          {/* Content */}
          <div
            style={{
              flex: 1,
              paddingBlockEnd: i < milestones - 1 ? 28 : 0,
              paddingBlockStart: 1,
              display: "flex",
              flexDirection: "column",
              gap: 7,
            }}
          >
            <SkeletonBase width="60%" height={13} radius={3} />
            <SkeletonBase width="35%" height={11} radius={3} />
          </div>
          {/* Date chip */}
          <SkeletonBase
            width={72}
            height={22}
            radius={6}
            style={{ flexShrink: 0, marginBlockStart: 1 }}
          />
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DetailHeaderSkeleton
// ---------------------------------------------------------------------------

export interface DetailHeaderSkeletonProps {
  /** Show an avatar/icon circle on the inline-start. Default true. */
  showAvatar?: boolean;
  dark?: boolean;
}

/**
 * Page-header skeleton: avatar circle + title + sub-title + meta badges row.
 * Prevents the page from jumping when the header data loads.
 */
export function DetailHeaderSkeleton({ showAvatar = true, dark: darkOverride }: DetailHeaderSkeletonProps) {
  const darkAuto = usePrefersDark();
  const dark = darkOverride ?? darkAuto;
  const tk = shimmerTokens(dark);
  ensureKeyframe();

  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading page header…"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 18,
        padding: "20px 24px",
        background: dark ? "#111827" : "#FFFFFF",
        border: `1px solid ${tk.border}`,
        borderRadius: 10,
      }}
    >
      {/* Avatar */}
      {showAvatar && (
        <SkeletonBase
          width={52}
          height={52}
          radius="50%"
          style={{ flexShrink: 0 }}
        />
      )}

      {/* Title + meta */}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 9 }}>
        <SkeletonBase width="40%" height={20} radius={4} />
        <SkeletonBase width="28%" height={13} radius={3} />
        {/* Meta row: 3 small chips */}
        <div style={{ display: "flex", gap: 8, marginBlockStart: 2 }}>
          {[72, 90, 60].map((w, i) => (
            <SkeletonBase key={i} width={w} height={20} radius={10} />
          ))}
        </div>
      </div>

      {/* Action button placeholder */}
      <SkeletonBase
        width={120}
        height={36}
        radius={6}
        style={{ flexShrink: 0 }}
      />
    </div>
  );
}
