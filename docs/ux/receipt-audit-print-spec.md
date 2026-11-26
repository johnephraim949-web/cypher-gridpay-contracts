# Printable receipt & audit certificate

Plain CSS in `apps/web/src/styles/print.css`; component in
`apps/web/src/components/receipts/PrintableReceipt.tsx`.

## Screen layout

- Single column, max width 760px, white card on grey page.
- Mandatory TESTNET banner when `network === 'testnet'`:
  `TESTNET — NON-PRODUCTION TRANSACTION`.
- Header: title, receipt ID, and a `no-print` "Print / Save PDF" button.
- Body: payer, merchant, amount + asset, status, date, ledger, network, memo, and the
  full transaction hash (never truncated in the printable area).
- Footer: verification QR plus the canonical verification URL in visible text.

## Canonical verification URL

The QR encodes one canonical URL. Default (overridable via `auditUrl`) is Stellar Expert:

- testnet: `https://stellar.expert/explorer/testnet/tx/<txHash>`
- mainnet: `https://stellar.expert/explorer/public/tx/<txHash>`

The URL is also rendered as a real anchor so a scanner failure never hides the audit path.

## Print / PDF rules

- `@page { size: A4 portrait; margin: 14mm; }`
- Hide all `.no-print` controls and the print button.
- Preserve the TESTNET banner with `print-color-adjust: exact`.
- Keep parties, amount, metadata, and the QR footer together with `break-inside: avoid`.
- No backgrounds are required for legibility; borders and text must survive greyscale.
- The transaction hash must remain complete and selectable in the PDF.

## Test hooks

- `data-testid="printable-receipt"`
- `data-testid="receipt-testnet-banner"`
- `data-testid="receipt-qr"` with `data-url` equal to the canonical URL
- `data-testid="receipt-print-button"`
- `data-network` on the root element
