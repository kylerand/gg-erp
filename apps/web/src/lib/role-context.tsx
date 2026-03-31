'use client';
import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, UserRole } from './auth';
import { setAuthToken } from './api-client';

interface RoleContextValue {
  user: AuthUser | null;
  role: UserRole | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const RoleContext = createContext<RoleContextValue>({ user: null, role: null, loading: true, refresh: async () => {} });

export function RoleProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  async function loadUser() {
    try {
      const { getAuthUser, getAccessToken } = await import('./auth');
      const u = await getAuthUser();
      setUser(u);
      if (u) {
        const token = await getAccessToken();
        setAuthToken(token);
      }
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUser();
  }, []);

  return (
    <RoleContext.Provider value={{ user, role: user?.role ?? null, loading, refresh: loadUser }}>
      {children}
    </RoleContext.Provider>
  );
}

export function useRole() {
  return useContext(RoleContext);
}
