'use client';

import { useState } from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { signInWithRedirect } from 'aws-amplify/auth';
import { doSignIn } from '@/lib/auth';
import { useAuth } from '@/lib/auth-provider';
import { Eye, EyeOff } from 'lucide-react';

const GOOGLE_ENABLED =
  process.env.NEXT_PUBLIC_COGNITO_GOOGLE === 'Google' &&
  (process.env.NEXT_PUBLIC_COGNITO_DOMAIN ?? '') !== '';

const SSO_DOMAIN = 'golfingarage.com';

function isSsoEmail(email: string): boolean {
  return GOOGLE_ENABLED && email.trim().toLowerCase().endsWith(`@${SSO_DOMAIN}`);
}

export default function AuthPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [phase, setPhase] = useState<'email' | 'password'>('email');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleContinueFromEmail(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!email.trim()) {
      setError('Please enter your email.');
      return;
    }
    if (isSsoEmail(email)) {
      setLoading(true);
      try {
        await signInWithRedirect({ provider: 'Google' });
      } catch (err) {
        setLoading(false);
        setError(err instanceof Error ? err.message : 'Google sign-in failed');
      }
      return;
    }
    setPhase('password');
  }

  async function handlePasswordSignIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await doSignIn(email, password);
      if (result.isSignedIn) {
        await refresh();
        router.replace('/work-orders/my-queue');
      } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        setError('Account not confirmed. Please check your email.');
      } else if (result.nextStep?.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
        setError('A new password is required. Please contact your manager.');
      } else {
        setError('Sign-in requires additional steps. Please contact support.');
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sign-in failed';
      if (message.includes('NotAuthorizedException') || message.includes('Incorrect')) {
        setError('Incorrect email or password.');
      } else if (message.includes('UserNotFoundException')) {
        setError('No account found with that email.');
      } else {
        setError(message);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#211F1E] text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(227,113,37,0.2),_transparent_34%),linear-gradient(180deg,_rgba(249,248,209,0.07),_transparent_35%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-8">
        <div className="tech-card rounded-2xl bg-white/95 p-6 text-[#211F1E]">
          <Image
            src="/brand/golfingarage-logo.svg"
            alt="Golfin Garage"
            width={260}
            height={104}
            className="mx-auto h-auto w-full max-w-[220px]"
            priority
          />
          <h1 className="mt-5 text-center text-3xl" data-brand-heading="true">
            Floor technician sign-in
          </h1>
          <p className="mt-2 text-center text-sm text-[#6E625A]">
            Built for gloves, thumbs, and quick updates between bays.
          </p>

          {error && (
            <div className="mt-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {error}
            </div>
          )}

          {phase === 'email' ? (
            <form onSubmit={handleContinueFromEmail} className="mt-6 space-y-4">
              <div>
                <label htmlFor="email" className="block text-sm font-semibold text-[#4F4641]">
                  Email
                </label>
                <input
                  id="email"
                  type="email"
                  required
                  autoFocus
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@golfingarage.com"
                  className="mt-1 block w-full rounded-2xl border border-[#D9CCBE] bg-white px-4 py-3 text-base text-[#211F1E] placeholder-[#A89F96] outline-none focus:border-[#E37125] focus:ring-2 focus:ring-[#E37125]/30"
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-[#E37125] text-lg font-bold text-white transition-colors hover:bg-[#C75F1D] disabled:opacity-60"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Redirecting…
                  </span>
                ) : (
                  'Continue'
                )}
              </button>

              {GOOGLE_ENABLED && (
                <p className="text-center text-xs text-[#8A7F76]">
                  Golfin Garage Workspace accounts will sign in with Google.
                </p>
              )}
            </form>
          ) : (
            <form onSubmit={handlePasswordSignIn} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-[#4F4641]">Email</label>
                <div className="mt-1 flex items-center justify-between rounded-2xl border border-[#D9CCBE] bg-[#FAF7F2] px-4 py-3 text-sm text-[#211F1E]">
                  <span className="truncate">{email}</span>
                  <button
                    type="button"
                    onClick={() => { setPhase('email'); setPassword(''); setError(null); }}
                    className="ml-3 flex-shrink-0 text-xs font-semibold text-[#E37125] hover:underline"
                  >
                    Change
                  </button>
                </div>
              </div>

              <div>
                <label htmlFor="password" className="block text-sm font-semibold text-[#4F4641]">
                  Password
                </label>
                <div className="relative mt-1">
                  <input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    required
                    autoFocus
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter your password"
                    className="block w-full rounded-2xl border border-[#D9CCBE] bg-white px-4 py-3 pr-12 text-base text-[#211F1E] placeholder-[#A89F96] outline-none focus:border-[#E37125] focus:ring-2 focus:ring-[#E37125]/30"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-[#6E625A]"
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="mt-2 flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-[#E37125] text-lg font-bold text-white transition-colors hover:bg-[#C75F1D] disabled:opacity-60"
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    Signing in…
                  </span>
                ) : (
                  'Sign In'
                )}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
