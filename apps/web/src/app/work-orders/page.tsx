'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { listWoOrders, type WoOrder } from '@/lib/api-client';
import { PageHeader, StatusBadge, LoadingSkeleton } from '@gg-erp/ui';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Pagination } from '@/components/ui/pagination';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

const PAGE_SIZE = 25;
const STATUS_FILTERS: Array<{ label: string; value: WoOrder['status'] | 'ALL' }> = [
  { label: 'All', value: 'ALL' },
  { label: 'Ready', value: 'READY' },
  { label: 'Scheduled', value: 'SCHEDULED' },
  { label: 'In Progress', value: 'IN_PROGRESS' },
  { label: 'Blocked', value: 'BLOCKED' },
  { label: 'Completed', value: 'COMPLETED' },
];

function parseStatus(value: string | null): WoOrder['status'] | undefined {
  return STATUS_FILTERS.some((filter) => filter.value === value && value !== 'ALL')
    ? (value as WoOrder['status'])
    : undefined;
}

export default function WorkOrdersPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeStatus = parseStatus(searchParams.get('status'));
  const activeSearch = searchParams.get('search') ?? '';
  const [items, setItems] = useState<WoOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [searchText, setSearchText] = useState(activeSearch);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({ ALL: 0 });

  const load = useCallback(
    async (p: number, ps: number, status?: WoOrder['status'], search?: string) => {
      setLoading(true);
      try {
        const r = await listWoOrders({
          status,
          search: search || undefined,
          limit: ps,
          offset: (p - 1) * ps,
        });
        setItems(r.items);
        setTotal(r.total);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  const loadCounts = useCallback(async () => {
    const countEntries = await Promise.all(
      STATUS_FILTERS.map(async (filter) => {
        const response = await listWoOrders({
          status: filter.value === 'ALL' ? undefined : filter.value,
          limit: 1,
          offset: 0,
        });
        return [filter.value, response.total] as const;
      }),
    );
    setStatusCounts(Object.fromEntries(countEntries));
  }, []);

  useEffect(() => {
    setSearchText(activeSearch);
  }, [activeSearch]);
  useEffect(() => {
    setPage(1);
  }, [activeSearch, activeStatus]);
  useEffect(() => {
    void load(page, pageSize, activeStatus, activeSearch);
  }, [activeSearch, activeStatus, page, pageSize, load]);
  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  function buildFilterHref(status?: WoOrder['status'], search = activeSearch): string {
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (search.trim()) params.set('search', search.trim());
    const qs = params.toString();
    const baseRoute = erpRoute('work-order');
    return qs ? `${baseRoute}?${qs}` : baseRoute;
  }

  function applySearch(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildFilterHref(activeStatus, searchText));
  }

  const blocked = items.filter((w) => w.status === 'BLOCKED').length;
  const inProgress = items.filter((w) => w.status === 'IN_PROGRESS').length;

  return (
    <div>
      <PageHeader title="Work Orders" description={`${total} total`} />

      <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
        {[
          {
            label: 'In Progress',
            value: statusCounts.IN_PROGRESS ?? inProgress,
            color: 'text-yellow-700',
            href: buildFilterHref('IN_PROGRESS', ''),
          },
          {
            label: 'Blocked',
            value: statusCounts.BLOCKED ?? blocked,
            color: 'text-red-600',
            href: buildFilterHref('BLOCKED', ''),
          },
          {
            label: 'Total',
            value: statusCounts.ALL ?? total,
            color: 'text-gray-700',
            href: erpRoute('work-order'),
          },
          {
            label: 'Dispatch',
            value: '—',
            color: 'text-purple-700',
            href: erpRoute('dispatch-board'),
          },
        ].map((stat) => (
          <Link
            key={stat.label}
            href={stat.href}
            className="bg-white rounded-lg border border-gray-200 p-4 hover:border-yellow-400 transition-colors"
          >
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
          </Link>
        ))}
      </div>

      <WorkspaceLinkGrid moduleKey="work-orders" />

      <div className="mt-8">
        <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-sm font-semibold text-gray-700">Work Order List</h2>
            <p className="mt-1 text-xs text-gray-500">
              {activeStatus ? `${activeStatus.replace(/_/g, ' ')} status` : 'All statuses'}
              {activeSearch ? ` matching "${activeSearch}"` : ''}
            </p>
          </div>
          <form onSubmit={applySearch} className="flex w-full gap-2 lg:max-w-md">
            <Input
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search WO #, title, customer, cart..."
              className="h-9"
            />
            <Button type="submit" className="h-9 bg-yellow-400 text-gray-900 hover:bg-yellow-300">
              Search
            </Button>
          </form>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          {STATUS_FILTERS.map((filter) => {
            const status = filter.value === 'ALL' ? undefined : filter.value;
            const active =
              (filter.value === 'ALL' && !activeStatus) || activeStatus === filter.value;
            return (
              <Link
                key={filter.value}
                href={buildFilterHref(status)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  active
                    ? 'border-[#E37125] bg-[#FFF3E8] text-[#8A4A18]'
                    : 'border-gray-200 bg-white text-gray-600 hover:border-yellow-400'
                }`}
              >
                {filter.label} ({statusCounts[filter.value] ?? 0})
              </Link>
            );
          })}
        </div>

        {loading ? (
          <LoadingSkeleton rows={5} cols={4} />
        ) : items.length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">
            No work orders found for the current filters.
          </p>
        ) : (
          <>
            <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b border-gray-200">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">WO #</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                    <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {items.map((wo) => (
                    <tr key={wo.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 font-mono font-medium text-gray-900">
                        <Link
                          href={erpRecordRoute('work-order', wo.id)}
                          className="hover:text-[#B1581B] hover:underline"
                        >
                          {wo.workOrderNumber}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-700 truncate max-w-xs">
                        <Link
                          href={erpRecordRoute('work-order', wo.id)}
                          className="hover:text-[#B1581B] hover:underline"
                        >
                          {wo.title}
                        </Link>
                      </td>
                      <td className="px-4 py-3 text-gray-500 truncate max-w-xs">
                        {wo.customerReference ?? '—'}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={wo.status} />
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
    </div>
  );
}
