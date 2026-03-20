'use client';

import Image from 'next/image';
import Link from 'next/link';

const MOCK_ROLES = [
  { label: 'Technician Shift Start', href: '/work-orders/my-queue', note: 'Primary tech workflow' },
  { label: 'Shared Device Mode', href: '/work-orders/my-queue', note: 'Fast start for common-floor tablets' },
];

export default function AuthPage() {
  return (
    <div className="min-h-screen bg-[#211F1E] text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(227,113,37,0.2),_transparent_34%),linear-gradient(180deg,_rgba(249,248,209,0.07),_transparent_35%)]" />
      <div className="relative mx-auto flex min-h-screen max-w-md flex-col justify-center px-5 py-8">
        <div className="tech-card bg-white/95 p-6 text-[#211F1E]">
          <Image src="/brand/golfingarage-logo.svg" alt="Golfin Garage" width={260} height={104} className="mx-auto h-auto w-full max-w-[220px]" priority />
          <h1 className="mt-5 text-center text-3xl" data-brand-heading="true">Floor technician sign-in</h1>
          <p className="mt-2 text-center text-sm text-[#6E625A]">
            Built for gloves, thumbs, and quick updates between bays.
          </p>

          <div className="mt-6 space-y-3">
            {MOCK_ROLES.map((role) => (
              <Link
                key={role.label}
                href={role.href}
                className="flex min-h-[64px] flex-col justify-center rounded-2xl border border-[#E6DFC6] bg-[#FFF8EF] px-4 py-3 transition-colors hover:border-[#E37125]"
              >
                <span className="text-base font-semibold text-[#211F1E]">{role.label}</span>
                <span className="mt-1 text-sm text-[#6E625A]">{role.note}</span>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
