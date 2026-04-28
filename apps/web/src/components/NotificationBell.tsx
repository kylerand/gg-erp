'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Bell } from 'lucide-react';
import {
  type AppNotification,
  listNotifications,
  markNotificationsRead,
} from '@/lib/api-client';

const POLL_INTERVAL_MS = 30_000;
const MAX_DISPLAY = 20;

function timeAgo(dateStr: string): string {
  const seconds = Math.floor((Date.now() - new Date(dateStr).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const router = useRouter();
  const [notifications, setNotifications] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const fetchNotifications = useCallback(async () => {
    try {
      const data = await listNotifications({ limit: MAX_DISPLAY });
      setNotifications(data.items);
      setUnreadCount(data.unreadCount);
    } catch {
      // Silently ignore fetch errors — polling will retry
    }
  }, []);

  // Initial fetch + polling
  useEffect(() => {
    fetchNotifications();
    const interval = setInterval(fetchNotifications, POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchNotifications]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  const handleNotificationClick = useCallback(
    async (notification: AppNotification) => {
      if (!notification.read) {
        try {
          await markNotificationsRead([notification.id]);
          setNotifications((prev) =>
            prev.map((n) => (n.id === notification.id ? { ...n, read: true } : n)),
          );
          setUnreadCount((prev) => Math.max(0, prev - 1));
        } catch {
          // Best-effort mark-as-read
        }
      }

      const href = getNotificationHref(notification);
      if (href) {
        setOpen(false);
        router.push(href);
      }
    },
    [router],
  );

  const handleMarkAllRead = useCallback(async () => {
    const unreadIds = notifications.filter((n) => !n.read).map((n) => n.id);
    if (unreadIds.length === 0) return;
    try {
      await markNotificationsRead(unreadIds);
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // Best-effort mark-all-read
    }
  }, [notifications]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        className="relative p-2.5 rounded-2xl text-[#85776F] hover:text-[#211F1E] hover:bg-white transition-colors border border-transparent hover:border-[#D9CCBE]"
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell size={18} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex h-4.5 min-w-4.5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold leading-none text-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full mt-2 w-80 sm:w-96 rounded-xl border border-[#D9CCBE] bg-white shadow-lg z-50 overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between border-b border-[#D9CCBE] px-4 py-3">
            <h3 className="text-sm font-semibold text-[#211F1E]">Notifications</h3>
            {unreadCount > 0 && (
              <button
                type="button"
                onClick={handleMarkAllRead}
                className="text-xs font-medium text-[#E37125] hover:text-[#C45F1C] transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          {/* Notification list */}
          <div className="max-h-96 overflow-y-auto">
            {notifications.length === 0 ? (
              <div className="px-4 py-8 text-center text-sm text-[#85776F]">
                No notifications yet
              </div>
            ) : (
              notifications.map((notification) => (
                <button
                  key={notification.id}
                  type="button"
                  onClick={() => handleNotificationClick(notification)}
                  className="flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-[#FFF8EF] transition-colors border-b border-[#F0E8DC] last:border-b-0"
                >
                  {/* Unread dot */}
                  <div className="mt-1.5 flex-shrink-0">
                    {!notification.read ? (
                      <span className="block h-2 w-2 rounded-full bg-blue-500" />
                    ) : (
                      <span className="block h-2 w-2" />
                    )}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-[#211F1E] leading-snug truncate">
                      {notification.title}
                    </p>
                    {notification.body && (
                      <p className="mt-0.5 text-xs text-[#6E625A] line-clamp-2">
                        {notification.body}
                      </p>
                    )}
                    <p className="mt-1 text-[10px] text-[#85776F]">
                      {timeAgo(notification.createdAt)}
                    </p>
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function getNotificationHref(notification: AppNotification): string | null {
  if (!notification.referenceId) return null;

  switch (notification.referenceType) {
    case 'channel':
      return `/messages?channel=${encodeURIComponent(notification.referenceId)}`;
    case 'work_order':
    case 'wo_order':
      return `/work-orders/${encodeURIComponent(notification.referenceId)}`;
    case 'customer':
      return `/customer-dealers/customers?search=${encodeURIComponent(notification.referenceId)}`;
    case 'quote':
      return `/sales/quotes/${encodeURIComponent(notification.referenceId)}`;
    case 'opportunity':
      return `/sales/opportunities/${encodeURIComponent(notification.referenceId)}`;
    default:
      return '/messages';
  }
}
