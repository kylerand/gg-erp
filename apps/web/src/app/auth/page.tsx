'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { doSignIn, doSignOut, setMockRole, type UserRole } from '@/lib/auth';

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
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRealSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await doSignIn(email, password);
      // Hard navigate to force RoleProvider to re-initialize with new session
      window.location.href = '/';
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      // If a stale session exists, clear it and retry
      if (message.includes('already a signed in user')) {
        try {
          await doSignOut();
          await doSignIn(email, password);
          window.location.href = '/';
          return;
        } catch (retryErr) {
          setError(retryErr instanceof Error ? retryErr.message : 'Sign in failed');
        }
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  function handleMockSignIn(role: UserRole) {
    setMockRole(role);
    router.push('/');
  }

  return (
    <div className="min-h-screen bg-[#211F1E] text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,_rgba(227,113,37,0.22),_transparent_30%),linear-gradient(135deg,_rgba(249,248,209,0.06),_transparent_40%)]" />
      <div className="relative min-h-screen flex items-center justify-center p-4 sm:p-8">
        <div className="grid w-full max-w-6xl gap-8 lg:grid-cols-[1.05fr_0.95fr] items-center">
          <section className="hidden lg:block pr-8">
            <span className="brand-pill border-white/15 bg-white/5 text-[#F9F8D1]">Golf cart operations platform</span>
            <h1 className="mt-6 text-6xl leading-[0.94] text-white" data-brand-heading="true">
              Built for the shop floor, tuned for Golfin Garage.
            </h1>
            <p className="mt-5 max-w-xl text-base text-white/72">
              Branded workflows for service, builds, inventory, training, and accounting — with a dedicated touch-first experience for technicians coming online alongside the main ERP.
            </p>
          </section>

          <div className="w-full max-w-md justify-self-center lg:justify-self-end">
            <div className="brand-panel p-6 sm:p-8">
              <div className="mb-8 text-center">
                <Image
                  src="/brand/golfingarage-logo.svg"
                  alt="Golfin Garage"
                  width={260}
                  height={104}
                  className="mx-auto h-auto w-full max-w-[240px]"
                  priority
                />
                <p className="text-[#6E625A] text-sm mt-4">Sign in to continue to the ERP</p>
              </div>

              {IS_MOCK ? (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-xs text-[#8A4A18] bg-[#FFF3E8] border border-[#F6D1B7] rounded-2xl px-4 py-3">
                    <span>🔧</span>
                    <span>Mock mode — select a role to simulate login</span>
                  </div>
                  <div className="space-y-2">
                    {MOCK_ROLES.map((r) => (
                      <button
                        key={r.value}
                        onClick={() => handleMockSignIn(r.value)}
                        className="w-full text-left px-4 py-4 rounded-2xl border border-[#E6DFC6] hover:border-[#E37125] hover:bg-[#FFF8EF] transition-colors"
                      >
                        <div className="font-medium text-sm text-[#211F1E]">{r.label}</div>
                        <div className="text-xs text-[#6E625A] mt-1">{r.description}</div>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                <form onSubmit={handleRealSignIn} className="space-y-4">
                  {error && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{error}</div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-[#4F4641] mb-1.5">Email</label>
                    <input
                      type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      className="w-full border border-[#D9CCBE] rounded-2xl px-4 py-3 text-sm text-[#211F1E] bg-white placeholder:text-[#A89E95] focus:outline-none focus:ring-2 focus:ring-[#E37125]"
                      placeholder="you@golfingarage.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4F4641] mb-1.5">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)}
                        className="w-full border border-[#D9CCBE] rounded-2xl px-4 py-3 pr-12 text-sm text-[#211F1E] bg-white placeholder:text-[#A89E95] focus:outline-none focus:ring-2 focus:ring-[#E37125]"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A7F76] hover:text-[#4F4641] transition-colors p-1"
                        tabIndex={-1}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                      >
                        {showPassword ? (
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                            <line x1="1" y1="1" x2="23" y2="23" />
                          </svg>
                        ) : (
                          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                            <circle cx="12" cy="12" r="3" />
                          </svg>
                        )}
                      </button>
                    </div>
                  </div>
                  <button
                    type="submit" disabled={loading}
                    className="w-full rounded-2xl bg-[#E37125] hover:bg-[#C95F18] disabled:opacity-50 text-white font-semibold py-3.5 transition-colors shadow-lg shadow-[#E37125]/20"
                  >
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
