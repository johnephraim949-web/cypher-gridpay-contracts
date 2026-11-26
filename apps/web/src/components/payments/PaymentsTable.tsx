import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';

// ---------------------------------------------------------------------------
// Types & enums (mirrors @cypher-gridpay/contracts-sdk Payment contract)
// ---------------------------------------------------------------------------

export enum PaymentStatus {
  Pending = 'Pending',
  Completed = 'Completed',
  Refunded = 'Refunded',
  Cancelled = 'Cancelled',
  Expired = 'Expired',
  Disputed = 'Disputed',
}

export interface PaymentMemo {
  /** Raw memo type as stored on-chain (e.g. "text", "id", "hash", "return"). */
  type: string;
  /** Decoded memo value. */
  value: string;
}

export interface PaymentRecord {
  id: string;
  customer: string;
  token: string;
  /** i128 stroop amount as decimal string (never a JS number). */
  amount: string;
  /** Net settlement amount after fees, i128 decimal string. */
  netAmount: string;
  status: PaymentStatus;
  memo?: PaymentMemo | null;
  /** Free-text merchant notes — must be sanitized before render. */
  notes?: string | null;
  /** Arbitrary metadata JSON string — must be sanitized before render. */
  metadata?: string | null;
  createdAt: string;
  updatedAt: string;
  expiresAt?: string | null;
  /** True when the payment is Pending and past its expiry. */
  isExpired?: boolean;
  /** True when the underlying Soroban ledger entry has been archived. */
  isArchived?: boolean;
}

export interface PaymentFilters {
  status?: PaymentStatus | null;
  token?: string | null;
  dateFrom?: string | null;
  dateTo?: string | null;
  search?: string | null;
}

export interface PaymentsPage {
  records: PaymentRecord[];
  nextCursor: string | null;
}

export interface AllowedToken {
  address: string;
  symbol: string;
  decimals: number;
}

// ---------------------------------------------------------------------------
// SDK surface (injected for testability)
// ---------------------------------------------------------------------------

export interface PaymentsSdk {
  listPayments: (params: {
    filters: PaymentFilters;
    cursor: string | null;
    limit: number;
  }) => Promise<PaymentsPage>;
  getAllowedTokens: () => Promise<AllowedToken[]>;
  isPaymentExpired: (paymentId: string) => Promise<boolean>;
  restoreArchivedEntry: (paymentId: string) => Promise<void>;
  expirePayment: (paymentId: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// BigInt-safe amount formatting
// ---------------------------------------------------------------------------

/**
 * Format an i128 decimal string into a human-readable token amount using
 * BigInt arithmetic only. Never converts through JS Number.
 */
export function formatAmount(raw: string, decimals: number): string {
  if (raw === null || raw === undefined || raw === '') return '0';
  let negative = false;
  let value = raw.trim();
  if (value.startsWith('-')) {
    negative = true;
    value = value.slice(1);
  }
  if (!/^\d+$/.test(value)) {
    // Defensive: reject non-integer input rather than silently rounding.
    return raw;
  }
  const big = BigInt(value);
  const base = BigInt(10) ** BigInt(decimals);
  const whole = big / base;
  const frac = big % base;
  let fracStr = frac.toString().padStart(decimals, '0');
  // Trim trailing zeros but keep at least 2 decimals for readability.
  fracStr = fracStr.replace(/0+$/, '');
  if (fracStr.length < 2) fracStr = fracStr.padEnd(2, '0');
  const sign = negative ? '-' : '';
  return decimals === 0 ? `${sign}${whole.toString()}` : `${sign}${whole.toString()}.${fracStr}`;
}

// ---------------------------------------------------------------------------
// XSS sanitization
// ---------------------------------------------------------------------------

const HTML_ESCAPE_MAP: Record<string, string> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
};

/**
 * Escape free-text so it is safe to render. React already escapes text nodes,
 * but we defensively sanitize before any string interpolation / export.
 */
export function sanitizeText(input: string | null | undefined): string {
  if (input === null || input === undefined) return '';
  return String(input).replace(/[&<>"'`]/g, (ch) => HTML_ESCAPE_MAP[ch] ?? ch);
}

// ---------------------------------------------------------------------------
// CSV formula-injection escaping
// ---------------------------------------------------------------------------

const FORMULA_PREFIXES = ['=', '+', '-', '@', '\t', '\r'];

export function escapeCsvCell(value: string | null | undefined): string {
  const str = value === null || value === undefined ? '' : String(value);
  let safe = str;
  if (safe.length > 0 && FORMULA_PREFIXES.includes(safe[0])) {
    safe = `'${safe}`;
  }
  if (/[",\n\r]/.test(safe)) {
    safe = `"${safe.replace(/"/g, '""')}"`;
  }
  return safe;
}

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_STYLES: Record<PaymentStatus, string> = {
  [PaymentStatus.Pending]: 'bg-amber-100 text-amber-800 border-amber-300',
  [PaymentStatus.Completed]: 'bg-emerald-100 text-emerald-800 border-emerald-300',
  [PaymentStatus.Refunded]: 'bg-sky-100 text-sky-800 border-sky-300',
  [PaymentStatus.Cancelled]: 'bg-slate-100 text-slate-700 border-slate-300',
  [PaymentStatus.Expired]: 'bg-rose-100 text-rose-800 border-rose-300',
  [PaymentStatus.Disputed]: 'bg-purple-100 text-purple-800 border-purple-300',
};

function StatusBadge({ status }: { status: PaymentStatus }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[status] ?? ''}`}
    >
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface PaymentsTableProps {
  sdk: PaymentsSdk;
  /** Optional externally-controlled filters (e.g. from dashboard). */
  filters?: PaymentFilters;
  /** Page size for cursor pagination. */
  pageSize?: number;
  /** Called when a record is restored or expired so parent can refresh KPIs. */
  onRecordMutated?: () => void;
}

const DEFAULT_FILTERS: PaymentFilters = {
  status: null,
  token: null,
  dateFrom: null,
  dateTo: null,
  search: null,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PaymentsTable({
  sdk,
  filters: externalFilters,
  pageSize = 25,
  onRecordMutated,
}: PaymentsTableProps) {
  const queryClient = useQueryClient();
  const [internalFilters, setInternalFilters] = useState<PaymentFilters>(DEFAULT_FILTERS);
  const filters = externalFilters ?? internalFilters;

  const setFilters = useCallback(
    (patch: Partial<PaymentFilters>) => {
      if (externalFilters) return; // externally controlled
      setInternalFilters((prev) => ({ ...prev, ...patch }));
    },
    [externalFilters],
  );

  // Whitelisted SEP-41 tokens
  const tokensQuery = useQuery<AllowedToken[]>({
    queryKey: ['payments', 'allowed-tokens'],
    queryFn: () => sdk.getAllowedTokens(),
    staleTime: 60_000,
  });

  const tokenDecimals = useMemo(() => {
    const map = new Map<string, number>();
    (tokensQuery.data ?? []).forEach((t) => map.set(t.address, t.decimals));
    return map;
  }, [tokensQuery.data]);

  const tokenSymbol = useMemo(() => {
    const map = new Map<string, string>();
    (tokensQuery.data ?? []).forEach((t) => map.set(t.address, t.symbol));
    return map;
  }, [tokensQuery.data]);

  const queryKey = useMemo(
    () => ['payments', 'list', filters, pageSize] as const,
    [filters, pageSize],
  );

  const paymentsQuery = useInfiniteQuery<PaymentsPage, Error>({
    queryKey,
    queryFn: ({ pageParam }) =>
      sdk.listPayments({
        filters,
        cursor: (pageParam as string | null) ?? null,
        limit: pageSize,
      }),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
  });

  const records = useMemo(
    () => (paymentsQuery.data?.pages ?? []).flatMap((p) => p.records),
    [paymentsQuery.data],
  );

  // Mutations for restore / expire
  const restoreMutation = useMutation({
    mutationFn: (paymentId: string) => sdk.restoreArchivedEntry(paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      onRecordMutated?.();
    },
  });

  const expireMutation = useMutation({
    mutationFn: (paymentId: string) => sdk.expirePayment(paymentId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['payments'] });
      onRecordMutated?.();
    },
  });

  // Virtualization
  const parentRef = useRef<HTMLDivElement | null>(null);
  const rowVirtualizer = useVirtualizer({
    count: records.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 64,
    overscan: 8,
  });

  // Infinite scroll: fetch next page when near bottom
  const virtualItems = rowVirtualizer.getVirtualItems();
  useEffect(() => {
    if (virtualItems.length === 0) return;
    const last = virtualItems[virtualItems.length - 1];
    if (
      last.index >= records.length - 1 &&
      paymentsQuery.hasNextPage &&
      !paymentsQuery.isFetchingNextPage
    ) {
      void paymentsQuery.fetchNextPage();
    }
  }, [
    virtualItems,
    records.length,
    paymentsQuery.hasNextPage,
    paymentsQuery.isFetchingNextPage,
    paymentsQuery,
  ]);

  // Export
  const handleExport = useCallback(
    (format: 'csv' | 'json') => {
      const rows = records.map((r) => {
        const decimals = tokenDecimals.get(r.token) ?? 7;
        const memo = r.memo ? `${r.memo.type}:${r.memo.value}` : '';
        return {
          id: r.id,
          customer: r.customer,
          token: r.token,
          tokenSymbol: tokenSymbol.get(r.token) ?? '',
          amount: formatAmount(r.amount, decimals),
          netAmount: formatAmount(r.netAmount, decimals),
          status: r.status,
          memo,
          notes: sanitizeText(r.notes),
          metadata: sanitizeText(r.metadata),
          createdAt: r.createdAt,
          updatedAt: r.updatedAt,
          expiresAt: r.expiresAt ?? '',
          isExpired: r.isExpired ? 'true' : 'false',
          isArchived: r.isArchived ? 'true' : 'false',
        };
      });

      let blob: Blob;
      let filename: string;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-');
      if (format === 'csv') {
        const headers = [
          'id',
          'customer',
          'token',
          'tokenSymbol',
          'amount',
          'netAmount',
          'status',
          'memo',
          'notes',
          'metadata',
          'createdAt',
          'updatedAt',
          'expiresAt',
          'isExpired',
          'isArchived',
        ];
        const lines = [headers.join(',')];
        for (const row of rows) {
          lines.push(
            headers
              .map((h) => escapeCsvCell((row as Record<string, string>)[h]))
              .join(','),
          );
        }
        blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
        filename = `payments-${stamp}.csv`;
      } else {
        blob = new Blob([JSON.stringify(rows, null, 2)], {
          type: 'application/json',
        });
        filename = `payments-${stamp}.json`;
      }

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
    [records, tokenDecimals, tokenSymbol],
  );

  // -------------------------------------------------------------------------
  // Render states
  // -------------------------------------------------------------------------

  const isInitialLoading = paymentsQuery.isLoading;
  const isError = paymentsQuery.isError;
  const isEmpty = !isInitialLoading && !isError && records.length === 0;

  const renderFilters = () => (
    <div className="flex flex-wrap items-center gap-2 border-b border-slate-200 p-3">
      <select
        aria-label="Filter by status"
        className="rounded border border-slate-300 px-2 py-1 text-sm"
        value={filters.status ?? ''}
        onChange={(e) =>
          setFilters({
            status: (e.target.value || null) as PaymentStatus | null,
          })
        }
      >
        <option value="">All statuses</option>
        {Object.values(PaymentStatus).map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </select>

      <select
        aria-label="Filter by token"
        className="rounded border border-slate-300 px-2 py-1 text-sm"
        value={filters.token ?? ''}
        onChange={(e) => setFilters({ token: e.target.value || null })}
      >
        <option value="">All tokens</option>
        {(tokensQuery.data ?? []).map((t) => (
          <option key={t.address} value={t.address}>
            {t.symbol}
          </option>
        ))}
      </select>

      <input
        type="date"
        aria-label="From date"
        className="rounded border border-slate-300 px-2 py-1 text-sm"
        value={filters.dateFrom ?? ''}
        onChange={(e) => setFilters({ dateFrom: e.target.value || null })}
      />
      <input
        type="date"
        aria-label="To date"
        className="rounded border border-slate-300 px-2 py-1 text-sm"
        value={filters.dateTo ?? ''}
        onChange={(e) => setFilters({ dateTo: e.target.value || null })}
      />

      <input
        type="search"
        aria-label="Search payment ID or customer"
        placeholder="Search ID or customer"
        className="min-w-[180px] rounded border border-slate-300 px-2 py-1 text-sm"
        value={filters.search ?? ''}
        onChange={(e) => setFilters({ search: e.target.value || null })}
      />

      <div className="ml-auto flex gap-2">
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
          onClick={() => handleExport('csv')}
          disabled={records.length === 0}
        >
          Export CSV
        </button>
        <button
          type="button"
          className="rounded border border-slate-300 px-2 py-1 text-sm hover:bg-slate-50"
          onClick={() => handleExport('json')}
          disabled={records.length === 0}
        >
          Export JSON
        </button>
      </div>
    </div>
  );

  const renderRow = (record: PaymentRecord) => {
    const decimals = tokenDecimals.get(record.token) ?? 7;
    const symbol = tokenSymbol.get(record.token) ?? record.token.slice(0, 6);
    const expired = record.isExpired || (record.status === PaymentStatus.Pending && record.expiresAt && new Date(record.expiresAt).getTime() < Date.now());
    const archived = record.isArchived === true;

    return (
      <div className="grid grid-cols-[1.2fr_1.2fr_0.8fr_1fr_1fr_0.9fr_1.4fr_1.2fr_1.2fr] items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm">
        <span className="truncate font-mono text-xs" title={record.id}>
          {record.id}
        </span>
        <span className="truncate font-mono text-xs" title={record.customer}>
          {record.customer}
        </span>
        <span className="truncate">{symbol}</span>
        <span className="text-right font-mono">
          {formatAmount(record.amount, decimals)}
        </span>
        <span className="text-right font-mono">
          {formatAmount(record.netAmount, decimals)}
        </span>
        <span className="flex flex-wrap gap-1">
          <StatusBadge status={record.status} />
          {expired && (
            <span className="inline-flex items-center rounded-full border border-rose-300 bg-rose-50 px-2 py-0.5 text-xs font-medium text-rose-700">
              Expired
            </span>
          )}
          {archived && (
            <span className="inline-flex items-center rounded-full border border-slate-400 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
              Archived
            </span>
          )}
        </span>
        <span className="truncate text-xs" title={record.memo?.value ?? ''}>
          {record.memo ? `${record.memo.type}:${sanitizeText(record.memo.value)}` : '—'}
        </span>
        <span className="truncate text-xs text-slate-500" title={record.createdAt}>
          {record.createdAt}
        </span>
        <span className="flex gap-1">
          {archived && (
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50 disabled:opacity-50"
              disabled={restoreMutation.isPending}
              onClick={() => restoreMutation.mutate(record.id)}
            >
              Restore
            </button>
          )}
          {expired && record.status === PaymentStatus.Pending && (
            <button
              type="button"
              className="rounded border border-rose-300 px-2 py-0.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
              disabled={expireMutation.isPending}
              onClick={() => expireMutation.mutate(record.id)}
            >
              Expire
            </button>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="flex flex-col rounded-lg border border-slate-200 bg-white">
      {renderFilters()}

      {/* Header */}
      <div className="grid grid-cols-[1.2fr_1.2fr_0.8fr_1fr_1fr_0.9fr_1.4fr_1.2fr_1.2fr] gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
        <span>Payment ID</span>
        <span>Customer</span>
        <span>Token</span>
        <span className="text-right">Amount</span>
        <span className="text-right">Net</span>
        <span>Status</span>
        <span>Memo</span>
        <span>Created</span>
        <span>Actions</span>
      </div>

      {/* Body */}
      {isInitialLoading && (
        <div className="flex items-center justify-center p-8 text-sm text-slate-500" role="status">
          Loading payments…
        </div>
      )}

      {isError && (
        <div className="flex flex-col items-center justify-center gap-2 p-8 text-sm text-rose-700" role="alert">
          <span>Failed to load payments from RPC/indexer.</span>
          <button
            type="button"
            className="rounded border border-rose-300 px-3 py-1 text-xs hover:bg-rose-50"
            onClick={() => paymentsQuery.refetch()}
          >
            Retry
          </button>
        </div>
      )}

      {isEmpty && (
        <div className="flex items-center justify-center p-8 text-sm text-slate-500" role="status">
          No payments match the current filters.
        </div>
      )}

      {!isInitialLoading && !isError && records.length > 0 && (
        <div ref={parentRef} className="max-h-[600px] overflow-auto">
          <div
            style={{
              height: `${rowVirtualizer.getTotalSize()}px`,
              width: '100%',
              position: 'relative',
            }}
          >
            {virtualItems.map((virtualRow) => {
              const record = records[virtualRow.index];
              if (!record) return null;
              return (
                <div
                  key={record.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                >
                  {renderRow(record)}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Footer / pagination */}
      {!isInitialLoading && !isError && records.length > 0 && (
        <div className="flex items-center justify-between border-t border-slate-200 px-3 py-2 text-xs text-slate-500">
          <span>
            Showing {records.length} record{records.length === 1 ? '' : 's'}
          </span>
          {paymentsQuery.hasNextPage ? (
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 hover:bg-slate-50 disabled:opacity-50"
              disabled={paymentsQuery.isFetchingNextPage}
              onClick={() => paymentsQuery.fetchNextPage()}
            >
              {paymentsQuery.isFetchingNextPage ? 'Loading…' : 'Load more'}
            </button>
          ) : (
            <span>End of results</span>
          )}
        </div>
      )}
    </div>
  );
}

export default PaymentsTable;