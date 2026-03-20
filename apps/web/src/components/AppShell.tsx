'use client';

import type { ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { SidebarNav } from '@/components/SidebarNav';
import { TopHeader } from '@/components/TopHeader';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/auth';

  if (isAuthRoute) {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen xl:flex">
      <SidebarNav />
      <div className="flex-1 min-w-0 flex flex-col">
        <TopHeader />
        <main className="flex-1 overflow-y-auto px-4 py-5 sm:px-6 sm:py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
