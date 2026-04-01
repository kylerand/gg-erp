'use client';

import { useAuth } from '@/lib/auth-provider';
import { doSignOut } from '@/lib/auth';
import { useRouter } from 'next/navigation';
import { User, Mail, Shield, LogOut } from 'lucide-react';

export default function ProfilePage() {
  const { user } = useAuth();
  const router = useRouter();

  async function handleSignOut() {
    await doSignOut();
    router.replace('/login');
  }

  if (!user) return null;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl" data-brand-heading="true">
        Profile
      </h1>

      <div className="card p-5">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-primary/10 text-2xl font-bold text-primary">
            {(user.name ?? user.email).charAt(0).toUpperCase()}
          </div>
          <div>
            <div className="text-lg font-semibold">{user.name ?? 'Team Member'}</div>
            <div className="text-sm text-muted-foreground">{user.email}</div>
          </div>
        </div>
      </div>

      <div className="card divide-y divide-border">
        <div className="flex items-center gap-3 px-5 py-4">
          <User size={18} className="text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Name</div>
            <div className="text-sm font-medium">{user.name ?? '—'}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 py-4">
          <Mail size={18} className="text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Email</div>
            <div className="text-sm font-medium">{user.email}</div>
          </div>
        </div>
        <div className="flex items-center gap-3 px-5 py-4">
          <Shield size={18} className="text-muted-foreground" />
          <div className="flex-1">
            <div className="text-xs text-muted-foreground">Role</div>
            <div className="text-sm font-medium capitalize">{user.role}</div>
          </div>
        </div>
      </div>

      <button
        onClick={handleSignOut}
        className="flex w-full items-center justify-center gap-2 rounded-2xl border border-red-200 bg-red-50 py-3 text-sm font-bold text-red-700 transition-colors hover:bg-red-100"
      >
        <LogOut size={16} />
        Sign Out
      </button>
    </div>
  );
}
