// apps/web/src/hooks/useGridPayTransaction.ts
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  TransactionBuilder,
  Networks,
  SorobanRpc,
  xdr,
  FeeBumpTransaction,
  Transaction,
  Keypair,
  Account,
  Operation,
} from '@stellar/stellar-sdk';
import {
  simulateTransaction,
  submitTransaction,
  pollTransaction,
  buildRestoreFootprintTransaction,
  GridPaySimulationResult,
  GridPaySubmitResult,
} from '../../../../sdk/typescript/src/transactions';
import {
  decodeGridPayError,
  GridPayDecodedError,
  GridPayErrorCategory,
} from '../../../../sdk/typescript/src/errors';

export type TxStep =
  | 'idle'
  | 'Simulating'
  | 'AwaitingSignature'
  | 'Submitted'
  | 'Confirmed'
  | 'Failed';

export type RemediationAction =
  | 'restore'
  | 'approveAllowance'
  | 'retry'
  | 'retryHigherFee'
  | 'none';

export interface SimulationSummary {
  operationSummary: string;
  contractAddresses: string[];
  cpuInstructions: number;
  memoryBytes: number;
  resourceFeeStroops: string;
  inclusionFeeStroops: string;
  totalFeeStroops: string;
  restorePreambleRequired: boolean;
  restorePreamble?: xdr.SorobanTransactionData | null;
  minResourceFee?: string;
}

export interface DecodedErrorState {
  category: GridPayErrorCategory;
  message: string;
  resolution: string;
  action: RemediationAction;
  actionLabel: string;
  rawCode?: number | string;
  raw?: unknown;
}

export interface UseGridPayTransactionOptions {
  server: SorobanRpc.Server;
  networkPassphrase?: string;
  signTransaction: (
    xdr: string,
    opts?: { networkPassphrase?: string; address?: string }
  ) => Promise<{ signedTxXdr: string; signerAddress?: string }>;
  onConfirmed?: (result: GridPaySubmitResult) => void;
  onError?: (error: DecodedErrorState) => void;
  pollTimeoutMs?: number;
  pollInitialDelayMs?: number;
  pollMaxDelayMs?: number;
}

export interface UseGridPayTransactionResult {
  step: TxStep;
  ledger?: number;
  txHash?: string;
  simulation?: SimulationSummary;
  error?: DecodedErrorState;
  isBusy: boolean;
  explorerUrl?: string;
  simulate: (tx: Transaction | FeeBumpTransaction) => Promise<SimulationSummary | undefined>;
  execute: (
    tx: Transaction | FeeBumpTransaction,
    summary?: SimulationSummary
  ) => Promise<GridPaySubmitResult | undefined>;
  retry: () => Promise<GridPaySubmitResult | undefined>;
  restore: () => Promise<GridPaySubmitResult | undefined>;
  approveAllowance: () => Promise<GridPaySubmitResult | undefined>;
  reset: () => void;
  copyDebugDiagnostics: () => Promise<string>;
}

const DEFAULT_NETWORK = Networks.TESTNET;
const DEFAULT_POLL_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INITIAL_DELAY_MS = 1_000;
const DEFAULT_POLL_MAX_DELAY_MS = 8_000;

const SENSITIVE_MEMO_KEYS = ['memo', 'auth', 'authPayload', 'signature', 'signedTxXdr'];

function redactDiagnostics(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(redactDiagnostics);
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_MEMO_KEYS.includes(k)) {
        out[k] = '[REDACTED]';
      } else {
        out[k] = redactDiagnostics(v);
      }
    }
    return out;
  }
  return value;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableRpcError(err: unknown): boolean {
  const msg = (err as { message?: string } | undefined)?.message ?? String(err);
  return /TRY_AGAIN_LATER|NOT_FOUND|timeout|timed out|ECONNRESET|ETIMEDOUT/i.test(msg);
}

function mapActionForCategory(
  category: GridPayErrorCategory,
  rawCode?: number | string
): { action: RemediationAction; actionLabel: string } {
  switch (category) {
    case 'TTL_EXPIRED':
    case 'ARCHIVED_ENTRY':
      return { action: 'restore', actionLabel: 'Restore Archived Entry' };
    case 'INSUFFICIENT_ALLOWANCE':
    case 'ALLOWANCE':
      return { action: 'approveAllowance', actionLabel: 'Approve Token Allowance' };
    case 'INSUFFICIENT_FEE':
    case 'RESOURCE_LIMIT':
      return { action: 'retryHigherFee', actionLabel: 'Retry with Higher Fee' };
    case 'RATE_LIMIT':
    case 'TRY_AGAIN_LATER':
    case 'NOT_FOUND':
      return { action: 'retry', actionLabel: 'Retry' };
    default:
      if (typeof rawCode === 'number' && rawCode > 0) {
        return { action: 'retry', actionLabel: 'Retry' };
      }
      return { action: 'none', actionLabel: 'Dismiss' };
  }
}

function toDecodedErrorState(
  decoded: GridPayDecodedError,
  raw?: unknown
): DecodedErrorState {
  const { action, actionLabel } = mapActionForCategory(decoded.category, decoded.code);
  return {
    category: decoded.category,
    message: decoded.message,
    resolution: decoded.resolution,
    action,
    actionLabel,
    rawCode: decoded.code,
    raw,
  };
}

function buildSimulationSummary(
  sim: GridPaySimulationResult,
  operationSummary: string,
  contractAddresses: string[]
): SimulationSummary {
  const resourceFee = sim.minResourceFee ?? '0';
  const inclusionFee = sim.inclusionFee ?? '100';
  const total = (BigInt(resourceFee) + BigInt(inclusionFee)).toString();
  return {
    operationSummary,
    contractAddresses,
    cpuInstructions: sim.cpuInstructions ?? 0,
    memoryBytes: sim.memoryBytes ?? 0,
    resourceFeeStroops: resourceFee,
    inclusionFeeStroops: inclusionFee,
    totalFeeStroops: total,
    restorePreambleRequired: Boolean(sim.restorePreamble),
    restorePreamble: sim.restorePreamble ?? null,
    minResourceFee: sim.minResourceFee,
  };
}

function extractContractAddresses(tx: Transaction | FeeBumpTransaction): string[] {
  const addresses = new Set<string>();
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  for (const op of inner.operations) {
    if (op.type === 'invokeHostFunction') {
      const invoke = op as Operation.InvokeHostFunction;
      try {
        const hostFn = invoke.func;
        const invokeContract = hostFn.invokeContract();
        const contractId = invokeContract.contractAddress();
        addresses.add(contractId.contractId().toString('hex'));
      } catch {
        // ignore non-contract invocations
      }
    }
  }
  return Array.from(addresses);
}

function summarizeOperations(tx: Transaction | FeeBumpTransaction): string {
  const inner = tx instanceof FeeBumpTransaction ? tx.innerTransaction : tx;
  if (inner.operations.length === 0) return 'No operations';
  return inner.operations
    .map((op) => {
      if (op.type === 'invokeHostFunction') {
        return 'Invoke Soroban contract';
      }
      if (op.type === 'payment') {
        return `Payment ${op.amount} ${op.asset.code ?? 'XLM'}`;
      }
      return op.type;
    })
    .join(' • ');
}

export function useGridPayTransaction(
  options: UseGridPayTransactionOptions
): UseGridPayTransactionResult {
  const {
    server,
    networkPassphrase = DEFAULT_NETWORK,
    signTransaction,
    onConfirmed,
    onError,
    pollTimeoutMs = DEFAULT_POLL_TIMEOUT_MS,
    pollInitialDelayMs = DEFAULT_POLL_INITIAL_DELAY_MS,
    pollMaxDelayMs = DEFAULT_POLL_MAX_DELAY_MS,
  } = options;

  const [step, setStep] = useState<TxStep>('idle');
  const [ledger, setLedger] = useState<number | undefined>(undefined);
  const [txHash, setTxHash] = useState<string | undefined>(undefined);
  const [simulation, setSimulation] = useState<SimulationSummary | undefined>(undefined);
  const [error, setError] = useState<DecodedErrorState | undefined>(undefined);

  const lastTxRef = useRef<Transaction | FeeBumpTransaction | undefined>(undefined);
  const lastSummaryRef = useRef<SimulationSummary | undefined>(undefined);
  const cancelledRef = useRef(false);

  useEffect(() => {
    return () => {
      cancelledRef.current = true;
    };
  }, []);

  const isBusy = step === 'Simulating' || step === 'AwaitingSignature' || step === 'Submitted';

  const explorerUrl = useMemo(() => {
    if (!txHash) return undefined;
    const network = networkPassphrase === Networks.PUBLIC ? 'public' : 'testnet';
    return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
  }, [txHash, networkPassphrase]);

  const handleError = useCallback(
    (err: unknown) => {
      const decoded = decodeGridPayError(err);
      const state = toDecodedErrorState(decoded, err);
      setError(state);
      setStep('Failed');
      onError?.(state);
      return state;
    },
    [onError]
  );

  const pollWithBackoff = useCallback(
    async (hash: string): Promise<GridPaySubmitResult> => {
      const start = Date.now();
      let delay = pollInitialDelayMs;
      // eslint-disable-next-line no-constant-condition
      while (true) {
        if (cancelledRef.current) {
          throw new Error('Transaction polling cancelled');
        }
        try {
          const result = await pollTransaction(server, hash);
          if (result.status === 'SUCCESS') {
            return result;
          }
          if (result.status === 'FAILED') {
            throw result.error ?? new Error('Transaction failed on ledger');
          }
          // NOT_FOUND / pending -> continue polling
        } catch (err) {
          if (!isRetryableRpcError(err)) {
            throw err;
          }
        }
        if (Date.now() - start > pollTimeoutMs) {
          throw new Error(
            `Transaction confirmation timed out after ${pollTimeoutMs}ms (hash: ${hash})`
          );
        }
        await sleep(delay);
        delay = Math.min(delay * 2, pollMaxDelayMs);
      }
    },
    [server, pollInitialDelayMs, pollMaxDelayMs, pollTimeoutMs]
  );

  const simulate = useCallback(
    async (
      tx: Transaction | FeeBumpTransaction
    ): Promise<SimulationSummary | undefined> => {
      setError(undefined);
      setLedger(undefined);
      setTxHash(undefined);
      setStep('Simulating');
      lastTxRef.current = tx;
      try {
        const sim = await simulateTransaction(server, tx);
        if (sim.error) {
          throw sim.error;
        }
        const summary = buildSimulationSummary(
          sim,
          summarizeOperations(tx),
          extractContractAddresses(tx)
        );
        setSimulation(summary);
        lastSummaryRef.current = summary;
        return summary;
      } catch (err) {
        handleError(err);
        return undefined;
      }
    },
    [server, handleError]
  );

  const signAndSubmit = useCallback(
    async (
      tx: Transaction | FeeBumpTransaction,
      summary?: SimulationSummary
    ): Promise<GridPaySubmitResult> => {
      setStep('AwaitingSignature');
      const signed = await signTransaction(tx.toXDR(), {
        networkPassphrase,
      });
      const signedTx = TransactionBuilder.fromXDR(
        signed.signedTxXdr,
        networkPassphrase
      ) as Transaction | FeeBumpTransaction;
      setStep('Submitted');
      const submitResult = await submitTransaction(server, signedTx);
      if (submitResult.status === 'ERROR') {
        throw submitResult.error ?? new Error('Submission failed');
      }
      const hash = submitResult.hash;
      setTxHash(hash);
      const confirmed = await pollWithBackoff(hash);
      setLedger(confirmed.ledger);
      setStep('Confirmed');
      if (summary) {
        setSimulation(summary);
      }
      onConfirmed?.(confirmed);
      return confirmed;
    },
    [server, signTransaction, networkPassphrase, pollWithBackoff, onConfirmed]
  );

  const execute = useCallback(
    async (
      tx: Transaction | FeeBumpTransaction,
      summary?: SimulationSummary
    ): Promise<GridPaySubmitResult | undefined> => {
      const effectiveSummary = summary ?? lastSummaryRef.current;
      lastTxRef.current = tx;
      try {
        // If restore preamble is required, orchestrate two-step flow first.
        if (effectiveSummary?.restorePreambleRequired && effectiveSummary.restorePreamble) {
          const restoreTx = buildRestoreFootprintTransaction(
            tx,
            effectiveSummary.restorePreamble,
            networkPassphrase
          );
          await signAndSubmit(restoreTx, effectiveSummary);
          // After restore, re-simulate the original transaction.
          const reSim = await simulate(tx);
          if (!reSim) return undefined;
          return await signAndSubmit(tx, reSim);
        }
        return await signAndSubmit(tx, effectiveSummary);
      } catch (err) {
        handleError(err);
        return undefined;
      }
    },
    [signAndSubmit, simulate, handleError, networkPassphrase]
  );

  const retry = useCallback(async (): Promise<GridPaySubmitResult | undefined> => {
    const tx = lastTxRef.current;
    if (!tx) {
      setError({
        category: 'UNKNOWN',
        message: 'Nothing to retry',
        resolution: 'Start a new transaction.',
        action: 'none',
        actionLabel: 'Dismiss',
      });
      return undefined;
    }
    const summary = await simulate(tx);
    if (!summary) return undefined;
    return execute(tx, summary);
  }, [simulate, execute]);

  const restore = useCallback(async (): Promise<GridPaySubmitResult | undefined> => {
    const tx = lastTxRef.current;
    const summary = lastSummaryRef.current;
    if (!tx || !summary?.restorePreamble) {
      setError({
        category: 'ARCHIVED_ENTRY',
        message: 'No restore preamble available',
        resolution: 'Re-run simulation to detect archived entries.',
        action: 'retry',
        actionLabel: 'Retry',
      });
      return undefined;
    }
    return execute(tx, summary);
  }, [execute]);

  const approveAllowance = useCallback(async (): Promise<GridPaySubmitResult | undefined> => {
    // Allowance approval is contract-specific; delegate to caller via retry after
    // the user has signed the approval transaction externally. We re-simulate
    // and re-execute the original transaction.
    return retry();
  }, [retry]);

  const reset = useCallback(() => {
    setStep('idle');
    setLedger(undefined);
    setTxHash(undefined);
    setSimulation(undefined);
    setError(undefined);
    lastTxRef.current = undefined;
    lastSummaryRef.current = undefined;
  }, []);

  const copyDebugDiagnostics = useCallback(async (): Promise<string> => {
    const diagnostics = {
      step,
      ledger,
      txHash,
      explorerUrl,
      simulation: simulation
        ? {
            ...simulation,
            restorePreamble: simulation.restorePreamble ? '[PRESENT]' : null,
          }
        : undefined,
      error: error
        ? {
            category: error.category,
            message: error.message,
            resolution: error.resolution,
            rawCode: error.rawCode,
            raw: redactDiagnostics(error.raw),
          }
        : undefined,
      timestamp: new Date().toISOString(),
    };
    const text = JSON.stringify(diagnostics, null, 2);
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
      }
    } catch {
      // ignore clipboard failures
    }
    return text;
  }, [step, ledger, txHash, explorerUrl, simulation, error]);

  return {
    step,
    ledger,
    txHash,
    simulation,
    error,
    isBusy,
    explorerUrl,
    simulate,
    execute,
    retry,
    restore,
    approveAllowance,
    reset,
    copyDebugDiagnostics,
  };
}

export default useGridPayTransaction;