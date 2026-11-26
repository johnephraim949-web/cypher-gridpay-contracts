import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type StellarAddressKind = 'account' | 'contract';

export interface StellarAddressProps {
  /** Full Stellar address (G... account or C... contract). */
  address: string;
  /** Optional address-book alias shown as a badge. */
  alias?: string;
  /** Override the auto-detected address kind. */
  kind?: StellarAddressKind;
  /** Show the external Stellar Expert link. Defaults to true. */
  showExpertLink?: boolean;
  /** Network used for the Stellar Expert link. Defaults to 'public'. */
  network?: 'public' | 'testnet';
  /** Optional className for the outer wrapper. */
  className?: string;
}

const LEADING = 6;
const TRAILING = 6;

function detectKind(address: string): StellarAddressKind {
  return address.trim().toUpperCase().startsWith('C') ? 'contract' : 'account';
}

function truncate(address: string): string {
  const trimmed = address.trim();
  if (trimmed.length <= LEADING + TRAILING + 3) {
    return trimmed;
  }
  return `${trimmed.slice(0, LEADING)}...${trimmed.slice(-TRAILING)}`;
}

/**
 * Deterministic identicon derived from the address. Renders a small grid of
 * colored cells so the same address always produces the same visual pattern.
 */
function Identicon({ address, size = 20 }: { address: string; size?: number }) {
  const cells = useMemo(() => {
    // Simple deterministic hash (FNV-1a style) over the address characters.
    let hash = 0x811c9dc5;
    for (let i = 0; i < address.length; i += 1) {
      hash ^= address.charCodeAt(i);
      hash = Math.imul(hash, 0x01000193);
    }
    const hue = Math.abs(hash) % 360;
    const grid: boolean[] = [];
    let state = Math.abs(hash) || 1;
    for (let i = 0; i < 25; i += 1) {
      state = (state * 1103515245 + 12345) & 0x7fffffff;
      grid.push((state & 1) === 1);
    }
    return { hue, grid };
  }, [address]);

  const cell = size / 5;
  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden="true"
      focusable="false"
      style={{ borderRadius: 4, flexShrink: 0 }}
    >
      <rect width={size} height={size} fill={`hsl(${cells.hue}, 45%, 92%)`} />
      {cells.grid.map((on, index) => {
        if (!on) return null;
        const x = (index % 5) * cell;
        const y = Math.floor(index / 5) * cell;
        return (
          <rect
            key={index}
            x={x}
            y={y}
            width={cell}
            height={cell}
            fill={`hsl(${cells.hue}, 60%, 45%)`}
          />
        );
      })}
    </svg>
  );
}

export function StellarAddress({
  address,
  alias,
  kind,
  showExpertLink = true,
  network = 'public',
  className,
}: StellarAddressProps) {
  const [copied, setCopied] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const resolvedKind = kind ?? detectKind(address);
  const display = revealed ? address.trim() : truncate(address);
  const expertUrl = `https://stellar.expert/explorer/${network}/${
    resolvedKind === 'contract' ? 'contract' : 'account'
  }/${address.trim()}`;

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(address.trim());
      }
      setCopied(true);
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  }, [address]);

  return (
    <span
      className={className}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
    >
      <Identicon address={address} />
      <span
        tabIndex={0}
        onFocus={() => setRevealed(true)}
        onBlur={() => setRevealed(false)}
        onMouseEnter={() => setRevealed(true)}
        onMouseLeave={() => setRevealed(false)}
        title={address.trim()}
        style={{
          fontFamily:
            'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
          fontVariantNumeric: 'tabular-nums',
          wordBreak: 'break-all',
        }}
      >
        {display}
      </span>
      {alias ? (
        <span
          style={{
            fontSize: 11,
            padding: '1px 6px',
            borderRadius: 9999,
            background: 'var(--color-surface-muted, rgba(127,127,127,0.15))',
            color: 'var(--color-text-muted, inherit)',
          }}
        >
          {alias}
        </span>
      ) : null}
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? 'Address copied' : 'Copy address'}
        style={{
          border: 'none',
          background: 'transparent',
          cursor: 'pointer',
          padding: 2,
          fontSize: 12,
          color: 'var(--color-text-muted, inherit)',
        }}
      >
        {copied ? 'Copied!' : 'Copy'}
      </button>
      <span aria-live="polite" role="status" style={{ position: 'absolute', width: 1, height: 1, overflow: 'hidden', clip: 'rect(0 0 0 0)' }}>
        {copied ? 'Address copied to clipboard' : ''}
      </span>
      {showExpertLink ? (
        <a
          href={expertUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="View on Stellar Expert"
          style={{ fontSize: 12, color: 'var(--color-accent, #2563eb)' }}
        >
          Expert
        </a>
      ) : null}
    </span>
  );
}

export default StellarAddress;
