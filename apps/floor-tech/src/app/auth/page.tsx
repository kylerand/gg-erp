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

export default function AuthPage() {
  const router = useRouter();
  const { refresh } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
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

          <form onSubmit={handleSubmit} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-semibold text-[#4F4641]">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@golfingarage.com"
                className="mt-1 block w-full rounded-2xl border border-[#D9CCBE] bg-white px-4 py-3 text-base text-[#211F1E] placeholder-[#A89F96] outline-none focus:border-[#E37125] focus:ring-2 focus:ring-[#E37125]/30"
              />
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

            {GOOGLE_ENABLED && (
              <>
                <div className="relative pt-3">
                  <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-[#D9CCBE]" /></div>
                  <div className="relative flex justify-center text-xs uppercase"><span className="bg-white px-3 text-[#8A7F76]">or</span></div>
                </div>
                <button
                  type="button"
                  onClick={() => signInWithRedirect({ provider: 'Google' }).catch((err) => setError(err instanceof Error ? err.message : 'Google sign-in failed'))}
                  className="flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl border border-[#D9CCBE] bg-white text-lg font-semibold text-[#211F1E] hover:bg-[#FAF7F2]"
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
                    <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                    <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                    <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                    <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                  </svg>
                  Sign in with Google
                </button>
                <p className="text-xs text-center text-[#8A7F76]">Restricted to @golfingarage.com accounts</p>
              </>
            )}
          </form>
        </div>
      </div>
    </div>
  );
}
