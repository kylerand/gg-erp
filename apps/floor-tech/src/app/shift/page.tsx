'use client';

import { useState } from 'react';

export default function ShiftPage() {
  const [clockedIn, setClockedIn] = useState(true);
  const [status, setStatus] = useState<'Available' | 'On break' | 'Needs help'>('Available');

  return (
    <div className="space-y-4">
      <section className="tech-card p-5">
        <div className="text-xs font-semibold uppercase tracking-[0.18em] text-[#8A4A18]">Shift status</div>
        <h1 className="mt-2 text-4xl text-[#211F1E]" data-brand-heading="true">Keep the floor updated</h1>
        <p className="mt-2 text-sm text-[#6E625A]">Clock in/out, change availability, and make the shared tablet obvious for the next person.</p>

        <div className="mt-5 rounded-[1.5rem] bg-[#211F1E] p-5 text-white">
          <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[#F9F8D1]">Current state</div>
          <div className="mt-2 text-3xl font-bold">{clockedIn ? 'Clocked In' : 'Clocked Out'}</div>
          <div className="mt-2 text-sm text-white/70">Bay 2 · Shared floor tablet · Updated just now</div>
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => setClockedIn((value) => !value)}
            className={`tech-button w-full ${clockedIn ? 'bg-[#E37125] text-white' : 'bg-[#211F1E] text-white'}`}
          >
            {clockedIn ? 'Clock out' : 'Clock in'}
          </button>
          <button type="button" className="tech-button w-full border border-[#D9CCBE] bg-white text-[#211F1E]">
            Switch device user
          </button>
        </div>
      </section>

      <section className="tech-card p-5">
        <h2 className="text-2xl text-[#211F1E]" data-brand-heading="true">Availability</h2>
        <div className="mt-4 grid gap-3">
          {(['Available', 'On break', 'Needs help'] as const).map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatus(value)}
              className={`flex min-h-[60px] items-center justify-between rounded-2xl border px-4 text-left ${
                status === value ? 'border-[#E37125] bg-[#FFF3E8]' : 'border-[#E6DFC6] bg-white'
              }`}
            >
              <span className="text-base font-semibold text-[#211F1E]">{value}</span>
              <span className={`h-3 w-3 rounded-full ${status === value ? 'bg-[#E37125]' : 'bg-[#D9CCBE]'}`} />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
