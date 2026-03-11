import type { ReactNode } from 'react';

const VARIANT_CLASSES: Record<string, string> = {
  PLANNED: 'bg-blue-100 text-blue-800 border-blue-200',
  RELEASED: 'bg-purple-100 text-purple-800 border-purple-200',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  BLOCKED: 'bg-red-100 text-red-800 border-red-200',
  COMPLETED: 'bg-green-100 text-green-800 border-green-200',
  CANCELLED: 'bg-gray-100 text-gray-600 border-gray-200',
  PENDING: 'bg-slate-100 text-slate-700 border-slate-200',
  SYNCED: 'bg-green-100 text-green-800 border-green-200',
  FAILED: 'bg-red-100 text-red-800 border-red-200',
  ACTIVE: 'bg-green-100 text-green-800 border-green-200',
  INACTIVE: 'bg-gray-100 text-gray-600 border-gray-200',
  LEAD: 'bg-blue-100 text-blue-800 border-blue-200',
};

const LABEL_MAP: Record<string, string> = {
  IN_PROGRESS: 'In Progress',
  PLANNED: 'Planned',
  RELEASED: 'Released',
  BLOCKED: 'Blocked',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  PENDING: 'Pending',
  SYNCED: 'Synced',
  FAILED: 'Failed',
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  LEAD: 'Lead',
};

export function StatusBadge({ status, children }: { status: string; children?: ReactNode }) {
  const classes = VARIANT_CLASSES[status] ?? 'bg-gray-100 text-gray-600 border-gray-200';
  const label = children ?? LABEL_MAP[status] ?? status.replace(/_/g, ' ');
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${classes}`}>
      {label}
    </span>
  );
}
