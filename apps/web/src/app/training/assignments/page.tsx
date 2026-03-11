'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { listMyAssignments, type TrainingAssignment } from '@/lib/api-client';

const STATUS_CLASSES: Record<string, string> = {
  COMPLETED:   'bg-green-100 text-green-800',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  ASSIGNED:    'bg-gray-100 text-gray-600',
  FAILED:      'bg-red-100 text-red-800',
  CANCELLED:   'bg-gray-100 text-gray-400',
  EXEMPT:      'bg-blue-50 text-blue-600',
};

function isOverdue(a: TrainingAssignment): boolean {
  return (
    !['COMPLETED', 'CANCELLED', 'EXEMPT'].includes(a.assignmentStatus) &&
    !!a.dueAt &&
    new Date(a.dueAt) < new Date()
  );
}

export default function AssignmentsPage() {
  const [assignments, setAssignments] = useState<TrainingAssignment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Load all team assignments — using empty string to get all
    listMyAssignments('', {})
      .then(res => setAssignments(res.items))
      .catch(() => toast.error('Failed to load assignments'))
      .finally(() => setLoading(false));
  }, []);

  const overdue = assignments.filter(isOverdue);

  return (
    <div>
      <PageHeader
        title="Team Assignments"
        description="Track training progress across your team"
        action={
          <Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900" onClick={() => toast.info('Assign module — coming soon')}>
            + Assign Module
          </Button>
        }
      />

      {loading ? (
        <div className="space-y-2">{[1,2,3].map(i => <div key={i} className="h-14 bg-gray-100 rounded animate-pulse" />)}</div>
      ) : (
        <>
          {overdue.length > 0 && (
            <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-sm font-semibold text-red-700 mb-2">⚠️ {overdue.length} overdue assignment{overdue.length > 1 ? 's' : ''}</p>
              {overdue.map(a => (
                <div key={a.id} className="text-xs text-red-600">
                  {a.employeeId} — {a.module?.moduleName ?? a.moduleId}
                  {a.dueAt ? ` (was due ${new Date(a.dueAt).toLocaleDateString()})` : ''}
                </div>
              ))}
            </div>
          )}

          {assignments.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <p className="text-lg mb-1">No assignments found</p>
              <p className="text-sm">Assign modules to team members to track their progress.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {assignments.map(a => (
                <Card key={a.id}>
                  <CardContent className="pt-3 pb-3">
                    <div className="flex items-center gap-4">
                      <div className="flex-1">
                        <p className="text-sm font-medium text-gray-900">{a.employeeId}</p>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {a.module?.moduleName ?? a.moduleId}
                          {a.dueAt ? ` · Due ${new Date(a.dueAt).toLocaleDateString()}` : ''}
                        </p>
                      </div>
                      {a.score !== undefined && (
                        <span className="text-xs text-gray-500">Score: {a.score}</span>
                      )}
                      <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[a.assignmentStatus] ?? 'bg-gray-100 text-gray-500'}`}>
                        {a.assignmentStatus.replace('_', ' ')}
                      </span>
                      <Button size="sm" variant="outline" onClick={() => toast.info('Reassign — coming soon')}>Reassign</Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
