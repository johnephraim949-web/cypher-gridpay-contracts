import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * MultisigProposalQueue
 * ----------------------------------------------------------------------------
 * Operational queue for multi-admin WASM upgrade proposals and contract
 * rotations on the Soroban orchestrator admin contract.
 *
 * Responsibilities:
 *  - List pending `UpgradeProposal`s (propose_upgrade / approve_upgrade /
 *    execute_upgrade / cancel) and `PendingRotation`s (get_pending_rotation /
 *    execute_*_rotation).
 *  - Enforce WASM SHA-256 hash verification: inputs MUST be 64-char lowercase
 *    hex strings matching the uploaded CI SEP-42 checksum manifest before a
 *    proposal can be submitted.
 *  - Render M-of-N signer approval progress and a live timelock countdown.
 *  - Provide approve / execute / cancel actions.
 *
 * The component is intentionally presentational + validation heavy; the actual
 * Soroban transaction construction is delegated to the injected callbacks so
 * the parent OrchestratorConsole can own wallet/signing concerns.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ContractAlias = "Payment" | "Escrow" | "Refund" | "Admin";

export interface UpgradeProposal {
  id: string;
  contractAlias: ContractAlias;
  /** 64-char lowercase hex SHA-256 of the new WASM blob. */
  wasmHash: string;
  /** Ledger sequence at which the proposal was created. */
  proposedAtLedger: number;
  /** Ledger sequence at which the timelock expires and execution is allowed. */
  timelockExpiresAtLedger: number;
  /** Current ledger sequence (used for countdown). */
  currentLedger: number;
  /** Addresses that have approved. */
  approvals: string[];
  /** Required approvals (N in M-of-N). */
  threshold: number;
  /** Total eligible signers (M in M-of-N). */
  totalSigners: number;
  /** Whether the connected signer has already approved. */
  hasCurrentSignerApproved: boolean;
  status: "pending" | "ready" | "executed" | "cancelled";
}

export interface PendingRotation {
  id: string;
  contractAlias: ContractAlias;
  /** Current contract id being rotated out. */
  currentContractId: string;
  /** Proposed replacement contract id. */
  proposedContractId: string;
  proposedAtLedger: number;
  timelockExpiresAtLedger: number;
  currentLedger: number;
  approvals: string[];
  threshold: number;
  totalSigners: number;
  hasCurrentSignerApproved: boolean;
  status: "pending" | "ready" | "executed" | "cancelled";
}

export interface Sep42ChecksumManifest {
  /** Map of contract alias -> expected 64-char lowercase hex SHA-256. */
  checksums: Partial<Record<ContractAlias, string>>;
  /** Optional build identifier for display. */
  buildId?: string;
}

export interface MultisigProposalQueueProps {
  upgradeProposals: UpgradeProposal[];
  pendingRotations: PendingRotation[];
  /** CI SEP-42 checksum manifest used to verify WASM hashes. */
  checksumManifest?: Sep42ChecksumManifest | null;
  /** Whether the connected signer is a super-admin (can propose/execute). */
  isSuperAdmin: boolean;
  /** Whether the connected signer can approve (any admin). */
  canApprove: boolean;
  /** Ledger time estimate in ms, used for countdown ticking. */
  ledgerTimeMs?: number;
  /** Callbacks wired to Soroban contract entrypoints. */
  onProposeUpgrade?: (input: {
    contractAlias: ContractAlias;
    wasmHash: string;
  }) => Promise<void> | void;
  onApproveUpgrade?: (proposalId: string) => Promise<void> | void;
  onExecuteUpgrade?: (proposalId: string) => Promise<void> | void;
  onCancelUpgrade?: (proposalId: string) => Promise<void> | void;
  onExecuteRotation?: (rotationId: string) => Promise<void> | void;
  onCancelRotation?: (rotationId: string) => Promise<void> | void;
  /** Optional refresh hook invoked after a successful action. */
  onRefresh?: () => void;
}

// ---------------------------------------------------------------------------
// Validation helpers (exported for integration tests)
// ---------------------------------------------------------------------------

const WASM_HASH_REGEX = /^[0-9a-f]{64}$/;

/**
 * Returns true iff `hash` is a valid 64-char lowercase hex SHA-256 digest.
 */
export function isValidWasmHash(hash: string | null | undefined): boolean {
  if (typeof hash !== "string") return false;
  return WASM_HASH_REGEX.test(hash);
}

export type WasmHashValidationResult =
  | { ok: true }
  | { ok: false; reason: string };

/**
 * Validates a WASM hash against format rules AND the SEP-42 checksum manifest.
 * The manifest check is only enforced when a manifest is supplied and contains
 * an entry for the given contract alias.
 */
export function validateWasmHash(
  hash: string,
  contractAlias: ContractAlias,
  manifest?: Sep42ChecksumManifest | null,
): WasmHashValidationResult {
  if (!hash || hash.trim().length === 0) {
    return { ok: false, reason: "WASM SHA-256 hash is required." };
  }
  if (hash !== hash.trim()) {
    return { ok: false, reason: "WASM hash must not contain leading/trailing whitespace." };
  }
  if (!isValidWasmHash(hash)) {
    return {
      ok: false,
      reason:
        "WASM hash must be a 64-character lowercase hexadecimal SHA-256 digest.",
    };
  }
  const expected = manifest?.checksums?.[contractAlias];
  if (expected && expected !== hash) {
    return {
      ok: false,
      reason: `WASM hash does not match the CI SEP-42 checksum manifest for ${contractAlias}.`,
    };
  }
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

const CONTRACT_ALIASES: ContractAlias[] = ["Payment", "Escrow", "Refund", "Admin"];

function shorten(value: string, head = 6, tail = 6): string {
  if (!value) return "";
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function formatLedgers(ledgers: number): string {
  if (ledgers <= 0) return "0 ledgers";
  return `${ledgers.toLocaleString()} ledger${ledgers === 1 ? "" : "s"}`;
}

function statusBadgeClass(status: UpgradeProposal["status"]): string {
  switch (status) {
    case "ready":
      return "bg-emerald-500/15 text-emerald-300 border-emerald-500/40";
    case "executed":
      return "bg-sky-500/15 text-sky-300 border-sky-500/40";
    case "cancelled":
      return "bg-zinc-500/15 text-zinc-400 border-zinc-500/40";
    case "pending":
    default:
      return "bg-amber-500/15 text-amber-300 border-amber-500/40";
  }
}

// ---------------------------------------------------------------------------
// Timelock countdown hook
// ---------------------------------------------------------------------------

function useTimelockCountdown(
  expiresAtLedger: number,
  initialCurrentLedger: number,
  ledgerTimeMs: number,
): { remainingLedgers: number; remainingMs: number; isExpired: boolean } {
  const [currentLedger, setCurrentLedger] = useState(initialCurrentLedger);

  useEffect(() => {
    setCurrentLedger(initialCurrentLedger);
  }, [initialCurrentLedger]);

  useEffect(() => {
    if (expiresAtLedger <= currentLedger) return;
    const interval = window.setInterval(() => {
      setCurrentLedger((prev) => prev + 1);
    }, ledgerTimeMs);
    return () => window.clearInterval(interval);
  }, [expiresAtLedger, currentLedger, ledgerTimeMs]);

  const remainingLedgers = Math.max(0, expiresAtLedger - currentLedger);
  return {
    remainingLedgers,
    remainingMs: remainingLedgers * ledgerTimeMs,
    isExpired: remainingLedgers <= 0,
  };
}

function TimelockCountdown({
  expiresAtLedger,
  currentLedger,
  ledgerTimeMs,
}: {
  expiresAtLedger: number;
  currentLedger: number;
  ledgerTimeMs: number;
}) {
  const { remainingLedgers, isExpired } = useTimelockCountdown(
    expiresAtLedger,
    currentLedger,
    ledgerTimeMs,
  );
  if (isExpired) {
    return (
      <span className="text-xs font-medium text-emerald-300" data-testid="timelock-expired">
        Timelock elapsed
      </span>
    );
  }
  return (
    <span className="text-xs font-medium text-amber-300" data-testid="timelock-countdown">
      Timelock: {formatLedgers(remainingLedgers)} remaining
    </span>
  );
}

// ---------------------------------------------------------------------------
// Approval progress
// ---------------------------------------------------------------------------

function ApprovalProgress({
  approvals,
  threshold,
  totalSigners,
}: {
  approvals: string[];
  threshold: number;
  totalSigners: number;
}) {
  const count = approvals.length;
  const pct = totalSigners > 0 ? Math.min(100, (count / threshold) * 100) : 0;
  return (
    <div className="flex flex-col gap-1" data-testid="approval-progress">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span>
          Approvals:{" "}
          <span className="font-semibold text-zinc-200">
            {count} of {threshold}
          </span>{" "}
          <span className="text-zinc-500">(M of N: {threshold}/{totalSigners})</span>
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-800">
        <div
          className={`h-full rounded-full transition-all ${
            count >= threshold ? "bg-emerald-400" : "bg-amber-400"
          }`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Action button
// ---------------------------------------------------------------------------

function ActionButton({
  label,
  onClick,
  disabled,
  variant = "default",
  testId,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "danger";
  testId?: string;
}) {
  const base =
    "inline-flex items-center justify-center rounded-md px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-40";
  const variants: Record<string, string> = {
    default: "border border-zinc-700 bg-zinc-800 text-zinc-200 hover:bg-zinc-700",
    primary:
      "border border-emerald-500/50 bg-emerald-500/15 text-emerald-200 hover:bg-emerald-500/25",
    danger: "border border-rose-500/50 bg-rose-500/15 text-rose-200 hover:bg-rose-500/25",
  };
  return (
    <button
      type="button"
      className={`${base} ${variants[variant]}`}
      onClick={onClick}
      disabled={disabled}
      data-testid={testId}
    >
      {label}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Propose upgrade form
// ---------------------------------------------------------------------------

function ProposeUpgradeForm({
  manifest,
  isSuperAdmin,
  onProposeUpgrade,
  onRefresh,
}: {
  manifest?: Sep42ChecksumManifest | null;
  isSuperAdmin: boolean;
  onProposeUpgrade?: MultisigProposalQueueProps["onProposeUpgrade"];
  onRefresh?: () => void;
}) {
  const [contractAlias, setContractAlias] = useState<ContractAlias>("Payment");
  const [wasmHash, setWasmHash] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const validation = useMemo(
    () => validateWasmHash(wasmHash, contractAlias, manifest),
    [wasmHash, contractAlias, manifest],
  );

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      setError(null);
      const result = validateWasmHash(wasmHash, contractAlias, manifest);
      if (!result.ok) {
        setError(result.reason);
        return;
      }
      if (!onProposeUpgrade) {
        setError("Proposal submission is not available.");
        return;
      }
      try {
        setSubmitting(true);
        await onProposeUpgrade({ contractAlias, wasmHash });
        setWasmHash("");
        onRefresh?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to submit proposal.");
      } finally {
        setSubmitting(false);
      }
    },
    [wasmHash, contractAlias, manifest, onProposeUpgrade, onRefresh],
  );

  if (!isSuperAdmin) {
    return (
      <div
        className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4 text-xs text-zinc-500"
        data-testid="propose-upgrade-locked"
      >
        Only super-admins can propose WASM upgrades.
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
      data-testid="propose-upgrade-form"
    >
      <h3 className="mb-3 text-sm font-semibold text-zinc-200">Propose WASM Upgrade</h3>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          Contract
          <select
            value={contractAlias}
            onChange={(e) => setContractAlias(e.target.value as ContractAlias)}
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-100 focus:border-emerald-500 focus:outline-none"
            data-testid="propose-contract-select"
          >
            {CONTRACT_ALIASES.map((alias) => (
              <option key={alias} value={alias}>
                {alias}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-xs text-zinc-400">
          WASM SHA-256
          <input
            type="text"
            value={wasmHash}
            onChange={(e) => setWasmHash(e.target.value)}
            placeholder="64-char lowercase hex"
            spellCheck={false}
            autoComplete="off"
            className="rounded-md border border-zinc-700 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 focus:border-emerald-500 focus:outline-none"
            data-testid="propose-wasm-hash-input"
          />
        </label>
      </div>

      {manifest?.checksums?.[contractAlias] ? (
        <p className="mt-2 break-all font-mono text-[11px] text-zinc-500">
          Expected (SEP-42): {manifest.checksums[contractAlias]}
        </p>
      ) : (
        <p className="mt-2 text-[11px] text-zinc-500">
          No SEP-42 checksum manifest entry for {contractAlias}; format validation only.
        </p>
      )}

      {wasmHash.length > 0 && !validation.ok ? (
        <p className="mt-2 text-xs text-rose-400" data-testid="wasm-hash-error">
          {validation.reason}
        </p>
      ) : null}
      {error ? (
        <p className="mt-2 text-xs text-rose-400" data-testid="propose-error">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex justify-end">
        <ActionButton
          label={submitting ? "Submitting…" : "Propose Upgrade"}
          onClick={() => {
            /* handled by form submit */
          }}
          disabled={!validation.ok || submitting}
          variant="primary"
          testId="propose-upgrade-submit"
        />
      </div>
      {/* Hidden native submit so Enter works and the button above triggers it */}
      <button type="submit" className="hidden" aria-hidden="true" tabIndex={-1} />
    </form>
  );
}

// ---------------------------------------------------------------------------
// Upgrade proposal row
// ---------------------------------------------------------------------------

function UpgradeProposalRow({
  proposal,
  isSuperAdmin,
  canApprove,
  ledgerTimeMs,
  manifest,
  onApproveUpgrade,
  onExecuteUpgrade,
  onCancelUpgrade,
  onRefresh,
}: {
  proposal: UpgradeProposal;
  isSuperAdmin: boolean;
  canApprove: boolean;
  ledgerTimeMs: number;
  manifest?: Sep42ChecksumManifest | null;
  onApproveUpgrade?: MultisigProposalQueueProps["onApproveUpgrade"];
  onExecuteUpgrade?: MultisigProposalQueueProps["onExecuteUpgrade"];
  onCancelUpgrade?: MultisigProposalQueueProps["onCancelUpgrade"];
  onRefresh?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const expected = manifest?.checksums?.[proposal.contractAlias];
  const hashMatchesManifest = !expected || expected === proposal.wasmHash;
  const hashFormatValid = isValidWasmHash(proposal.wasmHash);

  const timelockElapsed = proposal.currentLedger >= proposal.timelockExpiresAtLedger;
  const approvalsMet = proposal.approvals.length >= proposal.threshold;
  const canExecute =
    isSuperAdmin &&
    proposal.status !== "executed" &&
    proposal.status !== "cancelled" &&
    timelockElapsed &&
    approvalsMet &&
    hashFormatValid &&
    hashMatchesManifest;

  const run = useCallback(
    async (key: string, fn?: () => Promise<void> | void) => {
      if (!fn) return;
      setError(null);
      try {
        setBusy(key);
        await fn();
        onRefresh?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setBusy(null);
      }
    },
    [onRefresh],
  );

  return (
    <div
      className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
      data-testid={`upgrade-proposal-${proposal.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">
              {proposal.contractAlias} Upgrade
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(
                proposal.status,
              )}`}
            >
              {proposal.status}
            </span>
          </div>
          <span className="font-mono text-[11px] text-zinc-500" title={proposal.wasmHash}>
            WASM: {shorten(proposal.wasmHash, 10, 10)}
          </span>
        </div>
        <TimelockCountdown
          expiresAtLedger={proposal.timelockExpiresAtLedger}
          currentLedger={proposal.currentLedger}
          ledgerTimeMs={ledgerTimeMs}
        />
      </div>

      <div className="mt-3">
        <ApprovalProgress
          approvals={proposal.approvals}
          threshold={proposal.threshold}
          totalSigners={proposal.totalSigners}
        />
      </div>

      {!hashFormatValid ? (
        <p className="mt-2 text-xs text-rose-400" data-testid="proposal-hash-invalid">
          Stored WASM hash is malformed; execution blocked.
        </p>
      ) : !hashMatchesManifest ? (
        <p className="mt-2 text-xs text-rose-400" data-testid="proposal-hash-mismatch">
          Stored WASM hash does not match the SEP-42 checksum manifest.
        </p>
      ) : null}

      {error ? (
        <p className="mt-2 text-xs text-rose-400" data-testid="proposal-action-error">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <ActionButton
          label={busy === "approve" ? "Approving…" : "Approve"}
          onClick={() => run("approve", () => onApproveUpgrade?.(proposal.id))}
          disabled={
            !canApprove ||
            proposal.hasCurrentSignerApproved ||
            proposal.status === "executed" ||
            proposal.status === "cancelled" ||
            busy !== null
          }
          testId={`approve-upgrade-${proposal.id}`}
        />
        <ActionButton
          label={busy === "execute" ? "Executing…" : "Execute"}
          onClick={() => run("execute", () => onExecuteUpgrade?.(proposal.id))}
          disabled={!canExecute || busy !== null}
          variant="primary"
          testId={`execute-upgrade-${proposal.id}`}
        />
        <ActionButton
          label={busy === "cancel" ? "Cancelling…" : "Cancel"}
          onClick={() => run("cancel", () => onCancelUpgrade?.(proposal.id))}
          disabled={
            !isSuperAdmin ||
            proposal.status === "executed" ||
            proposal.status === "cancelled" ||
            busy !== null
          }
          variant="danger"
          testId={`cancel-upgrade-${proposal.id}`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rotation row
// ---------------------------------------------------------------------------

function RotationRow({
  rotation,
  isSuperAdmin,
  ledgerTimeMs,
  onExecuteRotation,
  onCancelRotation,
  onRefresh,
}: {
  rotation: PendingRotation;
  isSuperAdmin: boolean;
  ledgerTimeMs: number;
  onExecuteRotation?: MultisigProposalQueueProps["onExecuteRotation"];
  onCancelRotation?: MultisigProposalQueueProps["onCancelRotation"];
  onRefresh?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const timelockElapsed = rotation.currentLedger >= rotation.timelockExpiresAtLedger;
  const approvalsMet = rotation.approvals.length >= rotation.threshold;
  const canExecute =
    isSuperAdmin &&
    rotation.status !== "executed" &&
    rotation.status !== "cancelled" &&
    timelockElapsed &&
    approvalsMet;

  const run = useCallback(
    async (key: string, fn?: () => Promise<void> | void) => {
      if (!fn) return;
      setError(null);
      try {
        setBusy(key);
        await fn();
        onRefresh?.();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setBusy(null);
      }
    },
    [onRefresh],
  );

  return (
    <div
      className="rounded-lg border border-zinc-800 bg-zinc-900/60 p-4"
      data-testid={`rotation-${rotation.id}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold text-zinc-100">
              {rotation.contractAlias} Rotation
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${statusBadgeClass(
                rotation.status,
              )}`}
            >
              {rotation.status}
            </span>
          </div>
          <span className="font-mono text-[11px] text-zinc-500" title={rotation.currentContractId}>
            from: {shorten(rotation.currentContractId, 8, 8)}
          </span>
          <span className="font-mono text-[11px] text-zinc-500" title={rotation.proposedContractId}>
            to: {shorten(rotation.proposedContractId, 8, 8)}
          </span>
        </div>
        <TimelockCountdown
          expiresAtLedger={rotation.timelockExpiresAtLedger}
          currentLedger={rotation.currentLedger}
          ledgerTimeMs={ledgerTimeMs}
        />
      </div>

      <div className="mt-3">
        <ApprovalProgress
          approvals={rotation.approvals}
          threshold={rotation.threshold}
          totalSigners={rotation.totalSigners}
        />
      </div>

      {error ? (
        <p className="mt-2 text-xs text-rose-400" data-testid="rotation-action-error">
          {error}
        </p>
      ) : null}

      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <ActionButton
          label={busy === "execute" ? "Executing…" : "Execute Rotation"}
          onClick={() => run("execute", () => onExecuteRotation?.(rotation.id))}
          disabled={!canExecute || busy !== null}
          variant="primary"
          testId={`execute-rotation-${rotation.id}`}
        />
        <ActionButton
          label={busy === "cancel" ? "Cancelling…" : "Cancel"}
          onClick={() => run("cancel", () => onCancelRotation?.(rotation.id))}
          disabled={
            !isSuperAdmin ||
            rotation.status === "executed" ||
            rotation.status === "cancelled" ||
            busy !== null
          }
          variant="danger"
          testId={`cancel-rotation-${rotation.id}`}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function MultisigProposalQueue({
  upgradeProposals,
  pendingRotations,
  checksumManifest,
  isSuperAdmin,
  canApprove,
  ledgerTimeMs = 5000,
  onProposeUpgrade,
  onApproveUpgrade,
  onExecuteUpgrade,
  onCancelUpgrade,
  onExecuteRotation,
  onCancelRotation,
  onRefresh,
}: MultisigProposalQueueProps) {
  const [tab, setTab] = useState<"upgrades" | "rotations">("upgrades");
  const refreshRef = useRef(onRefresh);
  refreshRef.current = onRefresh;

  const activeUpgrades = useMemo(
    () =>
      upgradeProposals.filter(
        (p) => p.status === "pending" || p.status === "ready",
      ),
    [upgradeProposals],
  );

  const activeRotations = useMemo(
    () =>
      pendingRotations.filter(
        (r) => r.status === "pending" || r.status === "ready",
      ),
    [pendingRotations],
  );

  return (
    <section
      className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950/80 p-4"
      data-testid="multisig-proposal-queue"
    >
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-semibold text-zinc-100">
            Multisig Upgrade &amp; Rotation Queue
          </h2>
          <p className="text-xs text-zinc-500">
            M-of-N approvals, timelock enforcement, and SEP-42 WASM hash verification.
          </p>
        </div>
        <div className="flex items-center gap-1 rounded-lg border border-zinc-800 bg-zinc-900 p-1">
          <button
            type="button"
            onClick={() => setTab("upgrades")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
              tab === "upgrades"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            data-testid="tab-upgrades"
          >
            Upgrades ({activeUpgrades.length})
          </button>
          <button
            type="button"
            onClick={() => setTab("rotations")}
            className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${
              tab === "rotations"
                ? "bg-zinc-800 text-zinc-100"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
            data-testid="tab-rotations"
          >
            Rotations ({activeRotations.length})
          </button>
        </div>
      </header>

      {tab === "upgrades" ? (
        <div className="flex flex-col gap-4">
          <ProposeUpgradeForm
            manifest={checksumManifest}
            isSuperAdmin={isSuperAdmin}
            onProposeUpgrade={onProposeUpgrade}
            onRefresh={() => refreshRef.current?.()}
          />

          {activeUpgrades.length === 0 ? (
            <div
              className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500"
              data-testid="no-upgrade-proposals"
            >
              No pending upgrade proposals.
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {activeUpgrades.map((proposal) => (
                <UpgradeProposalRow
                  key={proposal.id}
                  proposal={proposal}
                  isSuperAdmin={isSuperAdmin}
                  canApprove={canApprove}
                  ledgerTimeMs={ledgerTimeMs}
                  manifest={checksumManifest}
                  onApproveUpgrade={onApproveUpgrade}
                  onExecuteUpgrade={onExecuteUpgrade}
                  onCancelUpgrade={onCancelUpgrade}
                  onRefresh={() => refreshRef.current?.()}
                />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {activeRotations.length === 0 ? (
            <div
              className="rounded-lg border border-dashed border-zinc-800 p-6 text-center text-xs text-zinc-500"
              data-testid="no-pending-rotations"
            >
              No pending contract rotations.
            </div>
          ) : (
            activeRotations.map((rotation) => (
              <RotationRow
                key={rotation.id}
                rotation={rotation}
                isSuperAdmin={isSuperAdmin}
                ledgerTimeMs={ledgerTimeMs}
                onExecuteRotation={onExecuteRotation}
                onCancelRotation={onCancelRotation}
                onRefresh={() => refreshRef.current?.()}
              />
            ))
          )}
        </div>
      )}
    </section>
  );
}