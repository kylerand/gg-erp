'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface Assignment {
  id: string;
  technicianName: string;
  moduleName: string;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'OVERDUE';
  dueDate: string;
}

const MOCK: Assignment[] = [
  { id: 'a1', technicianName: 'Marcus Johnson', moduleName: 'Battery Pack Handling & Safety', status: 'OVERDUE', dueDate: '2026-03-01' },
  { id: 'a2', technicianName: 'Sarah Kim', moduleName: 'Controller Installation', status: 'IN_PROGRESS', dueDate: '2026-03-20' },
  { id: 'a3', technicianName: 'Marcus Johnson', moduleName: 'QC Inspection Standards', status: 'NOT_STARTED', dueDate: '2026-03-25' },
  { id: 'a4', technicianName: 'Derek Wilson', moduleName: 'Wiring Harness Installation', status: 'COMPLETE', dueDate: '2026-03-10' },
];

const STATUS_CLASSES: Record<Assignment['status'], string> = {
  COMPLETE:    'bg-green-100 text-green-800',
  IN_PROGRESS: 'bg-yellow-100 text-yellow-800',
  NOT_STARTED: 'bg-gray-100 text-gray-600',
  OVERDUE:     'bg-red-100 text-red-800',
};

export default function AssignmentsPage() {
  const [assignments] = useState(MOCK);
  const overdue = assignments.filter(a => a.status === 'OVERDUE');

  return (
    <div>
      <PageHeader
        title="Team Assignments"
        description="Track training progress across your team"
        action={
          <Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900" onClick={() => toast.info('Assign module (coming soon)')}>
            + Assign Module
          </Button>
        }
      />
      {overdue.length > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4">
          <p className="text-sm font-semibold text-red-700 mb-2">⚠️ {overdue.length} overdue assignment{overdue.length > 1 ? 's' : ''}</p>
          {overdue.map(a => (
            <div key={a.id} className="text-xs text-red-600">
              {a.technicianName} — {a.moduleName} (was due {new Date(a.dueDate).toLocaleDateString()})
            </div>
          ))}
        </div>
      )}
      <div className="space-y-2">
        {assignments.map(a => (
          <Card key={a.id}>
            <CardContent className="pt-3 pb-3">
              <div className="flex items-center gap-4">
                <div className="flex-1">
                  <p className="text-sm font-medium text-gray-900">{a.technicianName}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{a.moduleName} · Due {new Date(a.dueDate).toLocaleDateString()}</p>
                </div>
                <span className={`text-xs px-2.5 py-0.5 rounded-full font-medium ${STATUS_CLASSES[a.status]}`}>
                  {a.status.replace('_', ' ')}
                </span>
                <Button size="sm" variant="outline" onClick={() => toast.info('Reassign (coming soon)')}>Reassign</Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
