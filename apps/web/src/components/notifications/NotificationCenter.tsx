import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type NotificationCategory = 'action-required' | 'disputes' | 'settlements' | 'info';

export interface AppNotification {
  id: string;
  title: string;
  body?: string;
  category: NotificationCategory;
  createdAt: number;
  read: boolean;
  resolved?: boolean;
}

export interface NotificationPreferences {
  settlements: boolean;
  disputes: boolean;
  actionRequired: boolean;
  info: boolean;
}

type FilterKey = 'all' | 'action-required' | 'disputes' | 'settlements';

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'action-required', label: 'Action Required' },
  { key: 'disputes', label: 'Disputes' },
  { key: 'settlements', label: 'Settlements' },
];

const DEFAULT_PREFERENCES: NotificationPreferences = {
  settlements: true,
  disputes: true,
  actionRequired: true,
  info: true,
};

function isPinned(n: AppNotification): boolean {
  return n.category === 'action-required' && !n.resolved;
}

function matchesFilter(n: AppNotification, filter: FilterKey): boolean {
  if (filter === 'all') return true;
  return n.category === filter;
}

function preferenceFor(
  category: NotificationCategory,
  prefs: NotificationPreferences,
): boolean {
  switch (category) {
    case 'settlements':
      return prefs.settlements;
    case 'disputes':
      return prefs.disputes;
    case 'action-required':
      return prefs.actionRequired;
    default:
      return prefs.info;
  }
}

export interface NotificationCenterProps {
  notifications: AppNotification[];
  open: boolean;
  onClose: () => void;
  onMarkAllRead?: () => void;
  onMarkRead?: (id: string) => void;
  preferences?: NotificationPreferences;
  onPreferencesChange?: (prefs: NotificationPreferences) => void;
}

export function NotificationCenter({
  notifications,
  open,
  onClose,
  onMarkAllRead,
  onMarkRead,
  preferences = DEFAULT_PREFERENCES,
  onPreferencesChange,
}: NotificationCenterProps) {
  const [filter, setFilter] = useState<FilterKey>('all');
  const drawerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const visible = useMemo(() => {
    const filtered = notifications.filter(
      (n) => matchesFilter(n, filter) && preferenceFor(n.category, preferences),
    );
    const pinned = filtered.filter(isPinned);
    const rest = filtered.filter((n) => !isPinned(n));
    const byDate = (a: AppNotification, b: AppNotification) => b.createdAt - a.createdAt;
    return [...pinned.sort(byDate), ...rest.sort(byDate)];
  }, [notifications, filter, preferences]);

  const unreadCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications],
  );

  const togglePreference = useCallback(
    (key: keyof NotificationPreferences) => {
      if (!onPreferencesChange) return;
      onPreferencesChange({ ...preferences, [key]: !preferences[key] });
    },
    [preferences, onPreferencesChange],
  );

  if (!open) return null;

  return (
    <div
      className="notification-center-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={drawerRef}
        className="notification-center-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="Notification Center"
      >
        <header className="notification-center-header">
          <h2>Notifications{unreadCount > 0 ? ` (${unreadCount})` : ''}</h2>
          <button
            ref={closeRef}
            type="button"
            className="notification-center-close"
            aria-label="Close notification center"
            onClick={onClose}
          >
            ×
          </button>
        </header>

        <div className="notification-center-toolbar">
          <div role="tablist" aria-label="Notification filters" className="notification-filters">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="tab"
                aria-selected={filter === f.key}
                className={filter === f.key ? 'active' : undefined}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            className="notification-mark-all"
            onClick={onMarkAllRead}
            disabled={unreadCount === 0}
          >
            Mark all as read
          </button>
        </div>

        <ul className="notification-list" aria-live="polite">
          {visible.length === 0 ? (
            <li className="notification-empty">No notifications</li>
          ) : (
            visible.map((n) => (
              <li
                key={n.id}
                className={`notification-item${n.read ? '' : ' unread'}${
                  isPinned(n) ? ' pinned' : ''
                }`}
              >
                <button
                  type="button"
                  className="notification-item-body"
                  onClick={() => onMarkRead?.(n.id)}
                >
                  {!n.read && (
                    <span className="notification-unread-dot" aria-label="Unread" />
                  )}
                  <span className="notification-item-title">{n.title}</span>
                  {n.body && <span className="notification-item-text">{n.body}</span>}
                </button>
              </li>
            ))
          )}
        </ul>

        <section className="notification-preferences" aria-label="Notification preferences">
          <h3>Preferences</h3>
          {(
            [
              ['settlements', 'Settlements'],
              ['disputes', 'Disputes'],
              ['actionRequired', 'Action Required'],
              ['info', 'Informational'],
            ] as [keyof NotificationPreferences, string][]
          ).map(([key, label]) => (
            <label key={key} className="notification-preference-row">
              <span>{label}</span>
              <input
                type="checkbox"
                checked={preferences[key]}
                onChange={() => togglePreference(key)}
              />
            </label>
          ))}
        </section>
      </div>
    </div>
  );
}

export default NotificationCenter;
