'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import CommandPalette from './CommandPalette';

export type WorkspaceRole = 'customer' | 'merchant' | 'arbitrator' | 'admin';

export interface RoleAvailability {
  customer?: boolean;
  merchant?: boolean;
  arbitrator?: boolean;
  admin?: boolean;
}

interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const ROLE_LABELS: Record<WorkspaceRole, string> = {
  customer: 'Customer',
  merchant: 'Merchant',
  arbitrator: 'Arbitrator',
  admin: 'Admin',
};

const ROLE_NAV: Record<WorkspaceRole, NavItem[]> = {
  customer: [
    { label: 'Invoices', href: '/customer/invoices', icon: '🧾' },
    { label: 'Escrows', href: '/customer/escrows', icon: '🔒' },
    { label: 'Refunds', href: '/customer/refunds', icon: '↩️' },
    { label: 'Disputes', href: '/customer/disputes', icon: '⚖️' },
    { label: 'Settings', href: '/customer/settings', icon: '⚙️' },
  ],
  merchant: [
    { label: 'Settlements', href: '/merchant/settlements', icon: '💸' },
    { label: 'Policies', href: '/merchant/policies', icon: '📜' },
    { label: 'Invoices', href: '/merchant/invoices', icon: '🧾' },
    { label: 'Disputes', href: '/merchant/disputes', icon: '⚖️' },
    { label: 'Settings', href: '/merchant/settings', icon: '⚙️' },
  ],
  arbitrator: [
    { label: 'Case Queue', href: '/arbitrator/queue', icon: '📥' },
    { label: 'Voting', href: '/arbitrator/voting', icon: '🗳️' },
    { label: 'History', href: '/arbitrator/history', icon: '🕘' },
    { label: 'Settings', href: '/arbitrator/settings', icon: '⚙️' },
  ],
  admin: [
    { label: 'Overview', href: '/admin/overview', icon: '📊' },
    { label: 'Arbitrators', href: '/admin/arbitrators', icon: '🧑‍⚖️' },
    { label: 'Parameters', href: '/admin/parameters', icon: '🎛️' },
    { label: 'Audit Log', href: '/admin/audit', icon: '📋' },
    { label: 'Settings', href: '/admin/settings', icon: '⚙️' },
  ],
};

const ALL_ROLES: WorkspaceRole[] = ['customer', 'merchant', 'arbitrator', 'admin'];

function detectRoleFromPath(pathname: string | null): WorkspaceRole {
  const seg = (pathname ?? '').split('/').filter(Boolean)[0];
  return (ALL_ROLES as string[]).includes(seg) ? (seg as WorkspaceRole) : 'customer';
}

interface AppShellProps {
  children: React.ReactNode;
  roles?: RoleAvailability;
  walletAddress?: string;
  network?: string;
  ledger?: number;
  notifications?: number;
}

export default function AppShell({
  children,
  roles,
  walletAddress,
  network = 'testnet',
  ledger,
  notifications = 0,
}: AppShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [collapsed, setCollapsed] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [exploreAll, setExploreAll] = useState(false);

  const activeRole = detectRoleFromPath(pathname);

  const availableRoles = useMemo<WorkspaceRole[]>(() => {
    const detected = ALL_ROLES.filter((r) => roles?.[r]);
    const base = detected.length > 0 ? detected : ['customer' as WorkspaceRole];
    return exploreAll ? ALL_ROLES : base;
  }, [roles, exploreAll]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const switchRole = useCallback(
    (role: WorkspaceRole) => {
      setDrawerOpen(false);
      router.push(`/${role}`);
    },
    [router],
  );

  const nav = ROLE_NAV[activeRole];
  const primaryTabs = nav.slice(0, 4);

  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex flex-col border-r border-slate-800 transition-all duration-200 ${collapsed ? 'w-16' : 'w-60'}`}
        aria-label="Primary navigation"
      >
        <div className="flex items-center justify-between px-3 py-4">
          {!collapsed && <span className="text-sm font-semibold">Workspace</span>}
          <button
            type="button"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded p-1 hover:bg-slate-800"
          >
            {collapsed ? '»' : '«'}
          </button>
        </div>
        <div className="px-2 pb-3">
          {!collapsed && (
            <select
              aria-label="Switch workspace role"
              value={activeRole}
              onChange={(e) => switchRole(e.target.value as WorkspaceRole)}
              className="w-full rounded bg-slate-800 px-2 py-1 text-sm"
            >
              {availableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          )}
          {!collapsed && (
            <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
              <input
                type="checkbox"
                checked={exploreAll}
                onChange={(e) => setExploreAll(e.target.checked)}
              />
              Explore all workspaces
            </label>
          )}
        </div>
        <nav className="flex-1 space-y-1 px-2">
          {nav.map((item) => {
            const active = pathname === item.href;
            return (
              <a
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded px-2 py-2 text-sm ${active ? 'bg-slate-800 text-white' : 'text-slate-300 hover:bg-slate-800/60'}`}
              >
                <span aria-hidden>{item.icon}</span>
                {!collapsed && <span>{item.label}</span>}
              </a>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Top utility bar */}
        <header className="flex items-center gap-3 border-b border-slate-800 px-4 py-3">
          <button
            type="button"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation drawer"
            className="rounded p-1 hover:bg-slate-800 md:hidden"
          >
            ☰
          </button>
          <span className="rounded-full bg-indigo-600/20 px-2 py-0.5 text-xs font-medium text-indigo-300">
            {ROLE_LABELS[activeRole]}
          </span>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="flex flex-1 items-center gap-2 rounded bg-slate-800 px-3 py-1.5 text-left text-sm text-slate-400"
          >
            <span aria-hidden>🔍</span>
            <span className="truncate">Search…</span>
            <kbd className="ml-auto hidden rounded bg-slate-700 px-1.5 text-xs sm:inline">⌘K</kbd>
          </button>
          <span className="hidden items-center gap-1 text-xs text-slate-400 sm:flex">
            <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
            {network}
            {typeof ledger === 'number' && <span className="text-slate-500">· #{ledger}</span>}
          </span>
          <button type="button" aria-label={`Notifications (${notifications})`} className="relative rounded p-1 hover:bg-slate-800">
            🔔
            {notifications > 0 && (
              <span className="absolute -right-1 -top-1 rounded-full bg-rose-500 px-1 text-[10px]">{notifications}</span>
            )}
          </button>
          <button type="button" aria-label="Wallet menu" className="rounded p-1 hover:bg-slate-800">
            {walletAddress ? `${walletAddress.slice(0, 4)}…${walletAddress.slice(-4)}` : 'Connect'}
          </button>
        </header>

        <main className="flex-1 overflow-y-auto p-4 pb-24 md:pb-4">{children}</main>
      </div>

      {/* Mobile bottom tab bar */}
      <nav
        aria-label="Primary mobile navigation"
        className="fixed inset-x-0 bottom-0 z-30 flex border-t border-slate-800 bg-slate-900 md:hidden"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
      >
        {primaryTabs.map((item) => {
          const active = pathname === item.href;
          return (
            <a
              key={item.href}
              href={item.href}
              aria-current={active ? 'page' : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${active ? 'text-indigo-300' : 'text-slate-400'}`}
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </a>
          );
        })}
      </nav>

      {/* Mobile slide-over drawer */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 md:hidden" role="dialog" aria-modal="true" aria-label="Navigation drawer">
          <div className="absolute inset-0 bg-black/50" onClick={() => setDrawerOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 bg-slate-900 p-4">
            <div className="mb-4 flex items-center justify-between">
              <span className="text-sm font-semibold">Workspace</span>
              <button type="button" onClick={() => setDrawerOpen(false)} aria-label="Close navigation drawer">
                ✕
              </button>
            </div>
            <select
              aria-label="Switch workspace role"
              value={activeRole}
              onChange={(e) => switchRole(e.target.value as WorkspaceRole)}
              className="mb-3 w-full rounded bg-slate-800 px-2 py-1 text-sm"
            >
              {availableRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
            <nav className="space-y-1">
              {nav.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  onClick={() => setDrawerOpen(false)}
                  className="flex items-center gap-3 rounded px-2 py-2 text-sm text-slate-300 hover:bg-slate-800"
                >
                  <span aria-hidden>{item.icon}</span>
                  {item.label}
                </a>
              ))}
            </nav>
          </div>
        </div>
      )}

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
