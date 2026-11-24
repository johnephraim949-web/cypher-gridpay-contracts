import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type Currency = 'USDC' | 'XLM' | 'MULTI';

export type DateRangeKey = '7D' | '30D' | '90D' | 'EPOCH';

export interface VolumePoint {
  /** ISO date or epoch label */
  date: string;
  epoch?: number;
  volumeUsdc: number;
  volumeXlm: number;
  netRevenueUsdc: number;
  netRevenueXlm: number;
  /** Number of transactions in the bucket; used for sample-size gating. */
  txCount: number;
}

export interface ReasonCodeBucket {
  reasonCode: string;
  count: number;
  /** Epoch the bucket belongs to (optional for aggregate views). */
  epoch?: number;
}

export interface VelocityDeltaRow {
  reasonCode: string;
  previousEpoch: number;
  currentEpoch: number;
  previousCount: number;
  currentCount: number;
  /** Percentage delta; may be null when previousCount is 0. */
  deltaPct: number | null;
  /** True when either epoch has fewer than 5 transactions. */
  insufficientSample: boolean;
}

export interface QuotaSnapshot {
  /** Total refunded amount in the active currency. */
  refundedAmount: number;
  /** MerchantRefundQuota limit in the active currency. */
  quotaLimit: number;
  /** Circuit-breaker trip threshold (fraction of quota, e.g. 0.9). */
  circuitBreakerThreshold: number;
}

export interface LatencyPoint {
  date: string;
  p50: number;
  p95: number;
  p99: number;
  txCount: number;
}

export interface AnalyticsDataSource {
  fetchVolume: (range: DateRangeKey) => Promise<VolumePoint[]>;
  fetchReasonCodes: (range: DateRangeKey) => Promise<ReasonCodeBucket[]>;
  fetchVelocityDelta: (range: DateRangeKey) => Promise<VelocityDeltaRow[]>;
  fetchQuota: (range: DateRangeKey) => Promise<QuotaSnapshot>;
  fetchLatency: (range: DateRangeKey) => Promise<LatencyPoint[]>;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MIN_SAMPLE_SIZE = 5;

const DATE_RANGE_OPTIONS: { key: DateRangeKey; label: string }[] = [
  { key: '7D', label: '7D' },
  { key: '30D', label: '30D' },
  { key: '90D', label: '90D' },
  { key: 'EPOCH', label: 'Epoch Range' },
];

const CURRENCY_OPTIONS: { key: Currency; label: string }[] = [
  { key: 'USDC', label: 'USDC' },
  { key: 'XLM', label: 'XLM' },
  { key: 'MULTI', label: 'Multi-token' },
];

const REASON_CODE_COLORS = [
  '#2563eb',
  '#16a34a',
  '#dc2626',
  '#d97706',
  '#7c3aed',
  '#0891b2',
  '#db2777',
  '#65a30d',
];

// ---------------------------------------------------------------------------
// URL query-param helpers
// ---------------------------------------------------------------------------

function readQueryParam(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return new URLSearchParams(window.location.search).get(key);
  } catch {
    return null;
  }
}

function writeQueryParams(params: Record<string, string>): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    Object.entries(params).forEach(([k, v]) => {
      if (v) url.searchParams.set(k, v);
      else url.searchParams.delete(k);
    });
    window.history.replaceState(null, '', url.toString());
  } catch {
    /* no-op */
  }
}

function parseDateRange(value: string | null): DateRangeKey {
  const found = DATE_RANGE_OPTIONS.find((o) => o.key === value);
  return found ? found.key : '30D';
}

function parseCurrency(value: string | null): Currency {
  const found = CURRENCY_OPTIONS.find((o) => o.key === value);
  return found ? found.key : 'USDC';
}

// ---------------------------------------------------------------------------
// Formatting helpers (exported for unit tests)
// ---------------------------------------------------------------------------

export function formatDeltaPct(deltaPct: number | null): string {
  if (deltaPct === null || !Number.isFinite(deltaPct)) return '—';
  const sign = deltaPct > 0 ? '+' : '';
  return `${sign}${deltaPct.toFixed(1)}%`;
}

export function computeDeltaPct(
  previousCount: number,
  currentCount: number,
): number | null {
  if (!Number.isFinite(previousCount) || !Number.isFinite(currentCount)) {
    return null;
  }
  if (previousCount <= 0) return null;
  return ((currentCount - previousCount) / previousCount) * 100;
}

export function formatCurrency(value: number, currency: Currency): string {
  if (!Number.isFinite(value)) return '—';
  const symbol = currency === 'XLM' ? 'XLM ' : currency === 'USDC' ? 'USDC ' : '';
  return `${symbol}${value.toLocaleString(undefined, {
    maximumFractionDigits: 2,
  })}`;
}

export function formatLatency(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  return `${Math.round(ms)} ms`;
}

// ---------------------------------------------------------------------------
// Debounce hook
// ---------------------------------------------------------------------------

function useDebouncedValue<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const handle = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(handle);
  }, [value, delayMs]);
  return debounced;
}

// ---------------------------------------------------------------------------
// "View as Table" toggle + accessible table
// ---------------------------------------------------------------------------

interface ViewAsTableProps {
  chartLabel: string;
  columns: string[];
  rows: (string | number)[][];
}

const ViewAsTable: React.FC<ViewAsTableProps> = ({
  chartLabel,
  columns,
  rows,
}) => {
  const [open, setOpen] = useState(false);
  const tableId = useMemo(
    () => `table-${chartLabel.replace(/\s+/g, '-').toLowerCase()}`,
    [chartLabel],
  );

  return (
    <div className="mt-2">
      <button
        type="button"
        className="text-sm text-blue-600 underline focus:outline-none focus:ring-2 focus:ring-blue-500"
        aria-expanded={open}
        aria-controls={tableId}
        onClick={() => setOpen((v) => !v)}
      >
        {open ? 'Hide Table' : 'View as Table'}
      </button>
      {open && (
        <div className="mt-2 overflow-x-auto">
          <table
            id={tableId}
            className="min-w-full text-sm border-collapse"
            aria-label={`${chartLabel} data table`}
          >
            <thead>
              <tr>
                {columns.map((col) => (
                  <th
                    key={col}
                    scope="col"
                    className="border-b px-2 py-1 text-left font-semibold"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length}
                    className="px-2 py-1 text-gray-500"
                  >
                    No data available.
                  </td>
                </tr>
              ) : (
                rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((cell, j) => (
                      <td key={j} className="border-b px-2 py-1">
                        {cell}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

// ---------------------------------------------------------------------------
// Insufficient sample annotation
// ---------------------------------------------------------------------------

const InsufficientSampleBadge: React.FC = () => (
  <span
    className="inline-block rounded bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800"
    role="note"
    aria-label="Insufficient sample size"
  >
    Insufficient Sample Size
  </span>
);

// ---------------------------------------------------------------------------
// Chart section wrapper
// ---------------------------------------------------------------------------

interface ChartSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

const ChartSection: React.FC<ChartSectionProps> = ({
  title,
  description,
  children,
}) => (
  <section
    className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm"
    aria-label={title}
  >
    <header className="mb-3">
      <h2 className="text-lg font-semibold text-gray-900">{title}</h2>
      {description && (
        <p className="text-sm text-gray-600">{description}</p>
      )}
    </header>
    {children}
  </section>
);

// ---------------------------------------------------------------------------
// Volume & Net Revenue chart
// ---------------------------------------------------------------------------

interface VolumeChartProps {
  data: VolumePoint[];
  currency: Currency;
}

const VolumeChart: React.FC<VolumeChartProps> = ({ data, currency }) => {
  const chartData = useMemo(() => {
    return data.map((p) => ({
      date: p.date,
      volume:
        currency === 'USDC'
          ? p.volumeUsdc
          : currency === 'XLM'
          ? p.volumeXlm
          : p.volumeUsdc + p.volumeXlm,
      netRevenue:
        currency === 'USDC'
          ? p.netRevenueUsdc
          : currency === 'XLM'
          ? p.netRevenueXlm
          : p.netRevenueUsdc + p.netRevenueXlm,
      txCount: p.txCount,
    }));
  }, [data, currency]);

  const tableRows = useMemo(
    () =>
      chartData.map((p) => [
        p.date,
        formatCurrency(p.volume, currency),
        formatCurrency(p.netRevenue, currency),
        p.txCount,
      ]),
    [chartData, currency],
  );

  return (
    <ChartSection
      title="Payment Volume & Net Revenue"
      description="Time-series of gross volume and net revenue for the selected currency."
    >
      <div className="h-72" role="img" aria-label="Payment volume and net revenue line chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} />
            <Tooltip />
            <Legend />
            <Line
              type="monotone"
              dataKey="volume"
              name="Volume"
              stroke="#2563eb"
              dot={false}
            />
            <Line
              type="monotone"
              dataKey="netRevenue"
              name="Net Revenue"
              stroke="#16a34a"
              dot={false}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ViewAsTable
        chartLabel="Payment Volume and Net Revenue"
        columns={['Date', 'Volume', 'Net Revenue', 'Tx Count']}
        rows={tableRows}
      />
    </ChartSection>
  );
};

// ---------------------------------------------------------------------------
// Reason Code distribution chart
// ---------------------------------------------------------------------------

interface ReasonCodeChartProps {
  data: ReasonCodeBucket[];
}

const ReasonCodeChart: React.FC<ReasonCodeChartProps> = ({ data }) => {
  const aggregated = useMemo(() => {
    const map = new Map<string, number>();
    data.forEach((b) => {
      map.set(b.reasonCode, (map.get(b.reasonCode) ?? 0) + b.count);
    });
    return Array.from(map.entries())
      .map(([reasonCode, count]) => ({ reasonCode, count }))
      .sort((a, b) => b.count - a.count);
  }, [data]);

  const total = useMemo(
    () => aggregated.reduce((sum, b) => sum + b.count, 0),
    [aggregated],
  );

  const tableRows = useMemo(
    () =>
      aggregated.map((b) => [
        b.reasonCode,
        b.count,
        total > 0 ? `${((b.count / total) * 100).toFixed(1)}%` : '0.0%',
      ]),
    [aggregated, total],
  );

  return (
    <ChartSection
      title="Refund Reason Code Distribution"
      description="Breakdown of refunds by reason code for the selected range."
    >
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="h-72" role="img" aria-label="Refund reason code donut chart">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={aggregated}
                dataKey="count"
                nameKey="reasonCode"
                innerRadius="50%"
                outerRadius="80%"
                paddingAngle={2}
              >
                {aggregated.map((entry, index) => (
                  <Cell
                    key={entry.reasonCode}
                    fill={REASON_CODE_COLORS[index % REASON_CODE_COLORS.length]}
                  />
                ))}
              </Pie>
              <Tooltip />
              <Legend />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="h-72" role="img" aria-label="Refund reason code bar chart">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={aggregated} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="reasonCode" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={60} />
              <YAxis tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="count" name="Refunds">
                {aggregated.map((entry, index) => (
                  <Cell
                    key={entry.reasonCode}
                    fill={REASON_CODE_COLORS[index % REASON_CODE_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
      <ViewAsTable
        chartLabel="Refund Reason Code Distribution"
        columns={['Reason Code', 'Count', 'Share']}
        rows={tableRows}
      />
    </ChartSection>
  );
};

// ---------------------------------------------------------------------------
// Velocity delta table
// ---------------------------------------------------------------------------

interface VelocityDeltaTableProps {
  rows: VelocityDeltaRow[];
}

const VelocityDeltaTable: React.FC<VelocityDeltaTableProps> = ({ rows }) => {
  const normalized = useMemo(
    () =>
      rows.map((r) => {
        const deltaPct =
          r.deltaPct !== null && Number.isFinite(r.deltaPct)
            ? r.deltaPct
            : computeDeltaPct(r.previousCount, r.currentCount);
        const insufficientSample =
          r.insufficientSample ||
          r.previousCount < MIN_SAMPLE_SIZE ||
          r.currentCount < MIN_SAMPLE_SIZE;
        return { ...r, deltaPct, insufficientSample };
      }),
    [rows],
  );

  const tableRows = useMemo(
    () =>
      normalized.map((r) => [
        r.reasonCode,
        r.previousEpoch,
        r.currentEpoch,
        r.previousCount,
        r.currentCount,
        formatDeltaPct(r.deltaPct),
        r.insufficientSample ? 'Insufficient Sample Size' : 'OK',
      ]),
    [normalized],
  );

  return (
    <ChartSection
      title="Reason Code Velocity Delta"
      description="Epoch-over-epoch change in refund reason codes (get_reason_code_velocity_delta)."
    >
      <div className="overflow-x-auto">
        <table
          className="min-w-full text-sm border-collapse"
          aria-label="Reason code velocity delta table"
        >
          <thead>
            <tr>
              <th scope="col" className="border-b px-2 py-1 text-left font-semibold">Reason Code</th>
              <th scope="col" className="border-b px-2 py-1 text-left font-semibold">Prev Epoch</th>
              <th scope="col" className="border-b px-2 py-1 text-left font-semibold">Curr Epoch</th>
              <th scope="col" className="border-b px-2 py-1 text-left font-semibold">Prev Count</th>
              <th scope="col" className="border-b px-2 py-1 text-left font-semibold">Curr Count</th>
              <th scope="col" className="border-b px-2 py-1 text-left font-semibold">Δ %</th>
              <th scope="col" className="border-b px-2 py-1 text-left font-semibold">Sample</th>
            </tr>
          </thead>
          <tbody>
            {normalized.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-2 py-1 text-gray-500">
                  No velocity data available.
                </td>
              </tr>
            ) : (
              normalized.map((r, i) => (
                <tr key={`${r.reasonCode}-${i}`}>
                  <td className="border-b px-2 py-1">{r.reasonCode}</td>
                  <td className="border-b px-2 py-1">{r.previousEpoch}</td>
                  <td className="border-b px-2 py-1">{r.currentEpoch}</td>
                  <td className="border-b px-2 py-1">{r.previousCount}</td>
                  <td className="border-b px-2 py-1">{r.currentCount}</td>
                  <td className="border-b px-2 py-1">{formatDeltaPct(r.deltaPct)}</td>
                  <td className="border-b px-2 py-1">
                    {r.insufficientSample ? <InsufficientSampleBadge /> : 'OK'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      <ViewAsTable
        chartLabel="Reason Code Velocity Delta"
        columns={['Reason Code', 'Prev Epoch', 'Curr Epoch', 'Prev Count', 'Curr Count', 'Δ %', 'Sample']}
        rows={tableRows}
      />
    </ChartSection>
  );
};

// ---------------------------------------------------------------------------
// Quota gauge
// ---------------------------------------------------------------------------

interface QuotaGaugeProps {
  snapshot: QuotaSnapshot;
  currency: Currency;
}

const QuotaGauge: React.FC<QuotaGaugeProps> = ({ snapshot, currency }) => {
  const { refundedAmount, quotaLimit, circuitBreakerThreshold } = snapshot;

  const ratio = useMemo(() => {
    if (!Number.isFinite(quotaLimit) || quotaLimit <= 0) return 0;
    return Math.min(refundedAmount / quotaLimit, 1);
  }, [refundedAmount, quotaLimit]);

  const pct = ratio * 100;
  const breakerPct = Math.min(Math.max(circuitBreakerThreshold, 0), 1) * 100;
  const tripped = ratio >= circuitBreakerThreshold;

  const gaugeColor = tripped
    ? '#dc2626'
    : ratio >= 0.75
    ? '#d97706'
    : '#16a34a';

  const tableRows = useMemo(
    () => [
      ['Refunded Amount', formatCurrency(refundedAmount, currency)],
      ['Quota Limit', formatCurrency(quotaLimit, currency)],
      ['Quota Utilization', `${pct.toFixed(1)}%`],
      ['Circuit-Breaker Threshold', `${breakerPct.toFixed(1)}%`],
      ['Status', tripped ? 'Circuit breaker tripped' : 'Within limits'],
    ],
    [refundedAmount, quotaLimit, currency, pct, breakerPct, tripped],
  );

  return (
    <ChartSection
      title="Chargeback / Refund Ratio Gauge"
      description="Proximity to MerchantRefundQuota and circuit-breaker trip threshold."
    >
      <div
        className="flex flex-col items-center"
        role="img"
        aria-label={`Refund quota utilization ${pct.toFixed(1)} percent, circuit breaker threshold ${breakerPct.toFixed(1)} percent`}
      >
        <div className="relative h-4 w-full max-w-md overflow-hidden rounded-full bg-gray-200">
          <div
            className="h-full transition-all"
            style={{ width: `${pct}%`, backgroundColor: gaugeColor }}
          />
          <div
            className="absolute top-0 h-full w-0.5 bg-red-700"
            style={{ left: `${breakerPct}%` }}
            aria-hidden="true"
          />
        </div>
        <div className="mt-2 flex w-full max-w-md justify-between text-xs text-gray-600">
          <span>0%</span>
          <span>Breaker: {breakerPct.toFixed(0)}%</span>
          <span>100%</span>
        </div>
        <p className="mt-3 text-sm font-medium" style={{ color: gaugeColor }}>
          {pct.toFixed(1)}% of quota used
          {tripped ? ' — Circuit breaker tripped' : ''}
        </p>
      </div>
      <ViewAsTable
        chartLabel="Refund Quota Gauge"
        columns={['Metric', 'Value']}
        rows={tableRows}
      />
    </ChartSection>
  );
};

// ---------------------------------------------------------------------------
// Latency percentile chart
// ---------------------------------------------------------------------------

interface LatencyChartProps {
  data: LatencyPoint[];
}

const LatencyChart: React.FC<LatencyChartProps> = ({ data }) => {
  const tableRows = useMemo(
    () =>
      data.map((p) => [
        p.date,
        formatLatency(p.p50),
        formatLatency(p.p95),
        formatLatency(p.p99),
        p.txCount,
      ]),
    [data],
  );

  return (
    <ChartSection
      title="Settlement Latency Percentiles"
      description="p50 / p95 / p99 settlement latency over the selected range."
    >
      <div className="h-72" role="img" aria-label="Settlement latency percentile line chart">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 12 }} />
            <YAxis tick={{ fontSize: 12 }} unit=" ms" />
            <Tooltip />
            <Legend />
            <Line type="monotone" dataKey="p50" name="p50" stroke="#16a34a" dot={false} />
            <Line type="monotone" dataKey="p95" name="p95" stroke="#d97706" dot={false} />
            <Line type="monotone" dataKey="p99" name="p99" stroke="#dc2626" dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ViewAsTable
        chartLabel="Settlement Latency Percentiles"
        columns={['Date', 'p50', 'p95', 'p99', 'Tx Count']}
        rows={tableRows}
      />
    </ChartSection>
  );
};

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export interface AnalyticsPageProps {
  /** Injectable data source; defaults to a no-op stub for tests. */
  dataSource?: AnalyticsDataSource;
}

const emptyDataSource: AnalyticsDataSource = {
  fetchVolume: async () => [],
  fetchReasonCodes: async () => [],
  fetchVelocityDelta: async () => [],
  fetchQuota: async () => ({
    refundedAmount: 0,
    quotaLimit: 0,
    circuitBreakerThreshold: 0.9,
  }),
  fetchLatency: async () => [],
};

const AnalyticsPage: React.FC<AnalyticsPageProps> = ({
  dataSource = emptyDataSource,
}) => {
  const [dateRange, setDateRange] = useState<DateRangeKey>(() =>
    parseDateRange(readQueryParam('range')),
  );
  const [currency, setCurrency] = useState<Currency>(() =>
    parseCurrency(readQueryParam('currency')),
  );

  const [volume, setVolume] = useState<VolumePoint[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCodeBucket[]>([]);
  const [velocity, setVelocity] = useState<VelocityDeltaRow[]>([]);
  const [quota, setQuota] = useState<QuotaSnapshot>({
    refundedAmount: 0,
    quotaLimit: 0,
    circuitBreakerThreshold: 0.9,
  });
  const [latency, setLatency] = useState<LatencyPoint[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Persist filters to URL query params.
  useEffect(() => {
    writeQueryParams({ range: dateRange, currency });
  }, [dateRange, currency]);

  // Debounce the range so rapid toggles don't spam the data source.
  const debouncedRange = useDebouncedValue(dateRange, 250);

  const requestIdRef = useRef(0);

  useEffect(() => {
    const requestId = ++requestIdRef.current;
    let cancelled = false;
    setLoading(true);
    setError(null);

    Promise.all([
      dataSource.fetchVolume(debouncedRange),
      dataSource.fetchReasonCodes(debouncedRange),
      dataSource.fetchVelocityDelta(debouncedRange),
      dataSource.fetchQuota(debouncedRange),
      dataSource.fetchLatency(debouncedRange),
    ])
      .then(([vol, reasons, vel, q, lat]) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setVolume(vol);
        setReasonCodes(reasons);
        setVelocity(vel);
        setQuota(q);
        setLatency(lat);
      })
      .catch((err: unknown) => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setError(err instanceof Error ? err.message : 'Failed to load analytics');
      })
      .finally(() => {
        if (cancelled || requestId !== requestIdRef.current) return;
        setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [dataSource, debouncedRange]);

  const handleRangeChange = useCallback((key: DateRangeKey) => {
    setDateRange(key);
  }, []);

  const handleCurrencyChange = useCallback((key: Currency) => {
    setCurrency(key);
  }, []);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6" aria-label="Merchant Analytics">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Merchant Analytics</h1>
        <p className="text-sm text-gray-600">
          Monitor payment volume, refund reason codes, quota proximity, and
          settlement latency.
        </p>
      </header>

      <div className="mb-6 flex flex-wrap items-center gap-4">
        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Date range selector"
        >
          {DATE_RANGE_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleRangeChange(opt.key)}
              aria-pressed={dateRange === opt.key}
              className={`rounded px-3 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                dateRange === opt.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <div
          className="flex items-center gap-1"
          role="group"
          aria-label="Currency selector"
        >
          {CURRENCY_OPTIONS.map((opt) => (
            <button
              key={opt.key}
              type="button"
              onClick={() => handleCurrencyChange(opt.key)}
              aria-pressed={currency === opt.key}
              className={`rounded px-3 py-1 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                currency === opt.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <p className="mb-4 text-sm text-gray-500" role="status" aria-live="polite">
          Loading analytics…
        </p>
      )}
      {error && (
        <p className="mb-4 text-sm text-red-600" role="alert">
          {error}
        </p>
      )}

      <div className="grid grid-cols-1 gap-6">
        <VolumeChart data={volume} currency={currency} />
        <ReasonCodeChart data={reasonCodes} />
        <VelocityDeltaTable rows={velocity} />
        <QuotaGauge snapshot={quota} currency={currency} />
        <LatencyChart data={latency} />
      </div>
    </main>
  );
};

export default AnalyticsPage;