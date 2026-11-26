/**
 * useContractEventStream.ts
 *
 * Real-time Stellar Soroban contract event streaming and network telemetry hook.
 * Connects to WebSocket / SSE feed with automatic cursor-based getEvents polling
 * fallback when persistent sockets are blocked by corporate proxies or network errors.
 *
 * Provides:
 *   - Live ledger sequence tracking
 *   - Network latency benchmarking in milliseconds
 *   - Connectivity health & degraded state alerts
 *   - Deterministic event deduplication by Soroban event.id / pagingToken
 *   - Complete wallet account switching isolation (never leaks previous account state)
 *   - Toast throttling for single-ledger batch bursts
 *   - Browser desktop notification opt-in management
 */

import { useCallback, useEffect, useRef, useState } from "react";
import {
  BatchBurstThrottler,
  ContractEventFilter,
  ContractEventStreamManager,
  ContractNotificationItem,
  EventDeduplicator,
  EventRpc,
  isEventRelevantToAddress,
  mapEventToNotification,
  ParsedContractEvent,
  StreamConnectionStatus,
  ThrottledToastResult,
} from "../../../../sdk/typescript/src/events";

export type StellarNetwork = "mainnet" | "testnet" | "standalone";

export interface UseContractEventStreamOptions {
  /** Active connected Stellar address (e.g. G...). State resets immediately when this changes. */
  address?: string;
  /** Active network target. Defaults to 'testnet'. */
  network?: StellarNetwork;
  /** WebSocket / SSE streaming URL for contract event feed. */
  wsUrl?: string;
  /** Soroban RPC URL for cursor-based polling fallback and latency health checks. */
  rpcUrl?: string;
  /** Optional custom EventRpc implementation. */
  rpcClient?: EventRpc;
  /** Optional contract filters. Defaults to standard topics. */
  filters?: ContractEventFilter[];
  /** Polling interval in ms when in fallback polling mode. Defaults to 3000ms. */
  pollIntervalMs?: number;
  /** Latency check interval in ms. Defaults to 5000ms. */
  latencyCheckIntervalMs?: number;
  /** Burst threshold of events in a single ledger before throttling toasts. Defaults to 2. */
  burstThreshold?: number;
  /** Maximum individual toasts before bundling remainder into summary. Defaults to 2. */
  maxIndividualToasts?: number;
  /** Storage key prefix for persisted notifications. Defaults to 'gridpay_notifs_'. */
  storageKeyPrefix?: string;
  /** Callback fired for each relevant incoming notification. */
  onNotification?: (notification: ContractNotificationItem) => void;
  /** Callback fired when an individual or summary toast is ready for display. */
  onToast?: (toast: ThrottledToastResult<ContractNotificationItem>) => void;
}

export interface UseContractEventStreamResult {
  /** Notifications belonging exclusively to the currently connected address. */
  notifications: ContractNotificationItem[];
  /** Total unread count for the active address. */
  unreadCount: number;
  /** Mark a specific notification as read. */
  markAsRead: (id: string) => void;
  /** Mark all notifications for the active address as read. */
  markAllAsRead: () => void;
  /** Clear all notifications for the active address. */
  clearNotifications: () => void;
  /** Remove a single notification by id. */
  removeNotification: (id: string) => void;

  /** Active Stellar network. */
  network: StellarNetwork;
  /** Latest closed ledger sequence number. */
  latestLedger: number | null;
  /** RPC latency in milliseconds. */
  rpcLatencyMs: number | null;
  /** Connection state. */
  connectionStatus: StreamConnectionStatus;
  /** Whether the connection is degraded (latency > 1000ms or polling fallback). */
  isDegraded: boolean;
  /** Timestamp of the latest closed ledger. */
  latestLedgerClosedAt: string | null;

  /** Browser notification permission status. */
  browserPermission: NotificationPermission | "unsupported";
  /** Whether user has opted into desktop/browser notifications. */
  browserNotificationsEnabled: boolean;
  /** Request user opt-in for browser notifications. */
  requestNotificationPermission: () => Promise<boolean>;
  /** Toggle browser notification opt-in. */
  setBrowserNotificationsEnabled: (enabled: boolean) => void;

  /** Active throttled toasts to display in the UI. */
  activeToasts: ThrottledToastResult<ContractNotificationItem>[];
  /** Dismiss an active toast. */
  dismissToast: (index: number) => void;

  /** Manually trigger connection retry. */
  reconnect: () => void;
}

const DEFAULT_STORAGE_PREFIX = "gridpay_notifs_";

export function useContractEventStream(
  options: UseContractEventStreamOptions = {},
): UseContractEventStreamResult {
  const {
    address,
    network = "testnet",
    wsUrl,
    rpcUrl = network === "mainnet"
      ? "https://mainnet.sorobanrpc.com"
      : "https://soroban-testnet.stellar.org",
    rpcClient,
    filters = [],
    pollIntervalMs = 3000,
    latencyCheckIntervalMs = 5000,
    burstThreshold = 2,
    maxIndividualToasts = 2,
    storageKeyPrefix = DEFAULT_STORAGE_PREFIX,
    onNotification,
    onToast,
  } = options;

  // ---------------------------------------------------------------------------
  // Account-Isolated Notification State
  // ---------------------------------------------------------------------------
  const [notifications, setNotifications] = useState<ContractNotificationItem[]>([]);
  const [activeToasts, setActiveToasts] = useState<ThrottledToastResult<ContractNotificationItem>[]>([]);

  // Telemetry & Ledger State
  const [latestLedger, setLatestLedger] = useState<number | null>(null);
  const [latestLedgerClosedAt, setLatestLedgerClosedAt] = useState<string | null>(null);
  const [rpcLatencyMs, setRpcLatencyMs] = useState<number | null>(null);
  const [connectionStatus, setConnectionStatus] = useState<StreamConnectionStatus>("disconnected");

  // Browser Notification Settings
  const [browserPermission, setBrowserPermission] = useState<NotificationPermission | "unsupported">("default");
  const [browserNotificationsEnabled, setBrowserNotificationsEnabledState] = useState<boolean>(() => {
    try {
      return localStorage.getItem("gridpay_browser_notifications_enabled") === "true";
    } catch {
      return false;
    }
  });

  // Deduplication & Burst Throttling References
  const deduplicatorRef = useRef<EventDeduplicator>(new EventDeduplicator({ maxCapacity: 5000 }));
  const throttlerRef = useRef<BatchBurstThrottler<ContractNotificationItem>>(
    new BatchBurstThrottler({ burstThreshold, maxIndividualToasts, burstWindowMs: 400 }),
  );
  const streamManagerRef = useRef<ContractEventStreamManager | null>(null);
  const currentAddressRef = useRef<string | undefined>(address);

  // ---------------------------------------------------------------------------
  // Account Switching Isolation: Instant State Reset & Reload
  // ---------------------------------------------------------------------------
  useEffect(() => {
    currentAddressRef.current = address;

    // Reset deduplicator and in-flight burst queue on account switch
    throttlerRef.current.reset();
    setActiveToasts([]);

    if (!address) {
      // Wallet disconnected: Immediately clear all notification state
      setNotifications([]);
      return;
    }

    // Load exclusively from storage keyed by the active address
    try {
      const storageKey = `${storageKeyPrefix}${address}`;
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          // Verify items belong strictly to current address
          const isolated = parsed.filter(
            (item: ContractNotificationItem) =>
              !item.targetAddress ||
              item.targetAddress.trim().toLowerCase() === address.trim().toLowerCase(),
          );
          setNotifications(isolated);
          return;
        }
      }
    } catch {
      // Ignore storage read error
    }

    setNotifications([]);
  }, [address, storageKeyPrefix]);

  // Sync notifications to address-isolated localStorage whenever they change
  const persistNotifications = useCallback(
    (updated: ContractNotificationItem[], targetAddr?: string) => {
      const addr = targetAddr || currentAddressRef.current;
      if (!addr) return;
      try {
        const storageKey = `${storageKeyPrefix}${addr}`;
        localStorage.setItem(storageKey, JSON.stringify(updated.slice(0, 100))); // Persist top 100
      } catch {
        // LocalStorage quota or access denied
      }
    },
    [storageKeyPrefix],
  );

  // ---------------------------------------------------------------------------
  // Browser Notification Permission Check
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setBrowserPermission(Notification.permission);
    } else {
      setBrowserPermission("unsupported");
    }
  }, []);

  const requestNotificationPermission = useCallback(async (): Promise<boolean> => {
    if (typeof window === "undefined" || !("Notification" in window)) {
      setBrowserPermission("unsupported");
      return false;
    }
    try {
      const permission = await Notification.requestPermission();
      setBrowserPermission(permission);
      if (permission === "granted") {
        setBrowserNotificationsEnabledState(true);
        localStorage.setItem("gridpay_browser_notifications_enabled", "true");
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }, []);

  const setBrowserNotificationsEnabled = useCallback((enabled: boolean) => {
    setBrowserNotificationsEnabledState(enabled);
    try {
      localStorage.setItem("gridpay_browser_notifications_enabled", enabled ? "true" : "false");
    } catch {
      // ignore
    }
  }, []);

  // ---------------------------------------------------------------------------
  // Notification Actions
  // ---------------------------------------------------------------------------
  const markAsRead = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.map((item) => (item.id === id ? { ...item, read: true } : item));
        persistNotifications(next);
        return next;
      });
    },
    [persistNotifications],
  );

  const markAllAsRead = useCallback(() => {
    setNotifications((prev) => {
      const next = prev.map((item) => ({ ...item, read: true }));
      persistNotifications(next);
      return next;
    });
  }, [persistNotifications]);

  const clearNotifications = useCallback(() => {
    setNotifications([]);
    const addr = currentAddressRef.current;
    if (addr) {
      try {
        localStorage.removeItem(`${storageKeyPrefix}${addr}`);
      } catch {
        // ignore
      }
    }
  }, [storageKeyPrefix]);

  const removeNotification = useCallback(
    (id: string) => {
      setNotifications((prev) => {
        const next = prev.filter((item) => item.id !== id);
        persistNotifications(next);
        return next;
      });
    },
    [persistNotifications],
  );

  const dismissToast = useCallback((index: number) => {
    setActiveToasts((prev) => prev.filter((_, i) => i !== index));
  }, []);

  // ---------------------------------------------------------------------------
  // Event Processing & Dispatch Pipeline
  // ---------------------------------------------------------------------------
  const handleIncomingEvent = useCallback(
    (parsedEvent: ParsedContractEvent) => {
      const activeAddr = currentAddressRef.current;

      // 1. Ledger Sequence Telemetry
      if (parsedEvent.ledger) {
        setLatestLedger(parsedEvent.ledger);
        if (parsedEvent.ledgerClosedAt) {
          setLatestLedgerClosedAt(parsedEvent.ledgerClosedAt);
        }
      }

      // 2. Filter relevance to current wallet address
      if (!isEventRelevantToAddress(parsedEvent, activeAddr)) {
        return;
      }

      // 3. Map to human-readable notification item with deep link
      const notification = mapEventToNotification(parsedEvent, activeAddr);

      // 4. Update address-isolated persistent state
      setNotifications((prev) => {
        // Avoid duplicate items in state
        if (prev.some((n) => n.id === notification.id)) return prev;
        const next = [notification, ...prev];
        persistNotifications(next, activeAddr);
        return next;
      });

      onNotification?.(notification);

      // 5. Throttled Toast Presentation Pipeline
      throttlerRef.current.enqueue(notification, (results) => {
        setActiveToasts((prev) => [...results, ...prev].slice(0, 5));
        for (const res of results) {
          onToast?.(res);
        }
      });

      // 6. Optional Desktop Browser Notification Opt-In
      if (
        browserNotificationsEnabled &&
        typeof window !== "undefined" &&
        "Notification" in window &&
        Notification.permission === "granted" &&
        document.hidden // only show if tab is in background or user opted in
      ) {
        try {
          new Notification(notification.title, {
            body: notification.message,
            icon: "/favicon.ico",
            tag: notification.id,
          });
        } catch {
          // ignore notification error
        }
      }
    },
    [browserNotificationsEnabled, onNotification, onToast, persistNotifications],
  );

  // ---------------------------------------------------------------------------
  // Connection & Streaming Setup with Polling Fallback
  // ---------------------------------------------------------------------------
  const setupStream = useCallback(() => {
    // Tear down existing manager
    if (streamManagerRef.current) {
      streamManagerRef.current.stop();
      streamManagerRef.current = null;
    }

    // Default JSON-RPC client fallback
    const effectiveRpc: EventRpc = rpcClient || {
      async getEvents(req) {
        const rpcPayload = {
          jsonrpc: "2.0",
          id: 1,
          method: "getEvents",
          params: {
            startLedger: req.startLedger,
            filters: req.filters,
            pagination: req.cursor ? { cursor: req.cursor, limit: req.limit ?? 50 } : { limit: req.limit ?? 50 },
          },
        };

        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(rpcPayload),
        });

        if (!res.ok) {
          throw new Error(`Soroban RPC HTTP error ${res.status}`);
        }

        const data = await res.json();
        if (data.error) {
          throw new Error(data.error.message || "Soroban RPC error");
        }

        return {
          events: data.result?.events || [],
          cursor: data.result?.cursor || "",
          latestLedger: data.result?.latestLedger || 0,
        };
      },
    };

    const manager = new ContractEventStreamManager({
      wsUrl,
      rpc: effectiveRpc,
      filters,
      pollIntervalMs,
      onEvent: (evt) => handleIncomingEvent(evt),
      onStatusChange: (status) => setConnectionStatus(status),
      onLedgerUpdate: (ledger) => setLatestLedger(ledger),
      onLatencyUpdate: (latency) => setRpcLatencyMs(latency),
    });

    streamManagerRef.current = manager;
    manager.start();
  }, [filters, handleIncomingEvent, pollIntervalMs, rpcClient, rpcUrl, wsUrl]);

  useEffect(() => {
    setupStream();
    return () => {
      if (streamManagerRef.current) {
        streamManagerRef.current.stop();
        streamManagerRef.current = null;
      }
    };
  }, [setupStream]);

  // Periodic RPC Latency Heartbeat Check
  useEffect(() => {
    let timer: any = null;
    const checkLatency = async () => {
      if (!rpcUrl) return;
      const start = Date.now();
      try {
        const res = await fetch(rpcUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "health",
            method: "getLatestLedger",
          }),
        });
        const elapsed = Date.now() - start;
        setRpcLatencyMs(elapsed);
        if (res.ok) {
          const json = await res.json();
          if (json.result?.sequence) {
            setLatestLedger(json.result.sequence);
          }
        }
      } catch {
        // Network timeout / degraded
        setRpcLatencyMs(null);
      }
    };

    checkLatency();
    timer = setInterval(checkLatency, latencyCheckIntervalMs);
    return () => {
      if (timer) clearInterval(timer);
    };
  }, [latencyCheckIntervalMs, rpcUrl]);

  const isDegraded =
    connectionStatus === "degraded" ||
    connectionStatus === "polling" ||
    (rpcLatencyMs !== null && rpcLatencyMs > 1000);

  const unreadCount = notifications.filter((n) => !n.read).length;

  return {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    clearNotifications,
    removeNotification,
    network,
    latestLedger,
    rpcLatencyMs,
    connectionStatus,
    isDegraded,
    latestLedgerClosedAt,
    browserPermission,
    browserNotificationsEnabled,
    requestNotificationPermission,
    setBrowserNotificationsEnabled,
    activeToasts,
    dismissToast,
    reconnect: setupStream,
  };
}
