import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ContractHealthMatrix from '../../components/admin/ContractHealthMatrix';
import MultisigProposalQueue from '../../components/admin/MultisigProposalQueue';
import EmergencyPauseModal from '../../components/admin/EmergencyPauseModal';

/**
 * OrchestratorConsole
 *
 * High-assurance operational console for protocol operators managing
 * `orchestrator/contracts/admin`.
 *
 * Responsibilities:
 *  - Role-aware UI gating based on on-chain RBAC roles:
 *      * SUPER_ADMIN: full access (pause/unpause, rotations, upgrades)
 *      * EMERGENCY_PAUSER: may only trigger emergency pause actions
 *  - Poll `get_system_status` every ledger (~5s) with exponential backoff
 *    on RPC degradation.
 *  - Display `get_protocol_parameters`.
 *  - Compose ContractHealthMatrix, MultisigProposalQueue, EmergencyPauseModal.
 */

export type AdminRole = 'SUPER_ADMIN' | 'EMERGENCY_PAUSER' | 'NONE';

export interface ProtocolParameters {
  admin: string;
  emergencyPauser: string;
  paymentContract: string;
  escrowContract: string;
  refundContract: string;
  adminContract: string;
  upgradeTimelockLedgers: number;
  rotationTimelockLedgers: number;
  requiredUpgradeApprovals: number;
  requiredRotationApprovals: number;
  [key: string]: unknown;
}

export interface SystemStatus {
  ledger: number;
  timestamp: number;
  paused: boolean;
  contracts: {
    payment: ContractStatus;
    escrow: ContractStatus;
    refund: ContractStatus;
    admin: ContractStatus;
  };
  [key: string]: unknown;
}

export interface ContractStatus {
  contractId: string;
  schemaVersion: number;
  paused: boolean;
  ttlRemainingLedgers: number;
  deprecated: boolean;
}

export interface OrchestratorRpcClient {
  getSystemStatus(): Promise<SystemStatus>;
  getProtocolParameters(): Promise<ProtocolParameters>;
  getAdminRole(address: string): Promise<AdminRole>;
}

export interface OrchestratorConsoleProps {
  /** Connected wallet / operator address. */
  operatorAddress: string;
  /** Soroban RPC client bound to the orchestrator admin contract. */
  rpc: OrchestratorRpcClient;
  /** Target network name used for confirmation barriers. */
  networkName: 'MAINNET' | 'TESTNET';
  /** Optional polling interval override (ms). Defaults to ~5s (one ledger). */
  pollIntervalMs?: number;
  /** Optional max backoff interval (ms). Defaults to 60s. */
  maxBackoffMs?: number;
}

const DEFAULT_POLL_INTERVAL_MS = 5_000;
const DEFAULT_MAX_BACKOFF_MS = 60_000;

type PollState = 'idle' | 'polling' | 'degraded' | 'error';

export const OrchestratorConsole: React.FC<OrchestratorConsoleProps> = ({
  operatorAddress,
  rpc,
  networkName,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
}) => {
  const [role, setRole] = useState<AdminRole>('NONE');
  const [roleLoading, setRoleLoading] = useState<boolean>(true);
  const [roleError, setRoleError] = useState<string | null>(null);

  const [systemStatus, setSystemStatus] = useState<SystemStatus | null>(null);
  const [protocolParams, setProtocolParams] = useState<ProtocolParameters | null>(null);
  const [paramsError, setParamsError] = useState<string | null>(null);

  const [pollState, setPollState] = useState<PollState>('idle');
  const [lastError, setLastError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const [pauseModalOpen, setPauseModalOpen] = useState<boolean>(false);
  const [pauseMode, setPauseMode] = useState<'pause' | 'unpause'>('pause');

  // Refs used by the polling loop so we don't restart it on every render.
  const backoffRef = useRef<number>(pollIntervalMs);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelledRef = useRef<boolean>(false);
  const mountedRef = useRef<boolean>(true);

  // ---------------------------------------------------------------------------
  // Role resolution
  // ---------------------------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setRoleLoading(true);
    setRoleError(null);

    rpc
      .getAdminRole(operatorAddress)
      .then((resolved) => {
        if (cancelled) return;
        setRole(resolved ?? 'NONE');
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setRole('NONE');
        setRoleError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (cancelled) return;
        setRoleLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [rpc, operatorAddress]);

  const isSuperAdmin = role === 'SUPER_ADMIN';
  const isEmergencyPauser = role === 'EMERGENCY_PAUSER';
  const canPause = isSuperAdmin || isEmergencyPauser;
  const canUnpause = isSuperAdmin;
  const canRotate = isSuperAdmin;
  const canUpgrade = isSuperAdmin;

  // ---------------------------------------------------------------------------
  // Protocol parameters (fetched once, refetchable)
  // ---------------------------------------------------------------------------
  const loadProtocolParameters = useCallback(async () => {
    setParamsError(null);
    try {
      const params = await rpc.getProtocolParameters();
      if (!mountedRef.current) return;
      setProtocolParams(params);
    } catch (err: unknown) {
      if (!mountedRef.current) return;
      setParamsError(err instanceof Error ? err.message : String(err));
    }
  }, [rpc]);

  useEffect(() => {
    void loadProtocolParameters();
  }, [loadProtocolParameters]);

  // ---------------------------------------------------------------------------
  // System status polling with exponential backoff
  // ---------------------------------------------------------------------------
  const scheduleNextPoll = useCallback(
    (delay: number) => {
      if (cancelledRef.current) return;
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      timeoutRef.current = setTimeout(() => {
        void pollOnce();
      }, delay);
    },
    // pollOnce is defined below; we intentionally reference via closure.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const pollOnce = useCallback(async () => {
    if (cancelledRef.current) return;
    setPollState((prev) => (prev === 'idle' ? 'polling' : prev));

    try {
      const status = await rpc.getSystemStatus();
      if (cancelledRef.current) return;

      setSystemStatus(status);
      setLastUpdated(Date.now());
      setLastError(null);
      setPollState('polling');

      // Successful poll: reset backoff to base interval.
      backoffRef.current = pollIntervalMs;
      scheduleNextPoll(pollIntervalMs);
    } catch (err: unknown) {
      if (cancelledRef.current) return;

      const message = err instanceof Error ? err.message : String(err);
      setLastError(message);
      setPollState('degraded');

      // Exponential backoff, capped at maxBackoffMs.
      const nextDelay = Math.min(backoffRef.current * 2, maxBackoffMs);
      backoffRef.current = nextDelay;
      scheduleNextPoll(nextDelay);
    }
  }, [rpc, pollIntervalMs, maxBackoffMs, scheduleNextPoll]);

  useEffect(() => {
    mountedRef.current = true;
    cancelledRef.current = false;
    backoffRef.current = pollIntervalMs;

    // Kick off the first poll immediately.
    void pollOnce();

    return () => {
      cancelledRef.current = true;
      mountedRef.current = false;
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
    // We intentionally only restart the loop when the RPC or interval changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rpc, pollIntervalMs, maxBackoffMs]);

  // ---------------------------------------------------------------------------
  // Derived state
  // ---------------------------------------------------------------------------
  const systemPaused = systemStatus?.paused ?? false;

  const openPauseModal = useCallback(
    (mode: 'pause' | 'unpause') => {
      if (mode === 'pause' && !canPause) return;
      if (mode === 'unpause' && !canUnpause) return;
      setPauseMode(mode);
      setPauseModalOpen(true);
    },
    [canPause, canUnpause],
  );

  const closePauseModal = useCallback(() => {
    setPauseModalOpen(false);
  }, []);

  const handlePauseSuccess = useCallback(() => {
    setPauseModalOpen(false);
    // Trigger an immediate refresh after a successful pause/unpause.
    backoffRef.current = pollIntervalMs;
    void pollOnce();
  }, [pollOnce, pollIntervalMs]);

  const handleQueueChanged = useCallback(() => {
    // Refresh system status after any queue mutation (approve/execute/cancel).
    backoffRef.current = pollIntervalMs;
    void pollOnce();
  }, [pollOnce, pollIntervalMs]);

  const pollStatusLabel = useMemo(() => {
    switch (pollState) {
      case 'polling':
        return 'Live';
      case 'degraded':
        return 'Degraded (backing off)';
      case 'error':
        return 'Error';
      default:
        return 'Connecting…';
    }
  }, [pollState]);

  const lastUpdatedLabel = useMemo(() => {
    if (!lastUpdated) return '—';
    return new Date(lastUpdated).toLocaleTimeString();
  }, [lastUpdated]);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="orchestrator-console" data-testid="orchestrator-console">
      <header className="orchestrator-console__header">
        <div>
          <h1>Orchestrator Control Center</h1>
          <p className="orchestrator-console__subtitle">
            Network: <strong>{networkName}</strong> · Operator:{' '}
            <code>{operatorAddress}</code>
          </p>
        </div>

        <div className="orchestrator-console__status">
          <span
            className={`orchestrator-console__poll-badge orchestrator-console__poll-badge--${pollState}`}
            data-testid="poll-status"
          >
            {pollStatusLabel}
          </span>
          <span className="orchestrator-console__last-updated">
            Last updated: {lastUpdatedLabel}
          </span>
          {lastError && (
            <span className="orchestrator-console__error" role="alert">
              {lastError}
            </span>
          )}
        </div>
      </header>

      {roleLoading && (
        <div className="orchestrator-console__banner" data-testid="role-loading">
          Resolving on-chain RBAC role…
        </div>
      )}

      {roleError && (
        <div
          className="orchestrator-console__banner orchestrator-console__banner--error"
          role="alert"
          data-testid="role-error"
        >
          Failed to resolve role: {roleError}
        </div>
      )}

      {!roleLoading && !roleError && role === 'NONE' && (
        <div
          className="orchestrator-console__banner orchestrator-console__banner--error"
          role="alert"
          data-testid="role-none"
        >
          Connected account has no admin role on this orchestrator. Controls are
          locked.
        </div>
      )}

      {!roleLoading && !roleError && role !== 'NONE' && (
        <div
          className="orchestrator-console__banner orchestrator-console__banner--info"
          data-testid="role-badge"
        >
          Role: <strong>{role}</strong>
          {isEmergencyPauser && (
            <span className="orchestrator-console__role-note">
              {' '}
              — Emergency pauser: only pause actions are available. Super-admin
              controls are locked.
            </span>
          )}
        </div>
      )}

      <section className="orchestrator-console__actions">
        <button
          type="button"
          className="orchestrator-console__btn orchestrator-console__btn--danger"
          onClick={() => openPauseModal('pause')}
          disabled={!canPause || systemPaused}
          data-testid="emergency-pause-btn"
          title={
            !canPause
              ? 'Requires SUPER_ADMIN or EMERGENCY_PAUSER role'
              : systemPaused
                ? 'System is already paused'
                : 'Trigger emergency_pause_all'
          }
        >
          Emergency Pause All
        </button>

        <button
          type="button"
          className="orchestrator-console__btn orchestrator-console__btn--primary"
          onClick={() => openPauseModal('unpause')}
          disabled={!canUnpause || !systemPaused}
          data-testid="emergency-unpause-btn"
          title={
            !canUnpause
              ? 'Requires SUPER_ADMIN role'
              : !systemPaused
                ? 'System is not paused'
                : 'Trigger emergency_unpause_all'
          }
        >
          Emergency Unpause All
        </button>

        <button
          type="button"
          className="orchestrator-console__btn"
          onClick={() => {
            backoffRef.current = pollIntervalMs;
            void pollOnce();
          }}
          data-testid="refresh-btn"
        >
          Refresh
        </button>
      </section>

      <section className="orchestrator-console__section">
        <h2>System Health Matrix</h2>
        <ContractHealthMatrix
          systemStatus={systemStatus}
          networkName={networkName}
          loading={!systemStatus && pollState !== 'degraded'}
        />
      </section>

      <section className="orchestrator-console__section">
        <h2>Protocol Parameters</h2>
        {paramsError && (
          <div
            className="orchestrator-console__banner orchestrator-console__banner--error"
            role="alert"
            data-testid="params-error"
          >
            Failed to load protocol parameters: {paramsError}
            <button
              type="button"
              className="orchestrator-console__btn orchestrator-console__btn--small"
              onClick={() => void loadProtocolParameters()}
            >
              Retry
            </button>
          </div>
        )}
        {!paramsError && !protocolParams && (
          <div className="orchestrator-console__placeholder">
            Loading protocol parameters…
          </div>
        )}
        {protocolParams && (
          <dl
            className="orchestrator-console__params"
            data-testid="protocol-parameters"
          >
            <div>
              <dt>Admin</dt>
              <dd>
                <code>{protocolParams.admin}</code>
              </dd>
            </div>
            <div>
              <dt>Emergency Pauser</dt>
              <dd>
                <code>{protocolParams.emergencyPauser}</code>
              </dd>
            </div>
            <div>
              <dt>Payment Contract</dt>
              <dd>
                <code>{protocolParams.paymentContract}</code>
              </dd>
            </div>
            <div>
              <dt>Escrow Contract</dt>
              <dd>
                <code>{protocolParams.escrowContract}</code>
              </dd>
            </div>
            <div>
              <dt>Refund Contract</dt>
              <dd>
                <code>{protocolParams.refundContract}</code>
              </dd>
            </div>
            <div>
              <dt>Admin Contract</dt>
              <dd>
                <code>{protocolParams.adminContract}</code>
              </dd>
            </div>
            <div>
              <dt>Upgrade Timelock</dt>
              <dd>{protocolParams.upgradeTimelockLedgers} ledgers</dd>
            </div>
            <div>
              <dt>Rotation Timelock</dt>
              <dd>{protocolParams.rotationTimelockLedgers} ledgers</dd>
            </div>
            <div>
              <dt>Upgrade Approvals</dt>
              <dd>{protocolParams.requiredUpgradeApprovals} required</dd>
            </div>
            <div>
              <dt>Rotation Approvals</dt>
              <dd>{protocolParams.requiredRotationApprovals} required</dd>
            </div>
          </dl>
        )}
      </section>

      <section className="orchestrator-console__section">
        <h2>Multisig Upgrade &amp; Rotation Queue</h2>
        {!canUpgrade && !canRotate && (
          <div
            className="orchestrator-console__banner orchestrator-console__banner--locked"
            data-testid="queue-locked"
          >
            Super-admin controls are locked. Proposing, approving, and executing
            upgrades or rotations requires the SUPER_ADMIN role.
          </div>
        )}
        <MultisigProposalQueue
          rpc={rpc}
          operatorAddress={operatorAddress}
          networkName={networkName}
          canUpgrade={canUpgrade}
          canRotate={canRotate}
          currentLedger={systemStatus?.ledger ?? null}
          onQueueChanged={handleQueueChanged}
        />
      </section>

      {pauseModalOpen && (
        <EmergencyPauseModal
          open={pauseModalOpen}
          mode={pauseMode}
          rpc={rpc}
          networkName={networkName}
          operatorAddress={operatorAddress}
          onClose={closePauseModal}
          onSuccess={handlePauseSuccess}
        />
      )}
    </div>
  );
};

export default OrchestratorConsole;