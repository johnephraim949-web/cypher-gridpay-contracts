import React, { useCallback, useEffect, useMemo, useState } from 'react';

export type CheckoutStep = 'review' | 'authorize' | 'receipt';

export interface MerchantInfo {
  name: string;
  domain?: string;
  verifiedTier?: 'basic' | 'verified' | 'premier';
}

export interface LineItem {
  label: string;
  amount: number;
}

export interface AssetOption {
  code: string;
  issuer?: string;
  usdRate: number;
  balance?: number;
  hasTrustline?: boolean;
}

export interface EscrowTerms {
  holdPeriodDays: number;
  disputeWindowDays: number;
}

export interface GridPayCheckoutProps {
  merchant: MerchantInfo;
  items: LineItem[];
  assets: AssetOption[];
  escrow?: EscrowTerms;
  loyaltyPointsAvailable?: number;
  loyaltyPointValueUsd?: number;
  refundVoucherUsd?: number;
  networkFeeXlm?: number;
  xlmUsdRate?: number;
  expiresAt?: number;
  paymentId?: string;
  stellarExpertUrl?: string;
  onSign?: (payload: { assetCode: string; totalUsd: number }) => Promise<void> | void;
  onAddTrustline?: (assetCode: string) => Promise<void> | void;
  onDownloadReceipt?: (format: 'pdf' | 'json') => void;
  onTrackEscrow?: () => void;
  onRequestSupport?: () => void;
}

const DEFAULT_FEE_XLM = 0.00001;
const DEFAULT_XLM_USD = 0.1;

function formatUsd(value: number): string {
  return `$${value.toFixed(2)}`;
}

function useCountdown(expiresAt?: number): { remainingMs: number; expired: boolean } {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!expiresAt) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [expiresAt]);
  if (!expiresAt) return { remainingMs: 0, expired: false };
  const remainingMs = Math.max(0, expiresAt - now);
  return { remainingMs, expired: remainingMs <= 0 };
}

function formatCountdown(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

const VerifiedBadge: React.FC<{ tier?: MerchantInfo['verifiedTier'] }> = ({ tier }) => {
  if (!tier) return null;
  const label = tier === 'premier' ? 'Premier Merchant' : tier === 'verified' ? 'Verified Merchant' : 'Basic Merchant';
  return (
    <span
      className="gridpay-badge"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, padding: '2px 8px', borderRadius: 999, background: '#e8f5e9', color: '#1b5e20' }}
      aria-label={label}
    >
      <span aria-hidden="true">✓</span> {label}
    </span>
  );
};

const StepIndicator: React.FC<{ step: CheckoutStep }> = ({ step }) => {
  const steps: { key: CheckoutStep; label: string }[] = [
    { key: 'review', label: 'Review & Asset' },
    { key: 'authorize', label: 'Authorize & Sign' },
    { key: 'receipt', label: 'Receipt & Tracking' },
  ];
  const activeIndex = steps.findIndex((s) => s.key === step);
  return (
    <ol className="gridpay-steps" style={{ display: 'flex', gap: 12, listStyle: 'none', padding: 0, margin: '0 0 16px' }}>
      {steps.map((s, i) => (
        <li key={s.key} aria-current={s.key === step ? 'step' : undefined} style={{ fontSize: 13, fontWeight: i === activeIndex ? 600 : 400, opacity: i <= activeIndex ? 1 : 0.5 }}>
          {i + 1}. {s.label}
        </li>
      ))}
    </ol>
  );
};

export const GridPayCheckout: React.FC<GridPayCheckoutProps> = ({
  merchant,
  items,
  assets,
  escrow,
  loyaltyPointsAvailable = 0,
  loyaltyPointValueUsd = 0,
  refundVoucherUsd = 0,
  networkFeeXlm = DEFAULT_FEE_XLM,
  xlmUsdRate = DEFAULT_XLM_USD,
  expiresAt,
  paymentId,
  stellarExpertUrl,
  onSign,
  onAddTrustline,
  onDownloadReceipt,
  onTrackEscrow,
  onRequestSupport,
}) => {
  const [step, setStep] = useState<CheckoutStep>('review');
  const [selectedAsset, setSelectedAsset] = useState<string>(assets[0]?.code ?? 'XLM');
  const [useLoyalty, setUseLoyalty] = useState(false);
  const [useVoucher, setUseVoucher] = useState(false);
  const [signing, setSigning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { remainingMs, expired } = useCountdown(expiresAt);
  const asset = useMemo(() => assets.find((a) => a.code === selectedAsset) ?? assets[0], [assets, selectedAsset]);

  const subtotal = useMemo(() => items.reduce((sum, item) => sum + item.amount, 0), [items]);
  const loyaltyDiscount = useLoyalty ? Math.min(subtotal, loyaltyPointsAvailable * loyaltyPointValueUsd) : 0;
  const voucherDiscount = useVoucher ? Math.min(subtotal - loyaltyDiscount, refundVoucherUsd) : 0;
  const totalUsd = Math.max(0, subtotal - loyaltyDiscount - voucherDiscount);
  const feeUsd = networkFeeXlm * xlmUsdRate;
  const convertedTotal = asset ? totalUsd / asset.usdRate : totalUsd;

  const needsTrustline = asset ? asset.hasTrustline === false : false;
  const insufficientBalance = asset?.balance !== undefined && asset.balance < convertedTotal;

  const handleAddTrustline = useCallback(async () => {
    if (!asset || !onAddTrustline) return;
    setError(null);
    try {
      await onAddTrustline(asset.code);
    } catch (e) {
      setError('Could not add trustline. Please try again.');
    }
  }, [asset, onAddTrustline]);

  const handleSign = useCallback(async () => {
    if (!asset || expired) return;
    setSigning(true);
    setError(null);
    try {
      await onSign?.({ assetCode: asset.code, totalUsd });
      setStep('receipt');
    } catch (e) {
      setError('Wallet rejected the signature. No funds were moved.');
    } finally {
      setSigning(false);
    }
  }, [asset, expired, onSign, totalUsd]);

  return (
    <div className="gridpay-checkout" style={{ maxWidth: 560, margin: '0 auto', fontFamily: 'system-ui, sans-serif' }}>
      <StepIndicator step={step} />

      {expiresAt && !expired && (
        <div role="timer" aria-live="polite" style={{ fontSize: 13, marginBottom: 12, color: remainingMs < 60000 ? '#b71c1c' : '#555' }}>
          Session expires in {formatCountdown(remainingMs)}
        </div>
      )}
      {expired && (
        <div role="alert" style={{ padding: 12, background: '#ffebee', color: '#b71c1c', borderRadius: 8, marginBottom: 12 }}>
          This checkout session has expired. Please restart checkout to get a fresh quote.
        </div>
      )}

      {step === 'review' && (
        <section aria-label="Review and asset selection">
          <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
            <h2 style={{ margin: 0, fontSize: 18 }}>{merchant.name}</h2>
            <VerifiedBadge tier={merchant.verifiedTier} />
          </header>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 12px' }}>
            {items.map((item, i) => (
              <li key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '4px 0' }}>
                <span>{item.label}</span>
                <span>{formatUsd(item.amount)}</span>
              </li>
            ))}
          </ul>

          <div style={{ marginBottom: 12 }}>
            <label htmlFor="gridpay-asset" style={{ display: 'block', fontSize: 13, marginBottom: 4 }}>Pay with</label>
            <select id="gridpay-asset" value={selectedAsset} onChange={(e) => setSelectedAsset(e.target.value)} style={{ width: '100%', padding: 8 }}>
              {assets.map((a) => (
                <option key={a.code} value={a.code}>{a.code}</option>
              ))}
            </select>
            {asset && (
              <div style={{ fontSize: 12, color: '#555', marginTop: 4, minHeight: 16 }}>
                ≈ {convertedTotal.toFixed(4)} {asset.code} at live oracle rate
              </div>
            )}
          </div>

          {(loyaltyPointsAvailable > 0 || refundVoucherUsd > 0) && (
            <fieldset style={{ border: '1px solid #ddd', borderRadius: 8, padding: 8, marginBottom: 12 }}>
              <legend style={{ fontSize: 13 }}>Savings</legend>
              {loyaltyPointsAvailable > 0 && (
                <label style={{ display: 'block', fontSize: 13 }}>
                  <input type="checkbox" checked={useLoyalty} onChange={(e) => setUseLoyalty(e.target.checked)} /> Redeem loyalty points
                </label>
              )}
              {refundVoucherUsd > 0 && (
                <label style={{ display: 'block', fontSize: 13 }}>
                  <input type="checkbox" checked={useVoucher} onChange={(e) => setUseVoucher(e.target.checked)} /> Apply refund voucher
                </label>
              )}
            </fieldset>
          )}

          <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 600, marginBottom: 12 }}>
            <span>Total</span>
            <span>{formatUsd(totalUsd)}</span>
          </div>

          {escrow && (
            <div style={{ padding: 12, background: '#e3f2fd', borderRadius: 8, fontSize: 13, marginBottom: 12 }}>
              <strong>Buyer Protection (Escrow)</strong>
              <p style={{ margin: '4px 0 0' }}>
                Your payment is held for {escrow.holdPeriodDays} days before release to the merchant. You can open a dispute within {escrow.disputeWindowDays} days.
              </p>
            </div>
          )}

          <button type="button" disabled={expired} onClick={() => setStep('authorize')} style={{ width: '100%', padding: 12 }}>
            Continue to authorize
          </button>
        </section>
      )}

      {step === 'authorize' && (
        <section aria-label="Authorize and sign">
          {needsTrustline && (
            <div style={{ padding: 12, background: '#fff8e1', borderRadius: 8, marginBottom: 12 }}>
              <p style={{ margin: '0 0 8px', fontSize: 13 }}>Need {asset?.code} trustline? Add in 1 click.</p>
              <button type="button" onClick={handleAddTrustline}>Add {asset?.code} trustline</button>
            </div>
          )}
          {insufficientBalance && (
            <div role="alert" style={{ padding: 12, background: '#ffebee', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
              Insufficient {asset?.code} balance — switch payment asset.
            </div>
          )}

          <div style={{ padding: 12, border: '1px solid #ddd', borderRadius: 8, marginBottom: 12, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <span>Payment</span>
              <span>{formatUsd(totalUsd)}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', color: '#555' }}>
              <span>Soroban network fee</span>
              <span>{networkFeeXlm} XLM (~{formatUsd(feeUsd)})</span>
            </div>
          </div>

          {error && <div role="alert" style={{ color: '#b71c1c', fontSize: 13, marginBottom: 12 }}>{error}</div>}

          <button type="button" disabled={signing || expired || needsTrustline || insufficientBalance} onClick={handleSign} style={{ width: '100%', padding: 12 }}>
            {signing ? 'Waiting for wallet…' : 'Sign payment'}
          </button>
          <button type="button" onClick={() => setStep('review')} style={{ width: '100%', padding: 8, marginTop: 8, background: 'transparent', border: 'none' }}>
            Back
          </button>
        </section>
      )}

      {step === 'receipt' && (
        <section aria-label="Receipt and tracking">
          <div style={{ padding: 16, border: '1px solid #c8e6c9', background: '#f1f8e9', borderRadius: 8, marginBottom: 12 }}>
            <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Payment received</h2>
            {paymentId && <p style={{ margin: '0 0 4px', fontSize: 13 }}>Payment ID: <code>{paymentId}</code></p>}
            <p style={{ margin: 0, fontSize: 13 }}>Amount: {formatUsd(totalUsd)}</p>
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <button type="button" onClick={() => onDownloadReceipt?.('pdf')}>Download PDF</button>
            <button type="button" onClick={() => onDownloadReceipt?.('json')}>Download JSON</button>
          </div>

          {stellarExpertUrl && (
            <p style={{ fontSize: 13 }}>
              <a href={stellarExpertUrl} target="_blank" rel="noopener noreferrer">View on Stellar Expert</a>
            </p>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <button type="button" onClick={onTrackEscrow} style={{ flex: 1, padding: 12 }}>Track Escrow</button>
            <button type="button" onClick={onRequestSupport} style={{ flex: 1, padding: 12 }}>Request Support</button>
          </div>
        </section>
      )}
    </div>
  );
};

export default GridPayCheckout;
