'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { doSignIn, setMockRole, type UserRole } from '@/lib/auth';

const IS_MOCK = process.env.NEXT_PUBLIC_AUTH_MODE === 'mock';

const MOCK_ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: 'technician', label: 'Technician', description: 'My Queue, SOP Runner, Time Logging' },
  { value: 'manager', label: 'Shop Manager', description: 'Dispatch Board, Open/Blocked, Reporting' },
  { value: 'parts', label: 'Parts Manager', description: 'Inventory, Reservations, Receiving' },
  { value: 'trainer', label: 'Trainer', description: 'Training Assignments, SOP Library' },
  { value: 'accounting', label: 'Accounting', description: 'Sync Monitor, Reconciliation, Audit' },
  { value: 'admin', label: 'Admin', description: 'Full access, User Management' },
];

export default function AuthPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRealSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await doSignIn(email, password);
      router.push('/');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign in failed');
    } finally {
      setLoading(false);
    }
  }

  function handleMockSignIn(role: UserRole) {
    setMockRole(role);
    router.push('/');
  }

  return (
    <div className="min-h-screen bg-gray-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="text-4xl mb-3">⛳</div>
          <h1 className="text-2xl font-bold text-white">Golfin Garage ERP</h1>
          <p className="text-gray-400 text-sm mt-1">Sign in to continue</p>
        </div>

        {IS_MOCK ? (
          <div className="bg-white rounded-xl p-6">
            <div className="flex items-center gap-2 mb-4 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <span>🔧</span>
              <span>Mock mode — select a role to simulate login</span>
            </div>
            <div className="space-y-2">
              {MOCK_ROLES.map((r) => (
                <button
                  key={r.value}
                  onClick={() => handleMockSignIn(r.value)}
                  className="w-full text-left px-4 py-3 rounded-lg border border-gray-200 hover:border-yellow-400 hover:bg-yellow-50 transition-colors"
                >
                  <div className="font-medium text-sm text-gray-900">{r.label}</div>
                  <div className="text-xs text-gray-500 mt-0.5">{r.description}</div>
                </button>
              ))}
            </div>
          </div>
        ) : (
          <form onSubmit={handleRealSignIn} className="bg-white rounded-xl p-6 space-y-4">
            {error && (
              <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-4 py-2">{error}</div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
              <input
                type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
                placeholder="you@golfingarage.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
                className="w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-yellow-400"
              />
            </div>
            <button
              type="submit" disabled={loading}
              className="w-full bg-yellow-400 hover:bg-yellow-300 disabled:opacity-50 text-gray-900 font-semibold py-2 rounded-lg transition-colors"
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
