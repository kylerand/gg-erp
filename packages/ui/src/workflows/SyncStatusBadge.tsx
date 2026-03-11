export type SyncStatus = 'PENDING' | 'IN_PROGRESS' | 'SYNCED' | 'FAILED' | 'RETRY';

const CONFIG: Record<SyncStatus, { icon: string; label: string; classes: string }> = {
  PENDING:     { icon: '⏳', label: 'Pending',     classes: 'bg-slate-100 text-slate-700 border-slate-200' },
  IN_PROGRESS: { icon: '🔄', label: 'Syncing',     classes: 'bg-blue-100 text-blue-700 border-blue-200' },
  SYNCED:      { icon: '✅', label: 'Synced',      classes: 'bg-green-100 text-green-700 border-green-200' },
  FAILED:      { icon: '❌', label: 'Failed',      classes: 'bg-red-100 text-red-700 border-red-200' },
  RETRY:       { icon: '🔁', label: 'Retry queued', classes: 'bg-amber-100 text-amber-700 border-amber-200' },
};

export function SyncStatusBadge({ status }: { status: SyncStatus }) {
  const cfg = CONFIG[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border ${cfg.classes}`}>
      <span aria-hidden>{cfg.icon}</span>
      <span>{cfg.label}</span>
    </span>
  );
}
