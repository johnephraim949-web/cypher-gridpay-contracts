import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';
import { GridPayCheckout } from '@cypher-gridpay/checkout-widget';
import type {
  CheckoutSession,
  CheckoutResult,
  CheckoutError,
} from '@cypher-gridpay/checkout-widget';
import { decodeGridPayError } from '@cypher-gridpay/sdk/errors';

type CheckoutPath =
  | 'standard'
  | 'escrowed'
  | 'split'
  | 'loyalty';

interface CheckoutSessionResponse extends CheckoutSession {
  path?: CheckoutPath;
  merchantName?: string;
  merchantLogoUrl?: string;
  returnUrl?: string;
  cancelUrl?: string;
}

interface DecodedErrorInfo {
  code: string;
  message: string;
  recovery?: string;
  actionLabel?: string;
  actionHref?: string;
}

const DEFAULT_API_BASE =
  process.env.NEXT_PUBLIC_GRIDPAY_API_BASE ?? '/api';

function resolveCheckoutPath(session: CheckoutSessionResponse): CheckoutPath {
  if (session.path) return session.path;
  if (session.escrow) return 'escrowed';
  if (Array.isArray(session.recipients) && session.recipients.length > 1) {
    return 'split';
  }
  if (session.loyaltyRedemption) return 'loyalty';
  return 'standard';
}

function decodeError(err: unknown): DecodedErrorInfo {
  try {
    const decoded = decodeGridPayError(err);
    if (decoded) {
      return {
        code: decoded.code ?? 'unknown_error',
        message: decoded.message ?? 'Payment failed.',
        recovery: decoded.recovery ?? decoded.recoveryInstructions,
        actionLabel: decoded.actionLabel,
        actionHref: decoded.actionHref,
      };
    }
  } catch {
    // fall through to generic handling
  }
  const message =
    err instanceof Error
      ? err.message
      : typeof err === 'string'
        ? err
        : 'An unexpected error occurred while processing the payment.';
  return {
    code: 'unknown_error',
    message,
    recovery:
      'Please verify your wallet connection, token balance, and trustline, then try again. If the problem persists, contact the merchant.',
  };
}

async function fetchCheckoutSession(
  sessionId: string,
  signal: AbortSignal,
): Promise<CheckoutSessionResponse> {
  const res = await fetch(
    `${DEFAULT_API_BASE}/checkout/sessions/${encodeURIComponent(sessionId)}`,
    {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal,
    },
  );
  if (!res.ok) {
    let detail = `Failed to load checkout session (${res.status}).`;
    try {
      const body = await res.json();
      if (body?.message) detail = body.message;
    } catch {
      // ignore parse errors
    }
    throw new Error(detail);
  }
  return (await res.json()) as CheckoutSessionResponse;
}

const CheckoutPage: React.FC = () => {
  const router = useRouter();
  const { sessionId } = router.query;

  const [session, setSession] = useState<CheckoutSessionResponse | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<DecodedErrorInfo | null>(null);
  const [submitError, setSubmitError] = useState<DecodedErrorInfo | null>(null);
  const [submitting, setSubmitting] = useState<boolean>(false);

  const normalizedSessionId = useMemo(() => {
    if (Array.isArray(sessionId)) return sessionId[0];
    return sessionId;
  }, [sessionId]);

  useEffect(() => {
    if (!normalizedSessionId) return;
    const controller = new AbortController();
    let active = true;

    setLoading(true);
    setLoadError(null);

    fetchCheckoutSession(normalizedSessionId, controller.signal)
      .then((data) => {
        if (!active) return;
        setSession(data);
      })
      .catch((err: unknown) => {
        if (!active) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setLoadError(decodeError(err));
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [normalizedSessionId]);

  const checkoutPath = useMemo<CheckoutPath | null>(() => {
    if (!session) return null;
    return resolveCheckoutPath(session);
  }, [session]);

  const handleSuccess = useCallback(
    (result: CheckoutResult) => {
      setSubmitting(false);
      setSubmitError(null);
      const txHash = result?.transactionHash ?? result?.hash ?? '';
      const query: Record<string, string> = {
        sessionId: normalizedSessionId ?? '',
        status: 'success',
      };
      if (txHash) query.txHash = txHash;
      if (result?.ledger) query.ledger = String(result.ledger);
      if (checkoutPath) query.path = checkoutPath;

      if (session?.returnUrl) {
        try {
          const url = new URL(session.returnUrl, window.location.origin);
          Object.entries(query).forEach(([k, v]) => url.searchParams.set(k, v));
          window.location.assign(url.toString());
          return;
        } catch {
          // fall back to internal confirmation route
        }
      }

      void router.push({
        pathname: '/checkout/confirmation',
        query,
      });
    },
    [router, normalizedSessionId, checkoutPath, session?.returnUrl],
  );

  const handleError = useCallback(
    (err: CheckoutError | unknown) => {
      setSubmitting(false);
      const decoded = decodeError(err);
      setSubmitError(decoded);
    },
    [],
  );

  const handleSubmitStart = useCallback(() => {
    setSubmitting(true);
    setSubmitError(null);
  }, []);

  const handleCancel = useCallback(() => {
    if (session?.cancelUrl) {
      try {
        window.location.assign(
          new URL(session.cancelUrl, window.location.origin).toString(),
        );
        return;
      } catch {
        // fall back to internal cancel route
      }
    }
    void router.push({
      pathname: '/checkout/cancelled',
      query: { sessionId: normalizedSessionId ?? '' },
    });
  }, [router, normalizedSessionId, session?.cancelUrl]);

  const title = session?.merchantName
    ? `Checkout — ${session.merchantName}`
    : 'Checkout — Cypher GridPay';

  return (
    <>
      <Head>
        <title>{title}</title>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex,nofollow" />
      </Head>
      <main
        style={{
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '24px',
          background: '#f6f7fb',
          fontFamily:
            'system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
        }}
      >
        <div
          style={{
            width: '100%',
            maxWidth: 480,
            background: '#ffffff',
            borderRadius: 16,
            boxShadow: '0 8px 32px rgba(15, 23, 42, 0.08)',
            padding: 24,
          }}
        >
          {session?.merchantName ? (
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                marginBottom: 16,
              }}
            >
              {session.merchantLogoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={session.merchantLogoUrl}
                  alt={session.merchantName}
                  width={40}
                  height={40}
                  style={{ borderRadius: 8, objectFit: 'contain' }}
                />
              ) : null}
              <div>
                <div style={{ fontSize: 12, color: '#64748b' }}>
                  Paying
                </div>
                <div style={{ fontSize: 16, fontWeight: 600 }}>
                  {session.merchantName}
                </div>
              </div>
            </header>
          ) : null}

          {loading ? (
            <div
              role="status"
              aria-live="polite"
              style={{ textAlign: 'center', padding: '32px 0', color: '#475569' }}
            >
              Loading checkout session…
            </div>
          ) : null}

          {!loading && loadError ? (
            <div role="alert" style={{ color: '#b91c1c' }}>
              <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>
                Unable to load checkout
              </h2>
              <p style={{ margin: '0 0 8px' }}>{loadError.message}</p>
              {loadError.recovery ? (
                <p style={{ margin: '0 0 16px', color: '#7f1d1d' }}>
                  {loadError.recovery}
                </p>
              ) : null}
              <button
                type="button"
                onClick={() => router.reload()}
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: 'none',
                  background: '#0f172a',
                  color: '#fff',
                  cursor: 'pointer',
                }}
              >
                Retry
              </button>
            </div>
          ) : null}

          {!loading && !loadError && !normalizedSessionId ? (
            <div role="alert" style={{ color: '#b91c1c' }}>
              Missing checkout session identifier.
            </div>
          ) : null}

          {!loading && !loadError && session && normalizedSessionId ? (
            <>
              <GridPayCheckout
                sessionId={normalizedSessionId}
                session={session}
                mode={checkoutPath ?? 'standard'}
                onSuccess={handleSuccess}
                onError={handleError}
                onSubmitStart={handleSubmitStart}
                onCancel={handleCancel}
                disabled={submitting}
                showConversionRate
                showItemizedBreakdown
                showEscrowWindow={checkoutPath === 'escrowed'}
                showLoyaltyRedemption={
                  checkoutPath === 'loyalty' || Boolean(session.loyaltyRedemption)
                }
                showNetworkFee
                showExpiryCountdown
                pollForConfirmation
              />

              {submitError ? (
                <div
                  role="alert"
                  aria-live="assertive"
                  style={{
                    marginTop: 16,
                    padding: 12,
                    borderRadius: 8,
                    background: '#fef2f2',
                    border: '1px solid #fecaca',
                    color: '#991b1b',
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>
                    Payment failed
                  </div>
                  <div style={{ fontSize: 14, marginBottom: 4 }}>
                    {submitError.message}
                  </div>
                  {submitError.recovery ? (
                    <div style={{ fontSize: 13, color: '#7f1d1d' }}>
                      {submitError.recovery}
                    </div>
                  ) : null}
                  {submitError.actionHref && submitError.actionLabel ? (
                    <a
                      href={submitError.actionHref}
                      style={{
                        display: 'inline-block',
                        marginTop: 8,
                        color: '#b91c1c',
                        fontWeight: 600,
                      }}
                    >
                      {submitError.actionLabel}
                    </a>
                  ) : null}
                  <div style={{ marginTop: 8, fontSize: 12, color: '#9ca3af' }}>
                    Error code: {submitError.code}
                  </div>
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </main>
    </>
  );
};

export default CheckoutPage;