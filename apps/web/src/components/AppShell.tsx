'use client';

import { useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { SidebarNav } from '@/components/SidebarNav';
import { TopHeader } from '@/components/TopHeader';
import { useRole } from '@/lib/role-context';
import GlobalCopilotChat from '@/components/GlobalCopilotChat';

// If `loading` stays true past this deadline (e.g. Amplify's Cognito session
// read is hanging on a cold OAuth token exchange), bounce to /auth rather
// than leaving the user on a spinner forever.
const AUTH_LOADING_DEADLINE_MS = 15_000;

export function AppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user, loading } = useRole();
  // Treat every /auth/* path as an "auth route" so Cognito's OAuth callback
  // (/auth/callback) can finish its token exchange without AppShell racing
  // `getCurrentUser` against Amplify's redirect handler.
  const isAuthRoute = pathname === '/auth' || pathname.startsWith('/auth/');
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [loadingTimedOut, setLoadingTimedOut] = useState(false);

  // Client-side auth guard: redirect to /auth if not signed in
  useEffect(() => {
    if (!loading && !user && !isAuthRoute) {
      router.replace('/auth');
    }
  }, [loading, user, isAuthRoute, router]);

  // Escape hatch for a stuck loading state — see AUTH_LOADING_DEADLINE_MS.
  useEffect(() => {
    if (!loading || isAuthRoute) return;
    const t = setTimeout(() => setLoadingTimedOut(true), AUTH_LOADING_DEADLINE_MS);
    return () => clearTimeout(t);
  }, [loading, isAuthRoute]);

  useEffect(() => {
    if (loadingTimedOut && !isAuthRoute) {
      window.location.replace('/auth');
    }
  }, [loadingTimedOut, isAuthRoute]);

  if (isAuthRoute) {
    return <>{children}</>;
  }

  // Show loading state while checking auth
  if (loading) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-[#211F1E]">
        <div className="h-10 w-10 border-4 border-[#E37125] border-t-transparent rounded-full animate-spin" />
        <p className="mt-4 text-white/60 text-sm">Checking authentication…</p>
        {loadingTimedOut && (
          <p className="mt-3 text-white/40 text-xs">Taking longer than expected — redirecting to sign in.</p>
        )}
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

      {/* Global Copilot */}
      <GlobalCopilotChat isOpen={copilotOpen} onClose={() => setCopilotOpen(false)} />
      {!copilotOpen && (
        <button
          onClick={() => setCopilotOpen(true)}
          className="fixed bottom-6 right-6 z-40 w-14 h-14 rounded-full bg-yellow-400 hover:bg-yellow-500 shadow-lg flex items-center justify-center text-2xl transition-transform hover:scale-110"
          title="Open ERP Copilot"
        >
          🤖
        </button>
      )}
    </div>
  );
}
