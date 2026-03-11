'use client';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, EmptyState } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';

interface Relationship { id: string; customerId: string; customerName: string; dealerId: string; dealerName: string; escalationOwner?: string; status: 'ACTIVE' | 'INACTIVE'; }

const MOCK: Relationship[] = [
  { id: 'rel-1', customerId: 'c-2', customerName: 'Riverside Golf Club', dealerId: 'd-1', dealerName: 'East Coast Golf Carts', escalationOwner: 'sales@ecgc.com', status: 'ACTIVE' },
  { id: 'rel-2', customerId: 'c-1', customerName: 'John Smith', dealerId: 'd-2', dealerName: 'Western Cart Co', status: 'ACTIVE' },
];

export default function RelationshipsPage() {
  const [rels, setRels] = useState(MOCK);

  function unlink(id: string) {
    setRels(prev => prev.map(r => r.id === id ? { ...r, status: 'INACTIVE' as const } : r));
    toast.success('Relationship unlinked');
  }

  const active = rels.filter(r => r.status === 'ACTIVE');
  const inactive = rels.filter(r => r.status === 'INACTIVE');

  return (
    <div>
      <PageHeader title="Customer-Dealer Relationships" description="Link customers to dealer context for support and billing"
        action={<Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900" onClick={() => toast.info('Link relationship (coming soon)')}>+ Link</Button>}
      />
      {active.length === 0 ? <EmptyState icon="🔗" title="No active relationships" description="Link a customer to a dealer." /> : (
        <div className="space-y-3">
          {active.map(r => (
            <div key={r.id} className="bg-white rounded-lg border border-gray-200 p-4 flex items-center gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium text-gray-900">{r.customerName}</p>
                <p className="text-xs text-gray-500 mt-0.5">↔ {r.dealerName} {r.escalationOwner && `· Escalation: ${r.escalationOwner}`}</p>
              </div>
              <span className="text-xs bg-green-100 text-green-700 px-2 py-0.5 rounded-full font-medium">Active</span>
              <Button size="sm" variant="outline" onClick={() => unlink(r.id)}>Unlink</Button>
            </div>
          ))}
          {inactive.length > 0 && (
            <div className="mt-4 opacity-50">
              <p className="text-xs font-medium text-gray-400 mb-2">Inactive ({inactive.length})</p>
              {inactive.map(r => (
                <div key={r.id} className="bg-white rounded-lg border border-gray-100 p-3 flex items-center gap-3 mb-2">
                  <div className="flex-1 text-sm text-gray-500">{r.customerName} ↔ {r.dealerName}</div>
                  <Button size="sm" variant="outline" onClick={() => { setRels(prev => prev.map(rel => rel.id === r.id ? { ...rel, status: 'ACTIVE' as const } : rel)); toast.success('Relationship reactivated'); }}>Re-link</Button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
