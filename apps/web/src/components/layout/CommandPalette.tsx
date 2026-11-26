'use client';

import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

export type CommandPaletteRole = 'customer' | 'merchant' | 'arbitrator' | 'admin';

export interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
  role?: CommandPaletteRole;
  /** Optional resolver for on-chain lookups (Payment/Escrow/Refund ID or Stellar address). */
  resolveEntity?: (query: string) => Promise<CommandPaletteResult[]> | CommandPaletteResult[];
}

export interface CommandPaletteResult {
  id: string;
  label: string;
  hint?: string;
  href: string;
  kind: 'payment' | 'escrow' | 'refund' | 'address' | 'route';
}

const ROUTES: Record<CommandPaletteRole, CommandPaletteResult[]> = {
  customer: [
    { id: 'route:customer:invoices', label: 'My Invoices', href: '/customer/invoices', kind: 'route' },
    { id: 'route:customer:payments', label: 'Payments', href: '/customer/payments', kind: 'route' },
    { id: 'route:customer:refunds', label: 'Refund Requests', href: '/customer/refunds', kind: 'route' },
    { id: 'route:customer:disputes', label: 'Disputes', href: '/customer/disputes', kind: 'route' },
  ],
  merchant: [
    { id: 'route:merchant:settlements', label: 'Settlements', href: '/merchant/settlements', kind: 'route' },
    { id: 'route:merchant:policies', label: 'Policies', href: '/merchant/policies', kind: 'route' },
    { id: 'route:merchant:invoices', label: 'Invoices', href: '/merchant/invoices', kind: 'route' },
    { id: 'route:merchant:disputes', label: 'Disputes', href: '/merchant/disputes', kind: 'route' },
  ],
  arbitrator: [
    { id: 'route:arbitrator:queue', label: 'Dispute Queue', href: '/arbitrator/queue', kind: 'route' },
    { id: 'route:arbitrator:votes', label: 'Commit / Reveal', href: '/arbitrator/votes', kind: 'route' },
    { id: 'route:arbitrator:history', label: 'Voting History', href: '/arbitrator/history', kind: 'route' },
  ],
  admin: [
    { id: 'route:admin:overview', label: 'Protocol Overview', href: '/admin', kind: 'route' },
    { id: 'route:admin:arbitrators', label: 'Arbitrator Registry', href: '/admin/arbitrators', kind: 'route' },
    { id: 'route:admin:merchants', label: 'Merchant Registry', href: '/admin/merchants', kind: 'route' },
    { id: 'route:admin:params', label: 'Protocol Parameters', href: '/admin/params', kind: 'route' },
  ],
};

const KIND_LABEL: Record<CommandPaletteResult['kind'], string> = {
  payment: 'Payment ID',
  escrow: 'Escrow ID',
  refund: 'Refund ID',
  address: 'Stellar address',
  route: 'Navigate',
};

const STELLAR_ADDRESS = /^G[A-Z2-7]{55}$/;

function classifyQuery(query: string): CommandPaletteResult['kind'] | null {
  const q = query.trim();
  if (!q) return null;
  if (STELLAR_ADDRESS.test(q)) return 'address';
  if (/^pay[_-]/i.test(q)) return 'payment';
  if (/^esc[_-]/i.test(q)) return 'escrow';
  if (/^ref[_-]/i.test(q)) return 'refund';
  return null;
}

export function CommandPalette({ open, onClose, role = 'customer', resolveEntity }: CommandPaletteProps) {
  const router = useRouter();
  const listboxId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [resolved, setResolved] = useState<CommandPaletteResult[]>([]);

  const routeResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    const routes = ROUTES[role] ?? ROUTES.customer;
    if (!q) return routes;
    return routes.filter((r) => r.label.toLowerCase().includes(q));
  }, [query, role]);

  const results = useMemo(() => [...resolved, ...routeResults], [resolved, routeResults]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    setResolved([]);
    const t = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !resolveEntity) return;
    const kind = classifyQuery(query);
    if (!kind) {
      setResolved([]);
      return;
    }
    let cancelled = false;
    Promise.resolve(resolveEntity(query.trim()))
      .then((items) => {
        if (!cancelled) setResolved(items ?? []);
      })
      .catch(() => {
        if (!cancelled) setResolved([]);
      });
    return () => {
      cancelled = true;
    };
  }, [open, query, resolveEntity]);

  useEffect(() => {
    setActiveIndex((i) => (results.length === 0 ? 0 : Math.min(i, results.length - 1)));
  }, [results.length]);

  const select = useCallback(
    (item: CommandPaletteResult | undefined) => {
      if (!item) return;
      onClose();
      router.push(item.href);
    },
    [onClose, router],
  );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i + 1) % results.length : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) => (results.length ? (i - 1 + results.length) % results.length : 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      select(results[activeIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    }
  };

  if (!open) return null;

  const activeId = results[activeIndex] ? `${listboxId}-opt-${activeIndex}` : undefined;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 px-4 pt-[10vh]"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
        <div className="border-b border-gray-200 px-4 py-3">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-expanded={results.length > 0}
            aria-controls={listboxId}
            aria-activedescendant={activeId}
            aria-autocomplete="list"
            aria-label="Global command palette"
            placeholder="Search Payment ID, Escrow ID, Refund ID, Stellar address, or route…"
            className="w-full bg-transparent text-sm text-gray-900 outline-none placeholder:text-gray-400"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onKeyDown}
          />
        </div>
        <ul id={listboxId} role="listbox" aria-label="Command results" className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-gray-500" role="presentation">
              No matches. Try a Payment ID, Escrow ID, Refund ID, or Stellar address.
            </li>
          ) : (
            results.map((item, index) => (
              <li
                key={item.id}
                id={`${listboxId}-opt-${index}`}
                role="option"
                aria-selected={index === activeIndex}
                className={`flex cursor-pointer items-center justify-between px-4 py-2 text-sm ${
                  index === activeIndex ? 'bg-indigo-50 text-indigo-900' : 'text-gray-700'
                }`}
                onMouseEnter={() => setActiveIndex(index)}
                onMouseDown={(e) => {
                  e.preventDefault();
                  select(item);
                }}
              >
                <span className="truncate">{item.label}</span>
                <span className="ml-3 shrink-0 text-xs text-gray-400">{item.hint ?? KIND_LABEL[item.kind]}</span>
              </li>
            ))
          )}
        </ul>
        <div className="flex items-center justify-between border-t border-gray-200 px-4 py-2 text-xs text-gray-400">
          <span>↑↓ navigate · ↵ open · esc close</span>
          <span className="rounded bg-gray-100 px-1.5 py-0.5 font-mono">⌘K</span>
        </div>
      </div>
    </div>
  );
}

export default CommandPalette;
