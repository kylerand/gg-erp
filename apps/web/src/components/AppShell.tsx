'use client';

import type { ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SidebarNav } from '@/components/SidebarNav';
import { TopHeader } from '@/components/TopHeader';
import { useRole } from '@/lib/role-context';

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useRole();
  const isAuthRoute = pathname === '/auth';

  // Client-side auth guard: redirect to /auth if not signed in
  useEffect(() => {
    if (!loading && !user && !isAuthRoute) {
      router.replace('/auth');
    }
  }, [loading, user, isAuthRoute, router]);

  if (isAuthRoute) {
    return <>{children}</>;
  }

  // Show nothing while checking auth to avoid flash of content
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="h-8 w-8 border-4 border-[#E37125] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!user) {
    return null;
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
