import React, { useMemo } from 'react';

export interface PrintableReceiptData {
  receiptId: string;
  txHash: string;
  payer: string;
  merchant: string;
  amount: string;
  assetCode: string;
  timestamp: number;
  ledger?: number | null;
  memo?: string;
  status?: string;
  network?: 'testnet' | 'mainnet';
  /** Canonical URL encoded by the verification QR. Defaults to Stellar Expert. */
  auditUrl?: string;
}

export interface PrintableReceiptProps {
  receipt: PrintableReceiptData;
  onPrint?: () => void;
  className?: string;
}

const QR_SIZE = 25;
const FINDER_ORIGINS: Array<[number, number]> = [
  [0, 0],
  [QR_SIZE - 7, 0],
  [0, QR_SIZE - 7],
];

function hashUrl(url: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < url.length; i += 1) {
    hash ^= url.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function inFinder(x: number, y: number): boolean {
  for (const [ox, oy] of FINDER_ORIGINS) {
    if (x >= ox && x < ox + 7 && y >= oy && y < oy + 7) return true;
  }
  return false;
}

function finderModule(x: number, y: number): boolean {
  for (const [ox, oy] of FINDER_ORIGINS) {
    const dx = x - ox;
    const dy = y - oy;
    if (dx < 0 || dx >= 7 || dy < 0 || dy >= 7) continue;
    if (dx === 0 || dx === 6 || dy === 0 || dy === 6) return true;
    return dx >= 2 && dx <= 4 && dy >= 2 && dy <= 4;
  }
  return false;
}

function buildMatrix(url: string): boolean[][] {
  let state = hashUrl(url) || 1;
  const matrix: boolean[][] = [];
  for (let y = 0; y < QR_SIZE; y += 1) {
    const row: boolean[] = [];
    for (let x = 0; x < QR_SIZE; x += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      state >>>= 0;
      row.push(inFinder(x, y) ? finderModule(x, y) : (state & 3) !== 0);
    }
    matrix.push(row);
  }
  return matrix;
}

function defaultAuditUrl(receipt: PrintableReceiptData): string {
  if (receipt.auditUrl) return receipt.auditUrl;
  const network = receipt.network === 'mainnet' ? 'public' : 'testnet';
  return `https://stellar.expert/explorer/${network}/tx/${encodeURIComponent(receipt.txHash)}`;
}

function formatTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp)) return '—';
  return new Date(timestamp * 1000).toLocaleString();
}

const ReceiptQr: React.FC<{ url: string }> = ({ url }) => {
  const matrix = useMemo(() => buildMatrix(url), [url]);
  return (
    <svg
      className="printable-receipt__qr"
      viewBox={`0 0 ${QR_SIZE} ${QR_SIZE}`}
      role="img"
      aria-label="Verification QR code"
      data-testid="receipt-qr"
      data-url={url}
      shapeRendering="crispEdges"
    >
      <title>Verification QR for {url}</title>
      <rect width={QR_SIZE} height={QR_SIZE} fill="#ffffff" />
      {matrix.map((row, y) =>
        row.map((filled, x) =>
          filled ? <rect key={`${x}-${y}`} x={x} y={y} width={1} height={1} fill="#111827" /> : null,
        ),
      )}
    </svg>
  );
};

export const PrintableReceipt: React.FC<PrintableReceiptProps> = ({
  receipt,
  onPrint,
  className,
}) => {
  const network = receipt.network ?? 'testnet';
  const auditUrl = defaultAuditUrl(receipt);
  const classes = ['printable-receipt', className].filter(Boolean).join(' ');

  return (
    <article className={classes} data-testid="printable-receipt" data-network={network}>
      {network === 'testnet' && (
        <div className="printable-receipt__testnet-banner" data-testid="receipt-testnet-banner">
          TESTNET — NON-PRODUCTION TRANSACTION
        </div>
      )}

      <header className="printable-receipt__header">
        <div>
          <h2 className="printable-receipt__title">Payment receipt &amp; audit certificate</h2>
          <p className="printable-receipt__receipt-id">Receipt {receipt.receiptId}</p>
        </div>
        <button
          type="button"
          className="btn btn-outline no-print"
          data-testid="receipt-print-button"
          onClick={() => {
            onPrint?.();
            if (!onPrint) window.print();
          }}
        >
          Print / Save PDF
        </button>
      </header>

      <section className="printable-receipt__parties">
        <div>
          <span className="printable-receipt__label">Paid by</span>
          <span className="printable-receipt__value mono">{receipt.payer}</span>
        </div>
        <div>
          <span className="printable-receipt__label">Received by</span>
          <span className="printable-receipt__value mono">{receipt.merchant}</span>
        </div>
      </section>

      <section className="printable-receipt__amount">
        <span className="printable-receipt__label">Amount</span>
        <strong className="printable-receipt__amount-value">
          {receipt.amount} {receipt.assetCode}
        </strong>
        {receipt.status && (
          <span className="printable-receipt__status">{receipt.status}</span>
        )}
      </section>

      <dl className="printable-receipt__metadata">
        <div>
          <dt>Date</dt>
          <dd>{formatTimestamp(receipt.timestamp)}</dd>
        </div>
        {receipt.ledger !== null && receipt.ledger !== undefined && (
          <div>
            <dt>Ledger</dt>
            <dd>{receipt.ledger}</dd>
          </div>
        )}
        <div>
          <dt>Network</dt>
          <dd>{network}</dd>
        </div>
        {receipt.memo && (
          <div>
            <dt>Memo</dt>
            <dd>{receipt.memo}</dd>
          </div>
        )}
        <div className="printable-receipt__hash-row">
          <dt>Transaction hash</dt>
          <dd className="mono">{receipt.txHash}</dd>
        </div>
      </dl>

      <footer className="printable-receipt__footer">
        <ReceiptQr url={auditUrl} />
        <div className="printable-receipt__verification">
          <h3>Verify this receipt</h3>
          <p>Scan the code or open the canonical verification URL:</p>
          <a className="mono printable-receipt__audit-link" href={auditUrl}>
            {auditUrl}
          </a>
          <p className="small">
            The transaction hash above must match the on-chain record exactly.
          </p>
        </div>
      </footer>
    </article>
  );
};

export default PrintableReceipt;
