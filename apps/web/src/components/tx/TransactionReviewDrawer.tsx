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
