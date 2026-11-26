import { useState } from 'react';
import { Copy, ChevronDown, ChevronRight, AlertTriangle, ShieldCheck, Loader2, Wallet } from 'lucide-react';

export type TxIntent =
  | 'pay'
  | 'lock_escrow'
  | 'release_escrow'
  | 'file_dispute'
  | 'commit_vote'
  | 'propose_upgrade'
  | 'emergency_pause';

export type SigningPhase =
  | 'idle'
  | 'awaiting_wallet'
  | 'restoring_footprint'
  | 'confirming_network'
  | 'success'
  | 'error';

export interface TransferLeg {
  label: string;
  amount: string;
  asset: string;
  address: string;
}

export interface SorobanTechnicalDetails {
  contractId: string;
  functionName: string;
  cpuInsns?: string;
  memBytes?: string;
  estimatedFee?: string;
  rawXdr: string;
}

export interface TransactionReviewDrawerProps {
  intent: TxIntent;
  phase: SigningPhase;
  from: TransferLeg;
  to: TransferLeg;
  consequence: string;
  highRisk?: boolean;
  requiresRestoreFootprint?: boolean;
  multisig?: { required: number; collected: number };
  technical: SorobanTechnicalDetails;
  onClose?: () => void;
}

const INTENT_LABELS: Record<TxIntent, string> = {
  pay: 'Pay',
  lock_escrow: 'Lock in Escrow',
  release_escrow: 'Release Escrow',
  file_dispute: 'File Dispute',
  commit_vote: 'Commit Vote',
  propose_upgrade: 'Propose Upgrade',
  emergency_pause: 'Emergency Pause',
};

const HIGH_RISK_INTENTS: TxIntent[] = ['release_escrow', 'emergency_pause', 'propose_upgrade'];

function PhaseIndicator({ phase, requiresRestoreFootprint }: { phase: SigningPhase; requiresRestoreFootprint?: boolean }) {
  const steps = requiresRestoreFootprint
    ? ['Restore footprint', 'Sign & submit']
    : ['Sign & submit'];
  const activeIndex =
    phase === 'restoring_footprint' ? 0 : phase === 'confirming_network' || phase === 'success' ? steps.length - 1 : -1;

  return (
    <div className="flex items-center gap-2 text-xs text-slate-500">
      {steps.map((step, i) => (
        <div key={step} className="flex items-center gap-2">
          <span
            className={`flex h-5 w-5 items-center justify-center rounded-full border ${
              i <= activeIndex ? 'border-emerald-500 bg-emerald-500 text-white' : 'border-slate-300 text-slate-400'
            }`}
          >
            {i + 1}
          </span>
          <span className={i <= activeIndex ? 'text-slate-900' : ''}>{step}</span>
          {i < steps.length - 1 && <ChevronRight className="h-3 w-3" />}
        </div>
      ))}
    </div>
  );
}

function PhaseBanner({ phase }: { phase: SigningPhase }) {
  if (phase === 'awaiting_wallet') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-amber-50 p-3 text-sm text-amber-800">
        <Wallet className="mt-0.5 h-4 w-4 shrink-0" />
        <span>Waiting for your wallet extension… check your browser toolbar or popup to approve.</span>
      </div>
    );
  }
  if (phase === 'restoring_footprint' || phase === 'confirming_network') {
    return (
      <div className="flex items-start gap-2 rounded-md bg-sky-50 p-3 text-sm text-sky-800">
        <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" />
        <span>Confirming on Stellar network…</span>
      </div>
    );
  }
  return null;
}

export function TransactionReviewDrawer({
  intent,
  phase,
  from,
  to,
  consequence,
  highRisk,
  requiresRestoreFootprint,
  multisig,
  technical,
  onClose,
}: TransactionReviewDrawerProps) {
  const [showTechnical, setShowTechnical] = useState(false);
  const [copied, setCopied] = useState(false);
  const isHighRisk = highRisk ?? HIGH_RISK_INTENTS.includes(intent);

  const copyXdr = async () => {
    try {
      await navigator.clipboard.writeText(technical.rawXdr);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="flex flex-col gap-4 p-4">
      <div className="flex items-center justify-between">
        <h2 className="text-base font-semibold text-slate-900">{INTENT_LABELS[intent]}</h2>
        {onClose && (
          <button type="button" onClick={onClose} className="text-sm text-slate-500 hover:text-slate-700">
            Close
          </button>
        )}
      </div>

      <PhaseIndicator phase={phase} requiresRestoreFootprint={requiresRestoreFootprint} />
      <PhaseBanner phase={phase} />

      {isHighRisk && (
        <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>This action is irreversible. Review carefully before approving.</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">You Send / Lock</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {from.amount} {from.asset}
          </p>
          <p className="mt-1 break-all text-xs text-slate-500">{from.address}</p>
        </div>
        <div className="rounded-lg border border-slate-200 p-3">
          <p className="text-xs uppercase tracking-wide text-slate-500">Recipient / Vault</p>
          <p className="mt-1 text-lg font-semibold text-slate-900">
            {to.amount} {to.asset}
          </p>
          <p className="mt-1 break-all text-xs text-slate-500">{to.address}</p>
        </div>
      </div>

      <div className="flex items-start gap-2 rounded-md bg-slate-50 p-3 text-sm text-slate-700">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" />
        <span>{consequence}</span>
      </div>

      {multisig && (
        <p className="text-sm text-slate-600">
          Multisig co-sign: {multisig.collected} of {multisig.required} signatures collected.
        </p>
      )}

      <div className="rounded-lg border border-slate-200">
        <button
          type="button"
          onClick={() => setShowTechnical((v) => !v)}
          className="flex w-full items-center justify-between p-3 text-sm font-medium text-slate-700"
        >
          <span>Technical Soroban Details</span>
          <ChevronDown className={`h-4 w-4 transition-transform ${showTechnical ? 'rotate-180' : ''}`} />
        </button>
        {showTechnical && (
          <div className="space-y-2 border-t border-slate-200 p-3 text-xs text-slate-600">
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Contract ID</span>
              <span className="break-all text-right font-mono">{technical.contractId}</span>
            </div>
            <div className="flex justify-between gap-2">
              <span className="text-slate-500">Function</span>
              <span className="font-mono">{technical.functionName}</span>
            </div>
            {technical.cpuInsns && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">CPU</span>
                <span className="font-mono">{technical.cpuInsns}</span>
              </div>
            )}
            {technical.memBytes && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Memory</span>
                <span className="font-mono">{technical.memBytes}</span>
              </div>
            )}
            {technical.estimatedFee && (
              <div className="flex justify-between gap-2">
                <span className="text-slate-500">Estimated fee</span>
                <span className="font-mono">{technical.estimatedFee}</span>
              </div>
            )}
            <div className="space-y-1">
              <span className="text-slate-500">Raw XDR</span>
              <div className="flex items-start gap-2">
                <code className="max-h-24 flex-1 overflow-auto break-all rounded bg-slate-100 p-2 font-mono text-[11px]">
                  {technical.rawXdr}
                </code>
                <button
                  type="button"
                  onClick={copyXdr}
                  className="flex items-center gap-1 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-slate-50"
                >
                  <Copy className="h-3 w-3" />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default TransactionReviewDrawer;
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
