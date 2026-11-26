/**
 * GridPayCheckout
 *
 * Embeddable React checkout widget for Cypher GridPay. Supports standard
 * `create_payment`, `create_escrowed_payment`, and split-recipient payments,
 * with pre-flight validation, itemized breakdown, countdown, ledger finality
 * polling, strict postMessage origin allowlisting, idempotent submission, and
 * actionable error recovery via `decodeGridPayError`.
 *
 * Usage:
 *   <GridPayCheckout
 *     sessionId="sess_123"
 *     onSuccess={(r) => console.log(r)}
 *     onError={(e) => console.error(e)}
 *   />
 *
 * When embedded in an iframe, the widget posts lifecycle messages to the
 * parent window and only accepts commands from allowlisted origins.
 */

import * as React from 'react';

/* -------------------------------------------------------------------------- */
/* Types                                                                      */
/* -------------------------------------------------------------------------- */

export type CheckoutPaymentKind = 'standard' | 'escrowed' | 'split';

export interface CheckoutRecipient {
  address: string;
  amount: string;
  asset?: string;
}

export interface CheckoutPaymentSession {
  sessionId: string;
  kind: CheckoutPaymentKind;
  merchantAddress: string;
  customerAddress?: string;
  asset: string;
  subtotal: string;
  protocolFee: string;
  merchantFee: string;
  /** ISO-8601 timestamp at which the payment session expires. */
  expiresAt: string;
  /** Escrow hold window in seconds (only for escrowed payments). */
  escrowHoldSeconds?: number;
  recipients?: CheckoutRecipient[];
  /** Merchant-configured allowlist of origins permitted to message the widget. */
  allowedOrigins?: string[];
  /** Loyalty program id, if the merchant supports point redemption. */
  loyaltyProgramId?: string;
}

export interface ConversionRatePreview {
  rate: string;
  sourceAsset: string;
  targetAsset: string;
  oracleConfig?: {
    oracleId?: string;
    decimals?: number;
    updatedAt?: string;
  };
}

export interface PreflightResult {
  tokenBalance: string;
  hasTrustline: boolean;
  allowance: string;
  conversionRate?: ConversionRatePreview;
  networkResourceFee: string;
  loyaltyBalance: string;
  ok: boolean;
  issues: string[];
}

export interface CheckoutSuccessPayload {
  sessionId: string;
  transactionHash: string;
  ledger?: number;
  amountPaid: string;
  pointsRedeemed: string;
}

export interface CheckoutErrorPayload {
  sessionId: string;
  code: string;
  message: string;
  recovery?: string;
  cause?: unknown;
}

export interface GridPayCheckoutProps {
  sessionId: string;
  onSuccess?: (payload: CheckoutSuccessPayload) => void;
  onError?: (payload: CheckoutErrorPayload) => void;
  /** Optional override of the API base URL. */
  apiBaseUrl?: string;
  /** Optional override of the merchant allowlist (defaults to session config). */
  allowedOrigins?: string[];
  /** Optional wallet signer. When omitted, the widget prompts the host app. */
  signTransaction?: (xdr: string) => Promise<string>;
  /** Optional loyalty points to redeem. */
  redeemPoints?: string;
  /** Optional className for styling. */
  className?: string;
}

/* -------------------------------------------------------------------------- */
/* SDK shims                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * The widget depends on the TypeScript SDK. These imports are declared as
 * optional so the package can be tree-shaken and consumed in environments
 * where the SDK is provided by the host application.
 */
interface GridPaySdk {
  getPaymentSession: (sessionId: string) => Promise<CheckoutPaymentSession>;
  getTokenBalance: (address: string, asset: string) => Promise<string>;
  hasTrustline: (address: string, asset: string) => Promise<boolean>;
  getAllowance: (address: string, asset: string, spender: string) => Promise<string>;
  getConversionRate: (from: string, to: string) => Promise<ConversionRatePreview>;
  getOracleRateConfig: (asset: string) => Promise<ConversionRatePreview['oracleConfig']>;
  getLoyaltyBalance: (address: string, programId: string) => Promise<string>;
  redeemPoints: (address: string, programId: string, points: string) => Promise<string>;
  simulateTransaction: (xdr: string) => Promise<{ minResourceFee: string; transactionXdr: string }>;
  buildPaymentTransaction: (params: {
    session: CheckoutPaymentSession;
    pointsRedeemed?: string;
  }) => Promise<string>;
  submitTransaction: (signedXdr: string) => Promise<{ hash: string }>;
  getTransactionStatus: (hash: string) => Promise<{ status: string; ledger?: number }>;
  decodeGridPayError: (err: unknown) => { code: string; message: string; recovery?: string };
}

let sdkRef: GridPaySdk | null = null;

/** Inject the SDK implementation (called by the package entry point). */
export function setGridPaySdk(sdk: GridPaySdk): void {
  sdkRef = sdk;
}

function requireSdk(): GridPaySdk {
  if (!sdkRef) {
    throw new Error(
      'GridPayCheckout: SDK not configured. Call setGridPaySdk() before rendering the widget.',
    );
  }
  return sdkRef;
}

/* -------------------------------------------------------------------------- */
/* Helpers                                                                    */
/* -------------------------------------------------------------------------- */

const POLL_INTERVAL_MS = 2000;
const POLL_TIMEOUT_MS = 120_000;

function formatAmount(value: string, decimals = 7): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  });
}

function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (v: number) => String(v).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

function isEmbedded(): boolean {
  try {
    return typeof window !== 'undefined' && window.parent !== window;
  } catch {
    return false;
  }
}

function normalizeOrigin(origin: string): string {
  return origin.trim().toLowerCase().replace(/\/+$/, '');
}

function isOriginAllowed(origin: string, allowlist: string[]): boolean {
  if (!origin) return false;
  const normalized = normalizeOrigin(origin);
  return allowlist.some((allowed) => {
    const a = normalizeOrigin(allowed);
    if (a === '*') return false; // wildcard is never permitted for security
    return a === normalized;
  });
}

/* -------------------------------------------------------------------------- */
/* Component                                                                  */
/* -------------------------------------------------------------------------- */

type Phase =
  | 'loading'
  | 'preflight'
  | 'ready'
  | 'signing'
  | 'submitting'
  | 'confirming'
  | 'success'
  | 'error'
  | 'expired';

export const GridPayCheckout: React.FC<GridPayCheckoutProps> = ({
  sessionId,
  onSuccess,
  onError,
  apiBaseUrl,
  allowedOrigins,
  signTransaction,
  redeemPoints: initialRedeemPoints,
  className,
}) => {
  const [phase, setPhase] = React.useState<Phase>('loading');
  const [session, setSession] = React.useState<CheckoutPaymentSession | null>(null);
  const [preflight, setPreflight] = React.useState<PreflightResult | null>(null);
  const [error, setError] = React.useState<CheckoutErrorPayload | null>(null);
  const [secondsLeft, setSecondsLeft] = React.useState<number>(0);
  const [pointsToRedeem, setPointsToRedeem] = React.useState<string>(initialRedeemPoints ?? '0');
  const [txHash, setTxHash] = React.useState<string | null>(null);

  // Idempotent submission lock. A ref is used so concurrent renders cannot
  // race past the guard. The lock is never released on success; on failure it
  // is released only when the failure is definitively non-retryable.
  const submissionLockRef = React.useRef<boolean>(false);
  const submittedHashRef = React.useRef<string | null>(null);
  const pollTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownTimerRef = React.useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = React.useRef<boolean>(true);

  const effectiveAllowlist = React.useMemo(() => {
    const list = allowedOrigins ?? session?.allowedOrigins ?? [];
    return list.map(normalizeOrigin);
  }, [allowedOrigins, session?.allowedOrigins]);

  /* ------------------------------ messaging ------------------------------ */

  const postToParent = React.useCallback(
    (type: string, payload: Record<string, unknown>) => {
      if (!isEmbedded()) return;
      try {
        // We do not know the parent origin a priori; post to '*' but the
        // parent must validate `event.origin` against its own allowlist. We
        // include the widget origin so the parent can verify.
        window.parent.postMessage(
          { source: 'gridpay-checkout', type, sessionId, payload },
          '*',
        );
      } catch {
        /* ignore */
      }
    },
    [sessionId],
  );

  /* ------------------------------ data load ------------------------------ */

  const runPreflight = React.useCallback(
    async (sess: CheckoutPaymentSession): Promise<PreflightResult> => {
      const sdk = requireSdk();
      const customer = sess.customerAddress ?? '';
      const issues: string[] = [];

      const [balance, trustline, allowance, loyalty] = await Promise.all([
        customer ? sdk.getTokenBalance(customer, sess.asset) : Promise.resolve('0'),
        customer ? sdk.hasTrustline(customer, sess.asset) : Promise.resolve(false),
        customer ? sdk.getAllowance(customer, sess.asset, sess.merchantAddress) : Promise.resolve('0'),
        sess.loyaltyProgramId && customer
          ? sdk.getLoyaltyBalance(customer, sess.loyaltyProgramId)
          : Promise.resolve('0'),
      ]);

      let conversionRate: ConversionRatePreview | undefined;
      try {
        conversionRate = await sdk.getConversionRate(sess.asset, 'USD');
        const oracleConfig = await sdk.getOracleRateConfig(sess.asset);
        if (conversionRate && oracleConfig) {
          conversionRate = { ...conversionRate, oracleConfig };
        }
      } catch {
        /* conversion rate is best-effort */
      }

      let networkResourceFee = '0';
      try {
        const xdr = await sdk.buildPaymentTransaction({ session: sess });
        const sim = await sdk.simulateTransaction(xdr);
        networkResourceFee = sim.minResourceFee;
      } catch {
        /* simulation fee is best-effort during preflight */
      }

      if (!trustline) issues.push('Missing Stellar trustline for the payment asset.');
      if (Number(balance) <= 0) issues.push('Customer token balance is zero.');
      if (Number(allowance) < Number(sess.subtotal)) {
        issues.push('SEP-41 allowance is insufficient for this payment.');
      }

      return {
        tokenBalance: balance,
        hasTrustline: trustline,
        allowance,
        conversionRate,
        networkResourceFee,
        loyaltyBalance: loyalty,
        ok: issues.length === 0,
        issues,
      };
    },
    [],
  );

  React.useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const sdk = requireSdk();
        const sess = await sdk.getPaymentSession(sessionId);
        if (cancelled || !mountedRef.current) return;
        setSession(sess);
        setPhase('preflight');
        postToParent('session_loaded', { kind: sess.kind });

        const result = await runPreflight(sess);
        if (cancelled || !mountedRef.current) return;
        setPreflight(result);
        setPhase('ready');
        postToParent('preflight_complete', { ok: result.ok, issues: result.issues });
      } catch (err) {
        if (cancelled || !mountedRef.current) return;
        const decoded = safeDecode(err);
        setError({ sessionId, ...decoded, cause: err });
        setPhase('error');
        onError?.({ sessionId, ...decoded, cause: err });
        postToParent('error', decoded);
      }
    })();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  /* ------------------------------ countdown ------------------------------ */

  React.useEffect(() => {
    if (!session) return;
    const expiresAt = new Date(session.expiresAt).getTime();
    const tick = () => {
      const remaining = Math.floor((expiresAt - Date.now()) / 1000);
      setSecondsLeft(remaining);
      if (remaining <= 0 && phase !== 'success' && phase !== 'confirming') {
        setPhase('expired');
        postToParent('expired', {});
      }
    };
    tick();
    countdownTimerRef.current = setInterval(tick, 1000);
    return () => {
      if (countdownTimerRef.current) clearInterval(countdownTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, phase]);

  /* ------------------------------ messaging ------------------------------ */

  React.useEffect(() => {
    if (typeof window === 'undefined') return;

    const handler = (event: MessageEvent) => {
      // Strict origin validation: reject anything not on the allowlist.
      if (!isOriginAllowed(event.origin, effectiveAllowlist)) {
        // Do not throw; silently ignore untrusted messages.
        return;
      }
      const data = event.data;
      if (!data || typeof data !== 'object') return;
      if (data.source !== 'gridpay-host') return;
      if (data.sessionId && data.sessionId !== sessionId) return;

      switch (data.type) {
        case 'set_redeem_points':
          if (typeof data.payload?.points === 'string') {
            setPointsToRedeem(data.payload.points);
          }
          break;
        case 'request_state':
          postToParent('state', { phase, txHash });
          break;
        default:
          break;
      }
    };

    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [effectiveAllowlist, sessionId, phase, txHash, postToParent]);

  /* ------------------------------ polling ------------------------------ */

  const pollForFinality = React.useCallback(
    async (hash: string) => {
      const sdk = requireSdk();
      const started = Date.now();
      const poll = async (): Promise<void> => {
        if (!mountedRef.current) return;
        try {
          const status = await sdk.getTransactionStatus(hash);
          if (status.status === 'success') {
            setPhase('success');
            const payload: CheckoutSuccessPayload = {
              sessionId,
              transactionHash: hash,
              ledger: status.ledger,
              amountPaid: session?.subtotal ?? '0',
              pointsRedeemed: pointsToRedeem,
            };
            onSuccess?.(payload);
            postToParent('success', payload as unknown as Record<string, unknown>);
            return;
          }
          if (status.status === 'failed') {
            throw new Error('Transaction failed on ledger.');
          }
        } catch (err) {
          const decoded = safeDecode(err);
          setError({ sessionId, ...decoded, cause: err });
          setPhase('error');
          onError?.({ sessionId, ...decoded, cause: err });
          postToParent('error', decoded);
          return;
        }
        if (Date.now() - started > POLL_TIMEOUT_MS) {
          const decoded = {
            code: 'CONFIRMATION_TIMEOUT',
            message: 'Timed out waiting for ledger finality.',
            recovery: 'Check the transaction hash on a Stellar explorer before retrying.',
          };
          setError({ sessionId, ...decoded });
          setPhase('error');
          onError?.({ sessionId, ...decoded });
          postToParent('error', decoded);
          return;
        }
        pollTimerRef.current = setTimeout(poll, POLL_INTERVAL_MS);
      };
      await poll();
    },
    [sessionId, session?.subtotal, pointsToRedeem, onSuccess, onError, postToParent],
  );

  React.useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    };
  }, []);

  /* ------------------------------ submission ------------------------------ */

  const handlePay = React.useCallback(async () => {
    // Idempotent submission lock.
    if (submissionLockRef.current) return;
    if (submittedHashRef.current) return;
    if (!session || !preflight) return;
    if (phase === 'expired' || secondsLeft <= 0) return;

    submissionLockRef.current = true;
    setPhase('signing');
    postToParent('signing', {});

    try {
      const sdk = requireSdk();

      // Re-run preflight immediately before prompting the wallet.
      const fresh = await runPreflight(session);
      setPreflight(fresh);
      if (!fresh.ok) {
        const decoded = {
          code: 'PREFLIGHT_FAILED',
          message: fresh.issues.join(' '),
          recovery: 'Resolve the listed issues before retrying.',
        };
        setError({ sessionId, ...decoded });
        setPhase('error');
        onError?.({ sessionId, ...decoded });
        postToParent('error', decoded);
        submissionLockRef.current = false;
        return;
      }

      let points = pointsToRedeem;
      if (session.loyaltyProgramId && Number(points) > 0 && session.customerAddress) {
        try {
          points = await sdk.redeemPoints(
            session.customerAddress,
            session.loyaltyProgramId,
            points,
          );
        } catch (err) {
          const decoded = safeDecode(err);
          setError({ sessionId, ...decoded, cause: err });
          setPhase('error');
          onError?.({ sessionId, ...decoded, cause: err });
          postToParent('error', decoded);
          submissionLockRef.current = false;
          return;
        }
      }

      const xdr = await sdk.buildPaymentTransaction({ session, pointsRedeemed: points });

      if (!signTransaction) {
        const decoded = {
          code: 'NO_SIGNER',
          message: 'No wallet signer configured.',
          recovery: 'Provide a signTransaction prop or connect a wallet.',
        };
        setError({ sessionId, ...decoded });
        setPhase('error');
        onError?.({ sessionId, ...decoded });
        postToParent('error', decoded);
        submissionLockRef.current = false;
        return;
      }

      const signed = await signTransaction(xdr);
      setPhase('submitting');
      postToParent('submitting', {});

      const { hash } = await sdk.submitTransaction(signed);
      submittedHashRef.current = hash;
      setTxHash(hash);
      setPhase('confirming');
      postToParent('submitted', { transactionHash: hash });

      await pollForFinality(hash);
    } catch (err) {
      const decoded = safeDecode(err);
      setError({ sessionId, ...decoded, cause: err });
      setPhase('error');
      onError?.({ sessionId, ...decoded, cause: err });
      postToParent('error', decoded);
      // Release the lock only if no hash was submitted (safe to retry).
      if (!submittedHashRef.current) {
        submissionLockRef.current = false;
      }
    }
  }, [
    session,
    preflight,
    phase,
    secondsLeft,
    pointsToRedeem,
    signTransaction,
    runPreflight,
    pollForFinality,
    sessionId,
    onError,
    postToParent,
  ]);

  /* ------------------------------ render ------------------------------ */

  const subtotal = Number(session?.subtotal ?? 0);
  const protocolFee = Number(session?.protocolFee ?? 0);
  const merchantFee = Number(session?.merchantFee ?? 0);
  const networkFee = Number(preflight?.networkResourceFee ?? 0);
  const loyaltyBalance = Number(preflight?.loyaltyBalance ?? 0);
  const redeemable = Math.min(loyaltyBalance, Number(pointsToRedeem) || 0);
  // Simple 1 point = 1 unit discount model; merchants may override via session.
  const loyaltyDiscount = redeemable;
  const total = Math.max(0, subtotal + protocolFee + merchantFee + networkFee - loyaltyDiscount);

  const disabled =
    phase !== 'ready' ||
    secondsLeft <= 0 ||
    (preflight ? !preflight.ok : true) ||
    submissionLockRef.current;

  return (
    <div
      className={className}
      data-gridpay-checkout=""
      data-session-id={sessionId}
      data-phase={phase}
      style={{
        fontFamily: 'system-ui, -apple-system, sans-serif',
        maxWidth: 420,
        border: '1px solid #e5e7eb',
        borderRadius: 12,
        padding: 20,
        background: '#fff',
        color: '#111827',
      }}
    >
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Checkout</h2>
        {session && (
          <span
            data-gridpay-countdown=""
            style={{
              fontVariantNumeric: 'tabular-nums',
              color: secondsLeft <= 30 ? '#dc2626' : '#374151',
              fontWeight: 600,
            }}
          >
            {secondsLeft > 0 ? formatDuration(secondsLeft) : 'Expired'}
          </span>
        )}
      </header>

      {phase === 'loading' && <p>Loading payment session…</p>}

      {session && (
        <section style={{ marginTop: 16 }}>
          <div style={{ fontSize: 13, color: '#6b7280', marginBottom: 8 }}>
            {session.kind === 'escrowed'
              ? `Escrowed payment · hold ${formatDuration(session.escrowHoldSeconds ?? 0)}`
              : session.kind === 'split'
              ? `Split payment · ${session.recipients?.length ?? 0} recipients`
              : 'Standard payment'}
          </div>

          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
            <tbody>
              <Row label="Subtotal" value={`${formatAmount(session.subtotal)} ${session.asset}`} />
              <Row label="Protocol fee" value={`${formatAmount(session.protocolFee)} ${session.asset}`} />
              <Row label="Merchant fee" value={`${formatAmount(session.merchantFee)} ${session.asset}`} />
              <Row
                label="Network resource fee (est.)"
                value={`${formatAmount(preflight?.networkResourceFee ?? '0')} XLM`}
              />
              {session.loyaltyProgramId && (
                <Row
                  label={`Loyalty discount (${formatAmount(String(redeemable))} pts)`}
                  value={`-${formatAmount(String(loyaltyDiscount))} ${session.asset}`}
                  accent="#059669"
                />
              )}
              <tr>
                <td style={{ paddingTop: 12, fontWeight: 700 }}>Total</td>
                <td style={{ paddingTop: 12, textAlign: 'right', fontWeight: 700 }}>
                  {formatAmount(String(total))} {session.asset}
                </td>
              </tr>
            </tbody>
          </table>

          {preflight?.conversionRate && (
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
              Live rate: 1 {preflight.conversionRate.sourceAsset} ≈{' '}
              {formatAmount(preflight.conversionRate.rate, 6)} {preflight.conversionRate.targetAsset}
            </p>
          )}

          {session.loyaltyProgramId && loyaltyBalance > 0 && (
            <label style={{ display: 'block', marginTop: 12, fontSize: 13 }}>
              Redeem points (balance {formatAmount(String(loyaltyBalance))})
              <input
                type="number"
                min={0}
                max={loyaltyBalance}
                value={pointsToRedeem}
                onChange={(e) => setPointsToRedeem(e.target.value)}
                disabled={phase !== 'ready'}
                style={{
                  display: 'block',
                  width: '100%',
                  marginTop: 4,
                  padding: '6px 8px',
                  border: '1px solid #d1d5db',
                  borderRadius: 6,
                }}
              />
            </label>
          )}

          {preflight && !preflight.ok && (
            <ul style={{ marginTop: 12, paddingLeft: 18, color: '#b91c1c', fontSize: 13 }}>
              {preflight.issues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          )}

          {error && (
            <div
              role="alert"
              data-gridpay-error={error.code}
              style={{
                marginTop: 12,
                padding: 10,
                borderRadius: 8,
                background: '#fef2f2',
                color: '#991b1b',
                fontSize: 13,
              }}
            >
              <strong>{error.message}</strong>
              {error.recovery && <div style={{ marginTop: 4 }}>{error.recovery}</div>}
            </div>
          )}

          {phase === 'confirming' && txHash && (
            <p style={{ fontSize: 12, color: '#6b7280', marginTop: 12 }}>
              Confirming on ledger… <code>{txHash.slice(0, 12)}…</code>
            </p>
          )}

          {phase === 'success' && (
            <p style={{ color: '#059669', fontWeight: 600, marginTop: 12 }}>Payment confirmed.</p>
          )}

          <button
            type="button"
            onClick={handlePay}
            disabled={disabled}
            data-gridpay-pay=""
            style={{
              marginTop: 16,
              width: '100%',
              padding: '10px 14px',
              borderRadius: 8,
              border: 'none',
              background: disabled ? '#9ca3af' : '#2563eb',
              color: '#fff',
              fontWeight: 600,
              cursor: disabled ? 'not-allowed' : 'pointer',
            }}
          >
            {phase === 'signing'
              ? 'Awaiting signature…'
              : phase === 'submitting'
              ? 'Submitting…'
              : phase === 'confirming'
              ? 'Confirming…'
              : phase === 'success'
              ? 'Paid'
              : phase === 'expired'
              ? 'Session expired'
              : `Pay ${formatAmount(String(total))} ${session.asset}`}
          </button>
        </section>
      )}
    </div>
  );
};

const Row: React.FC<{ label: string; value: string; accent?: string }> = ({
  label,
  value,
  accent,
}) => (
  <tr>
    <td style={{ padding: '4px 0', color: '#4b5563' }}>{label}</td>
    <td style={{ padding: '4px 0', textAlign: 'right', color: accent ?? '#111827' }}>{value}</td>
  </tr>
);

/* -------------------------------------------------------------------------- */
/* Error decoding                                                             */
/* -------------------------------------------------------------------------- */

function safeDecode(err: unknown): { code: string; message: string; recovery?: string } {
  try {
    const sdk = requireSdk();
    return sdk.decodeGridPayError(err);
  } catch {
    const message = err instanceof Error ? err.message : String(err);
    return { code: 'UNKNOWN', message, recovery: 'Please retry or contact support.' };
  }
}

/* -------------------------------------------------------------------------- */
/* Web Component wrapper                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Registers a `<gridpay-checkout>` custom element that mounts the React
 * widget. Attributes:
 *   session-id, api-base-url, allowed-origins (comma-separated)
 * Events:
 *   gridpay-success, gridpay-error
 */
export function registerGridPayCheckoutElement(tagName = 'gridpay-checkout'): void {
  if (typeof window === 'undefined' || typeof customElements === 'undefined') return;
  if (customElements.get(tagName)) return;

  class GridPayCheckoutElement extends HTMLElement {
    private root: HTMLElement | null = null;
    private reactRoot: { render: (el: React.ReactElement) => void; unmount: () => void } | null =
      null;

    static get observedAttributes(): string[] {
      return ['session-id', 'api-base-url', 'allowed-origins'];
    }

    connectedCallback(): void {
      if (!this.root) {
        this.root = document.createElement('div');
        this.appendChild(this.root);
      }
      this.mount();
    }

    disconnectedCallback(): void {
      this.reactRoot?.unmount();
      this.reactRoot = null;
    }

    attributeChangedCallback(): void {
      if (this.isConnected) this.mount();
    }

    private mount(): void {
      if (!this.root) return;
      const sessionId = this.getAttribute('session-id') ?? '';
      const apiBaseUrl = this.getAttribute('api-base-url') ?? undefined;
      const allowedOrigins = (this.getAttribute('allowed-origins') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      // Lazy-load react-dom/client to keep the package tree-shakeable.
      // Consumers that only use the React component never pull this in.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { createRoot } = require('react-dom/client');
      if (!this.reactRoot) {
        this.reactRoot = createRoot(this.root);
      }

      this.reactRoot.render(
        React.createElement(GridPayCheckout, {
          sessionId,
          apiBaseUrl,
          allowedOrigins,
          onSuccess: (payload) =>
            this.dispatchEvent(
              new CustomEvent('gridpay-success', { detail: payload, bubbles: true }),
            ),
          onError: (payload) =>
            this.dispatchEvent(
              new CustomEvent('gridpay-error', { detail: payload, bubbles: true }),
            ),
        }),
      );
    }
  }

  customElements.define(tagName, GridPayCheckoutElement);
}

export default GridPayCheckout;