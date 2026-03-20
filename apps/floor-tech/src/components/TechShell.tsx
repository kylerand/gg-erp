'use client';

import type { ReactNode } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ClipboardList, Clock3, RefreshCcw, TimerReset } from 'lucide-react';

const NAV_ITEMS = [
  { href: '/work-orders/my-queue', label: 'Queue', icon: ClipboardList },
  { href: '/shift', label: 'Shift', icon: Clock3 },
  { href: '/work-orders/time-logging', label: 'Time', icon: TimerReset },
  { href: '/sync', label: 'Sync', icon: RefreshCcw },
];

export function TechShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/auth';

  if (isAuthRoute) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen pb-28">
      <header className="sticky top-0 z-20 border-b border-[#D9CCBE] bg-[#FFF8EF]/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3">
          <Image src="/brand/golfingarage-icon.svg" alt="Golfin Garage" width={42} height={42} className="h-11 w-11" priority />
          <div className="min-w-0 flex-1">
            <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A4A18]">Floor Tech</div>
            <div className="truncate text-base font-semibold text-[#211F1E]">Touch-first work execution</div>
          </div>
          <Link href="/auth" className="rounded-2xl border border-[#D9CCBE] bg-white px-3 py-2 text-xs font-semibold text-[#4F4641]">
            Switch User
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 py-4">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-30 border-t border-[#D9CCBE] bg-[#FFF8EF]/95 px-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)] pt-3 backdrop-blur">
        <div className="mx-auto grid max-w-3xl grid-cols-4 gap-2">
          {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={href}
                href={href}
                className={`flex min-h-[60px] flex-col items-center justify-center rounded-2xl border text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#E37125] bg-[#E37125] text-white shadow-lg shadow-[#E37125]/20'
                    : 'border-[#D9CCBE] bg-white text-[#5F5752]'
                }`}
              >
                <Icon size={19} />
                <span className="mt-1">{label}</span>
              </Link>
            );
          })}
        </div>
      </nav>
    </div>
  );
}
