'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  useGridPayTransaction,
  type GridPayTxStep,
  type GridPayTxState,
} from '../../hooks/useGridPayTransaction';
import {
  decodeGridPayError,
  redactDiagnostics,
  type DecodedGridPayError,
} from '@gridpay/sdk/errors';

export interface TransactionReviewDrawerProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  operationSummary: string;
  contractAddresses?: string[];
  network?: 'testnet' | 'mainnet' | 'futurenet';
  /** Optional override for the action that triggers simulation + signing. */
  onExecute?: () => Promise<void>;
  /** Optional raw diagnostics payload for support tickets. */
  diagnostics?: Record<string, unknown>;
}

const STELLAR_EXPERT_BASE: Record<string, string> = {
  testnet: 'https://stellar.expert/explorer/testnet',
  mainnet: 'https://stellar.expert/explorer/public',
  futurenet: 'https://stellar.expert/explorer/futurenet',
};

const STEP_ORDER: GridPayTxStep[] = [
  'simulating',
  'awaiting_signature',
  'submitted',
  'confirmed',
];

const STEP_LABELS: Record<GridPayTxStep, string> = {
  simulating: 'Simulating',
  awaiting_signature: 'Awaiting Signature',
  submitted: 'Submitted',
  confirmed: 'Confirmed on Ledger',
};

function formatStroops(stroops: number | bigint | undefined | null): string {
  if (stroops === undefined || stroops === null) return '—';
  const value = typeof stroops === 'bigint' ? Number(stroops) : stroops;
  if (!Number.isFinite(value)) return '—';
  const xlm = value / 10_000_000;
  return `${value.toLocaleString()} stroops (${xlm.toFixed(7)} XLM)`;
}

function explorerLink(
  network: string,
  kind: 'tx' | 'contract' | 'account',
  id: string,
): string {
  const base = STELLAR_EXPERT_BASE[network] ?? STELLAR_EXPERT_BASE.testnet;
  return `${base}/${kind}/${id}`;
}

function stepIndex(step: GridPayTxStep | undefined): number {
  if (!step) return -1;
  return STEP_ORDER.indexOf(step);
}

interface FootprintGaugeProps {
  cpuInsns?: number;
  memBytes?: number;
  cpuLimit?: number;
  memLimit?: number;
}

const FootprintGauge: React.FC<FootprintGaugeProps> = ({
  cpuInsns,
  memBytes,
  cpuLimit = 100_000_000,
  memLimit = 41_943_040,
}) => {
  const cpuPct = cpuInsns ? Math.min(100, (cpuInsns / cpuLimit) * 100) : 0;
  const memPct = memBytes ? Math.min(100, (memBytes / memLimit) * 100) : 0;

  const barColor = (pct: number) =>
    pct > 90 ? '#dc2626' : pct > 70 ? '#f59e0b' : '#16a34a';

  return (
    <div className="gridpay-footprint-gauge" data-testid="footprint-gauge">
      <div className="gridpay-gauge-row">
        <span className="gridpay-gauge-label">CPU Instructions</span>
        <span className="gridpay-gauge-value">
          {cpuInsns !== undefined ? cpuInsns.toLocaleString() : '—'} /{' '}
          {cpuLimit.toLocaleString()}
        </span>
      </div>
      <div className="gridpay-gauge-track">
        <div
          className="gridpay-gauge-fill"
          style={{ width: `${cpuPct}%`, backgroundColor: barColor(cpuPct) }}
        />
      </div>
      <div className="gridpay-gauge-row">
        <span className="gridpay-gauge-label">Memory Footprint</span>
        <span className="gridpay-gauge-value">
          {memBytes !== undefined ? memBytes.toLocaleString() : '—'} /{' '}
          {memLimit.toLocaleString()} bytes
        </span>
      </div>
      <div className="gridpay-gauge-track">
        <div
          className="gridpay-gauge-fill"
          style={{ width: `${memPct}%`, backgroundColor: barColor(memPct) }}
        />
      </div>
    </div>
  );
};

interface ProgressTrackerProps {
  state: GridPayTxState;
  network: string;
  txHash?: string;
  ledger?: number;
}

const ProgressTracker: React.FC<ProgressTrackerProps> = ({
  state,
  network,
  txHash,
  ledger,
}) => {
  const current = stepIndex(state.step);
  return (
    <ol className="gridpay-progress-tracker" data-testid="progress-tracker">
      {STEP_ORDER.map((step, idx) => {
        const isDone = current > idx || state.step === 'confirmed';
        const isActive = current === idx && state.step !== 'confirmed';
        const label =
          step === 'confirmed' && ledger !== undefined
            ? `Confirmed on Ledger #${ledger}`
            : STEP_LABELS[step];
        return (
          <li
            key={step}
            className={
              'gridpay-progress-step' +
              (isDone ? ' is-done' : '') +
              (isActive ? ' is-active' : '')
            }
            data-testid={`progress-step-${step}`}
          >
            <span className="gridpay-progress-dot">{isDone ? '✓' : idx + 1}</span>
            <span className="gridpay-progress-label">{label}</span>
            {step === 'submitted' && txHash && (
              <a
                className="gridpay-explorer-link"
                href={explorerLink(network, 'tx', txHash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Stellar Expert ↗
              </a>
            )}
            {step === 'confirmed' && txHash && (
              <a
                className="gridpay-explorer-link"
                href={explorerLink(network, 'tx', txHash)}
                target="_blank"
                rel="noopener noreferrer"
              >
                View on Stellar Expert ↗
              </a>
            )}
          </li>
        );
      })}
    </ol>
  );
};

interface ErrorPanelProps {
  decoded: DecodedGridPayError;
  onAction: (action: string) => void;
}

const ErrorPanel: React.FC<ErrorPanelProps> = ({ decoded, onAction }) => {
  return (
    <div className="gridpay-error-panel" data-testid="error-panel">
      <div className="gridpay-error-category" data-testid="error-category">
        {decoded.category}
      </div>
      <div className="gridpay-error-message" data-testid="error-message">
        {decoded.message}
      </div>
      {decoded.resolution && (
        <div className="gridpay-error-resolution" data-testid="error-resolution">
          {decoded.resolution}
        </div>
      )}
      {decoded.action && (
        <button
          type="button"
          className="gridpay-btn gridpay-btn-primary"
          data-testid="error-action-button"
          onClick={() => onAction(decoded.action!)}
        >
          {decoded.action}
        </button>
      )}
    </div>
  );
};

export const TransactionReviewDrawer: React.FC<TransactionReviewDrawerProps> = ({
  open,
  onClose,
  title = 'Review Transaction',
  operationSummary,
  contractAddresses = [],
  network = 'testnet',
  onExecute,
  diagnostics,
}) => {
  const tx = useGridPayTransaction();
  const [copied, setCopied] = useState(false);

  const decodedError = useMemo<DecodedGridPayError | null>(() => {
    if (!tx.error) return null;
    try {
      return decodeGridPayError(tx.error);
    } catch {
      return {
        category: 'Unknown',
        message:
          typeof tx.error === 'string' ? tx.error : 'An unexpected error occurred.',
        resolution: 'Please retry or contact support with debug diagnostics.',
      } as DecodedGridPayError;
    }
  }, [tx.error]);

  const handleExecute = useCallback(async () => {
    if (onExecute) {
      await tx.run(onExecute);
    } else {
      await tx.simulateAndSubmit();
    }
  }, [onExecute, tx]);

  const handleErrorAction = useCallback(
    (action: string) => {
      switch (action) {
        case 'Restore Archived Entry':
          void tx.restoreFootprint();
          break;
        case 'Approve Token Allowance':
          void tx.approveAllowance();
          break;
        case 'Retry with Higher Fee':
          void tx.retryWithHigherFee();
          break;
        default:
          void tx.retry();
      }
    },
    [tx],
  );

  const handleCopyDiagnostics = useCallback(async () => {
    const payload = redactDiagnostics({
      operationSummary,
      contractAddresses,
      network,
      state: tx.state,
      error: tx.error,
      simulation: tx.simulation,
      ...(diagnostics ?? {}),
    });
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable; no-op.
    }
  }, [operationSummary, contractAddresses, network, tx.state, tx.error, tx.simulation, diagnostics]);

  if (!open) return null;

  const sim = tx.simulation;
  const resourceFee = sim?.resourceFeeStroops;
  const inclusionFee = sim?.inclusionFeeStroops;
  const needsRestore = Boolean(sim?.restorePreamble);

  return (
    <div
      className="gridpay-drawer-overlay"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      data-testid="transaction-review-drawer"
    >
      <div className="gridpay-drawer">
        <header className="gridpay-drawer-header">
          <h2>{title}</h2>
          <button
            type="button"
            className="gridpay-drawer-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <section className="gridpay-drawer-section" data-testid="operation-summary">
          <h3>Operation Summary</h3>
          <p>{operationSummary}</p>
        </section>

        {contractAddresses.length > 0 && (
          <section className="gridpay-drawer-section" data-testid="contract-addresses">
            <h3>Affected Contracts</h3>
            <ul>
              {contractAddresses.map((addr) => (
                <li key={addr}>
                  <a
                    href={explorerLink(network, 'contract', addr)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="gridpay-explorer-link"
                  >
                    {addr}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        )}

        {sim && (
          <section className="gridpay-drawer-section" data-testid="simulation-results">
            <h3>Resource Footprint</h3>
            <FootprintGauge
              cpuInsns={sim.cpuInsns}
              memBytes={sim.memBytes}
              cpuLimit={sim.cpuLimit}
              memLimit={sim.memLimit}
            />
            <div className="gridpay-fee-breakdown" data-testid="fee-breakdown">
              <div className="gridpay-fee-row">
                <span>Resource Fee</span>
                <span data-testid="resource-fee">{formatStroops(resourceFee)}</span>
              </div>
              <div className="gridpay-fee-row">
                <span>Inclusion Fee</span>
                <span data-testid="inclusion-fee">{formatStroops(inclusionFee)}</span>
              </div>
              <div className="gridpay-fee-row gridpay-fee-total">
                <span>Total</span>
                <span data-testid="total-fee">
                  {formatStroops(
                    (resourceFee ?? 0) + (inclusionFee ?? 0),
                  )}
                </span>
              </div>
            </div>
            {needsRestore && (
              <div className="gridpay-restore-notice" data-testid="restore-notice">
                This transaction requires restoring archived ledger entries before
                execution. A guided two-step Restore Footprint → Execute flow will
                run automatically.
              </div>
            )}
          </section>
        )}

        <section className="gridpay-drawer-section" data-testid="progress-section">
          <h3>Progress</h3>
          <ProgressTracker
            state={tx.state}
            network={network}
            txHash={tx.txHash}
            ledger={tx.ledger}
          />
        </section>

        {decodedError && (
          <section className="gridpay-drawer-section">
            <h3>Error</h3>
            <ErrorPanel decoded={decodedError} onAction={handleErrorAction} />
          </section>
        )}

        <footer className="gridpay-drawer-footer">
          <button
            type="button"
            className="gridpay-btn gridpay-btn-secondary"
            onClick={handleCopyDiagnostics}
            data-testid="copy-diagnostics"
          >
            {copied ? 'Copied!' : 'Copy Debug Diagnostics'}
          </button>
          <button
            type="button"
            className="gridpay-btn gridpay-btn-secondary"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="gridpay-btn gridpay-btn-primary"
            onClick={handleExecute}
            disabled={tx.isPending}
            data-testid="execute-button"
          >
            {tx.isPending ? 'Processing…' : 'Simulate & Sign'}
          </button>
        </footer>
      </div>
    </div>
  );
};

export default TransactionReviewDrawer;