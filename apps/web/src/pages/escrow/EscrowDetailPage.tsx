import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";

import QuorumTracker from "../../components/escrow/QuorumTracker";
import VestingScheduleChart from "../../components/escrow/VestingScheduleChart";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EscrowParticipant {
  address: string;
  weight: number; // basis points
  accepted: boolean;
  role?: string;
}

export interface EscrowObserver {
  address: string;
  label?: string;
}

export interface EscrowMilestone {
  id: number;
  description: string;
  deliverable_hash: string;
  amount: string;
  unlocked: boolean;
  approved: boolean;
  release_timestamp?: number;
}

export interface EscrowToken {
  denom: string;
  amount: string;
}

export interface EscrowDetails {
  id: string;
  customer: string;
  merchant: string;
  arbiter?: string;
  beneficiary: string;
  state: string;
  is_multi_party: boolean;
  is_multi_token: boolean;
  is_vesting: boolean;
  total_amount: string;
  tokens: EscrowToken[];
  hold_period_until: number;
  release_timestamp: number;
  expiry_timestamp: number;
  threshold_bps: number;
  accumulated_weight_bps: number;
  participants: EscrowParticipant[];
  observers: EscrowObserver[];
  milestones: EscrowMilestone[];
  pending_beneficiary?: string;
  proposed_by?: string;
  cliff_until?: number;
  vesting_start?: number;
  vesting_end?: number;
  vested_amount?: string;
  releasable_amount?: string;
}

export interface ViewerContext {
  address: string;
  is_participant: boolean;
  is_observer: boolean;
  is_customer: boolean;
  is_merchant: boolean;
  is_beneficiary: boolean;
  can_mutate: boolean;
}

// ---------------------------------------------------------------------------
// Data access layer (injectable for tests)
// ---------------------------------------------------------------------------

export interface EscrowDataClient {
  getEscrowDetails: (id: string) => Promise<EscrowDetails>;
  getMultiPartyEscrow: (id: string) => Promise<EscrowDetails | null>;
  getObservers: (id: string) => Promise<EscrowObserver[]>;
  verifyEscrowParticipant: (id: string, address: string) => Promise<boolean>;
  getCurrentAddress: () => Promise<string>;
  getLedgerTime: () => Promise<number>;
  acceptMultiPartyEscrow: (id: string) => Promise<void>;
  approveRelease: (id: string) => Promise<void>;
  releaseMultiPartyEscrow: (id: string) => Promise<void>;
  approveMilestone: (id: string, milestoneId: number) => Promise<void>;
  releaseMilestone: (id: string, milestoneId: number) => Promise<void>;
  claimVestedEscrowTokens: (id: string) => Promise<void>;
  proposeBeneficiaryTransfer: (id: string, newBeneficiary: string) => Promise<void>;
  acceptBeneficiaryTransfer: (id: string) => Promise<void>;
  simulateReleaseMilestone: (id: string, milestoneId: number) => Promise<string>;
  simulateClaimVested: (id: string) => Promise<string>;
}

let defaultClient: EscrowDataClient | null = null;

export function setEscrowDataClient(client: EscrowDataClient | null): void {
  defaultClient = client;
}

function getClient(): EscrowDataClient {
  if (!defaultClient) {
    throw new Error("EscrowDataClient has not been configured");
  }
  return defaultClient;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTimestamp(ts: number | undefined | null): string {
  if (!ts || ts <= 0) return "—";
  try {
    return new Date(ts * 1000).toLocaleString();
  } catch {
    return String(ts);
  }
}

function isPast(ts: number | undefined | null, now: number): boolean {
  return !!ts && ts > 0 && now >= ts;
}

export function computeViewerContext(
  details: EscrowDetails,
  address: string,
  isParticipant: boolean,
): ViewerContext {
  const isObserver = details.observers.some(
    (o) => o.address.toLowerCase() === address.toLowerCase(),
  );
  const isCustomer = details.customer.toLowerCase() === address.toLowerCase();
  const isMerchant = details.merchant.toLowerCase() === address.toLowerCase();
  const isBeneficiary = details.beneficiary.toLowerCase() === address.toLowerCase();
  const canMutate = isParticipant && !isObserver;
  return {
    address,
    is_participant: isParticipant,
    is_observer: isObserver,
    is_customer: isCustomer,
    is_merchant: isMerchant,
    is_beneficiary: isBeneficiary,
    can_mutate: canMutate,
  };
}

export function isReleaseDisabledReason(
  details: EscrowDetails,
  now: number,
): string | null {
  if (details.state === "Released" || details.state === "Completed") {
    return "Escrow has already been released.";
  }
  if (details.state === "Expired" || isPast(details.expiry_timestamp, now)) {
    return "Escrow has expired.";
  }
  if (!isPast(details.hold_period_until, now)) {
    return `Hold period active until ${formatTimestamp(details.hold_period_until)}. Release is blocked by the hold period, not the timelock.`;
  }
  if (!isPast(details.release_timestamp, now)) {
    return `Timelock release not reached. Release becomes available at ${formatTimestamp(details.release_timestamp)}.`;
  }
  if (details.is_multi_party && details.accumulated_weight_bps < details.threshold_bps) {
    return `Approval quorum not met (${details.accumulated_weight_bps}/${details.threshold_bps} bps).`;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

const Banner: React.FC<{
  tone: "info" | "warning" | "success" | "danger";
  children: React.ReactNode;
  testId?: string;
}> = ({ tone, children, testId }) => {
  const colors: Record<string, string> = {
    info: "#e8f1ff",
    warning: "#fff7e0",
    success: "#e6f7ec",
    danger: "#fdeaea",
  };
  return (
    <div
      data-testid={testId}
      role="status"
      style={{
        background: colors[tone],
        border: "1px solid rgba(0,0,0,0.08)",
        borderRadius: 8,
        padding: "10px 14px",
        marginBottom: 12,
        fontSize: 14,
      }}
    >
      {children}
    </div>
  );
};

const Section: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <section style={{ marginBottom: 24 }}>
    <h2 style={{ fontSize: 18, marginBottom: 12 }}>{title}</h2>
    {children}
  </section>
);

const ActionButton: React.FC<{
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: React.ReactNode;
  testId?: string;
}> = ({ onClick, disabled, title, children, testId }) => (
  <button
    type="button"
    data-testid={testId}
    onClick={onClick}
    disabled={disabled}
    title={title}
    style={{
      padding: "8px 14px",
      borderRadius: 6,
      border: "1px solid #2b6cb0",
      background: disabled ? "#cbd5e0" : "#2b6cb0",
      color: "#fff",
      cursor: disabled ? "not-allowed" : "pointer",
      marginRight: 8,
      marginTop: 8,
    }}
  >
    {children}
  </button>
);

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

const EscrowDetailPage: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [details, setDetails] = useState<EscrowDetails | null>(null);
  const [observers, setObservers] = useState<EscrowObserver[]>([]);
  const [viewer, setViewer] = useState<ViewerContext | null>(null);
  const [now, setNow] = useState<number>(0);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [newBeneficiary, setNewBeneficiary] = useState<string>("");
  const [simulatedPayout, setSimulatedPayout] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    setError(null);
    try {
      const client = getClient();
      const [d, addr, ledgerTime] = await Promise.all([
        client.getEscrowDetails(id),
        client.getCurrentAddress(),
        client.getLedgerTime(),
      ]);

      let multi: EscrowDetails | null = null;
      if (d.is_multi_party) {
        multi = await client.getMultiPartyEscrow(id);
      }
      const merged: EscrowDetails = multi ? { ...d, ...multi } : d;

      const obs = await client.getObservers(id);
      const isParticipant = await client.verifyEscrowParticipant(id, addr);

      setDetails(merged);
      setObservers(obs);
      setNow(ledgerTime);
      setViewer(computeViewerContext({ ...merged, observers: obs }, addr, isParticipant));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load escrow");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  const runAction = useCallback(
    async (key: string, fn: () => Promise<void>, successMsg: string) => {
      setBusy(key);
      setNotice(null);
      try {
        await fn();
        setNotice(successMsg);
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Transaction failed");
      } finally {
        setBusy(null);
      }
    },
    [load],
  );

  const releaseDisabledReason = useMemo(
    () => (details ? isReleaseDisabledReason(details, now) : null),
    [details, now],
  );

  const canMutate = !!viewer?.can_mutate;

  const handleSimulateMilestone = useCallback(
    async (milestoneId: number) => {
      if (!id) return;
      try {
        const net = await getClient().simulateReleaseMilestone(id, milestoneId);
        setSimulatedPayout((prev) => ({ ...prev, [`m-${milestoneId}`]: net }));
      } catch (e) {
        setError(e instanceof Error ? e.message : "Simulation failed");
      }
    },
    [id],
  );

  const handleSimulateClaim = useCallback(async () => {
    if (!id) return;
    try {
      const net = await getClient().simulateClaimVested(id);
      setSimulatedPayout((prev) => ({ ...prev, claim: net }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Simulation failed");
    }
  }, [id]);

  if (loading) {
    return <div data-testid="escrow-detail-loading">Loading escrow…</div>;
  }

  if (error && !details) {
    return (
      <div data-testid="escrow-detail-error" style={{ color: "#c53030" }}>
        {error}
      </div>
    );
  }

  if (!details || !viewer) {
    return <div data-testid="escrow-detail-empty">Escrow not found.</div>;
  }

  const holdActive = !isPast(details.hold_period_until, now);
  const timelockActive = !isPast(details.release_timestamp, now);
  const expired = isPast(details.expiry_timestamp, now) || details.state === "Expired";

  return (
    <div data-testid="escrow-detail-page" style={{ maxWidth: 960, margin: "0 auto", padding: 24 }}>
      <button
        type="button"
        onClick={() => navigate("/escrow")}
        style={{ marginBottom: 16, background: "none", border: "none", color: "#2b6cb0", cursor: "pointer" }}
      >
        ← Back to escrows
      </button>

      <header style={{ marginBottom: 20 }}>
        <h1 style={{ fontSize: 24, marginBottom: 4 }}>Escrow {details.id}</h1>
        <div style={{ fontSize: 14, color: "#4a5568" }}>
          State: <strong>{details.state}</strong> · Total: <strong>{details.total_amount}</strong>
          {details.is_multi_party && " · Multi-party"}
          {details.is_multi_token && " · Multi-token"}
          {details.is_vesting && " · Vesting"}
        </div>
      </header>

      {error && (
        <Banner tone="danger" testId="escrow-detail-action-error">
          {error}
        </Banner>
      )}
      {notice && (
        <Banner tone="success" testId="escrow-detail-notice">
          {notice}
        </Banner>
      )}

      {viewer.is_observer && (
        <Banner tone="info" testId="observer-readonly-banner">
          You are viewing this escrow as a read-only <strong>EscrowObserver</strong>. Mutating actions are disabled.
        </Banner>
      )}
      {!viewer.is_participant && !viewer.is_observer && (
        <Banner tone="warning" testId="non-participant-banner">
          Your address is not a verified participant of this escrow. Actions are disabled.
        </Banner>
      )}

      {/* Beneficiary transfer handshake banners */}
      {details.pending_beneficiary && (
        <Banner tone="warning" testId="beneficiary-transfer-banner">
          <div style={{ marginBottom: 8 }}>
            Beneficiary transfer proposed to <code>{details.pending_beneficiary}</code>
            {details.proposed_by ? ` by ${details.proposed_by}` : ""}.
          </div>
          {viewer.address.toLowerCase() === details.pending_beneficiary.toLowerCase() && (
            <ActionButton
              testId="accept-beneficiary-transfer"
              disabled={!canMutate || busy === "accept-beneficiary"}
              title={!canMutate ? "Only verified participants may accept" : undefined}
              onClick={() =>
                runAction(
                  "accept-beneficiary",
                  () => getClient().acceptBeneficiaryTransfer(details.id),
                  "Beneficiary transfer accepted.",
                )
              }
            >
              {busy === "accept-beneficiary" ? "Accepting…" : "Accept Beneficiary Transfer"}
            </ActionButton>
          )}
        </Banner>
      )}

      {/* Timelock / hold / expiry explanation */}
      <Section title="Release Timeline">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
          <div data-testid="hold-period-card" style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "#718096" }}>Hold Period Until</div>
            <div style={{ fontWeight: 600 }}>{formatTimestamp(details.hold_period_until)}</div>
            <div style={{ fontSize: 12, color: holdActive ? "#c05621" : "#2f855a" }}>
              {holdActive ? "Active — blocks release" : "Elapsed"}
            </div>
          </div>
          <div data-testid="release-timestamp-card" style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "#718096" }}>Timelock Release</div>
            <div style={{ fontWeight: 600 }}>{formatTimestamp(details.release_timestamp)}</div>
            <div style={{ fontSize: 12, color: timelockActive ? "#c05621" : "#2f855a" }}>
              {timelockActive ? "Not yet reached" : "Reached"}
            </div>
          </div>
          <div data-testid="expiry-timestamp-card" style={{ padding: 12, border: "1px solid #e2e8f0", borderRadius: 8 }}>
            <div style={{ fontSize: 12, color: "#718096" }}>Expiry</div>
            <div style={{ fontWeight: 600 }}>{formatTimestamp(details.expiry_timestamp)}</div>
            <div style={{ fontSize: 12, color: expired ? "#c53030" : "#2f855a" }}>
              {expired ? "Expired" : "Valid"}
            </div>
          </div>
        </div>
        {releaseDisabledReason && (
          <Banner tone="info" testId="release-disabled-reason">
            {releaseDisabledReason}
          </Banner>
        )}
      </Section>

      {/* Multi-party quorum */}
      {details.is_multi_party && (
        <Section title="Multi-Party Approval Quorum">
          <QuorumTracker
            participants={details.participants}
            thresholdBps={details.threshold_bps}
            accumulatedBps={details.accumulated_weight_bps}
            viewerAddress={viewer.address}
            canMutate={canMutate}
            busy={busy}
            onAccept={() =>
              runAction(
                "accept-multi",
                () => getClient().acceptMultiPartyEscrow(details.id),
                "Participation accepted.",
              )
            }
            onApproveRelease={() =>
              runAction(
                "approve-release",
                () => getClient().approveRelease(details.id),
                "Release approved.",
              )
            }
            onRelease={() =>
              runAction(
                "release-multi",
                () => getClient().releaseMultiPartyEscrow(details.id),
                "Escrow released.",
              )
            }
            releaseDisabled={!!releaseDisabledReason}
            releaseDisabledReason={releaseDisabledReason}
          />
        </Section>
      )}

      {/* Vesting & milestones */}
      {details.is_vesting && (
        <Section title="Vesting & Milestone Schedule">
          <VestingScheduleChart
            now={now}
            cliffUntil={details.cliff_until}
            vestingStart={details.vesting_start}
            vestingEnd={details.vesting_end}
            vestedAmount={details.vested_amount}
            releasableAmount={details.releasable_amount}
            milestones={details.milestones}
            canMutate={canMutate}
            busy={busy}
            simulatedPayout={simulatedPayout}
            onApproveMilestone={(milestoneId) =>
              runAction(
                `approve-m-${milestoneId}`,
                () => getClient().approveMilestone(details.id, milestoneId),
                `Milestone ${milestoneId} approved.`,
              )
            }
            onSimulateMilestone={handleSimulateMilestone}
            onReleaseMilestone={(milestoneId) =>
              runAction(
                `release-m-${milestoneId}`,
                () => getClient().releaseMilestone(details.id, milestoneId),
                `Milestone ${milestoneId} released.`,
              )
            }
            onSimulateClaim={handleSimulateClaim}
            onClaimVested={() =>
              runAction(
                "claim-vested",
                () => getClient().claimVestedEscrowTokens(details.id),
                "Vested tokens claimed.",
              )
            }
          />
        </Section>
      )}

      {/* Multi-token basket */}
      {details.is_multi_token && (
        <Section title="Token Basket">
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", borderBottom: "1px solid #e2e8f0" }}>
                <th style={{ padding: 8 }}>Denom</th>
                <th style={{ padding: 8 }}>Amount</th>
              </tr>
            </thead>
            <tbody>
              {details.tokens.map((t) => (
                <tr key={t.denom} data-testid={`token-${t.denom}`}>
                  <td style={{ padding: 8 }}>{t.denom}</td>
                  <td style={{ padding: 8 }}>{t.amount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Section>
      )}

      {/* Beneficiary proposal (only for eligible mutators) */}
      {canMutate && !details.pending_beneficiary && (
        <Section title="Propose Beneficiary Transfer">
          <input
            type="text"
            placeholder="New beneficiary address"
            value={newBeneficiary}
            onChange={(e) => setNewBeneficiary(e.target.value)}
            data-testid="new-beneficiary-input"
            style={{ padding: 8, width: 360, marginRight: 8, borderRadius: 6, border: "1px solid #cbd5e0" }}
          />
          <ActionButton
            testId="propose-beneficiary-transfer"
            disabled={!newBeneficiary || busy === "propose-beneficiary"}
            onClick={() =>
              runAction(
                "propose-beneficiary",
                () => getClient().proposeBeneficiaryTransfer(details.id, newBeneficiary),
                "Beneficiary transfer proposed.",
              )
            }
          >
            {busy === "propose-beneficiary" ? "Proposing…" : "Propose Transfer"}
          </ActionButton>
        </Section>
      )}

      {/* Observers */}
      <Section title="Observers">
        {observers.length === 0 ? (
          <div style={{ color: "#718096", fontSize: 14 }}>No observers registered.</div>
        ) : (
          <ul data-testid="observer-list" style={{ listStyle: "none", padding: 0 }}>
            {observers.map((o) => (
              <li
                key={o.address}
                data-testid={`observer-${o.address}`}
                style={{ padding: "6px 0", display: "flex", alignItems: "center", gap: 8 }}
              >
                <span
                  style={{
                    fontSize: 11,
                    background: "#edf2f7",
                    color: "#4a5568",
                    borderRadius: 4,
                    padding: "2px 6px",
                  }}
                >
                  READ-ONLY
                </span>
                <code>{o.address}</code>
                {o.label && <span style={{ color: "#718096" }}>({o.label})</span>}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </div>
  );
};

export default EscrowDetailPage;