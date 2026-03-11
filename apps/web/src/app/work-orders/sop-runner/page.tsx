'use client';
import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface SOPStep {
  id: string;
  order: number;
  title: string;
  description: string;
  requiresEvidence: boolean;
  status: 'pending' | 'in_progress' | 'complete' | 'failed';
}

const MOCK_STEPS: SOPStep[] = [
  { id: 's1', order: 1, title: 'Safety inspection', description: 'Inspect vehicle for damage, check brake condition, inspect wiring.', requiresEvidence: true, status: 'complete' },
  { id: 's2', order: 2, title: 'Battery disconnect', description: 'Disconnect main battery pack. Verify 0V across terminals.', requiresEvidence: false, status: 'in_progress' },
  { id: 's3', order: 3, title: 'Motor removal', description: 'Remove drive motor assembly. Label all connectors.', requiresEvidence: true, status: 'pending' },
  { id: 's4', order: 4, title: 'Controller swap', description: 'Install new controller. Verify pinout against wiring diagram.', requiresEvidence: false, status: 'pending' },
  { id: 's5', order: 5, title: 'QC sign-off', description: 'Run QC checklist. Record test results.', requiresEvidence: true, status: 'pending' },
];

const STATUS_ICON: Record<SOPStep['status'], string> = {
  complete: '✅', in_progress: '🔄', pending: '⏳', failed: '❌',
};

export default function SOPRunnerPage() {
  const [steps, setSteps] = useState(MOCK_STEPS);
  const [timeRunning, setTimeRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (timeRunning) {
      intervalRef.current = setInterval(() => setElapsed(e => e + 1), 1000);
    } else if (intervalRef.current) {
      clearInterval(intervalRef.current);
    }
    return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
  }, [timeRunning]);

  function completeStep(id: string) {
    const step = steps.find(s => s.id === id);
    setSteps(prev => {
      const updated = prev.map(s => s.id === id ? { ...s, status: 'complete' as const } : s);
      const completedIdx = updated.findIndex(s => s.id === id);
      return updated.map((s, i) => i === completedIdx + 1 && s.status === 'pending' ? { ...s, status: 'in_progress' as const } : s);
    });
    if (step?.requiresEvidence) {
      toast.info('Evidence required — attach photo before submitting');
    } else {
      toast.success('Step completed');
    }
  }

  function toggleTimer() {
    setTimeRunning(r => !r);
    toast.info(timeRunning ? 'Timer paused' : 'Timer started');
  }

  const completedCount = steps.filter(s => s.status === 'complete').length;
  const progress = Math.round((completedCount / steps.length) * 100);

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="SOP Runner" description="WO-002 · Full Cart Restoration" />

      {/* Progress */}
      <Card>
        <CardContent className="pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm text-gray-600">{completedCount}/{steps.length} steps</span>
            <span className="text-sm font-semibold text-gray-900">{progress}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div className="bg-yellow-400 h-2 rounded-full transition-all" style={{ width: `${progress}%` }} />
          </div>
        </CardContent>
      </Card>

      {/* Timer */}
      <Card>
        <CardHeader><CardTitle className="text-sm">Time Logging</CardTitle></CardHeader>
        <CardContent className="flex items-center gap-4">
          <div className="font-mono text-2xl text-gray-900">{String(Math.floor(elapsed / 60)).padStart(2,'0')}:{String(elapsed % 60).padStart(2,'0')}</div>
          <Button variant={timeRunning ? 'outline' : 'default'} size="sm" onClick={toggleTimer} className={timeRunning ? '' : 'bg-yellow-400 hover:bg-yellow-300 text-gray-900'}>
            {timeRunning ? '⏸ Pause' : '▶ Start'}
          </Button>
          {elapsed > 0 && <Button variant="outline" size="sm" onClick={() => toast.success('Labor time logged')}>Log Time</Button>}
        </CardContent>
      </Card>

      {/* Steps */}
      <div className="space-y-3">
        {steps.map(step => (
          <Card key={step.id} className={step.status === 'in_progress' ? 'border-yellow-400' : ''}>
            <CardContent className="pt-4">
              <div className="flex items-start gap-3">
                <span className="text-lg mt-0.5">{STATUS_ICON[step.status]}</span>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-gray-400">Step {step.order}</span>
                    {step.requiresEvidence && <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded">Evidence required</span>}
                  </div>
                  <p className="text-sm font-semibold text-gray-900 mt-0.5">{step.title}</p>
                  <p className="text-xs text-gray-500 mt-1">{step.description}</p>
                </div>
                {step.status === 'in_progress' && (
                  <Button size="sm" onClick={() => completeStep(step.id)} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900">
                    Complete
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
