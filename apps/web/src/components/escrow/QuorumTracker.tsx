import { useMemo } from "react";

export type QuorumRole = "Buyer" | "Seller" | "Co-Signer" | "Observer";
export type QuorumStatus = "Approved" | "Pending" | "Rejected";

export interface QuorumParticipant {
  id: string;
  name: string;
  role: QuorumRole;
  weightBps: number;
  status: QuorumStatus;
  signedAt?: string | null;
  txHash?: string | null;
}

export interface QuorumTrackerProps {
  /** Required approval threshold in basis points (e.g. 6667 = 66.67%). */
  thresholdBps: number;
  participants: QuorumParticipant[];
  /** Optional anomalous-state overlays. */
  disputed?: boolean;
  frozen?: boolean;
  pendingBeneficiaryTransfer?: boolean;
  clawbackRequestedAt?: string | null;
  collateralHealthFactor?: number | null;
  className?: string;
}

const STATUS_COLORS: Record<QuorumStatus, string> = {
  Approved: "#16a34a",
  Pending: "#f59e0b",
  Rejected: "#dc2626",
};

const ROLE_LABELS: Record<QuorumRole, string> = {
  Buyer: "Buyer",
  Seller: "Seller",
  "Co-Signer": "Co-Signer",
  Observer: "Observer",
};

function formatBps(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString();
}

/**
 * Multi-Party Weighted Quorum visualization.
 *
 * Renders a segmented threshold bar with an exact `threshold_bps` marker and
 * color-coded signer weight segments (Approved / Pending / Rejected), plus a
 * participant roster table with role, weight, status and signature timestamp.
 */
export function QuorumTracker({
  thresholdBps,
  participants,
  disputed = false,
  frozen = false,
  pendingBeneficiaryTransfer = false,
  clawbackRequestedAt = null,
  collateralHealthFactor = null,
  className,
}: QuorumTrackerProps) {
  const { totalWeight, approvedWeight, segments } = useMemo(() => {
    const total = participants.reduce((sum, p) => sum + Math.max(0, p.weightBps), 0);
    const approved = participants
      .filter((p) => p.status === "Approved")
      .reduce((sum, p) => sum + Math.max(0, p.weightBps), 0);
    const segs = participants.map((p) => ({
      id: p.id,
      name: p.name,
      status: p.status,
      weightBps: Math.max(0, p.weightBps),
      percent: total > 0 ? (Math.max(0, p.weightBps) / total) * 100 : 0,
    }));
    return { totalWeight: total, approvedWeight: approved, segments: segs };
  }, [participants]);

  const thresholdPercent = Math.min(100, Math.max(0, thresholdBps / 100));
  const approvedPercent = totalWeight > 0 ? (approvedWeight / totalWeight) * 100 : 0;
  const quorumReached = totalWeight > 0 && approvedWeight >= thresholdBps;
  const locked = disputed || frozen;

  const healthWarning =
    collateralHealthFactor !== null && collateralHealthFactor < 1.5;

  return (
    <section
      className={className}
      aria-label="Multi-party weighted quorum"
      style={{ position: "relative", display: "grid", gap: 16 }}
    >
      {locked && (
        <div
          role="alert"
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(15, 23, 42, 0.55)",
            color: "#fff",
            borderRadius: 12,
            fontWeight: 600,
            letterSpacing: 0.5,
          }}
        >
          {disputed ? "Disputed — voting frozen" : "Frozen — awaiting resolution"}
        </div>
      )}

      {pendingBeneficiaryTransfer && (
        <div
          role="status"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#fef3c7",
            color: "#92400e",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Pending Beneficiary Transfer — quorum will re-evaluate on acceptance.
        </div>
      )}

      {clawbackRequestedAt && (
        <div
          role="status"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#fee2e2",
            color: "#991b1b",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Clawback requested at {formatTimestamp(clawbackRequestedAt)} — countdown active.
        </div>
      )}

      {healthWarning && (
        <div
          role="status"
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#ffedd5",
            color: "#9a3412",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Collateral Health Factor {collateralHealthFactor?.toFixed(2)} — warning zone (&lt; 1.50).
        </div>
      )}

      <header style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
        <div>
          <h3 style={{ margin: 0, fontSize: 16 }}>Approval Quorum</h3>
          <p style={{ margin: "4px 0 0", fontSize: 13, color: "#64748b" }}>
            {formatBps(approvedWeight)} approved of {formatBps(totalWeight)} total weight ·
            threshold {formatBps(thresholdBps)}
          </p>
        </div>
        <span
          style={{
            alignSelf: "center",
            padding: "4px 10px",
            borderRadius: 999,
            fontSize: 12,
            fontWeight: 700,
            background: quorumReached ? "#dcfce7" : "#f1f5f9",
            color: quorumReached ? "#166534" : "#475569",
          }}
        >
          {quorumReached ? "Quorum reached" : "Quorum pending"}
        </span>
      </header>

      <div
        role="img"
        aria-label={`Quorum bar: ${formatBps(approvedWeight)} approved, threshold ${formatBps(thresholdBps)}`}
        style={{ position: "relative", height: 22, borderRadius: 999, background: "#e2e8f0", overflow: "hidden" }}
      >
        <div style={{ display: "flex", height: "100%" }}>
          {segments.map((seg) => (
            <div
              key={seg.id}
              title={`${seg.name}: ${formatBps(seg.weightBps)} (${seg.status})`}
              style={{
                width: `${seg.percent}%`,
                background: STATUS_COLORS[seg.status],
                opacity: seg.status === "Pending" ? 0.55 : 1,
                transition: "width 200ms ease",
              }}
            />
          ))}
        </div>
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: 0,
            bottom: 0,
            left: `${thresholdPercent}%`,
            width: 2,
            background: "#0f172a",
          }}
        />
        <div
          aria-hidden
          style={{
            position: "absolute",
            top: -2,
            left: `${thresholdPercent}%`,
            transform: "translateX(-50%)",
            fontSize: 10,
            fontWeight: 700,
            color: "#0f172a",
            whiteSpace: "nowrap",
          }}
        >
          {formatBps(thresholdBps)}
        </div>
      </div>

      <div style={{ display: "flex", gap: 16, fontSize: 12, color: "#475569" }}>
        {(Object.keys(STATUS_COLORS) as QuorumStatus[]).map((status) => (
          <span key={status} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span
              aria-hidden
              style={{ width: 10, height: 10, borderRadius: 3, background: STATUS_COLORS[status] }}
            />
            {status}
          </span>
        ))}
      </div>

      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "#64748b" }}>
              <th style={{ padding: "6px 8px" }}>Participant</th>
              <th style={{ padding: "6px 8px" }}>Role</th>
              <th style={{ padding: "6px 8px" }}>Weight</th>
              <th style={{ padding: "6px 8px" }}>Status</th>
              <th style={{ padding: "6px 8px" }}>Signed</th>
            </tr>
          </thead>
          <tbody>
            {participants.map((p) => (
              <tr key={p.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                <td style={{ padding: "6px 8px", fontWeight: 600 }}>{p.name}</td>
                <td style={{ padding: "6px 8px" }}>{ROLE_LABELS[p.role]}</td>
                <td style={{ padding: "6px 8px" }}>{formatBps(p.weightBps)}</td>
                <td style={{ padding: "6px 8px" }}>
                  <span
                    style={{
                      display: "inline-block",
                      padding: "2px 8px",
                      borderRadius: 999,
                      fontSize: 11,
                      fontWeight: 700,
                      color: "#fff",
                      background: STATUS_COLORS[p.status],
                    }}
                  >
                    {p.status}
                  </span>
                </td>
                <td style={{ padding: "6px 8px", color: "#475569" }}>
                  {p.txHash ? (
                    <a href={`#tx-${p.txHash}`} title={p.txHash}>
                      {formatTimestamp(p.signedAt)}
                    </a>
                  ) : (
                    formatTimestamp(p.signedAt)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default QuorumTracker;
