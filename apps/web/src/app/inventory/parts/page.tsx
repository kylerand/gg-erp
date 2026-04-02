'use client';
import { useEffect, useState, useCallback } from 'react';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { listParts, type Part } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';

const PAGE_SIZE = 25;

export default function PartsPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: string, p: number, ps: number) => {
    setLoading(true);
    try {
      const r = await listParts({ search: s || undefined, limit: ps, offset: (p - 1) * ps });
      setParts(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void load(search, page, pageSize), 300);
    return () => clearTimeout(timeout);
  }, [search, page, pageSize, load]);

  // Reset to page 1 when search changes
  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  return (
    <div>
      <PageHeader title="Part Lookup" description={`${total} parts total`} />
      <div className="mb-4">
        <Input placeholder="Search SKU or name…" value={search} onChange={e => handleSearch(e.target.value)} className="max-w-sm" />
      </div>
      {loading ? <LoadingSkeleton rows={6} cols={5} /> : parts.length === 0 ? (
        <EmptyState icon="🔍" title="No parts found" description={search ? `No match for "${search}"` : 'No parts in inventory.'} />
      ) : (
        <>
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
                {parts.map(p => (
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
          <Pagination page={page} pageSize={pageSize} total={total} onPageChange={setPage} onPageSizeChange={ps => { setPageSize(ps); setPage(1); }} />
        </>
      )}
    </div>
  );
}
