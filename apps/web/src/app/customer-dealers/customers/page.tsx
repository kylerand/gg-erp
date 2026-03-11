'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { listCustomers, type Customer } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => { listCustomers().then(r => { setCustomers(r.items); setLoading(false); }); }, []);

  const filtered = customers.filter(c =>
    search === '' || c.fullName.toLowerCase().includes(search.toLowerCase()) || c.email?.toLowerCase().includes(search.toLowerCase())
  );

  function transition(id: string, toState: Customer['state']) {
    setCustomers(prev => prev.map(c => c.id === id ? { ...c, state: toState } : c));
    toast.success(`Customer lifecycle updated to ${toState}`);
  }

  return (
    <div>
      <PageHeader title="Customers" description={`${customers.length} total`}
        action={<Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900" onClick={() => toast.info('Create customer (coming soon)')}>+ New Customer</Button>}
      />
      <div className="mb-4">
        <Input placeholder="Search name or email…" value={search} onChange={e => setSearch(e.target.value)} className="max-w-sm" />
      </div>
      {loading ? <LoadingSkeleton rows={5} cols={4} /> : filtered.length === 0 ? (
        <EmptyState icon="👥" title="No customers" description={search ? `No match for "${search}"` : 'Add your first customer.'} />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.fullName}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.state} /></td>
                  <td className="px-4 py-3">
                    {c.state === 'LEAD' && <Button size="sm" variant="outline" onClick={() => transition(c.id, 'ACTIVE')}>Activate</Button>}
                    {c.state === 'ACTIVE' && <Button size="sm" variant="outline" onClick={() => transition(c.id, 'INACTIVE')}>Deactivate</Button>}
                    {c.state === 'INACTIVE' && <Button size="sm" variant="outline" onClick={() => transition(c.id, 'ACTIVE')}>Re-activate</Button>}
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
