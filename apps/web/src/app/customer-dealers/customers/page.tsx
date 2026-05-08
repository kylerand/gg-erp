'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { listCustomers, transitionCustomerState, type Customer } from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';

const PAGE_SIZE = 25;

export default function CustomersPage() {
  const searchParams = useSearchParams();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState(searchParams.get('search') ?? '');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (s: string, p: number, ps: number) => {
    setLoading(true);
    try {
      const r = await listCustomers(
        { search: s || undefined, limit: ps, offset: (p - 1) * ps },
        { allowMockFallback: false },
      );
      setCustomers(r.items);
      setTotal(r.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void load(search, page, pageSize), 300);
    return () => clearTimeout(timeout);
  }, [search, page, pageSize, load]);

  function handleSearch(value: string) {
    setSearch(value);
    setPage(1);
  }

  async function transition(id: string, toState: Customer['state']) {
    try {
      const updated = await transitionCustomerState(id, toState);
      setCustomers((prev) => prev.map((c) => (c.id === id ? updated : c)));
      toast.success(`Customer lifecycle updated to ${toState}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Customer lifecycle update failed');
    }
  }

  return (
    <div>
      <PageHeader
        title="Customers"
        description={`${total} total`}
        action={
          <Link href={erpRoute('create-customer')}>
            <Button className="bg-yellow-400 hover:bg-yellow-300 text-gray-900">
              + New Customer
            </Button>
          </Link>
        }
      />
      <div className="mb-4">
        <Input
          placeholder="Search name or email…"
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          className="max-w-sm"
        />
      </div>
      {loading ? (
        <LoadingSkeleton rows={5} cols={4} />
      ) : customers.length === 0 ? (
        <EmptyState
          icon="👥"
          title="No customers"
          description={search ? `No match for "${search}"` : 'Add your first customer.'}
        />
      ) : (
        <>
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
                {customers.map((c) => (
                  <tr key={c.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3 font-medium text-gray-900">{c.fullName}</td>
                    <td className="px-4 py-3 text-gray-500">{c.email ?? '—'}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.state} />
                    </td>
                    <td className="px-4 py-3">
                      {c.state === 'LEAD' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void transition(c.id, 'ACTIVE')}
                        >
                          Activate
                        </Button>
                      )}
                      {c.state === 'ACTIVE' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void transition(c.id, 'INACTIVE')}
                        >
                          Deactivate
                        </Button>
                      )}
                      {c.state === 'INACTIVE' && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void transition(c.id, 'ACTIVE')}
                        >
                          Re-activate
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pagination
            page={page}
            pageSize={pageSize}
            total={total}
            onPageChange={setPage}
            onPageSizeChange={(ps) => {
              setPageSize(ps);
              setPage(1);
            }}
          />
        </>
      )}
    </div>
  );
}
