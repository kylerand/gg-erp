'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { listDealers, type Dealer } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function DealersPage() {
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => { listDealers().then(d => { setDealers(d); setLoading(false); }); }, []);

  const filtered = dealers.filter(d =>
    search === '' || d.name.toLowerCase().includes(search.toLowerCase()) || d.territory?.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader title="Dealers" description={`${dealers.length} dealers`}
        action={<Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900" onClick={() => toast.info('Add dealer (coming soon)')}>+ Add Dealer</Button>}
      />
      <div className="mb-4">
        <Input placeholder="Search name or territory…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      </div>
      {loading ? <LoadingSkeleton rows={3} cols={4} /> : filtered.length === 0 ? (
        <EmptyState icon="🤝" title="No dealers found" description="Add your first dealer." />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Contact</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Territory</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Relationship</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(d => (
                <tr key={d.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{d.name}</td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{d.contactEmail ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{d.territory ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={d.serviceRelationship} /></td>
                  <td className="px-4 py-3">
                    <Button size="sm" variant="outline" onClick={() => toast.info(`Edit ${d.name} (coming soon)`)}>Edit</Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
