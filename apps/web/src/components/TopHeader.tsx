'use client';
import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { Bell, Search, WifiOff, Smartphone } from 'lucide-react';

function useOfflineQueue(refreshKey: number): number {
  const [count, setCount] = useState(0);
  useEffect(() => {
    const read = () => {
      try {
        const raw = localStorage.getItem('_offline_queue');
        const arr = raw ? (JSON.parse(raw) as unknown[]) : [];
        setCount(Array.isArray(arr) ? arr.length : 0);
      } catch {
        setCount(0);
      }
    };
    read();
    window.addEventListener('focus', read);
    window.addEventListener('online', read);
    return () => {
      window.removeEventListener('focus', read);
      window.removeEventListener('online', read);
    };
  }, [refreshKey]);
  return count;
}

export function TopHeader() {
  const [isOnline, setIsOnline] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const queuedCount = useOfflineQueue(refreshKey);

  useEffect(() => {
    setIsOnline(navigator.onLine);
    const handleOnline = () => { setIsOnline(true); setRefreshKey(k => k + 1); };
    const handleOffline = () => setIsOnline(false);
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, []);

  const handleReplay = useCallback(() => {
    window.dispatchEvent(new CustomEvent('offline-queue:replay'));
    setTimeout(() => setRefreshKey(k => k + 1), 800);
  }, []);

  return (
    <header className="sticky top-0 z-20 border-b border-[#D9CCBE] bg-[#FFF8EF]/95 backdrop-blur flex items-center px-4 sm:px-6 py-3 gap-4 flex-shrink-0">
      <div className="xl:hidden flex items-center gap-3">
        <Image src="/brand/golfingarage-icon.svg" alt="Golfin Garage" width={36} height={36} className="h-9 w-9" />
      </div>

      {/* Search */}
      <div className="flex items-center gap-2 flex-1 max-w-xl">
        <div className="flex items-center gap-2 w-full bg-white border border-[#D9CCBE] rounded-2xl px-4 py-3 text-sm text-[#6E625A] cursor-pointer hover:border-[#E37125] transition-colors shadow-sm">
          <Search size={14} className="flex-shrink-0" />
          <span className="flex-1">Search work orders, inventory, customers</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-xs text-[#85776F] bg-[#F9F8D1] border border-[#E6DFC6] rounded-lg px-2 py-1 font-sans">
            <span>⌘</span><span>K</span>
          </kbd>
        </div>
      </div>

      {/* Connectivity badge */}
      {!isOnline ? (
        <div className="hidden md:flex items-center gap-1.5 rounded-full bg-amber-100 text-amber-800 text-xs font-medium px-3 py-2 select-none border border-amber-200">
          <WifiOff size={12} />
          <span>⚠ Offline · {queuedCount} queued</span>
        </div>
      ) : queuedCount > 0 ? (
        <div className="hidden md:flex items-center gap-1.5 rounded-full bg-blue-100 text-blue-700 text-xs font-medium px-3 py-2 border border-blue-200">
          <span>↑ {queuedCount} pending</span>
          <button
            type="button"
            onClick={handleReplay}
            className="ml-0.5 underline hover:no-underline focus:outline-none"
            aria-label="Replay offline queue"
          >
            replay
          </button>
        </div>
      ) : null}

      {/* Actions */}
      <div className="flex items-center gap-2">
        <a
          href="http://localhost:3002"
          className="hidden lg:flex items-center gap-2 rounded-2xl border border-[#D9CCBE] bg-white px-3 py-2 text-xs font-semibold text-[#4F4641] hover:border-[#E37125] hover:text-[#211F1E] transition-colors"
        >
          <Smartphone size={14} />
          <span>Floor Tech App</span>
        </a>
        <button
          type="button"
          className="relative p-2.5 rounded-2xl text-[#85776F] hover:text-[#211F1E] hover:bg-white transition-colors border border-transparent hover:border-[#D9CCBE]"
          aria-label="Notifications"
        >
          <Bell size={18} />
        </button>

        {/* Avatar */}
        <div className="flex items-center gap-3 rounded-2xl border border-[#D9CCBE] bg-white px-2 py-2 pl-2.5 shadow-sm">
          <div
            className="w-9 h-9 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 cursor-pointer bg-[var(--brand-orange)]"
            aria-label="User menu"
          >
            KR
          </div>
          <div className="hidden sm:block pr-2">
            <div className="text-sm font-semibold text-[#211F1E] leading-none">Kyler Rand</div>
            <div className="text-xs text-[#85776F] mt-1">Ops Admin</div>
          </div>
        </div>
      </div>
    </header>
  );
}
