/**
 * NotificationCenter.tsx
 *
 * Persistent Web3 notification drawer and live event dispatch center for Cypher GridPay.
 * Subscribes to Soroban contract events relevant to the active wallet address:
 *   - PaymentCompleted
 *   - EscrowDisputed
 *   - RefundApproved
 *   - DisputeAppealFiled
 *   - UpgradeProposed
 *   - SystemPaused
 *
 * Guarantees:
 *   - Zero data leakage across account switches (strict per-address isolation)
 *   - Deterministic event deduplication across WebSocket and polling fallbacks
 *   - Burst toast throttling for high-velocity batches in a single ledger
 *   - Human-readable notifications with direct deep links to detail pages
 *   - Configurable browser desktop notification opt-in
 */

import React, {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import {
  ContractNotificationItem,
  formatAddress,
  NotificationCategory,
  ThrottledToastResult,
} from "../../../../sdk/typescript/src/events";
import {
  StellarNetwork,
  useContractEventStream,
  UseContractEventStreamOptions,
} from "../../hooks/useContractEventStream";

export interface NotificationCenterProps {
  /** Active connected Stellar address. */
  address?: string;
  /** Active Stellar network target. */
  network?: StellarNetwork;
  /** WebSocket / SSE streaming URL. */
  wsUrl?: string;
  /** Soroban RPC URL for fallback polling. */
  rpcUrl?: string;
  /** Custom navigation handler for deep links (defaults to window.location.assign). */
  onNavigate?: (url: string) => void;
  /** Optional custom stream hook options. */
  streamOptions?: Partial<UseContractEventStreamOptions>;
  /** Optional CSS class name. */
  className?: string;
  /** Optional inline styles. */
  style?: React.CSSProperties;
}

type TabFilter = "all" | "unread" | "payment" | "escrow" | "refund" | "system";

export function NotificationCenter({
  address,
  network = "testnet",
  wsUrl,
  rpcUrl,
  onNavigate,
  streamOptions,
  className,
  style,
}: NotificationCenterProps): React.JSX.Element {
  const drawerId = useId();
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<TabFilter>("all");
  const [pulseBell, setPulseBell] = useState(false);
  const drawerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Hook into live event stream with deduplication & account isolation
  const stream = useContractEventStream({
    address,
    network,
    wsUrl,
    rpcUrl,
    ...streamOptions,
  });

  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    removeNotification,
    browserPermission,
    browserNotificationsEnabled,
    requestNotificationPermission,
    setBrowserNotificationsEnabled,
    activeToasts,
    dismissToast,
    connectionStatus,
    latestLedger,
  } = stream;

  // Pulse bell when unread count increases
  const prevUnreadRef = useRef<number>(unreadCount);
  useEffect(() => {
    if (unreadCount > prevUnreadRef.current) {
      setPulseBell(true);
      const timer = setTimeout(() => setPulseBell(false), 1000);
      return () => clearTimeout(timer);
    }
    prevUnreadRef.current = unreadCount;
  }, [unreadCount]);

  // Keyboard navigation & Focus management
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isOpen]);

  const handleDeepLinkClick = useCallback(
    (e: React.MouseEvent, item: ContractNotificationItem) => {
      e.preventDefault();
      markAsRead(item.id);
      if (onNavigate) {
        onNavigate(item.deepLink);
      } else if (typeof window !== "undefined") {
        window.location.assign(item.deepLink);
      }
    },
    [markAsRead, onNavigate],
  );

  // Filter notifications by tab
  const filteredNotifications = notifications.filter((item) => {
    if (activeTab === "unread") return !item.read;
    if (activeTab === "payment") return item.category === "payment";
    if (activeTab === "escrow") return item.category === "escrow";
    if (activeTab === "refund") return item.category === "refund";
    if (activeTab === "system")
      return item.category === "system" || item.category === "governance";
    return true; // "all"
  });

  // Category Icon Renderer
  const renderCategoryIcon = (category: NotificationCategory, severity: string) => {
    switch (category) {
      case "payment":
        return (
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "rgba(16, 185, 129, 0.15)",
              color: "#059669",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="20 6 9 17 4 12" />
            </svg>
          </div>
        );
      case "escrow":
        return (
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "rgba(245, 158, 11, 0.15)",
              color: "#D97706",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
        );
      case "refund":
        return (
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "rgba(59, 130, 246, 0.15)",
              color: "#2563EB",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polyline points="1 4 1 10 7 10" />
              <path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10" />
            </svg>
          </div>
        );
      case "governance":
        return (
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "rgba(139, 92, 246, 0.15)",
              color: "#7C3AED",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
            </svg>
          </div>
        );
      case "system":
      default:
        return (
          <div
            style={{
              width: "32px",
              height: "32px",
              borderRadius: "50%",
              backgroundColor: "rgba(239, 68, 68, 0.15)",
              color: "#DC2626",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              flexShrink: 0,
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
          </div>
        );
    }
  };

  const formatRelativeTime = (timestamp: number) => {
    const elapsed = Math.max(0, Date.now() - timestamp);
    const secs = Math.floor(elapsed / 1000);
    if (secs < 60) return `${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return new Date(timestamp).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
  };

  return (
    <div
      className={className}
      style={{
        position: "relative",
        display: "inline-block",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        ...style,
      }}
    >
      {/* Drawer Trigger Button (Bell Icon with Unread Badge) */}
      <button
        ref={triggerRef}
        type="button"
        aria-label={`Notifications (${unreadCount} unread)${address ? ` for ${formatAddress(address)}` : ""}`}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-controls={drawerId}
        onClick={() => setIsOpen((prev) => !prev)}
        style={{
          position: "relative",
          width: "36px",
          height: "36px",
          borderRadius: "50%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: isOpen ? "#E5E7EB" : "var(--color-bg-card, #FFFFFF)",
          border: "1px solid var(--color-border-subtle, #E5E7EB)",
          cursor: "pointer",
          color: "var(--color-text-primary, #374151)",
          transition: "transform 0.15s ease, background-color 0.15s ease",
          transform: pulseBell ? "scale(1.15)" : "scale(1)",
        }}
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
          <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>

        {/* Unread Pill Badge */}
        {unreadCount > 0 && (
          <span
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              minWidth: "18px",
              height: "18px",
              padding: "0 4px",
              borderRadius: "9999px",
              backgroundColor: "#EF4444",
              color: "#FFFFFF",
              fontSize: "10px",
              fontWeight: 700,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              boxShadow: "0 0 0 2px #FFFFFF",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {unreadCount > 99 ? "99+" : unreadCount}
          </span>
        )}
      </button>

      {/* Floating Throttled Batch Toasts Overlay */}
      {activeToasts.length > 0 && (
        <div
          role="status"
          aria-live="polite"
          style={{
            position: "fixed",
            bottom: "20px",
            right: "20px",
            zIndex: 9999,
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            maxWidth: "360px",
            width: "100%",
            pointerEvents: "none",
          }}
        >
          {activeToasts.map((toast, idx) => (
            <div
              key={idx}
              style={{
                pointerEvents: "auto",
                backgroundColor: "#1F2937",
                color: "#FFFFFF",
                borderRadius: "10px",
                padding: "12px 16px",
                boxShadow: "0 10px 15px -3px rgba(0, 0, 0, 0.2)",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                gap: "12px",
                fontSize: "13px",
                borderLeft:
                  toast.type === "summary"
                    ? "4px solid #6366F1"
                    : "4px solid #10B981",
              }}
            >
              <div style={{ flex: 1 }}>
                {toast.type === "summary" ? (
                  <>
                    <div style={{ fontWeight: 600 }}>{toast.summaryTitle}</div>
                    <div style={{ fontSize: "12px", color: "#D1D5DB" }}>
                      {toast.summaryMessage}
                    </div>
                  </>
                ) : (
                  <>
                    <div style={{ fontWeight: 600 }}>{toast.item?.title}</div>
                    <div style={{ fontSize: "12px", color: "#D1D5DB" }}>
                      {toast.item?.message}
                    </div>
                  </>
                )}
              </div>
              <button
                type="button"
                onClick={() => dismissToast(idx)}
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#9CA3AF",
                  cursor: "pointer",
                  padding: "4px",
                }}
                aria-label="Dismiss notification"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Slide-out Persistent Drawer */}
      {isOpen && (
        <>
          {/* Backdrop */}
          <div
            onClick={() => setIsOpen(false)}
            style={{
              position: "fixed",
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              backgroundColor: "rgba(0, 0, 0, 0.35)",
              backdropFilter: "blur(2px)",
              zIndex: 9998,
            }}
          />

          {/* Drawer Container */}
          <div
            id={drawerId}
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-label="Cypher GridPay Notification Center"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "100%",
              maxWidth: "420px",
              backgroundColor: "var(--color-bg-card, #FFFFFF)",
              boxShadow: "-8px 0 24px rgba(0, 0, 0, 0.15)",
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
            }}
          >
            {/* Drawer Header */}
            <div
              style={{
                padding: "16px 20px",
                borderBottom: "1px solid #E5E7EB",
                display: "flex",
                flexDirection: "column",
                gap: "10px",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                }}
              >
                <div>
                  <h2
                    style={{
                      margin: 0,
                      fontSize: "16px",
                      fontWeight: 700,
                      color: "#111827",
                    }}
                  >
                    Notifications
                  </h2>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#6B7280",
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      marginTop: "2px",
                    }}
                  >
                    <span>Wallet:</span>
                    <span
                      style={{
                        fontFamily: "monospace",
                        fontWeight: 600,
                        color: address ? "#4F46E5" : "#9CA3AF",
                      }}
                    >
                      {address ? formatAddress(address) : "Not Connected"}
                    </span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() => setIsOpen(false)}
                  aria-label="Close notification drawer"
                  style={{
                    background: "transparent",
                    border: "none",
                    fontSize: "20px",
                    lineHeight: 1,
                    cursor: "pointer",
                    color: "#6B7280",
                    padding: "4px 8px",
                  }}
                >
                  ✕
                </button>
              </div>

              {/* Browser Notification Opt-In Toggle Banner */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "8px 12px",
                  backgroundColor: "#F9FAFB",
                  borderRadius: "8px",
                  border: "1px solid #E5E7EB",
                  fontSize: "12px",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="#4B5563"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                  </svg>
                  <span>Desktop Notifications</span>
                </div>

                {browserPermission === "granted" ? (
                  <button
                    type="button"
                    onClick={() =>
                      setBrowserNotificationsEnabled(!browserNotificationsEnabled)
                    }
                    style={{
                      fontSize: "11px",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      border: "1px solid #D1D5DB",
                      backgroundColor: browserNotificationsEnabled ? "#E0E7FF" : "#F3F4F6",
                      color: browserNotificationsEnabled ? "#4338CA" : "#6B7280",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {browserNotificationsEnabled ? "Enabled ✓" : "Paused"}
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={requestNotificationPermission}
                    style={{
                      fontSize: "11px",
                      padding: "3px 8px",
                      borderRadius: "4px",
                      backgroundColor: "#4F46E5",
                      color: "#FFFFFF",
                      border: "none",
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Opt-in
                  </button>
                )}
              </div>

              {/* Filter Tabs & Bulk Actions */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginTop: "4px",
                }}
              >
                <div style={{ display: "flex", gap: "4px" }}>
                  {(
                    [
                      { id: "all", label: "All" },
                      { id: "unread", label: `Unread (${unreadCount})` },
                      { id: "payment", label: "Payments" },
                      { id: "escrow", label: "Escrow" },
                      { id: "refund", label: "Refunds" },
                      { id: "system", label: "Safety" },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: "6px",
                        border: "none",
                        fontSize: "11px",
                        fontWeight: activeTab === tab.id ? 700 : 500,
                        backgroundColor:
                          activeTab === tab.id ? "#EEF2FF" : "transparent",
                        color: activeTab === tab.id ? "#4F46E5" : "#6B7280",
                        cursor: "pointer",
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {unreadCount > 0 && (
                  <button
                    type="button"
                    onClick={markAllAsRead}
                    style={{
                      background: "transparent",
                      border: "none",
                      fontSize: "11px",
                      color: "#4F46E5",
                      cursor: "pointer",
                      fontWeight: 600,
                    }}
                  >
                    Mark read
                  </button>
                )}
              </div>
            </div>

            {/* Notifications Scrollable List */}
            <div
              style={{
                flex: 1,
                overflowY: "auto",
                padding: "12px 16px",
                display: "flex",
                flexDirection: "column",
                gap: "8px",
              }}
            >
              {!address ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "40px 20px",
                    color: "#6B7280",
                  }}
                >
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
                    Wallet Not Connected
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: "12px" }}>
                    Connect your Stellar wallet to view personalized on-chain event
                    notifications.
                  </p>
                </div>
              ) : filteredNotifications.length === 0 ? (
                <div
                  style={{
                    textAlign: "center",
                    padding: "40px 20px",
                    color: "#6B7280",
                  }}
                >
                  <div
                    style={{
                      width: "40px",
                      height: "40px",
                      borderRadius: "50%",
                      backgroundColor: "#F3F4F6",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      margin: "0 auto 12px",
                      color: "#9CA3AF",
                    }}
                  >
                    <svg
                      width="20"
                      height="20"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                    >
                      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                      <path d="M13.73 21a2 2 0 0 1-3.46 0" />
                    </svg>
                  </div>
                  <p style={{ margin: 0, fontSize: "14px", fontWeight: 600 }}>
                    No Notifications
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: "12px" }}>
                    {activeTab === "unread"
                      ? "All caught up! No unread notifications."
                      : "New events for your escrow, payments, and disputes will appear here."}
                  </p>
                </div>
              ) : (
                filteredNotifications.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: "12px",
                      padding: "12px",
                      borderRadius: "8px",
                      backgroundColor: item.read ? "#FFFFFF" : "#F8FAFC",
                      border: `1px solid ${item.read ? "#E5E7EB" : "#CBD5E1"}`,
                      position: "relative",
                      transition: "border-color 0.15s ease",
                    }}
                  >
                    {/* Category Icon */}
                    {renderCategoryIcon(item.category, item.severity)}

                    {/* Content */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "8px",
                        }}
                      >
                        <span
                          style={{
                            fontWeight: item.read ? 600 : 700,
                            fontSize: "13px",
                            color: "#111827",
                          }}
                        >
                          {item.title}
                        </span>
                        <span
                          style={{
                            fontSize: "11px",
                            color: "#9CA3AF",
                            flexShrink: 0,
                          }}
                        >
                          {formatRelativeTime(item.timestamp)}
                        </span>
                      </div>

                      <p
                        style={{
                          margin: "4px 0 8px",
                          fontSize: "12px",
                          color: "#4B5563",
                          lineHeight: "1.4",
                        }}
                      >
                        {item.message}
                      </p>

                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          marginTop: "6px",
                        }}
                      >
                        {/* Deep link button */}
                        <a
                          href={item.deepLink}
                          onClick={(e) => handleDeepLinkClick(e, item)}
                          style={{
                            fontSize: "11px",
                            fontWeight: 600,
                            color: "#4F46E5",
                            textDecoration: "none",
                            display: "inline-flex",
                            alignItems: "center",
                            gap: "4px",
                          }}
                        >
                          View Details →
                        </a>

                        <div
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                          }}
                        >
                          <span
                            style={{
                              fontSize: "11px",
                              fontFamily: "monospace",
                              color: "#9CA3AF",
                            }}
                          >
                            #{item.ledger}
                          </span>

                          <button
                            type="button"
                            onClick={() => removeNotification(item.id)}
                            aria-label="Remove notification"
                            style={{
                              background: "transparent",
                              border: "none",
                              color: "#9CA3AF",
                              cursor: "pointer",
                              fontSize: "12px",
                              padding: "2px",
                            }}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Unread Indicator Dot */}
                    {!item.read && (
                      <span
                        style={{
                          position: "absolute",
                          top: "10px",
                          right: "10px",
                          width: "6px",
                          height: "6px",
                          borderRadius: "50%",
                          backgroundColor: "#4F46E5",
                        }}
                        title="Unread"
                      />
                    )}
                  </div>
                ))
              )}
            </div>

            {/* Drawer Footer Status Bar */}
            <div
              style={{
                padding: "12px 20px",
                borderTop: "1px solid #E5E7EB",
                backgroundColor: "#F9FAFB",
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: "11px",
                color: "#6B7280",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <span
                  style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    backgroundColor:
                      connectionStatus === "connected" ? "#10B981" : "#F59E0B",
                  }}
                />
                <span>
                  {connectionStatus === "connected"
                    ? "Live Feed Active"
                    : connectionStatus === "polling"
                    ? "Cursor Polling Fallback"
                    : "Connecting…"}
                </span>
                {latestLedger && (
                  <span style={{ fontFamily: "monospace" }}>
                    (#{latestLedger})
                  </span>
                )}
              </div>

              {notifications.length > 0 && (
                <button
                  type="button"
                  onClick={clearNotifications}
                  style={{
                    background: "transparent",
                    border: "none",
                    color: "#EF4444",
                    fontSize: "11px",
                    cursor: "pointer",
                    fontWeight: 500,
                  }}
                >
                  Clear all
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default NotificationCenter;
