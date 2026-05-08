'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { listQuotes, type Quote } from '@/lib/api-client';
import { PageHeader, LoadingSkeleton } from '@gg-erp/ui';
import { Pagination } from '@/components/ui/pagination';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

const PAGE_SIZE = 25;

const STATUS_TABS = ['All', 'DRAFT', 'SENT', 'ACCEPTED', 'REJECTED'] as const;

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-gray-100 text-gray-700',
  SENT: 'bg-blue-100 text-blue-800',
  ACCEPTED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
  EXPIRED: 'bg-yellow-100 text-yellow-800',
  CONVERTED: 'bg-purple-100 text-purple-800',
};

export default function QuotesListPage() {
  const searchParams = useSearchParams();
  const customerIdFilter = searchParams.get('customerId') ?? undefined;
  const [items, setItems] = useState<Quote[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [statusFilter, setStatusFilter] = useState<string>('All');
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (p: number, ps: number, status: string, customerId?: string) => {
    setLoading(true);
    try {
      const res = await listQuotes(
        {
          status: status === 'All' ? undefined : status,
          customerId,
          limit: ps,
          offset: (p - 1) * ps,
        },
        { allowMockFallback: false },
      );
      setItems(res.items);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(page, pageSize, statusFilter, customerIdFilter);
  }, [page, pageSize, statusFilter, customerIdFilter, load]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader
          title="Quotes"
          description={customerIdFilter ? `Filtered to customer ${customerIdFilter}` : undefined}
        />
        <Link
          href={erpRoute('create-quote', { customerId: customerIdFilter })}
          className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
        >
          + New Quote
        </Link>
      </div>

      {/* Filter tabs */}
      <div className="flex gap-1 mb-4">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => {
              setStatusFilter(tab);
              setPage(1);
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              statusFilter === tab
                ? 'bg-gray-900 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            {tab === 'All' ? 'All' : tab}
          </button>
        ))}
      </div>

      {loading ? (
        <LoadingSkeleton rows={8} cols={6} />
      ) : items.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No quotes found.</p>
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Quote #</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Total</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Created</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Valid Until</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {items.map((q) => (
                  <tr key={q.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={erpRecordRoute('quote', q.id)}
                        className="font-mono font-medium text-gray-900 hover:text-yellow-600"
                      >
                        {q.quoteNumber}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-700 truncate max-w-xs">{q.customerId}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold ${STATUS_COLORS[q.status] ?? 'bg-gray-100 text-gray-700'}`}
                      >
                        {q.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">
                      ${q.total.toLocaleString()}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {new Date(q.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {q.validUntil ? new Date(q.validUntil).toLocaleDateString() : '—'}
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
