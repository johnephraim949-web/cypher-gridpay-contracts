import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useWallet } from '../../hooks/useWallet';
import { useContract } from '../../hooks/useContract';
import { useToast } from '../../hooks/useToast';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

export type EscrowKind = 'standard' | 'multi-party' | 'multi-token' | 'vesting';

export interface EscrowParticipant {
  address: string;
  weight: number;
  accepted: boolean;
}

export interface EscrowObserver {
  address: string;
  addedAt?: number;
}

export interface BeneficiaryTransferProposal {
  from: string;
  to: string;
  proposedAt: number;
  accepted: boolean;
}

export interface EscrowSummary {
  id: string;
  customer: string;
  merchant: string;
  arbiter?: string;
  kind: EscrowKind;
  status: string;
  totalLocked: bigint;
  tokenSymbol: string;
  tokenCount: number;
  createdAt: number;
  expiryTimestamp: number;
  releaseTimestamp: number;
  holdPeriodUntil: number;
  participants: EscrowParticipant[];
  observers: EscrowObserver[];
  beneficiaryTransfer?: BeneficiaryTransferProposal | null;
  beneficiary: string;
  approvalThresholdBps: number;
  accumulatedWeightBps: number;
  hasVesting: boolean;
  pendingMilestones: number;
}

type RoleFilter = 'all' | 'customer' | 'merchant';
type KindFilter = 'all' | EscrowKind;

/* ------------------------------------------------------------------ */
/* Helpers                                                            */
/* ------------------------------------------------------------------ */

const ZERO = BigInt(0);

function formatBigIntAmount(value: bigint | undefined | null, decimals = 7): string {
  if (value === undefined || value === null) return '0';
  const negative = value < ZERO;
  const abs = negative ? -value : value;
  const base = BigInt(10) ** BigInt(decimals);
  const whole = abs / base;
  const frac = abs % base;
  const fracStr = frac.toString().padStart(decimals, '0').replace(/0+$/, '');
  const wholeStr = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${negative ? '-' : ''}${wholeStr}${fracStr ? `.${fracStr}` : ''}`;
}

function formatTimestamp(ts: number): string {
  if (!ts || ts <= 0) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return '—';
  }
}

function shortenAddress(addr: string | undefined | null): string {
  if (!addr) return '—';
  if (addr.length <= 12) return addr;
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function kindLabel(kind: EscrowKind): string {
  switch (kind) {
    case 'multi-party':
      return 'Multi-Party';
    case 'multi-token':
      return 'Multi-Token';
    case 'vesting':
      return 'Vesting';
    default:
      return 'Standard';
  }
}

function kindBadgeClass(kind: EscrowKind): string {
  switch (kind) {
    case 'multi-party':
      return 'bg-purple-100 text-purple-800 border-purple-200';
    case 'multi-token':
      return 'bg-amber-100 text-amber-800 border-amber-200';
    case 'vesting':
      return 'bg-teal-100 text-teal-800 border-teal-200';
    default:
      return 'bg-slate-100 text-slate-800 border-slate-200';
  }
}

function statusBadgeClass(status: string): string {
  const s = (status || '').toLowerCase();
  if (s.includes('released') || s.includes('completed') || s.includes('claimed')) {
    return 'bg-green-100 text-green-800 border-green-200';
  }
  if (s.includes('expired') || s.includes('cancelled') || s.includes('refunded')) {
    return 'bg-red-100 text-red-800 border-red-200';
  }
  if (s.includes('disputed')) {
    return 'bg-orange-100 text-orange-800 border-orange-200';
  }
  if (s.includes('active') || s.includes('funded')) {
    return 'bg-blue-100 text-blue-800 border-blue-200';
  }
  return 'bg-slate-100 text-slate-700 border-slate-200';
}

function isObserver(escrow: EscrowSummary, viewer: string | null): boolean {
  if (!viewer) return false;
  return escrow.observers.some((o) => o.address.toLowerCase() === viewer.toLowerCase());
}

function isParticipant(escrow: EscrowSummary, viewer: string | null): boolean {
  if (!viewer) return false;
  const v = viewer.toLowerCase();
  if (escrow.customer.toLowerCase() === v) return true;
  if (escrow.merchant.toLowerCase() === v) return true;
  if (escrow.arbiter && escrow.arbiter.toLowerCase() === v) return true;
  return escrow.participants.some((p) => p.address.toLowerCase() === v);
}

/* ------------------------------------------------------------------ */
/* Component                                                          */
/* ------------------------------------------------------------------ */

const EscrowListPage: React.FC = () => {
  const { address: viewer, isConnected } = useWallet();
  const { getContract } = useContract();
  const { pushToast } = useToast();

  const [escrows, setEscrows] = useState<EscrowSummary[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [roleFilter, setRoleFilter] = useState<RoleFilter>('all');
  const [kindFilter, setKindFilter] = useState<KindFilter>('all');
  const [search, setSearch] = useState<string>('');
  const [actionPending, setActionPending] = useState<string | null>(null);

  /* -------------------------------------------------------------- */
  /* Data loading                                                   */
  /* -------------------------------------------------------------- */

  const loadEscrows = useCallback(async () => {
    if (!isConnected || !viewer) {
      setEscrows([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const contract = getContract();
      const ids = new Set<string>();

      if (roleFilter === 'all' || roleFilter === 'customer') {
        const byCustomer: string[] = await contract.get_escrows_by_customer(viewer);
        (byCustomer || []).forEach((id) => ids.add(String(id)));
      }
      if (roleFilter === 'all' || roleFilter === 'merchant') {
        const byMerchant: string[] = await contract.get_escrows_by_merchant(viewer);
        (byMerchant || []).forEach((id) => ids.add(String(id)));
      }

      const summaries: EscrowSummary[] = [];
      for (const id of Array.from(ids)) {
        try {
          const details = await contract.get_escrow_details(id);
          const summary = await buildEscrowSummary(contract, id, details);
          summaries.push(summary);
        } catch (innerErr) {
          // Skip escrows that fail to load but keep the rest visible.
          // eslint-disable-next-line no-console
          console.warn(`Failed to load escrow ${id}`, innerErr);
        }
      }

      summaries.sort((a, b) => b.createdAt - a.createdAt);
      setEscrows(summaries);
    } catch (err: any) {
      setError(err?.message ?? 'Failed to load escrows');
    } finally {
      setLoading(false);
    }
  }, [getContract, isConnected, roleFilter, viewer]);

  useEffect(() => {
    void loadEscrows();
  }, [loadEscrows]);

  /* -------------------------------------------------------------- */
  /* Beneficiary transfer actions                                   */
  /* -------------------------------------------------------------- */

  const handleAcceptBeneficiaryTransfer = useCallback(
    async (escrow: EscrowSummary) => {
      if (!viewer) return;
      setActionPending(escrow.id);
      try {
        const contract = getContract();
        const tx = await contract.accept_beneficiary_transfer(escrow.id, { signer: viewer });
        await tx.wait?.();
        pushToast({ type: 'success', message: `Beneficiary transfer accepted for escrow #${escrow.id}` });
        await loadEscrows();
      } catch (err: any) {
        pushToast({ type: 'error', message: err?.message ?? 'Failed to accept beneficiary transfer' });
      } finally {
        setActionPending(null);
      }
    },
    [getContract, loadEscrows, pushToast, viewer],
  );

  const handleProposeBeneficiaryTransfer = useCallback(
    async (escrow: EscrowSummary) => {
      if (!viewer) return;
      const target = window.prompt('Enter the new beneficiary address:');
      if (!target) return;
      setActionPending(escrow.id);
      try {
        const contract = getContract();
        const tx = await contract.propose_beneficiary_transfer(escrow.id, target, { signer: viewer });
        await tx.wait?.();
        pushToast({ type: 'success', message: `Beneficiary transfer proposed for escrow #${escrow.id}` });
        await loadEscrows();
      } catch (err: any) {
        pushToast({ type: 'error', message: err?.message ?? 'Failed to propose beneficiary transfer' });
      } finally {
        setActionPending(null);
      }
    },
    [getContract, loadEscrows, pushToast, viewer],
  );

  /* -------------------------------------------------------------- */
  /* Derived data                                                   */
  /* -------------------------------------------------------------- */

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return escrows.filter((e) => {
      if (kindFilter !== 'all' && e.kind !== kindFilter) return false;
      if (!q) return true;
      return (
        e.id.toLowerCase().includes(q) ||
        e.customer.toLowerCase().includes(q) ||
        e.merchant.toLowerCase().includes(q) ||
        e.beneficiary.toLowerCase().includes(q) ||
        e.tokenSymbol.toLowerCase().includes(q)
      );
    });
  }, [escrows, kindFilter, search]);

  const totals = useMemo(() => {
    let locked = ZERO;
    let multiParty = 0;
    let vesting = 0;
    let multiToken = 0;
    for (const e of filtered) {
      locked += e.totalLocked;
      if (e.kind === 'multi-party') multiParty += 1;
      if (e.kind === 'vesting' || e.hasVesting) vesting += 1;
      if (e.kind === 'multi-token' || e.tokenCount > 1) multiToken += 1;
    }
    return { locked, multiParty, vesting, multiToken };
  }, [filtered]);

  /* -------------------------------------------------------------- */
  /* Render                                                         */
  /* -------------------------------------------------------------- */

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-5xl px-4 py-12">
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-2xl font-semibold text-slate-900">Escrows</h1>
          <p className="mt-2 text-slate-600">Connect your wallet to view your escrows.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-900">Escrows</h1>
          <p className="text-sm text-slate-600">
            Track locked funds, approval quorums, vesting schedules, and beneficiary transfers.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadEscrows()}
          disabled={loading}
          className="inline-flex items-center rounded-md border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </header>

      {/* Summary cards */}
      <section className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryCard label="Total Locked" value={formatBigIntAmount(totals.locked)} />
        <SummaryCard label="Multi-Party" value={String(totals.multiParty)} />
        <SummaryCard label="Multi-Token" value={String(totals.multiToken)} />
        <SummaryCard label="Vesting" value={String(totals.vesting)} />
      </section>

      {/* Filters */}
      <section className="mb-4 flex flex-col gap-3 rounded-lg border border-slate-200 bg-white p-4 shadow-sm sm:flex-row sm:items-center">
        <div className="flex items-center gap-2">
          <label htmlFor="role-filter" className="text-sm font-medium text-slate-700">
            Role
          </label>
          <select
            id="role-filter"
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value as RoleFilter)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="all">All</option>
            <option value="customer">As Customer</option>
            <option value="merchant">As Merchant</option>
          </select>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="kind-filter" className="text-sm font-medium text-slate-700">
            Type
          </label>
          <select
            id="kind-filter"
            value={kindFilter}
            onChange={(e) => setKindFilter(e.target.value as KindFilter)}
            className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-sm"
          >
            <option value="all">All</option>
            <option value="standard">Standard</option>
            <option value="multi-party">Multi-Party</option>
            <option value="multi-token">Multi-Token</option>
            <option value="vesting">Vesting</option>
          </select>
        </div>
        <div className="flex-1">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by ID, address, or token…"
            className="w-full rounded-md border border-slate-300 px-3 py-1.5 text-sm"
          />
        </div>
      </section>

      {error && (
        <div className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {error}
        </div>
      )}

      {/* List */}
      {loading && escrows.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
          Loading escrows…
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-lg border border-slate-200 bg-white p-8 text-center text-slate-500">
          No escrows found.
        </div>
      ) : (
        <ul className="space-y-4">
          {filtered.map((escrow) => {
            const observer = isObserver(escrow, viewer);
            const participant = isParticipant(escrow, viewer);
            const pendingTransfer =
              escrow.beneficiaryTransfer && !escrow.beneficiaryTransfer.accepted
                ? escrow.beneficiaryTransfer
                : null;
            const canAcceptTransfer =
              !!pendingTransfer &&
              !!viewer &&
              pendingTransfer.to.toLowerCase() === viewer.toLowerCase() &&
              !observer;
            const canProposeTransfer =
              !!viewer &&
              !observer &&
              participant &&
              !pendingTransfer &&
              escrow.beneficiary.toLowerCase() === viewer.toLowerCase();

            return (
              <li
                key={escrow.id}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
              >
                {/* Beneficiary transfer banner */}
                {pendingTransfer && (
                  <div className="mb-3 flex flex-col gap-2 rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm text-indigo-900 sm:flex-row sm:items-center sm:justify-between">
                    <span>
                      Beneficiary transfer pending: {shortenAddress(pendingTransfer.from)} →{' '}
                      {shortenAddress(pendingTransfer.to)}
                    </span>
                    {canAcceptTransfer ? (
                      <button
                        type="button"
                        onClick={() => void handleAcceptBeneficiaryTransfer(escrow)}
                        disabled={actionPending === escrow.id}
                        className="inline-flex items-center rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {actionPending === escrow.id ? 'Accepting…' : 'Accept Transfer'}
                      </button>
                    ) : (
                      <span className="text-xs font-medium text-indigo-700">
                        Awaiting acceptance by {shortenAddress(pendingTransfer.to)}
                      </span>
                    )}
                  </div>
                )}

                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        to={`/escrow/${escrow.id}`}
                        className="text-lg font-semibold text-slate-900 hover:text-indigo-600"
                      >
                        Escrow #{escrow.id}
                      </Link>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${kindBadgeClass(
                          escrow.kind,
                        )}`}
                      >
                        {kindLabel(escrow.kind)}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${statusBadgeClass(
                          escrow.status,
                        )}`}
                      >
                        {escrow.status}
                      </span>
                      {observer && (
                        <span className="inline-flex items-center rounded-full border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-600">
                          Observer · Read-only
                        </span>
                      )}
                      {escrow.hasVesting && (
                        <span className="inline-flex items-center rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-700">
                          {escrow.pendingMilestones} milestone
                          {escrow.pendingMilestones === 1 ? '' : 's'} pending
                        </span>
                      )}
                    </div>

                    <dl className="mt-3 grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Customer</dt>
                        <dd className="font-mono text-slate-800">{shortenAddress(escrow.customer)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Merchant</dt>
                        <dd className="font-mono text-slate-800">{shortenAddress(escrow.merchant)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Beneficiary</dt>
                        <dd className="font-mono text-slate-800">{shortenAddress(escrow.beneficiary)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Locked</dt>
                        <dd className="font-mono font-semibold text-slate-900">
                          {formatBigIntAmount(escrow.totalLocked)} {escrow.tokenSymbol}
                          {escrow.tokenCount > 1 && (
                            <span className="ml-1 text-xs font-normal text-slate-500">
                              ({escrow.tokenCount} tokens)
                            </span>
                          )}
                        </dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Expiry</dt>
                        <dd className="text-slate-800">{formatTimestamp(escrow.expiryTimestamp)}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-slate-500">Release Timelock</dt>
                        <dd className="text-slate-800">{formatTimestamp(escrow.releaseTimestamp)}</dd>
                      </div>
                    </dl>

                    {escrow.kind === 'multi-party' && (
                      <div className="mt-3">
                        <div className="mb-1 flex items-center justify-between text-xs text-slate-600">
                          <span>Approval Quorum</span>
                          <span>
                            {Math.min(escrow.accumulatedWeightBps, escrow.approvalThresholdBps)} /{' '}
                            {escrow.approvalThresholdBps} bps
                          </span>
                        </div>
                        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
                          <div
                            className="h-full rounded-full bg-purple-600 transition-all"
                            style={{
                              width: `${
                                escrow.approvalThresholdBps > 0
                                  ? Math.min(
                                      100,
                                      (escrow.accumulatedWeightBps / escrow.approvalThresholdBps) * 100,
                                    )
                                  : 0
                              }%`,
                            }}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="flex shrink-0 flex-col gap-2 sm:items-end">
                    <Link
                      to={`/escrow/${escrow.id}`}
                      className="inline-flex items-center justify-center rounded-md bg-indigo-600 px-3 py-2 text-sm font-semibold text-white hover:bg-indigo-700"
                    >
                      View Details
                    </Link>
                    {canProposeTransfer && (
                      <button
                        type="button"
                        onClick={() => void handleProposeBeneficiaryTransfer(escrow)}
                        disabled={actionPending === escrow.id}
                        className="inline-flex items-center justify-center rounded-md border border-slate-300 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                      >
                        {actionPending === escrow.id ? 'Proposing…' : 'Propose Beneficiary Transfer'}
                      </button>
                    )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Sub-components                                                     */
/* ------------------------------------------------------------------ */

const SummaryCard: React.FC<{ label: string; value: string }> = ({ label, value }) => (
  <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
    <p className="mt-1 font-mono text-xl font-semibold text-slate-900">{value}</p>
  </div>
);

/* ------------------------------------------------------------------ */
/* Data mapping                                                       */
/* ------------------------------------------------------------------ */

async function buildEscrowSummary(
  contract: any,
  id: string,
  details: any,
): Promise<EscrowSummary> {
  const customer: string = details.customer ?? details.buyer ?? '';
  const merchant: string = details.merchant ?? details.seller ?? '';
  const arbiter: string | undefined = details.arbiter ?? undefined;
  const beneficiary: string = details.beneficiary ?? customer;

  const isMultiParty: boolean =
    details.is_multi_party === true ||
    (Array.isArray(details.participants) && details.participants.length > 0) ||
    details.escrow_type === 'multi_party';

  const tokenCount: number = Array.isArray(details.tokens)
    ? details.tokens.length
    : details.token_count ?? 1;

  const hasVesting: boolean =
    details.has_vesting === true ||
    details.vesting_schedule != null ||
    details.escrow_type === 'vesting';

  let kind: EscrowKind = 'standard';
  if (hasVesting) kind = 'vesting';
  else if (isMultiParty) kind = 'multi-party';
  else if (tokenCount > 1) kind = 'multi-token';

  // Participants + weights
  let participants: EscrowParticipant[] = [];
  if (isMultiParty) {
    try {
      const mp = await contract.get_multi_party_escrow(id);
      const rawParticipants = mp?.participants ?? details.participants ?? [];
      participants = await Promise.all(
        (rawParticipants as any[]).map(async (p: any) => {
          const addr: string = typeof p === 'string' ? p : p.address ?? p.account ?? '';
          let weight = 0;
          try {
            const w = await contract.get_approval_weight(id, addr);
            weight = Number(w ?? 0);
          } catch {
            weight = Number(p?.weight ?? 0);
          }
          let accepted = false;
          try {
            const status = await contract.get_initiation_status(id, addr);
            accepted = status === true || status === 1 || status === 'accepted';
          } catch {
            accepted = Boolean(p?.accepted);
          }
          return { address: addr, weight, accepted };
        }),
      );
    } catch {
      participants = [];
    }
  }

  // Observers
  let observers: EscrowObserver[] = [];
  try {
    const rawObservers = await contract.get_observers(id);
    observers = (rawObservers as any[]).map((o: any) => ({
      address: typeof o === 'string' ? o : o.address ?? o.account ?? '',
      addedAt: typeof o === 'object' ? o.added_at ?? o.addedAt : undefined,
    }));
  } catch {
    observers = [];
  }

  // Beneficiary transfer proposal
  let beneficiaryTransfer: BeneficiaryTransferProposal | null = null;
  const rawProposal = details.beneficiary_transfer ?? details.pending_beneficiary_transfer;
  if (rawProposal) {
    beneficiaryTransfer = {
      from: rawProposal.from ?? beneficiary,
      to: rawProposal.to ?? rawProposal.new_beneficiary ?? '',
      proposedAt: Number(rawProposal.proposed_at ?? rawProposal.proposedAt ?? 0),
      accepted: Boolean(rawProposal.accepted),
    };
  }

  // Quorum
  const approvalThresholdBps = Number(
    details.approval_threshold_bps ?? details.threshold_bps ?? 0,
  );
  let accumulatedWeightBps = 0;
  if (isMultiParty && participants.length > 0) {
    accumulatedWeightBps = participants
      .filter((p) => p.accepted)
      .reduce((sum, p) => sum + p.weight, 0);
  }

  // Pending milestones
  let pendingMilestones = 0;
  if (hasVesting) {
    try {
      const pending = await contract.get_pending_milestones(id);
      pendingMilestones = Array.isArray(pending) ? pending.length : Number(pending ?? 0);
    } catch {
      pendingMilestones = 0;
    }
  }

  // Locked amount
  let totalLocked = ZERO;
  const rawLocked = details.total_locked ?? details.amount ?? details.total_amount;
  if (rawLocked !== undefined && rawLocked !== null) {
    totalLocked = BigInt(rawLocked.toString());
  } else if (Array.isArray(details.tokens)) {
    for (const t of details.tokens) {
      const amt = t.amount ?? t.locked ?? 0;
      totalLocked += BigInt(amt.toString());
    }
  }

  const tokenSymbol: string =
    details.token_symbol ?? details.symbol ?? (Array.isArray(details.tokens) && details.tokens[0]?.symbol) ?? 'TOKEN';

  return {
    id,
    customer,
    merchant,
    arbiter,
    kind,
    status: details.status ?? 'unknown',
    totalLocked,
    tokenSymbol,
    tokenCount,
    createdAt: Number(details.created_at ?? details.createdAt ?? 0),
    expiryTimestamp: Number(details.expiry_timestamp ?? details.expiryTimestamp ?? 0),
    releaseTimestamp: Number(details.release_timestamp ?? details.releaseTimestamp ?? 0),
    holdPeriodUntil: Number(details.hold_period_until ?? details.holdPeriodUntil ?? 0),
    participants,
    observers,
    beneficiaryTransfer,
    beneficiary,
    approvalThresholdBps,
    accumulatedWeightBps,
    hasVesting,
    pendingMilestones,
  };
}

export default EscrowListPage;