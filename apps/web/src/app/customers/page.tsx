'use client';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { listCustomers, createCustomer, transitionCustomerState, type Customer } from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export default function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const { items } = await listCustomers();
      setCustomers(items);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const filtered = customers.filter(c =>
    search === '' ||
    c.fullName.toLowerCase().includes(search.toLowerCase()) ||
    c.email?.toLowerCase().includes(search.toLowerCase())
  );

  async function handleTransition(id: string, toState: Customer['state']) {
    try {
      const updated = await transitionCustomerState(id, toState);
      setCustomers(prev => prev.map(c => c.id === id ? updated : c));
      toast.success(`Customer updated to ${toState}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Transition failed');
    }
  }

  async function handleCreate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCreating(true);
    const form = new FormData(e.currentTarget);
    const email = form.get('email') as string;
    const firstName = form.get('firstName') as string;
    const lastName = form.get('lastName') as string;
    try {
      const customer = await createCustomer({
        fullName: `${firstName} ${lastName}`.trim(),
        email: email.trim(),
        phone: (form.get('phone') as string) || undefined,
      });
      setCustomers(prev => [customer, ...prev]);
      setShowCreate(false);
      toast.success(`Customer ${customer.fullName} created`);
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Create failed');
    } finally {
      setCreating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description={loading ? '…' : `${customers.length} total`}
        action={
          <Button
            className="bg-yellow-400 hover:bg-yellow-300 text-gray-900"
            onClick={() => setShowCreate(v => !v)}
          >
            {showCreate ? 'Cancel' : '+ New Customer'}
          </Button>
        }
      />

      {showCreate && (
        <Card className="mb-6 max-w-lg">
          <CardHeader><CardTitle className="text-base">New Customer</CardTitle></CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label htmlFor="firstName">First Name <span className="text-red-500">*</span></Label>
                  <Input id="firstName" name="firstName" required />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="lastName">Last Name <span className="text-red-500">*</span></Label>
                  <Input id="lastName" name="lastName" required />
                </div>
              </div>
              <div className="space-y-1">
                <Label htmlFor="email">Email <span className="text-red-500">*</span></Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="space-y-1">
                <Label htmlFor="phone">Phone</Label>
                <Input id="phone" name="phone" type="tel" />
              </div>
              <Button type="submit" disabled={creating} className="bg-yellow-400 hover:bg-yellow-300 text-gray-900 w-full">
                {creating ? 'Creating…' : 'Create Customer'}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      <div className="mb-4">
        <Input
          placeholder="Search name or email…"
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>

      {loading ? (
        <LoadingSkeleton rows={5} cols={4} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="👥"
          title={search ? 'No matches' : 'No customers yet'}
          description={search ? `No customer matches "${search}"` : 'Create your first customer above.'}
        />
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b border-gray-200">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Name</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Email</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filtered.map(c => (
                <tr key={c.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{c.fullName}</td>
                  <td className="px-4 py-3 text-gray-500">{c.email ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">{c.phone ?? '—'}</td>
                  <td className="px-4 py-3"><StatusBadge status={c.state} /></td>
                  <td className="px-4 py-3">
                    {c.state === 'LEAD' && (
                      <Button size="sm" variant="outline" onClick={() => handleTransition(c.id, 'ACTIVE')}>
                        Activate
                      </Button>
                    )}
                    {c.state === 'ACTIVE' && (
                      <Button size="sm" variant="outline" onClick={() => handleTransition(c.id, 'INACTIVE')}>
                        Deactivate
                      </Button>
                    )}
                    {c.state === 'INACTIVE' && (
                      <Button size="sm" variant="outline" onClick={() => handleTransition(c.id, 'ACTIVE')}>
                        Re-activate
                      </Button>
                    )}
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
