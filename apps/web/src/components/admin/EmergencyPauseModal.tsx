/**
 * EmergencyPauseModal.tsx
 *
 * Calibrated-friction confirmation modals for high-stakes admin actions.
 * Implements docs/ux/admin-orchestrator-safety-ux.md
 *
 * i18n / RTL changes (issue #424):
 *   - All physical margin-left/right, padding-left/right, border-left,
 *     text-align: left → logical equivalents.
 *   - WASM checksums and signing addresses wrapped in dir="ltr" bidi-isolate
 *     so hex strings never reorder inside RTL paragraphs.
 *   - Diff table old/new values wrapped in dir="ltr" isolate spans.
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Network = "mainnet" | "testnet" | "localnet";
export type ViewerRole = "signer" | "auditor";
export type ActionTier = "standard" | "high-impact" | "emergency-pause";

export interface DiffField {
  label: string;
  oldValue: string;
  newValue: string;
  unchanged?: boolean;
}

export interface EnvironmentBannerProps {
  network: Network;
}

export interface StandardActionModalProps {
  open: boolean;
  title: string;
  diff: DiffField[];
  signerAddress?: string;
  multisigDescription?: string;
  viewerRole?: ViewerRole;
  onConfirm: () => void;
  onCancel: () => void;
}

export interface HighImpactActionModalProps extends StandardActionModalProps {
  confirmationPhrase: string;
  wasmChecksumExpected?: string;
  wasmChecksumVerified?: boolean | "pending";
}

export interface EmergencyPauseModalProps
  extends Omit<HighImpactActionModalProps, "confirmationPhrase"> {
  network: Network;
  pauseScope: "all" | "escrow" | "payments" | "refunds";
  countdownSeconds?: number;
  /**
   * Whether this modal is pausing or unpausing. Defaults to "pause".
   * Drives the confirmation phrase and the action label.
   */
  action?: "pause" | "unpause";
  /**
   * Contract alias the operator must re-type as part of the high-contrast
   * confirmation barrier (e.g. "orchestrator", "payment", "escrow").
   * Defaults to the pause scope when not supplied.
   */
  contractAlias?: string;
  /**
   * Structured incident reason. When provided, the modal renders a
   * two-step flow: (1) incident reason + post-mortem attestation hash,
   * (2) network/alias confirmation barrier before signing.
   */
  incidentReason?: string;
  /** 64-char lowercase hex post-mortem attestation hash. */
  postMortemAttestationHash?: string;
  /** Called with the collected structured incident payload on confirm. */
  onConfirmWithIncident?: (payload: EmergencyIncidentPayload) => void;
}

/** Structured incident payload collected by the two-step emergency flow. */
export interface EmergencyIncidentPayload {
  action: "pause" | "unpause";
  network: Network;
  pauseScope: EmergencyPauseModalProps["pauseScope"];
  contractAlias: string;
  incidentReason: string;
  postMortemAttestationHash: string;
  justification: string;
}

// ---------------------------------------------------------------------------
// Helpers
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

function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const sel = 'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const nodes = Array.from(el.querySelectorAll<HTMLElement>(sel));
    if (!nodes.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    function trap(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (e.shiftKey) {
        if (document.activeElement === first) { e.preventDefault(); last.focus(); }
      } else {
        if (document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    }
    el.addEventListener("keydown", trap);
    first.focus();
    return () => el.removeEventListener("keydown", trap);
  }, [active, ref]);
}

function useEscapeKey(cb: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const h = (e: KeyboardEvent) => { if (e.key === "Escape") cb(); };
    document.addEventListener("keydown", h);
    return () => document.removeEventListener("keydown", h);
  }, [cb, active]);
}

/** Formats a 64-char hex SHA-256 into 4-char groups, 8 per row. */
function formatHash(hex: string): string[][] {
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) groups.push(hex.slice(i, i + 4));
  const rows: string[][] = [];
  for (let i = 0; i < groups.length; i += 8) rows.push(groups.slice(i, i + 8));
  return rows;
}

/** Groups an address/hash value with per-block difference highlighting. */
function groupedDisplay(str: string, other: string, mode: "old" | "new", dark: boolean): React.ReactNode {
  const changedBg = mode === "old"
    ? (dark ? "#7F1D1D" : "#FEE2E2")
    : (dark ? "#14532D" : "#DCFCE7");
  const color = dark ? "#F9FAFB" : "#111827";
  const groups: React.ReactNode[] = [];
  for (let i = 0; i < str.length; i += 4) {
    const chunk = str.slice(i, i + 4);
    const otherChunk = other.slice(i, i + 4);
    const differs = chunk !== otherChunk;
    groups.push(
      <span key={i} style={{ background: differs ? changedBg : "transparent", color, fontFamily: "monospace", marginInlineEnd: 4 }}>
        {chunk}
      </span>
    );
  }
  // Wrap in dir="ltr" isolate so hex never reorders in RTL
  return <span dir="ltr" style={{ unicodeBidi: "isolate" }}>{groups}</span>;
}

// ---------------------------------------------------------------------------
// Environment Banner
// ---------------------------------------------------------------------------

const NETWORK_CONFIG: Record<Network, { hairline: string; bg: string; pillBg: string; pillText: string; label: string; body: string }> = {
  mainnet:  { hairline: "#EF4444", bg: "#7F1D1D", pillBg: "#EF4444", pillText: "#FFFFFF", label: "MAINNET",  body: "You are operating on the live Stellar Mainnet. All actions are irreversible." },
  testnet:  { hairline: "#6366F1", bg: "#1E1B4B", pillBg: "#6366F1", pillText: "#FFFFFF", label: "TESTNET",  body: "You are on Testnet. No real funds or contracts are affected." },
  localnet: { hairline: "#64748B", bg: "#1E293B", pillBg: "#64748B", pillText: "#FFFFFF", label: "LOCALNET", body: "Local development environment." },
};

export function EnvironmentBanner({ network }: EnvironmentBannerProps) {
  const cfg = NETWORK_CONFIG[network];
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      role="banner"
      aria-label={`Network: ${cfg.label}`}
      onMouseEnter={() => setExpanded(true)}
      onMouseLeave={() => setExpanded(false)}
      onFocus={() => setExpanded(true)}
      onBlur={() => setExpanded(false)}
      tabIndex={0}
      style={{
        position: "sticky", top: 0, zIndex: 10000, width: "100%",
        background: cfg.bg,
        borderBlockStart: `3px solid ${cfg.hairline}`,
        height: expanded ? 32 : 8,
        overflow: "hidden",
        transition: "height 0.2s ease",
        display: "flex", alignItems: "center", gap: 10,
        paddingInlineStart: expanded ? 12 : 0,
        cursor: "default",
      }}
    >
      {expanded && (
        <>
          <span style={{ background: cfg.pillBg, color: cfg.pillText, fontSize: 10, fontWeight: 700, letterSpacing: "0.1em", paddingBlock: 1, paddingInline: 7, borderRadius: 4, whiteSpace: "nowrap" }}>
            {cfg.label}
          </span>
          <span style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", whiteSpace: "nowrap" }}>
            {cfg.body}
          </span>
          {network === "mainnet" && (
            <span aria-hidden="true" style={{ marginInlineStart: "auto", marginInlineEnd: 12, fontSize: 11, color: "#FCA5A5", fontWeight: 600 }}>
              ⚠ Live network
            </span>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared modal shell
// ---------------------------------------------------------------------------

interface ModalShellProps {
  titleId: string;
  title: string;
  tier: ActionTier;
  dark: boolean;
  onClose: () => void;
  children: React.ReactNode;
  modalRef: React.RefObject<HTMLDivElement>;
}

function ModalShell({ titleId, title, tier, dark, onClose, children, modalRef }: ModalShellProps) {
  const bg = dark ? "#1F2937" : "#FFFFFF";
  const border = dark ? "#374151" : "#E5E7EB";
  const textPrimary = dark ? "#F9FAFB" : "#111827";
  const isHigh = tier === "high-impact" || tier === "emergency-pause";
  const headerBg = isHigh ? (dark ? "#450A0A" : "#FEF2F2") : (dark ? "#1F2937" : "#F9FAFB");
  const headerBorder = isHigh ? (dark ? "#F87171" : "#EF4444") : border;

  return (
    <>
      <div aria-hidden="true" onClick={onClose}
        style={{ position: "fixed", inset: 0, background: dark ? "rgba(0,0,0,0.65)" : "rgba(0,0,0,0.45)", zIndex: 9998 }} />
      <div
        ref={modalRef}
        role="dialog" aria-modal="true" aria-labelledby={titleId}
        style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)",
          zIndex: 9999, width: "min(600px, 95vw)", maxHeight: "90vh", overflowY: "auto",
          background: bg, border: `1px solid ${border}`, borderRadius: 10,
          boxShadow: "0 24px 64px rgba(0,0,0,0.3)",
        }}
      >
        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", paddingBlock: 14, paddingInline: 20, background: headerBg, borderBlockEnd: `1px solid ${headerBorder}` }}>
          <h2 id={titleId} style={{ margin: 0, fontSize: 15, fontWeight: 700, color: isHigh ? (dark ? "#FCA5A5" : "#7F1D1D") : textPrimary, display: "flex", alignItems: "center", gap: 8 }}>
            {isHigh && <span aria-hidden="true">⚠</span>}
            {title}
          </h2>
          <button type="button" onClick={onClose} aria-label="Cancel and close"
            style={{ background: "none", border: "none", cursor: "pointer", color: dark ? "#9CA3AF" : "#6B7280", fontSize: 20, lineHeight: 1, paddingBlock: 2, paddingInline: 6 }}>
            ×
          </button>
        </div>
        <div style={{ paddingBlock: 20, paddingInline: 20 }}>{children}</div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// Diff Table
// ---------------------------------------------------------------------------

interface DiffTableProps { diff: DiffField[]; dark: boolean; }

function DiffTable({ diff, dark }: DiffTableProps) {
  const [showAll, setShowAll] = useState(false);
  const textPrimary = dark ? "#F9FAFB" : "#111827";
  const textMuted = dark ? "#9CA3AF" : "#6B7280";
  const border = dark ? "#374151" : "#E5E7EB";
  const headerBg = dark ? "#111827" : "#F9FAFB";

  const visible = showAll ? diff : diff.filter((f) => !f.unchanged);
  const hiddenCount = diff.filter((f) => f.unchanged).length;

  function oldColor(f: DiffField) { return f.oldValue === f.newValue ? textMuted : (dark ? "#FCA5A5" : "#DC2626"); }
  function newColor(f: DiffField) { return f.oldValue === f.newValue ? textMuted : (dark ? "#86EFAC" : "#16A34A"); }
  function isLong(v: string) { return v.length > 20; }

  return (
    <div style={{ marginBlockEnd: 16 }}>
      <table role="table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, border: `1px solid ${border}`, borderRadius: 6, overflow: "hidden" }}>
        <thead>
          <tr style={{ background: headerBg }}>
            {["Parameter", "Old Value", "New Value"].map((h) => (
              <th key={h} scope="col" style={{ paddingBlock: 8, paddingInline: 12, textAlign: "start", fontWeight: 600, color: textMuted, fontSize: 11, textTransform: "uppercase", letterSpacing: "0.06em", borderBlockEnd: `1px solid ${border}` }}>
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.map((f, i) => (
            <tr key={i} style={{ borderBlockEnd: `1px solid ${border}`, opacity: f.unchanged ? 0.5 : 1 }}>
              <td style={{ paddingBlock: 8, paddingInline: 12, color: textPrimary, fontWeight: 500 }}>{f.label}</td>
              <td style={{ paddingBlock: 8, paddingInline: 12, color: oldColor(f) }}>
                {isLong(f.oldValue) ? groupedDisplay(f.oldValue, f.newValue, "old", dark) : <span dir="ltr" style={{ unicodeBidi: "isolate", fontFamily: "monospace" }}>{f.oldValue || "—"}</span>}
              </td>
              <td style={{ paddingBlock: 8, paddingInline: 12, color: newColor(f) }}>
                {isLong(f.newValue) ? groupedDisplay(f.newValue, f.oldValue, "new", dark) : <span dir="ltr" style={{ unicodeBidi: "isolate", fontFamily: "monospace" }}>{f.newValue || "—"}</span>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hiddenCount > 0 && (
        <button type="button" onClick={() => setShowAll((s) => !s)}
          style={{ marginBlockStart: 6, background: "none", border: "none", cursor: "pointer", fontSize: 12, color: dark ? "#60A5FA" : "#2563EB", textDecoration: "underline", padding: 0 }}>
          {showAll ? "Hide unchanged fields" : `Show ${hiddenCount} unchanged field${hiddenCount > 1 ? "s" : ""}`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Checksum Badge
// ---------------------------------------------------------------------------

interface ChecksumBadgeProps {
  expected: string;
  verified: boolean | "pending";
  dark: boolean;
  confirmBadgeId: string;
}

function ChecksumBadge({ expected, verified, dark, confirmBadgeId }: ChecksumBadgeProps) {
  const rows = formatHash(expected);
  const border = dark ? "#374151" : "#E5E7EB";
  const codeBg = dark ? "#111827" : "#F9FAFB";
  const codeColor = dark ? "#D1D5DB" : "#374151";
  const badgeColor = verified === "pending" ? (dark ? "#FEF08A" : "#CA8A04") : verified ? (dark ? "#86EFAC" : "#16A34A") : (dark ? "#FCA5A5" : "#DC2626");
  const badgeLabel = verified === "pending" ? "Verifying…" : verified ? "✓ Hash matches uploaded WASM artifact" : "✗ Hash mismatch — do not proceed";

  return (
    <div style={{ marginBlockEnd: 16 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: dark ? "#9CA3AF" : "#6B7280", marginBlockEnd: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
        WASM Checksum Verification
      </div>
      {/* Hash is always LTR — wrap in dir="ltr" isolate */}
      <div dir="ltr" style={{ unicodeBidi: "isolate", background: codeBg, border: `1px solid ${border}`, borderRadius: 6, paddingBlock: 10, paddingInline: 14, marginBlockEnd: 8 }}>
        {rows.map((row, ri) => (
          <div key={ri} style={{ fontFamily: "monospace", fontSize: 12, color: codeColor, marginBlockEnd: ri < rows.length - 1 ? 4 : 0 }}>
            {row.map((group, gi) => <span key={gi} style={{ marginInlineEnd: 8 }}>{group}</span>)}
          </div>
        ))}
      </div>
      <span id={confirmBadgeId} aria-label={badgeLabel} style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 600, color: badgeColor }}>
        {verified === "pending" && <span style={{ display: "inline-block", width: 10, height: 10, border: `2px solid ${badgeColor}`, borderBlockStartColor: "transparent", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />}
        {badgeLabel}
      </span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Confirm button with auditor awareness
// ---------------------------------------------------------------------------

interface ConfirmButtonProps {
  disabled: boolean;
  viewerRole: ViewerRole;
  label: string;
  dark: boolean;
  onClick: () => void;
  disabledReasonId?: string;
}

function ConfirmButton({ disabled, viewerRole, label, dark, onClick, disabledReasonId }: ConfirmButtonProps) {
  const isAuditor = viewerRole === "auditor";
  const [showTip, setShowTip] = useState(false);
  const isDisabled = disabled || isAuditor;
  const reason = isAuditor ? "You have view-only access on this network" : "Complete all required fields to enable";

  return (
    <span style={{ position: "relative", display: "inline-block" }}
      onMouseEnter={() => setShowTip(true)} onMouseLeave={() => setShowTip(false)}>
      <button
        type="button" aria-disabled={isDisabled} aria-describedby={isDisabled ? disabledReasonId : undefined}
        onClick={isDisabled ? undefined : onClick}
        style={{
          paddingBlock: 10, paddingInline: 22,
          background: isDisabled ? (dark ? "#374151" : "#D1D5DB") : (dark ? "#16A34A" : "#15803D"),
          color: isDisabled ? (dark ? "#6B7280" : "#9CA3AF") : "#FFFFFF",
          border: "none", borderRadius: 6, fontSize: 14, fontWeight: 600,
          cursor: isDisabled ? "not-allowed" : "pointer", opacity: isDisabled ? 0.45 : 1,
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        {isAuditor && <span aria-hidden="true">🔒</span>}
        {label}
      </button>
      <span id={disabledReasonId} style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clip: "rect(0,0,0,0)", whiteSpace: "nowrap" }}>
        {reason}
      </span>
      {showTip && isDisabled && (
        <span role="tooltip" style={{
          position: "absolute", bottom: "calc(100% + 6px)", left: "50%", transform: "translateX(-50%)",
          background: "#1F2937", color: "#F9FAFB", fontSize: 12, paddingBlock: 5, paddingInline: 10,
          borderRadius: 4, whiteSpace: "nowrap", zIndex: 10001, pointerEvents: "none",
          boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        }}>
          {reason}
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StandardActionModal
// ---------------------------------------------------------------------------

export function StandardActionModal({
  open, title, diff, signerAddress, multisigDescription,
  viewerRole = "signer", onConfirm, onCancel,
}: StandardActionModalProps) {
  const dark = usePrefersDark();
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const disabledReasonId = useId();
  const textMuted = dark ? "#9CA3AF" : "#6B7280";

  useFocusTrap(modalRef, open);
  useEscapeKey(onCancel, open);
  if (!open) return null;

  return (
    <ModalShell titleId={titleId} title={`Confirm: ${title}`} tier="standard" dark={dark} onClose={onCancel} modalRef={modalRef}>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: textMuted }}>Review the change carefully before confirming.</p>
      <DiffTable diff={diff} dark={dark} />
      {(signerAddress || multisigDescription) && (
        <p style={{ margin: "0 0 20px", fontSize: 12, color: textMuted }}>
          {/* Signing address is always LTR — bidi-isolate */}
          {signerAddress && <>Signing address: <span dir="ltr" style={{ unicodeBidi: "isolate", fontFamily: "monospace" }}>{signerAddress}</span></>}
          {signerAddress && multisigDescription && " · "}
          {multisigDescription}
        </p>
      )}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button type="button" onClick={onCancel}
          style={{ paddingBlock: 9, paddingInline: 18, background: "none", border: `1px solid ${dark ? "#374151" : "#D1D5DB"}`, borderRadius: 6, fontSize: 13, color: dark ? "#D1D5DB" : "#374151", cursor: "pointer" }}>
          Cancel
        </button>
        <ConfirmButton disabled={false} viewerRole={viewerRole} label="Confirm Change →" dark={dark} onClick={onConfirm} disabledReasonId={disabledReasonId} />
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// HighImpactActionModal
// ---------------------------------------------------------------------------

export function HighImpactActionModal({
  open, title, diff, signerAddress, multisigDescription, viewerRole = "signer",
  confirmationPhrase, wasmChecksumExpected, wasmChecksumVerified, onConfirm, onCancel,
}: HighImpactActionModalProps) {
  const dark = usePrefersDark();
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const disabledReasonId = useId();
  const checksumBadgeId = useId();
  const phraseDescId = useId();

  const [phraseInput, setPhraseInput] = useState("");
  const [justification, setJustification] = useState("");
  const textPrimary = dark ? "#F9FAFB" : "#111827";
  const textMuted = dark ? "#9CA3AF" : "#6B7280";
  const border = dark ? "#374151" : "#E5E7EB";
  const inputBg = dark ? "#111827" : "#F9FAFB";

  useFocusTrap(modalRef, open);
  useEscapeKey(onCancel, open);

  const checksumOk = !wasmChecksumExpected || wasmChecksumVerified === true;
  const phraseOk = phraseInput === confirmationPhrase;
  const justificationOk = justification.trim().length >= 20;
  const allGuardsPassed = checksumOk && phraseOk && justificationOk;

  if (!open) return null;

  return (
    <ModalShell titleId={titleId} title={`HIGH-IMPACT ACTION — ${title}`} tier="high-impact" dark={dark} onClose={onCancel} modalRef={modalRef}>
      <DiffTable diff={diff} dark={dark} />

      {wasmChecksumExpected && wasmChecksumVerified !== undefined && (
        <ChecksumBadge expected={wasmChecksumExpected} verified={wasmChecksumVerified} dark={dark} confirmBadgeId={checksumBadgeId} />
      )}

      {/* Typed phrase */}
      <div style={{ marginBlockEnd: 16 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: textMuted, marginBlockEnd: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Typed Confirmation</div>
        <p id={phraseDescId} style={{ margin: "0 0 6px", fontSize: 13, color: textPrimary }}>
          Type{" "}
          <code style={{ background: dark ? "#111827" : "#F3F4F6", border: `1px solid ${border}`, paddingBlock: 2, paddingInline: 6, borderRadius: 4, fontFamily: "monospace", fontSize: 13, letterSpacing: "0.08em", userSelect: "all" }}>
            {confirmationPhrase}
          </code>{" "}
          to confirm:
        </p>
        <input
          type="text" aria-label="Type the confirmation phrase" aria-describedby={phraseDescId}
          value={phraseInput} onChange={(e) => setPhraseInput(e.target.value)}
          autoComplete="off" autoCorrect="off" spellCheck={false}
          style={{ width: "100%", paddingBlock: 9, paddingInline: 12, background: inputBg, border: `1px solid ${phraseInput && !phraseOk ? "#EF4444" : phraseOk ? "#22C55E" : border}`, borderRadius: 6, fontSize: 13, fontFamily: "monospace", color: textPrimary, outline: "none", boxSizing: "border-box" }}
          placeholder={`Type: ${confirmationPhrase}`}
        />
      </div>

      {/* Justification */}
      <div style={{ marginBlockEnd: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: textMuted, marginBlockEnd: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Incident Justification (required)</div>
        <p style={{ margin: "0 0 6px", fontSize: 11, color: textMuted }}>This text will be recorded in the audit log.</p>
        <textarea
          aria-label="Incident justification" value={justification} onChange={(e) => setJustification(e.target.value)}
          rows={3} placeholder="Post-mortem ticket, incident ID, or brief justification…"
          style={{ width: "100%", paddingBlock: 9, paddingInline: 12, background: inputBg, border: `1px solid ${justification.trim().length > 0 && !justificationOk ? "#EAB308" : justificationOk ? "#22C55E" : border}`, borderRadius: 6, fontSize: 13, color: textPrimary, resize: "vertical", boxSizing: "border-box", outline: "none" }}
        />
        <div style={{ textAlign: "end", fontSize: 11, color: textMuted, marginBlockStart: 3 }}>
          {justification.trim().length} / 20 min characters
        </div>
      </div>

      {signerAddress && (
        <p style={{ margin: "0 0 16px", fontSize: 12, color: textMuted }}>
          Signing address:{" "}
          <span dir="ltr" style={{ unicodeBidi: "isolate", fontFamily: "monospace" }}>{signerAddress}</span>
          {multisigDescription && ` · ${multisigDescription}`}
        </p>
      )}

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <button type="button" onClick={onCancel}
          style={{ paddingBlock: 9, paddingInline: 18, background: "none", border: `1px solid ${border}`, borderRadius: 6, fontSize: 13, color: dark ? "#D1D5DB" : "#374151", cursor: "pointer" }}>
          Cancel
        </button>
        <ConfirmButton disabled={!allGuardsPassed} viewerRole={viewerRole} label="I confirm — Execute →" dark={dark} onClick={onConfirm} disabledReasonId={disabledReasonId} />
      </div>
    </ModalShell>
  );
}

// ---------------------------------------------------------------------------
// EmergencyPauseModal
// ---------------------------------------------------------------------------

function pausePhrase(
  scope: EmergencyPauseModalProps["pauseScope"],
  network: Network,
  action: "pause" | "unpause" = "pause"
): string {
  const net = network === "mainnet" ? "MAINNET" : network === "testnet" ? "TESTNET" : "LOCALNET";
  return scope === "all" ? `PAUSE ${net}` : `PAUSE ${scope.toUpperCase()}`;
}

export function EmergencyPauseModal({
  open, title = "Emergency Pause", diff, signerAddress, multisigDescription,
  viewerRole = "signer", network, pauseScope, wasmChecksumExpected, wasmChecksumVerified,
  countdownSeconds = 5, onConfirm, onCancel,
  const verb = action === "unpause" ? "UNPAUSE" : "PAUSE";
  if (scope === "all") return `${verb} ${net}`;
  return `${verb} ${scope.toUpperCase()}`;
}

/** Network name the operator must re-type in the confirmation barrier. */
export function networkConfirmationName(network: Network): string {
  return network === "mainnet" ? "MAINNET" : network === "testnet" ? "TESTNET" : "LOCALNET";
}

/** Returns true when `input` is a valid 64-char lowercase hex SHA-256. */
export function isValidAttestationHash(input: string): boolean {
  return /^[0-9a-f]{64}$/.test(input);
}

/**
 * Evaluates the high-contrast confirmation barrier. Both the network name and
 * the contract alias must be re-typed exactly (case-sensitive) before the
 * operator is allowed to sign a high-stakes transaction.
 */
export function isConfirmationBarrierSatisfied(params: {
  networkInput: string;
  aliasInput: string;
  network: Network;
  contractAlias: string;
}): boolean {
  return (
    params.networkInput === networkConfirmationName(params.network) &&
    params.aliasInput === params.contractAlias
  );
}

export function EmergencyPauseModal({
  open,
  title = "Emergency Pause",
  diff,
  signerAddress,
  multisigDescription,
  viewerRole = "signer",
  network,
  pauseScope,
  wasmChecksumExpected,
  wasmChecksumVerified,
  countdownSeconds = 5,
  action = "pause",
  contractAlias,
  incidentReason: initialIncidentReason,
  postMortemAttestationHash: initialAttestationHash,
  onConfirm,
  onConfirmWithIncident,
  onCancel,
}: EmergencyPauseModalProps) {
  const dark = usePrefersDark();
  const modalRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const disabledReasonId = useId();
  const phraseDescId = useId();
  const barrierDescId = useId();

  const [phraseInput, setPhraseInput] = useState("");
  const [justification, setJustification] = useState("");
  const [countingDown, setCountingDown] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(countdownSeconds);

  // Two-step emergency flow state
  const [step, setStep] = useState<1 | 2>(1);
  const [incidentReason, setIncidentReason] = useState(initialIncidentReason ?? "");
  const [attestationHash, setAttestationHash] = useState(initialAttestationHash ?? "");
  const [networkInput, setNetworkInput] = useState("");
  const [aliasInput, setAliasInput] = useState("");

  const textPrimary = dark ? "#F9FAFB" : "#111827";
  const textMuted = dark ? "#9CA3AF" : "#6B7280";
  const border = dark ? "#374151" : "#E5E7EB";
  const inputBg = dark ? "#111827" : "#F9FAFB";

  const resolvedAlias =
    contractAlias ?? (pauseScope === "all" ? "orchestrator" : pauseScope);
  const confirmationPhrase = pausePhrase(pauseScope, network, action);
  const checksumOk = !wasmChecksumExpected || wasmChecksumVerified === true;
  const phraseOk = phraseInput === confirmationPhrase;
  const justificationOk = justification.trim().length >= 20;
  const incidentReasonOk = incidentReason.trim().length >= 20;
  const attestationOk = isValidAttestationHash(attestationHash);
  const barrierOk = isConfirmationBarrierSatisfied({
    networkInput,
    aliasInput,
    network,
    contractAlias: resolvedAlias,
  });
  const step1Ok = incidentReasonOk && attestationOk;
  const allGuardsPassed =
    checksumOk && phraseOk && justificationOk && step1Ok && barrierOk;

  useFocusTrap(modalRef, open);
  useEscapeKey(() => {
    if (countingDown) { setCountingDown(false); setSecondsLeft(countdownSeconds); }
    else { onCancel(); }
  }, open);

  useEffect(() => {
    if (!countingDown) return;
    if (secondsLeft <= 0) { setCountingDown(false); onConfirm(); return; }
    if (secondsLeft <= 0) {
      setCountingDown(false);
      handleFinalConfirm();
      return;
    }
    const t = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [countingDown, secondsLeft]);

  function buildIncidentPayload(): EmergencyIncidentPayload {
    return {
      action,
      network,
      pauseScope,
      contractAlias: resolvedAlias,
      incidentReason: incidentReason.trim(),
      postMortemAttestationHash: attestationHash,
      justification: justification.trim(),
    };
  }

  function handleInitiateCountdown() { setSecondsLeft(countdownSeconds); setCountingDown(true); }
  function handleAbort() { setCountingDown(false); setSecondsLeft(countdownSeconds); }
  function handleInitiateCountdown() {
    setSecondsLeft(countdownSeconds);
    setCountingDown(true);
  }

  function handleFinalConfirm() {
    if (onConfirmWithIncident) onConfirmWithIncident(buildIncidentPayload());
    onConfirm();
  }

  function handleAbort() {
    setCountingDown(false);
    setSecondsLeft(countdownSeconds);
  }

  if (!open) return null;

  const scopeLabel = pauseScope === "all" ? "All Contracts" : pauseScope.charAt(0).toUpperCase() + pauseScope.slice(1);
  const actionLabel = action === "unpause" ? "Emergency Unpause" : "Emergency Pause";
  const networkName = networkConfirmationName(network);

  return (
    <ModalShell titleId={titleId} title={`Emergency Pause — ${scopeLabel}`} tier="emergency-pause" dark={dark} onClose={countingDown ? handleAbort : onCancel} modalRef={modalRef}>
    <ModalShell
      titleId={titleId}
      title={`${actionLabel} — ${scopeLabel}`}
      tier="emergency-pause"
      dark={dark}
      onClose={countingDown ? handleAbort : onCancel}
      modalRef={modalRef}
    >
      {/* Countdown overlay */}
      {countingDown && (
        <div aria-live="assertive" aria-atomic="true" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", paddingBlock: 24, gap: 16 }}>
          <div style={{ fontSize: 80, fontWeight: 900, lineHeight: 1, color: dark ? "#FCA5A5" : "#DC2626", fontFamily: "monospace", animation: "pulseFade 1s ease-in-out" }}>
            {secondsLeft}
          </div>
          <p style={{ margin: 0, fontSize: 14, color: textPrimary, fontWeight: 600 }}>
            Submitting {action} transaction in {secondsLeft} second{secondsLeft !== 1 ? "s" : ""}…
          </p>
          <p style={{ margin: 0, fontSize: 12, color: textMuted }}>Press Abort or Escape to cancel.</p>
          <button type="button" onClick={handleAbort} autoFocus
            style={{ marginBlockStart: 8, paddingBlock: 10, paddingInline: 32, background: dark ? "#7F1D1D" : "#FEF2F2", border: `2px solid ${dark ? "#F87171" : "#EF4444"}`, borderRadius: 8, fontSize: 15, fontWeight: 700, color: dark ? "#FCA5A5" : "#DC2626", cursor: "pointer" }}>
            Abort
          </button>
        </div>
      )}

      {!countingDown && (
        <>
          {network === "mainnet" && (
            <div role="alert" style={{ marginBlockEnd: 14, paddingBlock: 10, paddingInline: 14, background: dark ? "#450A0A" : "#FEF2F2", border: `1px solid ${dark ? "#F87171" : "#EF4444"}`, borderRadius: 6, fontSize: 13, color: dark ? "#FEE2E2" : "#7F1D1D", fontWeight: 600 }}>
              ⚠ You are about to pause {scopeLabel} on MAINNET. This will halt all affected transactions until manually resumed.
            <div
              role="alert"
              style={{
                marginBottom: 14,
                padding: "10px 14px",
                background: dark ? "#450A0A" : "#FEF2F2",
                border: `1px solid ${dark ? "#F87171" : "#EF4444"}`,
                borderRadius: 6,
                fontSize: 13,
                color: dark ? "#FEE2E2" : "#7F1D1D",
                fontWeight: 600,
              }}
            >
              ⚠ You are about to {action} {scopeLabel} on MAINNET.{" "}
              {action === "pause"
                ? "This will halt all affected transactions until manually resumed."
                : "This will resume processing of all affected transactions."}
            </div>
          )}

          {/* Step indicator */}
          <div
            role="list"
            aria-label="Emergency action steps"
            style={{
              display: "flex",
              gap: 8,
              marginBottom: 16,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: "0.06em",
              textTransform: "uppercase",
            }}
          >
            {[
              { n: 1 as const, label: "Incident Attestation" },
              { n: 2 as const, label: "Confirmation Barrier" },
            ].map(({ n, label }) => {
              const active = step === n;
              const done = step > n;
              return (
                <div
                  key={n}
                  role="listitem"
                  aria-current={active ? "step" : undefined}
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    borderRadius: 6,
                    border: `1px solid ${active ? (dark ? "#F87171" : "#EF4444") : border}`,
                    background: active
                      ? dark ? "#450A0A" : "#FEF2F2"
                      : done
                      ? dark ? "#14532D" : "#DCFCE7"
                      : "transparent",
                    color: active
                      ? dark ? "#FCA5A5" : "#7F1D1D"
                      : done
                      ? dark ? "#86EFAC" : "#166534"
                      : textMuted,
                  }}
                >
                  {done ? "✓ " : `${n}. `}
                  {label}
                </div>
              );
            })}
          </div>

          <DiffTable diff={diff} dark={dark} />

          {/* Step 1: structured incident reason + post-mortem attestation hash */}
          {step === 1 && (
            <>
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Structured Incident Reason (required)
                </div>
                <textarea
                  aria-label="Structured incident reason"
                  value={incidentReason}
                  onChange={(e) => setIncidentReason(e.target.value)}
                  rows={3}
                  placeholder="Describe the incident: affected subsystem, observed impact, detection source…"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: inputBg,
                    border: `1px solid ${incidentReason.trim().length > 0 && !incidentReasonOk ? "#EAB308" : incidentReasonOk ? "#22C55E" : border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    color: textPrimary,
                    resize: "vertical",
                    boxSizing: "border-box",
                    outline: "none",
                  }}
                />
                <div style={{ textAlign: "right", fontSize: 11, color: textMuted, marginTop: 3 }}>
                  {incidentReason.trim().length} / 20 min characters
                </div>
              </div>

              <div style={{ marginBottom: 20 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: textMuted, marginBottom: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  Post-Mortem Attestation Hash (required)
                </div>
                <p style={{ margin: "0 0 6px", fontSize: 11, color: textMuted }}>
                  SHA-256 of the signed post-mortem / incident attestation (64-char lowercase hex).
                </p>
                <input
                  type="text"
                  aria-label="Post-mortem attestation hash"
                  value={attestationHash}
                  onChange={(e) => setAttestationHash(e.target.value.trim())}
                  autoComplete="off"
                  autoCorrect="off"
                  spellCheck={false}
                  placeholder="e.g. 3f9a… (64 hex chars)"
                  style={{
                    width: "100%",
                    padding: "9px 12px",
                    background: inputBg,
                    border: `1px solid ${attestationHash && !attestationOk ? "#EF4444" : attestationOk ? "#22C55E" : border}`,
                    borderRadius: 6,
                    fontSize: 13,
                    fontFamily: "monospace",
                    color: textPrimary,
                    outline: "none",
                    boxSizing: "border-box",
                  }}
                />
                {attestationHash && !attestationOk && (
                  <div role="alert" style={{ marginTop: 4, fontSize: 11, color: dark ? "#FCA5A5" : "#DC2626" }}>
                    Invalid hash — must be exactly 64 lowercase hex characters.
                  </div>
                )}
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <button
                  type="button"
                  disabled={!step1Ok}
                  aria-disabled={!step1Ok}
                  onClick={() => setStep(2)}
                  style={{
                    padding: "9px 20px",
                    background: step1Ok ? (dark ? "#1D4ED8" : "#2563EB") : (dark ? "#374151" : "#D1D5DB"),
                    color: step1Ok ? "#FFFFFF" : (dark ? "#6B7280" : "#9CA3AF"),
                    border: "none",
                    borderRadius: 6,
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: step1Ok ? "pointer" : "not-allowed",
                    opacity: step1Ok ? 1 : 0.6,
                  }}
                >
                  Continue to Confirmation →
                </button>
              </div>
            </>
          )}

          {/* Step 2: high-contrast confirmation barrier */}
          {step === 2 && (
            <div
              role="group"
              aria-labelledby={barrierDescId}
              style={{
                marginBottom: 20,
                padding: "14px 16px",
                border: `2px solid ${dark ? "#F87171" : "#DC2626"}`,
                borderRadius: 8,
                background: dark ? "#450A0A" : "#FEF2F2",
              }}
            >
              <div
                id={barrierDescId}
                style={{
                  fontSize: 12,
                  fontWeight: 800,
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: dark ? "#FCA5A5" : "#7F1D1D",
                  marginBottom: 10,
                }}
              >
                ⚠ High-Contrast Confirmation Barrier
              </div>
              <p style={{ margin: "0 0 10px", fontSize: 12, color: dark ? "#FEE2E2" : "#7F1D1D" }}>
                Re-type the target network name and contract alias exactly to unlock signing.
              </p>

              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Network name (type <code style={{ fontFamily: "monospace" }}>{networkName}</code>)
              </label>
              <input
                type="text"
                aria-label="Re-type target network name"
                value={networkInput}
                onChange={(e) => setNetworkInput(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={networkName}
                style={{
                  width: "100%",
                  marginBottom: 10,
                  padding: "9px 12px",
                  background: inputBg,
                  border: `1px solid ${networkInput && networkInput !== networkName ? "#EF4444" : networkInput === networkName ? "#22C55E" : border}`,
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: "monospace",
                  letterSpacing: "0.08em",
                  color: textPrimary,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />

              <label style={{ display: "block", fontSize: 11, fontWeight: 700, color: textMuted, marginBottom: 4, textTransform: "uppercase", letterSpacing: "0.06em" }}>
                Contract alias (type <code style={{ fontFamily: "monospace" }}>{resolvedAlias}</code>)
              </label>
              <input
                type="text"
                aria-label="Re-type contract alias"
                value={aliasInput}
                onChange={(e) => setAliasInput(e.target.value)}
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                placeholder={resolvedAlias}
                style={{
                  width: "100%",
                  padding: "9px 12px",
                  background: inputBg,
                  border: `1px solid ${aliasInput && aliasInput !== resolvedAlias ? "#EF4444" : aliasInput === resolvedAlias ? "#22C55E" : border}`,
                  borderRadius: 6,
                  fontSize: 13,
                  fontFamily: "monospace",
                  color: textPrimary,
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />

              <button
                type="button"
                onClick={() => setStep(1)}
                style={{
                  marginTop: 10,
                  background: "none",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 12,
                  color: dark ? "#93C5FD" : "#2563EB",
                  textDecoration: "underline",
                }}
              >
                ← Back to incident attestation
              </button>
            </div>
          )}

          {/* Typed phrase */}
          <div style={{ marginBlockEnd: 16 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: textMuted, marginBlockEnd: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Typed Confirmation</div>
            <p id={phraseDescId} style={{ margin: "0 0 6px", fontSize: 13, color: textPrimary }}>
              Type{" "}
              <code style={{ background: dark ? "#111827" : "#F3F4F6", border: `1px solid ${border}`, paddingBlock: 2, paddingInline: 8, borderRadius: 4, fontFamily: "monospace", fontSize: 13, letterSpacing: "0.1em", userSelect: "all" }}>
                {confirmationPhrase}
              </code>{" "}
              to continue:
            </p>
            <input type="text" aria-label="Type the confirmation phrase" aria-describedby={phraseDescId}
              value={phraseInput} onChange={(e) => setPhraseInput(e.target.value)}
              autoComplete="off" autoCorrect="off" spellCheck={false}
              style={{ width: "100%", paddingBlock: 9, paddingInline: 12, background: inputBg, border: `1px solid ${phraseInput && !phraseOk ? "#EF4444" : phraseOk ? "#22C55E" : border}`, borderRadius: 6, fontSize: 13, fontFamily: "monospace", letterSpacing: "0.08em", color: textPrimary, outline: "none", boxSizing: "border-box" }}
              placeholder={`Type: ${confirmationPhrase}`}
            />
          </div>

          {/* Justification */}
          <div style={{ marginBlockEnd: 20 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: textMuted, marginBlockEnd: 6, textTransform: "uppercase", letterSpacing: "0.06em" }}>Incident Justification (required)</div>
            <p style={{ margin: "0 0 6px", fontSize: 11, color: textMuted }}>This text will be recorded in the audit log.</p>
            <textarea aria-label="Incident justification" value={justification} onChange={(e) => setJustification(e.target.value)} rows={3}
              placeholder="Incident ID, post-mortem link, or brief description of the issue…"
              style={{ width: "100%", paddingBlock: 9, paddingInline: 12, background: inputBg, border: `1px solid ${justification.trim().length > 0 && !justificationOk ? "#EAB308" : justificationOk ? "#22C55E" : border}`, borderRadius: 6, fontSize: 13, color: textPrimary, resize: "vertical", boxSizing: "border-box", outline: "none" }}
            />
            <div style={{ textAlign: "end", fontSize: 11, color: textMuted, marginBlockStart: 3 }}>
              {justification.trim().length} / 20 min characters
            </div>
          </div>

          {signerAddress && (
            <p style={{ margin: "0 0 16px", fontSize: 12, color: textMuted }}>
              Signing address:{" "}
              <span dir="ltr" style={{ unicodeBidi: "isolate", fontFamily: "monospace" }}>{signerAddress}</span>
              {multisigDescription && ` · ${multisigDescription}`}
            </p>
          )}

          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <button type="button" onClick={onCancel}
              style={{ paddingBlock: 9, paddingInline: 18, background: "none", border: `1px solid ${border}`, borderRadius: 6, fontSize: 13, color: dark ? "#D1D5DB" : "#374151", cursor: "pointer" }}>
              Cancel
            </button>
            <ConfirmButton disabled={!allGuardsPassed} viewerRole={viewerRole}
              label={`Execute Pause${network === "mainnet" && pauseScope === "all" ? " (5s countdown)" : ""} →`}
              dark={dark} onClick={network === "mainnet" ? handleInitiateCountdown : onConfirm} disabledReasonId={disabledReasonId} />
            <ConfirmButton
              disabled={!allGuardsPassed || step !== 2}
              viewerRole={viewerRole}
              label={`Execute ${action === "unpause" ? "Unpause" : "Pause"}${network === "mainnet" && pauseScope === "all" ? " (5s countdown)" : ""} →`}
              dark={dark}
              onClick={network === "mainnet" ? handleInitiateCountdown : handleFinalConfirm}
              disabledReasonId={disabledReasonId}
            />
          </div>
        </>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulseFade { 0% { opacity: 0.4; transform: scale(0.9); } 50% { opacity: 1; transform: scale(1); } 100% { opacity: 0.4; transform: scale(0.9); } }
      `}</style>
    </ModalShell>
  );
}

export default EmergencyPauseModal;
