'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface OJTModule {
  id: string;
  title: string;
  category: string;
  totalSteps: number;
  completedSteps: number;
  status: 'NOT_STARTED' | 'IN_PROGRESS' | 'COMPLETE' | 'OVERDUE';
  dueDate?: string;
}

const MOCK_MODULES: OJTModule[] = [
  { id: 'm1', title: 'Battery Pack Handling & Safety', category: 'Safety', totalSteps: 8, completedSteps: 8, status: 'COMPLETE' },
  { id: 'm2', title: 'Controller Installation Procedure', category: 'Technical', totalSteps: 12, completedSteps: 7, status: 'IN_PROGRESS', dueDate: '2026-03-20' },
  { id: 'm3', title: 'QC Inspection Standards', category: 'Quality', totalSteps: 6, completedSteps: 0, status: 'NOT_STARTED', dueDate: '2026-03-25' },
  { id: 'm4', title: 'Wiring Harness Installation', category: 'Technical', totalSteps: 10, completedSteps: 2, status: 'OVERDUE', dueDate: '2026-03-05' },
];

const STATUS_CONFIG: Record<OJTModule['status'], { label: string; classes: string; icon: string }> = {
  COMPLETE:    { label: 'Complete',    classes: 'bg-green-100 text-green-800',   icon: '✅' },
  IN_PROGRESS: { label: 'In Progress', classes: 'bg-yellow-100 text-yellow-800', icon: '🔄' },
  NOT_STARTED: { label: 'Not Started', classes: 'bg-gray-100 text-gray-600',     icon: '⏳' },
  OVERDUE:     { label: 'Overdue',     classes: 'bg-red-100 text-red-800',       icon: '⚠️' },
};

export default function MyOJTPage() {
  const [modules] = useState(MOCK_MODULES);
  const completed = modules.filter(m => m.status === 'COMPLETE').length;
  const overdue = modules.filter(m => m.status === 'OVERDUE').length;

  return (
    <div>
      <PageHeader title="My OJT" description={`${completed}/${modules.length} modules complete`} />
      {overdue > 0 && (
        <div className="mb-6 bg-red-50 border border-red-200 rounded-lg p-4 flex items-center gap-3">
          <span className="text-red-500 text-lg">⚠️</span>
          <p className="text-sm text-red-700 font-medium">{overdue} overdue module{overdue > 1 ? 's' : ''} — complete as soon as possible</p>
        </div>
      )}
      <div className="space-y-3">
        {modules.map(m => {
          const cfg = STATUS_CONFIG[m.status];
          const pct = Math.round((m.completedSteps / m.totalSteps) * 100);
          return (
            <Card key={m.id} className={m.status === 'OVERDUE' ? 'border-red-300' : ''}>
              <CardContent className="pt-4">
                <div className="flex items-start gap-3">
                  <span className="text-lg mt-0.5">{cfg.icon}</span>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${cfg.classes}`}>{cfg.label}</span>
                      <span className="text-xs text-gray-400">{m.category}</span>
                      {m.dueDate && (
                        <span className={`text-xs ${m.status === 'OVERDUE' ? 'text-red-600 font-semibold' : 'text-gray-400'}`}>
                          Due {new Date(m.dueDate).toLocaleDateString()}
                        </span>
                      )}
                    </div>
                    <p className="text-sm font-semibold text-gray-900">{m.title}</p>
                    {m.status !== 'COMPLETE' && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>{m.completedSteps}/{m.totalSteps} steps</span>
                          <span>{pct}%</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                          <div className="bg-yellow-400 h-1.5 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                    )}
                  </div>
                  {m.status !== 'COMPLETE' && (
                    <Button size="sm" variant="outline" onClick={() => toast.info(`Opening ${m.title}…`)}>
                      {m.status === 'NOT_STARTED' ? 'Start' : 'Continue'}
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
