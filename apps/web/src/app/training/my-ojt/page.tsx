'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listMyAssignments, completeAssignment, type TrainingAssignment } from '@/lib/api-client';

// Placeholder — in production, get from Cognito session. Using a fixed dev ID here.
const CURRENT_EMPLOYEE_ID = 'current-user';

type DisplayStatus = 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'OVERDUE' | 'FAILED';

const STATUS_CONFIG: Record<DisplayStatus, { label: string; classes: string; icon: string }> = {
  COMPLETE:    { label: 'Complete',    classes: 'bg-green-100 text-green-800',   icon: '✅' },
  IN_PROGRESS: { label: 'In Progress', classes: 'bg-yellow-100 text-yellow-800', icon: '🔄' },
  NOT_STARTED: { label: 'Not Started', classes: 'bg-gray-100 text-gray-600',     icon: '⏳' },
  OVERDUE:     { label: 'Overdue',     classes: 'bg-red-100 text-red-800',       icon: '⚠️' },
  FAILED:      { label: 'Failed',      classes: 'bg-red-100 text-red-800',       icon: '❌' },
};

function toDisplayStatus(a: TrainingAssignment): DisplayStatus {
  if (a.assignmentStatus === 'COMPLETED') return 'COMPLETE';
  if (a.assignmentStatus === 'FAILED') return 'FAILED';
  if (a.assignmentStatus === 'IN_PROGRESS') return 'IN_PROGRESS';
  if (a.dueAt && new Date(a.dueAt) < new Date()) return 'OVERDUE';
  return 'NOT_STARTED';
}

export default function MyOJTPage() {
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [completing, setCompleting] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const res = await listMyAssignments(CURRENT_EMPLOYEE_ID);
      setAssignments(res.items);
    } catch {
      toast.error('Failed to load training assignments');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function handleComplete(id: string) {
    setCompleting(id);
    try {
      const updated = await completeAssignment(id);
      setAssignments(prev => prev.map(a => a.id === id ? updated : a));
      toast.success('Module marked complete');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete module');
    } finally {
      setCompleting(null);
    }
  }

  const completed = assignments.filter(a => a.assignmentStatus === 'COMPLETED').length;
  const overdue = assignments.filter(a => toDisplayStatus(a) === 'OVERDUE').length;

  if (loading) {
    return (
      <div>
        <PageHeader title="My OJT" description="Loading…" />
        <div className="space-y-3">{[1,2,3].map(i => <div key={i} className="h-24 bg-gray-100 rounded-lg animate-pulse" />)}</div>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="My OJT" description={`${completed}/${assignments.length} modules complete`} />
      {overdue > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <span className="text-red-500 text-lg">⚠️</span>
          <p className="text-sm text-red-700 font-medium">{overdue} overdue module{overdue > 1 ? 's' : ''} — complete as soon as possible</p>
        </div>
      )}
      {assignments.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-1">No training assignments</p>
          <p className="text-sm">Check with your manager to get modules assigned.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {assignments.map(a => {
            const displayStatus = toDisplayStatus(a);
            const cfg = STATUS_CONFIG[displayStatus];
            const moduleName = a.module?.moduleName ?? a.moduleId;
            const isCompleted = a.assignmentStatus === 'COMPLETED' || a.assignmentStatus === 'FAILED';
            return (
              <Card key={a.id} className={displayStatus === 'OVERDUE' ? 'border-red-300' : ''}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <span className="text-lg mt-0.5">{cfg.icon}</span>
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.classes}`}>{cfg.label}</span>
                        {a.module?.sopDocument && (
                          <span className="text-xs text-gray-400">{a.module.sopDocument.documentCode}</span>
                        )}
                        {a.dueAt && (
                          <span className={`text-xs ${displayStatus === 'OVERDUE' ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                            Due {new Date(a.dueAt).toLocaleDateString()}
                          </span>
                        )}
                        {a.module?.isRequired && (
                          <span className="text-xs bg-blue-50 text-blue-600 px-1.5 py-0.5 rounded">Required</span>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900">{moduleName}</p>
                      {a.score !== undefined && (
                        <p className="text-xs text-gray-500 mt-0.5">
                          Score: {a.score}
                          {a.module?.passScore ? ` / ${a.module.passScore} required` : ''}
                        </p>
                      )}
                      {a.completedAt && (
                        <p className="text-xs text-gray-400 mt-0.5">Completed {new Date(a.completedAt).toLocaleDateString()}</p>
                      )}
                    </div>
                    {!isCompleted && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={completing === a.id}
                        onClick={() => handleComplete(a.id)}
                      >
                        {completing === a.id ? 'Saving…' : displayStatus === 'NOT_STARTED' ? 'Start' : 'Complete'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
