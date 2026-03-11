'use client';
import { Bell, Search } from 'lucide-react';

export function TopHeader() {
  return (
    <header className="h-12 bg-white border-b border-gray-200 flex items-center px-6 gap-4 flex-shrink-0">
      {/* Search */}
      <div className="flex items-center gap-2 flex-1 max-w-sm">
        <div className="flex items-center gap-2 w-full bg-gray-50 border border-gray-200 rounded-md px-3 py-1.5 text-sm text-gray-400 cursor-pointer hover:border-gray-300 transition-colors">
          <Search size={14} className="flex-shrink-0" />
          <span className="flex-1">Search Golfin Garage</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 text-xs text-gray-400 bg-white border border-gray-200 rounded px-1.5 py-0.5 font-sans">
            <span>⌘</span><span>K</span>
          </kbd>
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="relative p-1.5 rounded-md text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
          aria-label="Notifications"
        >
          <Bell size={18} />
        </button>

        {/* Avatar */}
        <div
          className="w-7 h-7 rounded-full flex items-center justify-center text-white text-xs font-semibold flex-shrink-0 cursor-pointer"
          style={{ backgroundColor: 'var(--brand-orange)' }}
          aria-label="User menu"
        >
          KR
        </div>
      </div>
    </header>
  );
}
