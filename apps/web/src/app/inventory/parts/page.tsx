'use client';
import { useEffect, useState } from 'react';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { listParts, type Part } from '@/lib/api-client';
import { Input } from '@/components/ui/input';

export default function PartsPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { listParts().then(r => { setParts(r.items); setLoading(false); }); }, []);

  const filtered = parts.filter(p =>
    search === '' || p.sku.toLowerCase().includes(search.toLowerCase()) || p.name.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div>
      <PageHeader title="Part Lookup" description="Search inventory by SKU or name" />
      <div className="mb-4">
        <Input placeholder="Search SKU or name…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      </div>
      {loading ? <LoadingSkeleton rows={6} cols={5} /> : filtered.length === 0 ? (
        <EmptyState icon="🔍" title="No parts found" description={search ? `No match for "${search}"` : 'No parts in inventory.'} />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">SKU</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">On Hand</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(p => (
                <tr key={p.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700 font-medium">{p.sku}</td>
                  <td className="px-4 py-3 text-gray-900">{p.name}</td>
                  <td className="px-4 py-3"><StatusBadge status={p.partState} /></td>
                  <td className="px-4 py-3">
                    <span className={`font-semibold ${p.quantityOnHand === 0 ? 'text-red-600' : 'text-gray-900'}`}>
                      {p.quantityOnHand === 0 ? '⚠️ Out of stock' : p.quantityOnHand}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-gray-500">{p.location ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
