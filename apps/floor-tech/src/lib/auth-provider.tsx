'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { AuthUser, UserRole } from './auth';
import { setAuthToken } from './api-client';

interface AuthContextValue {
  user: AuthUser | null;
  role: UserRole | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  user: null,
  role: null,
  loading: true,
  refresh: async () => {},
});

const TOKEN_REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

export function AuthProvider({ children }: { children: ReactNode }) {
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
      } else {
        setAuthToken(null);
      }
    } catch {
      setUser(null);
      setAuthToken(null);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadUser();

    const interval = setInterval(async () => {
      try {
        const { getAccessToken, getAuthUser } = await import('./auth');
        const u = await getAuthUser();
        if (u) {
          const token = await getAccessToken();
          setAuthToken(token);
        } else {
          setUser(null);
          setAuthToken(null);
          window.location.href = '/auth';
        }
      } catch {
        setUser(null);
        setAuthToken(null);
        window.location.href = '/auth';
      }
    }, TOKEN_REFRESH_INTERVAL_MS);

    return () => clearInterval(interval);
  }, []);

  return (
    <AuthContext.Provider value={{ user, role: user?.role ?? null, loading, refresh: loadUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
