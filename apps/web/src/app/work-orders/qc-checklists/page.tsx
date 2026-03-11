'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';

interface QCItem { id: string; label: string; critical: boolean; result: 'pass' | 'fail' | 'na' | null; }

const INITIAL: QCItem[] = [
  { id: 'q1', label: 'Brake function test — both wheels stop within 10ft at 10mph', critical: true, result: null },
  { id: 'q2', label: 'Battery voltage within spec (±2V of rated)', critical: true, result: null },
  { id: 'q3', label: 'All connectors seated and latched', critical: false, result: null },
  { id: 'q4', label: 'Wiring harness routed without pinch points', critical: false, result: null },
  { id: 'q5', label: 'Controller firmware version confirmed', critical: false, result: null },
  { id: 'q6', label: 'Test drive completed — 5 lap minimum', critical: true, result: null },
];

export default function QCChecklistsPage() {
  const [items, setItems] = useState(INITIAL);
  const [submitted, setSubmitted] = useState(false);

  function setResult(id: string, result: QCItem['result']) {
    const item = items.find(i => i.id === id);
    setItems(prev => prev.map(i => i.id === id ? { ...i, result } : i));
    if (result === 'fail' && item?.critical) {
      toast.error('Critical failure — work order blocked until resolved', { duration: 5000 });
    }
  }

  function submit() {
    const pending = items.filter(i => i.result === null && i.critical);
    if (pending.length > 0) { toast.error('All critical items must be completed before submitting'); return; }
    const failures = items.filter(i => i.result === 'fail' && i.critical);
    if (failures.length > 0) { toast.error('Critical failures must be resolved before QC sign-off'); return; }
    setSubmitted(true);
    toast.success('QC checklist submitted — work order approved');
  }

  const RESULT_CLASSES: Record<string, string> = {
    pass: 'bg-green-600 text-white',
    fail: 'bg-red-600 text-white',
    na: 'bg-gray-400 text-white',
  };

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeader title="QC Checklist" description="WO-002 · Full Cart Restoration" />
      {submitted ? (
        <Card className="border-green-400"><CardContent className="pt-6 text-center"><div className="text-4xl mb-2">✅</div><p className="font-semibold text-green-700">QC Approved</p></CardContent></Card>
      ) : (
        <>
          <div className="space-y-3">
            {items.map(item => (
              <Card key={item.id} className={item.result === 'fail' && item.critical ? 'border-red-400' : ''}>
                <CardContent className="pt-4">
                  <div className="flex items-start gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-1">
                        {item.critical && <span className="text-xs bg-red-100 text-red-700 font-medium px-1.5 py-0.5 rounded">Critical</span>}
                      </div>
                      <p className="text-sm text-gray-900">{item.label}</p>
                    </div>
                    <div className="flex gap-1.5">
                      {(['pass', 'fail', 'na'] as const).map(r => (
                        <button key={r} onClick={() => setResult(item.id, r)}
                          className={`text-xs px-2.5 py-1 rounded font-medium border transition-colors ${item.result === r ? RESULT_CLASSES[r] : 'border-gray-300 text-gray-500 hover:border-gray-400'}`}>
                          {r.toUpperCase()}
                        </button>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
          <Button onClick={submit} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 font-semibold">Submit QC Sign-Off</Button>
        </>
      )}
    </div>
  );
}
