'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, UserRole } from './auth';

interface RoleContextValue {
  user: AuthUser | null;
  role: UserRole | null;
  loading: boolean;
}

const RoleContext = createContext<RoleContextValue>({ user: null, role: null, loading: true });

export function RoleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        // Lazy import to avoid SSR issues with aws-amplify
        const { getAuthUser } = await import('./auth');
        const u = await getAuthUser();
        setUser(u);
      } catch {
        setUser(null);
      } finally {
        setLoading(false);
      }
    }
    void load();
  }, []);

  return (
    <RoleContext.Provider value={{ user, role: user?.role ?? null, loading }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
