'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CalendarDays, CheckCircle2, AlertCircle, Clock } from 'lucide-react';
import { useAuth } from '@/lib/auth-provider';
import { listMyAssignments, type TrainingAssignment } from '@/lib/api-client';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: typeof CheckCircle2 }> = {
  ASSIGNED: { label: 'Assigned', color: 'text-blue-600 bg-blue-50 border-blue-200', icon: CalendarDays },
  IN_PROGRESS: { label: 'In Progress', color: 'text-primary bg-orange-50 border-orange-200', icon: Clock },
  COMPLETED: { label: 'Completed', color: 'text-green-600 bg-green-50 border-green-200', icon: CheckCircle2 },
  FAILED: { label: 'Failed', color: 'text-red-600 bg-red-50 border-red-200', icon: AlertCircle },
  EXEMPT: { label: 'Exempt', color: 'text-gray-600 bg-gray-50 border-gray-200', icon: CheckCircle2 },
  CANCELLED: { label: 'Cancelled', color: 'text-gray-500 bg-gray-50 border-gray-200', icon: AlertCircle },
};

export default function AssignmentsPage() {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    listMyAssignments(user.userId)
      .then((r) => setAssignments(r.items))
      .finally(() => setLoading(false));
  }, [user]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <div className="h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const active = assignments.filter((a) => ['ASSIGNED', 'IN_PROGRESS'].includes(a.assignmentStatus));
  const past = assignments.filter((a) => !['ASSIGNED', 'IN_PROGRESS'].includes(a.assignmentStatus));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl" data-brand-heading="true">
          My Assignments
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Training modules assigned to you by your supervisor.
        </p>
      </div>

      {assignments.length === 0 ? (
        <div className="card p-8 text-center">
          <CalendarDays size={32} className="mx-auto text-muted-foreground" />
          <p className="mt-3 text-sm text-muted-foreground">No assignments yet.</p>
        </div>
      ) : (
        <>
          {active.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Active ({active.length})
              </h2>
              <div className="space-y-2">
                {active.map((a) => (
                  <AssignmentCard key={a.id} assignment={a} />
                ))}
              </div>
            </div>
          )}

          {past.length > 0 && (
            <div>
              <h2 className="mb-3 text-sm font-bold uppercase tracking-wider text-muted-foreground">
                Completed ({past.length})
              </h2>
              <div className="space-y-2">
                {past.map((a) => (
                  <AssignmentCard key={a.id} assignment={a} />
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AssignmentCard({ assignment: a }: { assignment: TrainingAssignment }) {
  const config = STATUS_CONFIG[a.assignmentStatus] ?? STATUS_CONFIG.ASSIGNED;
  const Icon = config.icon;

  return (
    <Link href={`/modules/${a.moduleId}`}>
      <div className={`card p-4 transition-shadow hover:shadow-md`}>
        <div className="flex items-start gap-3">
          <Icon size={20} className={`mt-0.5 flex-shrink-0 ${config.color.split(' ')[0]}`} />
          <div className="min-w-0 flex-1">
            <div className="font-medium text-foreground">
              {a.module?.moduleName ?? `Module ${a.moduleId}`}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${config.color}`}>
                {config.label}
              </span>
              {a.dueAt && (
                <span>
                  Due: {new Date(a.dueAt).toLocaleDateString()}
                </span>
              )}
              {a.score !== undefined && a.score !== null && (
                <span>Score: {a.score}%</span>
              )}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}
