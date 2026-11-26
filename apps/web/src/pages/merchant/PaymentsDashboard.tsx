import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient, UseQueryResult } from '@tanstack/react-query';
import { PaymentsTable } from '../../components/payments/PaymentsTable';
import { formatAmount } from '../../utils/formatAmount';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PaymentStatus =
  | 'Pending'
  | 'Completed'
  | 'Refunded'
  | 'Cancelled'
  | 'Expired'
  | 'Disputed';

export interface PaymentRecord {
  id: string;
  customer: string;
  token: string;
  tokenDecimals: number;
  amount: string; // raw i128 as decimal string
  netAmount: string; // raw i128 as decimal string
  status: PaymentStatus;
  createdAt: number;
  expiresAt?: number;
  isExpired?: boolean;
  archived?: boolean;
  notes?: string;
  metadata?: string;
  memo?: string;
}

export interface PaymentFilters {
  status: PaymentStatus | 'All';
  token: string | 'All';
  fromDate: string;
  toDate: string;
  search: string;
}

export interface KpiSummary {
  gross24h: string;
  gross7d: string;
  gross30d: string;
  gross24hDecimals: number;
  gross7dDecimals: number;
  gross30dDecimals: number;
  pendingSettlementBalance: string;
  pendingSettlementDecimals: number;
  accumulatedBalance: string;
  accumulatedBalanceDecimals: number;
  activeFeeTier: string;
  nextPayoutTimestamp: number | null;
}

export interface PaymentsPage {
  records: PaymentRecord[];
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// SDK surface (loosely typed to avoid hard coupling in this file)
// ---------------------------------------------------------------------------

interface PaymentsSdk {
  getKpiSummary: (merchant: string) => Promise<KpiSummary>;
  getAccumulatedBalance: (merchant: string) => Promise<{ amount: string; decimals: number }>;
  getPayoutSchedule: (merchant: string) => Promise<{ nextPayoutTimestamp: number | null }>;
  getAllowedTokens: () => Promise<Array<{ address: string; symbol: string; decimals: number }>>;
  listPayments: (params: {
    merchant: string;
    cursor?: string | null;
    limit: number;
    filters: PaymentFilters;
  }) => Promise<PaymentsPage>;
  subscribePaymentEvents: (handlers: {
    onPaymentCreated?: (e: unknown) => void;
    onPaymentCompleted?: (e: unknown) => void;
    onPaymentRefunded?: (e: unknown) => void;
    onError?: (err: unknown) => void;
  }) => () => void;
}

interface SdkProvider {
  payments: PaymentsSdk;
}

declare global {
  interface Window {
    __CYPHER_GRIDPAY_SDK__?: SdkProvider;
  }
}

function getSdk(): PaymentsSdk {
  const provider = window.__CYPHER_GRIDPAY_SDK__;
  if (!provider || !provider.payments) {
    throw new Error('Cypher GridPay SDK is not initialized');
  }
  return provider.payments;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 50;

const DEFAULT_FILTERS: PaymentFilters = {
  status: 'All',
  token: 'All',
  fromDate: '',
  toDate: '',
  search: '',
};

function formatTimestamp(ts: number | null | undefined): string {
  if (ts === null || ts === undefined) return '—';
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return '—';
  }
}

function safeFormatAmount(raw: string | undefined, decimals: number): string {
  if (raw === undefined || raw === null || raw === '') return '—';
  try {
    return formatAmount(raw, decimals);
  } catch {
    return '—';
  }
}

// ---------------------------------------------------------------------------
// KPI Card
// ---------------------------------------------------------------------------

interface KpiCardProps {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
}

const KpiCard: React.FC<KpiCardProps> = ({ label, value, hint, testId }) => (
  <div
    className="kpi-card"
    data-testid={testId}
    style={{
      border: '1px solid #e2e8f0',
      borderRadius: 8,
      padding: '16px 20px',
      background: '#fff',
      display: 'flex',
      flexDirection: 'column',
      gap: 6,
      minWidth: 180,
    }}
  >
    <span style={{ fontSize: 12, color: '#64748b', textTransform: 'uppercase', letterSpacing: 0.5 }}>
      {label}
    </span>
    <span style={{ fontSize: 20, fontWeight: 600, color: '#0f172a' }}>{value}</span>
    {hint ? <span style={{ fontSize: 11, color: '#94a3b8' }}>{hint}</span> : null}
  </div>
);

// ---------------------------------------------------------------------------
// Filter Bar
// ---------------------------------------------------------------------------

interface FilterBarProps {
  filters: PaymentFilters;
  onChange: (next: PaymentFilters) => void;
  tokens: Array<{ address: string; symbol: string; decimals: number }>;
  onExportCsv: () => void;
  onExportJson: () => void;
  exporting: boolean;
}

const STATUS_OPTIONS: Array<PaymentStatus | 'All'> = [
  'All',
  'Pending',
  'Completed',
  'Refunded',
  'Cancelled',
  'Expired',
  'Disputed',
];

const FilterBar: React.FC<FilterBarProps> = ({
  filters,
  onChange,
  tokens,
  onExportCsv,
  onExportJson,
  exporting,
}) => {
  const update = (patch: Partial<PaymentFilters>) => onChange({ ...filters, ...patch });

  return (
    <div
      className="payments-filter-bar"
      data-testid="payments-filter-bar"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 12,
        alignItems: 'flex-end',
        padding: '12px 0',
      }}
    >
      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569' }}>
        Status
        <select
          aria-label="Filter by status"
          value={filters.status}
          onChange={(e) => update({ status: e.target.value as PaymentFilters['status'] })}
        >
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569' }}>
        Token
        <select
          aria-label="Filter by token"
          value={filters.token}
          onChange={(e) => update({ token: e.target.value })}
        >
          <option value="All">All</option>
          {tokens.map((t) => (
            <option key={t.address} value={t.address}>
              {t.symbol}
            </option>
          ))}
        </select>
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569' }}>
        From
        <input
          type="date"
          aria-label="Filter from date"
          value={filters.fromDate}
          onChange={(e) => update({ fromDate: e.target.value })}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569' }}>
        To
        <input
          type="date"
          aria-label="Filter to date"
          value={filters.toDate}
          onChange={(e) => update({ toDate: e.target.value })}
        />
      </label>

      <label style={{ display: 'flex', flexDirection: 'column', fontSize: 12, color: '#475569', flex: 1, minWidth: 200 }}>
        Search
        <input
          type="search"
          aria-label="Search by payment ID or customer address"
          placeholder="Payment ID or customer address"
          value={filters.search}
          onChange={(e) => update({ search: e.target.value })}
        />
      </label>

      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" onClick={onExportCsv} disabled={exporting}>
          Export CSV
        </button>
        <button type="button" onClick={onExportJson} disabled={exporting}>
          Export JSON
        </button>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------
// Export helpers
// ---------------------------------------------------------------------------

function escapeCsvField(value: string): string {
  let v = value ?? '';
  // Prevent formula injection
  if (/^[=+\-@]/.test(v)) {
    v = `'${v}`;
  }
  if (/[",\n\r]/.test(v)) {
    v = `"${v.replace(/"/g, '""')}"`;
  }
  return v;
}

function buildCsv(records: PaymentRecord[]): string {
  const header = [
    'Payment ID',
    'Customer',
    'Token',
    'Amount',
    'Net Settlement',
    'Status',
    'Created At',
    'Expires At',
    'Archived',
    'Memo',
    'Notes',
    'Metadata',
  ];
  const lines = [header.map(escapeCsvField).join(',')];
  for (const r of records) {
    lines.push(
      [
        r.id,
        r.customer,
        r.token,
        safeFormatAmount(r.amount, r.tokenDecimals),
        safeFormatAmount(r.netAmount, r.tokenDecimals),
        r.status,
        formatTimestamp(r.createdAt),
        formatTimestamp(r.expiresAt),
        r.archived ? 'true' : 'false',
        r.memo ?? '',
        r.notes ?? '',
        r.metadata ?? '',
      ]
        .map((v) => escapeCsvField(String(v)))
        .join(','),
    );
  }
  return lines.join('\n');
}

function downloadFile(filename: string, content: string, mime: string): void {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export interface PaymentsDashboardProps {
  merchantAddress: string;
}

export const PaymentsDashboard: React.FC<PaymentsDashboardProps> = ({ merchantAddress }) => {
  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<PaymentFilters>(DEFAULT_FILTERS);
  const [cursor, setCursor] = useState<string | null>(null);
  const [accumulatedRecords, setAccumulatedRecords] = useState<PaymentRecord[]>([]);
  const [exporting, setExporting] = useState(false);
  const [eventError, setEventError] = useState<string | null>(null);
  const cursorStackRef = useRef<Array<string | null>>([]);

  // Reset pagination when filters change
  useEffect(() => {
    setCursor(null);
    cursorStackRef.current = [];
    setAccumulatedRecords([]);
  }, [filters.status, filters.token, filters.fromDate, filters.toDate, filters.search]);

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  const kpiQuery: UseQueryResult<KpiSummary, Error> = useQuery({
    queryKey: ['merchant', merchantAddress, 'kpi'],
    queryFn: async () => {
      const sdk = getSdk();
      const [summary, accumulated, payout] = await Promise.all([
        sdk.getKpiSummary(merchantAddress),
        sdk.getAccumulatedBalance(merchantAddress),
        sdk.getPayoutSchedule(merchantAddress),
      ]);
      return {
        ...summary,
        accumulatedBalance: accumulated.amount,
        accumulatedBalanceDecimals: accumulated.decimals,
        nextPayoutTimestamp: payout.nextPayoutTimestamp,
      };
    },
    enabled: Boolean(merchantAddress),
    staleTime: 15_000,
    refetchOnWindowFocus: true,
  });

  const tokensQuery: UseQueryResult<Array<{ address: string; symbol: string; decimals: number }>, Error> =
    useQuery({
      queryKey: ['merchant', merchantAddress, 'allowed-tokens'],
      queryFn: async () => getSdk().getAllowedTokens(),
      enabled: Boolean(merchantAddress),
      staleTime: 60_000,
    });

  const paymentsQuery: UseQueryResult<PaymentsPage, Error> = useQuery({
    queryKey: ['merchant', merchantAddress, 'payments', filters, cursor],
    queryFn: async () =>
      getSdk().listPayments({
        merchant: merchantAddress,
        cursor,
        limit: PAGE_SIZE,
        filters,
      }),
    enabled: Boolean(merchantAddress),
    keepPreviousData: true,
    staleTime: 10_000,
  });

  // Accumulate records across cursor pages for the current filter set
  useEffect(() => {
    if (!paymentsQuery.data) return;
    if (cursor === null) {
      setAccumulatedRecords(paymentsQuery.data.records);
    } else {
      setAccumulatedRecords((prev) => {
        const seen = new Set(prev.map((r) => r.id));
        const merged = [...prev];
        for (const rec of paymentsQuery.data!.records) {
          if (!seen.has(rec.id)) {
            merged.push(rec);
            seen.add(rec.id);
          }
        }
        return merged;
      });
    }
  }, [paymentsQuery.data, cursor]);

  // -------------------------------------------------------------------------
  // Real-time event subscription
  // -------------------------------------------------------------------------

  useEffect(() => {
    if (!merchantAddress) return;
    let unsubscribe: (() => void) | null = null;
    try {
      const sdk = getSdk();
      const invalidate = () => {
        // Optimistic cache invalidation: mark stale and refetch in background
        queryClient.invalidateQueries({ queryKey: ['merchant', merchantAddress, 'payments'] });
        queryClient.invalidateQueries({ queryKey: ['merchant', merchantAddress, 'kpi'] });
      };
      unsubscribe = sdk.subscribePaymentEvents({
        onPaymentCreated: invalidate,
        onPaymentCompleted: invalidate,
        onPaymentRefunded: invalidate,
        onError: (err) => {
          setEventError(err instanceof Error ? err.message : 'Event stream error');
        },
      });
    } catch (err) {
      setEventError(err instanceof Error ? err.message : 'Failed to subscribe to events');
    }
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [merchantAddress, queryClient]);

  // -------------------------------------------------------------------------
  // Pagination handlers
  // -------------------------------------------------------------------------

  const handleLoadMore = useCallback(() => {
    const next = paymentsQuery.data?.nextCursor ?? null;
    if (!next) return;
    cursorStackRef.current.push(cursor);
    setCursor(next);
  }, [paymentsQuery.data, cursor]);

  const handlePrevPage = useCallback(() => {
    const prev = cursorStackRef.current.pop();
    setCursor(prev ?? null);
  }, []);

  // -------------------------------------------------------------------------
  // Export handlers
  // -------------------------------------------------------------------------

  const handleExportCsv = useCallback(() => {
    setExporting(true);
    try {
      const csv = buildCsv(accumulatedRecords);
      downloadFile(`payments-${merchantAddress.slice(0, 8)}-${Date.now()}.csv`, csv, 'text/csv;charset=utf-8;');
    } finally {
      setExporting(false);
    }
  }, [accumulatedRecords, merchantAddress]);

  const handleExportJson = useCallback(() => {
    setExporting(true);
    try {
      const payload = accumulatedRecords.map((r) => ({
        id: r.id,
        customer: r.customer,
        token: r.token,
        amount: safeFormatAmount(r.amount, r.tokenDecimals),
        netSettlement: safeFormatAmount(r.netAmount, r.tokenDecimals),
        status: r.status,
        createdAt: r.createdAt,
        expiresAt: r.expiresAt ?? null,
        archived: Boolean(r.archived),
        memo: r.memo ?? null,
        notes: r.notes ?? null,
        metadata: r.metadata ?? null,
      }));
      downloadFile(
        `payments-${merchantAddress.slice(0, 8)}-${Date.now()}.json`,
        JSON.stringify(payload, null, 2),
        'application/json;charset=utf-8;',
      );
    } finally {
      setExporting(false);
    }
  }, [accumulatedRecords, merchantAddress]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const tokens = tokensQuery.data ?? [];

  const kpi = kpiQuery.data;
  const kpiLoading = kpiQuery.isLoading;
  const kpiError = kpiQuery.isError;

  const paymentsLoading = paymentsQuery.isLoading;
  const paymentsError = paymentsQuery.isError;
  const paymentsEmpty = !paymentsLoading && !paymentsError && accumulatedRecords.length === 0;

  const hasNextPage = Boolean(paymentsQuery.data?.nextCursor);
  const hasPrevPage = cursorStackRef.current.length > 0;

  const kpiCards = useMemo(() => {
    if (!kpi) return null;
    return (
      <>
        <KpiCard
          label="24h Gross Volume"
          value={safeFormatAmount(kpi.gross24h, kpi.gross24hDecimals)}
          testId="kpi-gross-24h"
        />
        <KpiCard
          label="7d Gross Volume"
          value={safeFormatAmount(kpi.gross7d, kpi.gross7dDecimals)}
          testId="kpi-gross-7d"
        />
        <KpiCard
          label="30d Gross Volume"
          value={safeFormatAmount(kpi.gross30d, kpi.gross30dDecimals)}
          testId="kpi-gross-30d"
        />
        <KpiCard
          label="Pending Settlement"
          value={safeFormatAmount(kpi.pendingSettlementBalance, kpi.pendingSettlementDecimals)}
          testId="kpi-pending-settlement"
        />
        <KpiCard
          label="Accumulated Balance"
          value={safeFormatAmount(kpi.accumulatedBalance, kpi.accumulatedBalanceDecimals)}
          hint="get_accumulated_balance"
          testId="kpi-accumulated-balance"
        />
        <KpiCard label="Active Fee Tier" value={kpi.activeFeeTier || '—'} testId="kpi-fee-tier" />
        <KpiCard
          label="Next Scheduled Payout"
          value={formatTimestamp(kpi.nextPayoutTimestamp)}
          hint="get_payout_schedule"
          testId="kpi-next-payout"
        />
      </>
    );
  }, [kpi]);

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div className="payments-dashboard" data-testid="payments-dashboard" style={{ padding: 24 }}>
      <header style={{ marginBottom: 20 }}>
        <h1 style={{ margin: 0, fontSize: 24, color: '#0f172a' }}>Merchant Payments</h1>
        <p style={{ margin: '4px 0 0', fontSize: 13, color: '#64748b' }}>
          Merchant: <code>{merchantAddress}</code>
        </p>
      </header>

      {eventError ? (
        <div
          role="alert"
          data-testid="event-stream-error"
          style={{
            background: '#fef2f2',
            border: '1px solid #fecaca',
            color: '#991b1b',
            padding: '8px 12px',
            borderRadius: 6,
            marginBottom: 16,
            fontSize: 13,
          }}
        >
          Real-time updates unavailable: {eventError}
        </div>
      ) : null}

      {/* KPI Section */}
      <section aria-label="KPI summary" style={{ marginBottom: 24 }}>
        {kpiLoading ? (
          <div data-testid="kpi-loading" style={{ color: '#64748b' }}>
            Loading KPIs…
          </div>
        ) : kpiError ? (
          <div
            role="alert"
            data-testid="kpi-error"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '12px 16px',
              borderRadius: 6,
            }}
          >
            Failed to load KPI summary.{' '}
            <button type="button" onClick={() => kpiQuery.refetch()}>
              Retry
            </button>
          </div>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
              gap: 12,
            }}
          >
            {kpiCards}
          </div>
        )}
      </section>

      {/* Filters */}
      <FilterBar
        filters={filters}
        onChange={setFilters}
        tokens={tokens}
        onExportCsv={handleExportCsv}
        onExportJson={handleExportJson}
        exporting={exporting}
      />

      {/* Payments Table */}
      <section aria-label="Payments">
        {paymentsLoading && accumulatedRecords.length === 0 ? (
          <div data-testid="payments-loading" style={{ color: '#64748b', padding: 24 }}>
            Loading payments…
          </div>
        ) : paymentsError ? (
          <div
            role="alert"
            data-testid="payments-error"
            style={{
              background: '#fef2f2',
              border: '1px solid #fecaca',
              color: '#991b1b',
              padding: '12px 16px',
              borderRadius: 6,
            }}
          >
            Failed to load payments from indexer/RPC.{' '}
            <button type="button" onClick={() => paymentsQuery.refetch()}>
              Retry
            </button>
          </div>
        ) : paymentsEmpty ? (
          <div
            data-testid="payments-empty"
            style={{
              padding: 32,
              textAlign: 'center',
              color: '#64748b',
              border: '1px dashed #cbd5e1',
              borderRadius: 8,
            }}
          >
            No payments match the current filters.
          </div>
        ) : (
          <>
            <PaymentsTable records={accumulatedRecords} />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginTop: 12,
              }}
            >
              <span style={{ fontSize: 12, color: '#64748b' }}>
                Showing {accumulatedRecords.length} payment{accumulatedRecords.length === 1 ? '' : 's'}
                {paymentsQuery.isFetching ? ' · refreshing…' : ''}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={handlePrevPage} disabled={!hasPrevPage}>
                  Previous
                </button>
                <button type="button" onClick={handleLoadMore} disabled={!hasNextPage}>
                  Load more
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  );
};

export default PaymentsDashboard;