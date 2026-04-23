'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import { signInWithRedirect } from 'aws-amplify/auth';
import { doSignIn, doSignOut, doConfirmNewPassword, setMockRole, type UserRole } from '@/lib/auth';

const GOOGLE_ENABLED =
  process.env.NEXT_PUBLIC_COGNITO_GOOGLE === 'Google' &&
  (process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '') !== '';

const IS_MOCK = process.env.NEXT_PUBLIC_AUTH_MODE === 'mock';

const MOCK_ROLES: { value: UserRole; label: string; description: string }[] = [
  { value: 'technician', label: 'Technician', description: 'My Queue, SOP Runner, Time Logging' },
  { value: 'manager', label: 'Shop Manager', description: 'Dispatch Board, Open/Blocked, Reporting' },
  { value: 'parts', label: 'Parts Manager', description: 'Inventory, Reservations, Receiving' },
  { value: 'trainer', label: 'Trainer', description: 'Training Assignments, SOP Library' },
  { value: 'accounting', label: 'Accounting', description: 'Sync Monitor, Reconciliation, Audit' },
  { value: 'admin', label: 'Admin', description: 'Full access, User Management' },
];

const INPUT_CLS = 'w-full border border-[#D9CCBE] rounded-2xl px-4 py-3 text-sm text-[#211F1E] bg-white placeholder:text-[#A89E95] focus:outline-none focus:ring-2 focus:ring-[#E37125]';
const BTN_CLS = 'w-full rounded-2xl bg-[#E37125] hover:bg-[#C95F18] disabled:opacity-50 text-white font-semibold py-3.5 transition-colors shadow-lg shadow-[#E37125]/20';

function passwordRules(pw: string) {
  return {
    length: pw.length >= 12,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
    special: /[^A-Za-z0-9]/.test(pw),
  };
}

export default function AuthPage() {
  const router = useRouter();

  // ── Sign-in state ──────────────────────────────────────────────────────────
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  // ── New-password challenge state ───────────────────────────────────────────
  const [step, setStep] = useState<'login' | 'new-password'>('login');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);

  // ── Shared ─────────────────────────────────────────────────────────────────
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleRealSignIn(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const result = await doSignIn(email, password);

      if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setStep('new-password');
        return;
      }

      if (result.isSignedIn) {
        window.location.href = '/';
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign in failed';
      if (message.includes('already a signed in user')) {
        try {
          await doSignOut();
          const result = await doSignIn(email, password);
          if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
            setStep('new-password');
            return;
          }
          if (result.isSignedIn) window.location.href = '/';
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

  async function handleNewPassword(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }
    const rules = passwordRules(newPassword);
    if (!rules.length) { setError('Password must be at least 12 characters.'); return; }
    if (!rules.upper) { setError('Password must contain at least one uppercase letter.'); return; }
    if (!rules.lower) { setError('Password must contain at least one lowercase letter.'); return; }
    if (!rules.number) { setError('Password must contain at least one number.'); return; }
    if (!rules.special) { setError('Password must contain at least one special character.'); return; }
    setLoading(true);
    try {
      const result = await doConfirmNewPassword(newPassword);
      if (result.isSignedIn) {
        window.location.href = '/';
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to set new password.');
    } finally {
      setLoading(false);
    }
  }

  function handleMockSignIn(role: UserRole) {
    setMockRole(role);
    router.push('/');
  }

  const pwRules = passwordRules(newPassword);
  const pwStarted = newPassword.length > 0;

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
                <p className="text-[#6E625A] text-sm mt-4">
                  {step === 'new-password' ? 'Set your new password to continue' : 'Sign in to continue to the ERP'}
                </p>
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
              ) : step === 'new-password' ? (
                <form onSubmit={handleNewPassword} className="space-y-4">
                  <div className="text-sm text-[#4F4641] bg-[#FFF8EF] border border-[#F6D1B7] rounded-2xl px-4 py-3">
                    Your account requires a new password before you can continue.
                  </div>
                  {error && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{error}</div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-[#4F4641] mb-1.5">New password</label>
                    <div className="relative">
                      <input
                        type={showNew ? 'text' : 'password'} required autoFocus
                        value={newPassword} onChange={(e) => setNewPassword(e.target.value)}
                        className={`${INPUT_CLS} pr-12`}
                        placeholder="Create a strong password"
                      />
                      <button type="button" onClick={() => setShowNew(!showNew)} tabIndex={-1}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A7F76] hover:text-[#4F4641] transition-colors p-1"
                        aria-label={showNew ? 'Hide password' : 'Show password'}>
                        <EyeIcon open={showNew} />
                      </button>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1">
                      <RuleCheck met={pwRules.length} started={pwStarted} label="12+ characters" />
                      <RuleCheck met={pwRules.number} started={pwStarted} label="One number" />
                      <RuleCheck met={pwRules.upper} started={pwStarted} label="Uppercase letter" />
                      <RuleCheck met={pwRules.special} started={pwStarted} label="Special character" />
                      <RuleCheck met={pwRules.lower} started={pwStarted} label="Lowercase letter" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4F4641] mb-1.5">Confirm new password</label>
                    <input
                      type="password" required
                      value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)}
                      className={INPUT_CLS}
                      placeholder="Re-enter your new password"
                    />
                  </div>
                  <button type="submit" disabled={loading} className={BTN_CLS}>
                    {loading ? 'Setting password…' : 'Set password and sign in'}
                  </button>
                </form>
              ) : (
                <form onSubmit={handleRealSignIn} className="space-y-4">
                  {error && (
                    <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-2xl px-4 py-3">{error}</div>
                  )}
                  <div>
                    <label className="block text-sm font-medium text-[#4F4641] mb-1.5">Email</label>
                    <input
                      type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
                      className={INPUT_CLS}
                      placeholder="you@golfingarage.com"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[#4F4641] mb-1.5">Password</label>
                    <div className="relative">
                      <input
                        type={showPassword ? 'text' : 'password'} required value={password} onChange={(e) => setPassword(e.target.value)}
                        className={`${INPUT_CLS} pr-12`}
                      />
                      <button type="button" onClick={() => setShowPassword(!showPassword)} tabIndex={-1}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-[#8A7F76] hover:text-[#4F4641] transition-colors p-1"
                        aria-label={showPassword ? 'Hide password' : 'Show password'}>
                        <EyeIcon open={showPassword} />
                      </button>
                    </div>
                  </div>
                  <button type="submit" disabled={loading} className={BTN_CLS}>
                    {loading ? 'Signing in…' : 'Sign in'}
                  </button>

                  {GOOGLE_ENABLED && (
                    <>
                      <div className="relative py-2">
                        <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#D9CCBE]" /></div>
                        <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-3 text-[#8A7F76]">or</span></div>
                      </div>
                      <button
                        type="button"
                        onClick={() => signInWithRedirect({ provider: 'Google' }).catch((err) => setError(err instanceof Error ? err.message : 'Google sign-in failed'))}
                        className="w-full flex items-center justify-center gap-2 rounded-2xl border border-[#D9CCBE] bg-white hover:bg-[#FAF7F2] text-[#211F1E] font-semibold py-3.5 transition-colors"
                      >
                        <GoogleIcon />
                        <span>Sign in with Google</span>
                      </button>
                      <p className="text-xs text-center text-[#8A7F76]">Restricted to @golfingarage.com accounts</p>
                    </>
                  )}
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function RuleCheck({ met, started, label }: { met: boolean; started: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs transition-colors ${
      !started ? 'text-[#A89E95]' : met ? 'text-green-600' : 'text-red-500'
    }`}>
      <span className="flex-shrink-0">
        {!started ? '○' : met ? '✓' : '✗'}
      </span>
      <span>{label}</span>
    </div>
  );
}

function EyeIcon({ open }: { open: boolean }) {
  return open ? (
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
  );
}

function GoogleIcon() {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
      <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
      <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
      <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
    </svg>
  );
}
