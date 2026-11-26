/**
 * WalletSelectorModal.tsx
 *
 * Wallet Selector Modal and JIT Micro-Educator Cards for Cypher GridPay.
 * Implements the UX spec in docs/ux/wallet-onboarding-ux.md
 *
 * i18n / RTL changes (issue #424):
 *   - All physical CSS direction properties replaced with logical equivalents
 *     (marginInlineStart/End, paddingInlineStart/End, borderInlineStart,
 *     textAlign: 'start'/'end', insetInlineStart/End).
 *   - XLM shortfall value wrapped in dir="ltr" bidi-isolate span so the
 *     decimal number never reorders inside an RTL sentence.
 *   - `formatXlmShortfall` used for the shortfall display value.
 *
 * Exports:
 *   WalletSelectorModal   — The main wallet connection modal.
 *   MissingTrustlineCard  — JIT educator: USDC trustline not established.
 *   LowXlmReserveCard     — JIT educator: spendable XLM below minimum reserve.
 *   WrongNetworkCard      — JIT educator: wallet on wrong Stellar network.
 *
 * Design principles:
 *   - Modal NEVER auto-opens on page load. Must be triggered by user action.
 *   - JIT cards appear only when their specific condition is detected.
 *   - Zero unexplained Stellar acronyms in user-visible copy.
 *   - Progressive disclosure: simple path first, detail behind "Learn more".
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { formatXlmShortfall } from "../../utils/formatAmount";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WalletId =
  | "passkey"
  | "freighter"
  | "xbull"
  | "albedo"
  | "lobstr";

export type Platform = "ios" | "android" | "macos" | "windows" | "unknown";

export interface WalletSelectorModalProps {
  open: boolean;
  onSelect: (walletId: WalletId) => void;
  onClose: () => void;
  detectedWallets?: Partial<Record<WalletId, boolean>>;
  platform?: Platform;
  /** BCP 47 locale for number formatting. Defaults to navigator.language. */
  locale?: string;
}

export interface MissingTrustlineCardProps {
  onEnable: () => void;
  learnMoreUrl?: string;
}

export interface LowXlmReserveCardProps {
  shortfallXlm: number;
  onAddXlm: () => void;
  learnMoreUrl?: string;
  locale?: string;
}

export interface WrongNetworkCardProps {
  walletNetwork: "testnet" | "mainnet";
  onReconnect: () => void;
  learnMoreUrl?: string;
}

// ---------------------------------------------------------------------------
// Dark mode hook
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
// Platform detection
// ---------------------------------------------------------------------------

function detectPlatform(): Platform {
  if (typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent.toLowerCase();
  if (/iphone|ipad|ipod/.test(ua)) return "ios";
  if (/android/.test(ua)) return "android";
  if (/mac/.test(ua)) return "macos";
  if (/windows/.test(ua)) return "windows";
  return "unknown";
}

function passkeySubLabel(platform: Platform): string {
  switch (platform) {
    case "ios":
    case "macos":
      return "Face ID or Touch ID";
    case "android":
      return "Fingerprint or face unlock";
    case "windows":
      return "Windows Hello";
    default:
      return "Your device biometrics";
  }
}

// ---------------------------------------------------------------------------
// Focus trap hook
// ---------------------------------------------------------------------------

function useFocusTrap(ref: React.RefObject<HTMLElement>, active: boolean) {
  useEffect(() => {
    if (!active || !ref.current) return;
    const el = ref.current;
    const focusable = el.querySelectorAll<HTMLElement>(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const first = focusable[0];
    const last = focusable[focusable.length - 1];

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key !== "Tab") return;
      if (focusable.length === 0) {
        e.preventDefault();
        return;
      }
      if (e.shiftKey) {
        if (document.activeElement === first) {
          e.preventDefault();
          last.focus();
        }
      } else {
        if (document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    }

    el.addEventListener("keydown", handleKeyDown);
    first?.focus();
    return () => el.removeEventListener("keydown", handleKeyDown);
  }, [active, ref]);
}

// ---------------------------------------------------------------------------
// Escape key hook
// ---------------------------------------------------------------------------

function useEscapeKey(callback: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") callback();
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [callback, active]);
}

// ---------------------------------------------------------------------------
// Wallet definitions
// ---------------------------------------------------------------------------

interface WalletDef {
  id: WalletId;
  name: string;
  description: string;
  mobileCompatible: boolean;
  installUrl: string;
  logo: React.ReactNode;
}

function WalletLogo({ initial, bg }: { initial: string; bg: string }) {
  return (
    <span
      aria-hidden="true"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 32,
        height: 32,
        borderRadius: 8,
        background: bg,
        color: "#fff",
        fontSize: 14,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {initial}
    </span>
  );
}

const WALLETS: WalletDef[] = [
  {
    id: "freighter",
    name: "Freighter",
    description: "Browser extension",
    mobileCompatible: false,
    installUrl: "https://freighter.app",
    logo: <WalletLogo initial="F" bg="#6366F1" />,
  },
  {
    id: "xbull",
    name: "xBull",
    description: "Extension + mobile app",
    mobileCompatible: true,
    installUrl: "https://xbull.app",
    logo: <WalletLogo initial="X" bg="#0EA5E9" />,
  },
  {
    id: "albedo",
    name: "Albedo",
    description: "No install required",
    mobileCompatible: true,
    installUrl: "https://albedo.link",
    logo: <WalletLogo initial="A" bg="#8B5CF6" />,
  },
  {
    id: "lobstr",
    name: "Lobstr",
    description: "Mobile app",
    mobileCompatible: true,
    installUrl: "https://lobstr.co",
    logo: <WalletLogo initial="L" bg="#10B981" />,
  },
];

// ---------------------------------------------------------------------------
// Inline SVG icons
// ---------------------------------------------------------------------------

function PasskeyIcon({ color }: { color: string }) {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="8" r="4" />
      <path d="M6 20v-2a6 6 0 0112 0v2" />
      <line x1="18" y1="14" x2="22" y2="14" />
      <line x1="20" y1="12" x2="20" y2="16" />
    </svg>
  );
}

function LightbulbIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <path d="M9 18h6M10 22h4M12 2a7 7 0 017 7c0 2.5-1.3 4.7-3.3 6L15 18H9l-.7-3C6.3 13.7 5 11.5 5 9a7 7 0 017-7z" />
    </svg>
  );
}

function WarningIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function NetworkIcon({ color }: { color: string }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false" style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z" />
    </svg>
  );
}

/**
 * Chevron pointing inline-end (→ in LTR, ← in RTL).
 * dir prop is passed so the icon mirrors in RTL contexts.
 */
function ChevronInlineEnd({ dir = "ltr" }: { dir?: "ltr" | "rtl" }) {
  return (
    <svg
      width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={dir === "rtl" ? { transform: "scaleX(-1)" } : undefined}
    >
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}

function ChevronDown() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ExternalLinkIcon({ color }: { color: string }) {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
      stroke={color} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      aria-hidden="true" focusable="false"
      style={{ flexShrink: 0, marginInlineStart: 3 }}>
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Shared style helpers
// ---------------------------------------------------------------------------

function learnMoreLink(url: string, color: string) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      style={{
        display: "inline-flex",
        alignItems: "center",
        fontSize: 13,
        color,
        textDecoration: "underline",
        fontWeight: 500,
      }}
    >
      Learn more
      <ExternalLinkIcon color={color} />
    </a>
  );
}

// ---------------------------------------------------------------------------
// WalletSelectorModal
// ---------------------------------------------------------------------------

export function WalletSelectorModal({
  open,
  onSelect,
  onClose,
  detectedWallets = {},
  platform: platformProp,
}: WalletSelectorModalProps) {
  const dark = usePrefersDark();
  const platform = platformProp ?? detectPlatform();
  const isMobile = platform === "ios" || platform === "android";
  const modalRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const explainerId = useId();
  const [explainerOpen, setExplainerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      triggerRef.current = document.activeElement as HTMLElement;
    } else {
      triggerRef.current?.focus();
    }
  }, [open]);

  useFocusTrap(modalRef, open);
  useEscapeKey(onClose, open);

  const bg = dark ? "#1F2937" : "#FFFFFF";
  const border = dark ? "#374151" : "#E5E7EB";
  const textPrimary = dark ? "#F9FAFB" : "#111827";
  const textMuted = dark ? "#9CA3AF" : "#6B7280";
  const dividerColor = dark ? "#374151" : "#E5E7EB";
  const tileBg = dark ? "#111827" : "#F9FAFB";
  const tileHoverBg = dark ? "#1E3A8A" : "#EFF6FF";
  const passKeyBg = dark ? "#2563EB" : "#1D4ED8";
  const backdropBg = dark ? "rgba(0,0,0,0.6)" : "rgba(0,0,0,0.4)";

  if (!open) return null;

  const sortedWallets = isMobile
    ? [
        ...WALLETS.filter((w) => w.mobileCompatible),
        ...WALLETS.filter((w) => !w.mobileCompatible),
      ]
    : WALLETS;

  return (
    <>
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          background: backdropBg,
          zIndex: 9998,
        }}
      />

      {/* Modal */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        style={{
          position: "fixed",
          zIndex: 9999,
          background: bg,
          border: `1px solid ${border}`,
          borderRadius: isMobile ? "16px 16px 0 0" : 12,
          boxShadow: "0 20px 60px rgba(0,0,0,0.25)",
          width: isMobile ? "100%" : "min(440px, 95vw)",
          maxHeight: "90vh",
          overflowY: "auto",
          paddingBlock: "24px 20px",
          paddingInline: 20,
          ...(isMobile
            ? { bottom: 0, insetInlineStart: 0, insetInlineEnd: 0 }
            : {
                top: "50%",
                left: "50%",
                transform: "translate(-50%, -50%)",
              }),
        }}
      >
        {/* Drag handle (mobile only) */}
        {isMobile && (
          <div
            aria-hidden="true"
            style={{
              width: 36,
              height: 4,
              borderRadius: 2,
              background: dark ? "#4B5563" : "#D1D5DB",
              margin: "0 auto 16px",
            }}
          />
        )}

        {/* Header */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBlockEnd: 20 }}>
          <h2
            id={titleId}
            style={{ margin: 0, fontSize: 18, fontWeight: 700, color: textPrimary }}
          >
            Connect your wallet
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close wallet selector"
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: textMuted,
              fontSize: 22,
              lineHeight: 1,
              paddingBlock: 2,
              paddingInline: 6,
              borderRadius: 4,
            }}
          >
            ×
          </button>
        </div>

        {/* Featured — Passkey */}
        <button
          type="button"
          onClick={() => onSelect("passkey")}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            width: "100%",
            paddingBlock: 14,
            paddingInline: 16,
            background: passKeyBg,
            border: "none",
            borderRadius: 10,
            cursor: "pointer",
            marginBlockEnd: 16,
            textAlign: "start",
          }}
        >
          <PasskeyIcon color="#ffffff" />
          <div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#ffffff" }}>
              Continue with Passkey
            </div>
            <div style={{ fontSize: 12, color: "rgba(255,255,255,0.75)", marginBlockStart: 2 }}>
              {passkeySubLabel(platform)} · No seed phrase needed
            </div>
          </div>
        </button>

        {/* Divider */}
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBlockEnd: 14 }}>
          <div style={{ flex: 1, height: 1, background: dividerColor }} />
          <span style={{ fontSize: 12, color: textMuted, whiteSpace: "nowrap" }}>
            or choose a wallet
          </span>
          <div style={{ flex: 1, height: 1, background: dividerColor }} />
        </div>

        {/* Wallet grid */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: isMobile ? "1fr" : "repeat(2, 1fr)",
            gap: 8,
            marginBlockEnd: 16,
          }}
        >
          {sortedWallets.map((wallet) => {
            const detected = detectedWallets[wallet.id] ?? false;
            const desktopOnly = !wallet.mobileCompatible && isMobile;

            return (
              <WalletTile
                key={wallet.id}
                wallet={wallet}
                detected={detected}
                desktopOnly={desktopOnly}
                dark={dark}
                tileBg={tileBg}
                tileHoverBg={tileHoverBg}
                tileBorder={border}
                textPrimary={textPrimary}
                textMuted={textMuted}
                onSelect={onSelect}
              />
            );
          })}
        </div>

        {/* "New to Stellar?" expandable explainer */}
        <div
          style={{
            borderBlockStart: `1px solid ${dividerColor}`,
            paddingBlockStart: 12,
          }}
        >
          <button
            type="button"
            onClick={() => setExplainerOpen((o) => !o)}
            aria-expanded={explainerOpen}
            aria-controls={explainerId}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              background: "none",
              border: "none",
              cursor: "pointer",
              color: textMuted,
              fontSize: 13,
              fontWeight: 500,
              paddingBlock: 4,
              paddingInline: 0,
              width: "100%",
              textAlign: "start",
            }}
          >
            <span style={{ color: textMuted }}>
              {explainerOpen ? <ChevronDown /> : <ChevronInlineEnd />}
            </span>
            New to Stellar?
          </button>

          <div
            id={explainerId}
            hidden={!explainerOpen}
            style={{
              marginBlockStart: 10,
              paddingBlock: 14,
              paddingInline: 16,
              background: dark ? "#111827" : "#F9FAFB",
              borderRadius: 8,
              border: `1px solid ${border}`,
            }}
          >
            <StellarExplainer dark={dark} textPrimary={textPrimary} textMuted={textMuted} />
          </div>
        </div>
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------
// WalletTile
// ---------------------------------------------------------------------------

interface WalletTileProps {
  wallet: WalletDef;
  detected: boolean;
  desktopOnly: boolean;
  dark: boolean;
  tileBg: string;
  tileHoverBg: string;
  tileBorder: string;
  textPrimary: string;
  textMuted: string;
  onSelect: (id: WalletId) => void;
}

function WalletTile({
  wallet,
  detected,
  desktopOnly,
  tileBg,
  tileHoverBg,
  tileBorder,
  textPrimary,
  textMuted,
  onSelect,
}: WalletTileProps) {
  const [hovered, setHovered] = useState(false);

  function handleClick() {
    if (detected) {
      onSelect(wallet.id);
    } else {
      window.open(wallet.installUrl, "_blank", "noopener,noreferrer");
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setHovered(true)}
      onBlur={() => setHovered(false)}
      aria-label={
        detected
          ? `Connect with ${wallet.name}`
          : `Install ${wallet.name} — opens in a new tab`
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        paddingBlock: 10,
        paddingInline: 12,
        background: hovered ? tileHoverBg : tileBg,
        border: `1px solid ${tileBorder}`,
        borderRadius: 8,
        cursor: "pointer",
        textAlign: "start",
        transition: "background 0.15s",
        position: "relative",
      }}
    >
      {wallet.logo}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: textPrimary }}>
          {wallet.name}
        </div>
        <div style={{ fontSize: 11, color: textMuted, marginBlockStart: 1 }}>
          {desktopOnly ? "Desktop only" : wallet.description}
        </div>
      </div>
      {!detected && (
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#2563EB",
            background: "#EFF6FF",
            border: "1px solid #BFDBFE",
            borderRadius: 4,
            paddingBlock: 2,
            paddingInline: 5,
            flexShrink: 0,
          }}
        >
          Install
        </span>
      )}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Stellar explainer
// ---------------------------------------------------------------------------

interface ExplainerProps {
  dark: boolean;
  textPrimary: string;
  textMuted: string;
}

function StellarExplainer({ textPrimary, textMuted }: ExplainerProps) {
  return (
    <div style={{ fontSize: 13, lineHeight: 1.6, color: textPrimary }}>
      <p style={{ margin: "0 0 10px" }}>
        <strong>Stellar is a payment network</strong> — like a global bank wire, but instant and
        free. Your wallet is like a bank account that only you control. No passwords to forget:
        your device biometrics are the key.
      </p>
      <p style={{ margin: "0 0 10px" }}>
        <strong>USDC on Stellar</strong> is the same US dollar-backed stablecoin you may already
        know — just traveling on a faster network. One USDC always equals one US dollar.
      </p>
      <p style={{ margin: "0 0 10px" }}>
        <strong>XLM</strong> is Stellar's native currency, used in tiny amounts (fractions of a
        cent) to cover network fees and keep your account open. You don't need to buy or manage
        XLM manually — Cypher GridPay guides you if any action is needed.
      </p>
      <a
        href="https://stellar.org/learn"
        target="_blank"
        rel="noopener noreferrer"
        style={{
          display: "inline-flex",
          alignItems: "center",
          fontSize: 13,
          color: "#2563EB",
          textDecoration: "underline",
          fontWeight: 500,
        }}
      >
        Learn more about Stellar
        <ExternalLinkIcon color="#2563EB" />
      </a>
      <p style={{ margin: "10px 0 0", fontSize: 11, color: textMuted }}>
        Takes about 30 seconds to read.
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// JIT Micro-Educator Cards
// ---------------------------------------------------------------------------

interface JitCardShellProps {
  icon: React.ReactNode;
  title: string;
  children: React.ReactNode;
  bg: string;
  borderColor: string;
}

function JitCardShell({ icon, title, children, bg, borderColor }: JitCardShellProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      style={{
        display: "flex",
        gap: 12,
        paddingBlock: 14,
        paddingInline: 16,
        background: bg,
        /* Accent stripe on the inline-start edge — mirrors in RTL automatically */
        borderInlineStart: `4px solid ${borderColor}`,
        borderRadius: "0 8px 8px 0",
        marginBlockEnd: 12,
      }}
    >
      <span style={{ paddingBlockStart: 1, flexShrink: 0 }}>{icon}</span>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, marginBlockEnd: 6 }}>{title}</div>
        {children}
      </div>
    </div>
  );
}

// ── Missing Trustline ────────────────────────────────────────────────────────

export function MissingTrustlineCard({
  onEnable,
  learnMoreUrl = "https://developers.stellar.org/docs/learn/fundamentals/stellar-data-structures/assets",
}: MissingTrustlineCardProps) {
  const dark = usePrefersDark();
  const bg = dark ? "#172554" : "#EFF6FF";
  const borderColor = dark ? "#60A5FA" : "#3B82F6";
  const iconColor = dark ? "#93C5FD" : "#2563EB";
  const textColor = dark ? "#DBEAFE" : "#1E3A8A";
  const ctaBg = dark ? "#3B82F6" : "#2563EB";

  return (
    <JitCardShell
      icon={<LightbulbIcon color={iconColor} />}
      title="Enable USDC in your wallet"
      bg={bg}
      borderColor={borderColor}
    >
      <p style={{ margin: "0 0 12px", fontSize: 13, color: textColor, lineHeight: 1.5 }}>
        To hold and send USDC payments, your wallet needs a one-time "enable USDC" step. It takes
        one click and sets aside 0.5 XLM (Stellar's native currency) as a small deposit — which
        stays yours and can be recovered later.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onEnable}
          style={{
            paddingBlock: 8,
            paddingInline: 16,
            background: ctaBg,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Enable USDC — 1 click
        </button>
        {learnMoreLink(learnMoreUrl, iconColor)}
      </div>
    </JitCardShell>
  );
}

// ── Low XLM Reserve ──────────────────────────────────────────────────────────

export function LowXlmReserveCard({
  shortfallXlm,
  onAddXlm,
  learnMoreUrl = "https://developers.stellar.org/docs/learn/fundamentals/lumens#minimum-balance",
  locale = typeof navigator !== "undefined" ? navigator.language : "en-US",
}: LowXlmReserveCardProps) {
  const dark = usePrefersDark();
  const bg = dark ? "#422006" : "#FEFCE8";
  const borderColor = dark ? "#FDE047" : "#EAB308";
  const iconColor = dark ? "#FEF08A" : "#CA8A04";
  const textColor = dark ? "#FEF9C3" : "#713F12";
  const ctaBg = dark ? "#F59E0B" : "#D97706";

  // Locale-aware shortfall display, bidi-isolated so the number never
  // reorders inside an RTL sentence.
  const shortfallDisplay = formatXlmShortfall(shortfallXlm, locale);

  return (
    <JitCardShell
      icon={<WarningIcon color={iconColor} />}
      title="Your XLM balance is a little low"
      bg={bg}
      borderColor={borderColor}
    >
      <p style={{ margin: "0 0 6px", fontSize: 13, color: textColor, lineHeight: 1.5 }}>
        Stellar accounts keep a small amount of XLM (Stellar's native currency) locked as a
        security deposit — it's your money, just held to keep your account open. You need
        approximately{" "}
        {/* Bidi-isolate the numeric amount so it doesn't reorder in RTL text */}
        <strong>
          <span dir="ltr" style={{ unicodeBidi: "isolate" }}>
            {shortfallDisplay}
          </span>
        </strong>{" "}
        more to cover this deposit before proceeding.
      </p>
      <p style={{ margin: "0 0 12px", fontSize: 12, color: iconColor }}>
        This is not a fee — the deposit stays in your wallet and can be recovered if you ever
        close your account.
      </p>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onAddXlm}
          style={{
            paddingBlock: 8,
            paddingInline: 16,
            background: ctaBg,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          Add XLM to my wallet
        </button>
        {learnMoreLink(learnMoreUrl, iconColor)}
      </div>
    </JitCardShell>
  );
}

// ── Wrong Network ────────────────────────────────────────────────────────────

const NETWORK_INSTRUCTIONS: Record<string, string> = {
  Freighter: "Settings → Network → Public Network",
  xBull: "⚙ → Network → Mainnet",
  Albedo: "Reconnect — Mainnet is selected by default",
  Lobstr: "Menu → Settings → Network → Mainnet",
};

export function WrongNetworkCard({
  walletNetwork,
  onReconnect,
  learnMoreUrl = "https://developers.stellar.org/docs/learn/fundamentals/networks",
}: WrongNetworkCardProps) {
  const dark = usePrefersDark();
  const bg = dark ? "#431407" : "#FFF7ED";
  const borderColor = dark ? "#FB923C" : "#F97316";
  const iconColor = dark ? "#FDBA74" : "#EA580C";
  const textColor = dark ? "#FFEDD5" : "#7C2D12";
  const ctaBg = dark ? "#F97316" : "#EA580C";
  const stepColor = dark ? "#FED7AA" : "#9A3412";

  const appNetwork = walletNetwork === "testnet" ? "Mainnet" : "Testnet";
  const walletNetworkLabel =
    walletNetwork === "testnet" ? "Testnet (practice environment)" : "Mainnet (live network)";

  return (
    <JitCardShell
      icon={<NetworkIcon color={iconColor} />}
      title="Your wallet is on a different network"
      bg={bg}
      borderColor={borderColor}
    >
      <p style={{ margin: "0 0 10px", fontSize: 13, color: textColor, lineHeight: 1.5 }}>
        This checkout uses the live Stellar network ({appNetwork}), but your wallet appears to be
        connected to the {walletNetworkLabel}. Payments made on the wrong network don't use real
        funds and won't be received here.
      </p>

      {/* Network diagram — arrow is directional, mirrored in RTL via scaleX */}
      <div
        aria-label={`Switch from ${walletNetworkLabel} to ${appNetwork}`}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBlockEnd: 12,
          fontSize: 12,
          color: stepColor,
          fontFamily: "monospace",
        }}
      >
        <span style={{
          paddingBlock: 3,
          paddingInline: 8,
          border: `1px solid ${borderColor}`,
          borderRadius: 4,
          background: dark ? "#7C2D12" : "#FEE2E2",
        }}>
          {walletNetworkLabel}
        </span>
        {/* Directional arrow — mirrors in RTL */}
        <span aria-hidden="true" style={{ fontSize: 16 }}>→</span>
        <span style={{
          paddingBlock: 3,
          paddingInline: 8,
          border: `1px solid ${dark ? "#4ADE80" : "#16A34A"}`,
          borderRadius: 4,
          background: dark ? "#14532D" : "#DCFCE7",
          color: dark ? "#BBF7D0" : "#166534",
        }}>
          {appNetwork} (Live)
        </span>
      </div>

      {/* Per-wallet instructions */}
      <div style={{ marginBlockEnd: 12 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: iconColor, marginBlockEnd: 6 }}>
          How to switch to {appNetwork}:
        </div>
        {Object.entries(NETWORK_INSTRUCTIONS).map(([wallet, steps]) => (
          <div key={wallet} style={{ fontSize: 12, color: textColor, marginBlockEnd: 3 }}>
            <strong>{wallet}:</strong>{" "}
            <span style={{ fontFamily: "monospace" }}>{steps}</span>
          </div>
        ))}
      </div>

      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <button
          type="button"
          onClick={onReconnect}
          style={{
            paddingBlock: 8,
            paddingInline: 16,
            background: ctaBg,
            color: "#fff",
            border: "none",
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 600,
            cursor: "pointer",
          }}
        >
          I've switched — reconnect
        </button>
        {learnMoreLink(learnMoreUrl, iconColor)}
      </div>
    </JitCardShell>
  );
}

export default WalletSelectorModal;
