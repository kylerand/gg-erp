'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { listDealers, type Dealer } from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;

function dealerContactLine(dealer: Dealer): string {
  return [dealer.primaryContact, dealer.contactEmail].filter(Boolean).join(' · ');
}

function customerLookupHref(dealer: Dealer): string {
  return erpRoute('customer', {
    search: dealer.contactEmail ?? dealer.primaryContact ?? dealer.name,
  });
}

export default function DealersPage() {
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const load = useCallback(async (query: string) => {
    setLoading(true);
    setError(undefined);
    try {
      const response = await listDealers(
        { search: query || undefined, limit: 100 },
        STRICT_LIVE_DATA,
      );
      setDealers(response.items);
      setTotal(response.total);
    } catch (err) {
      setDealers([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Failed to load dealer accounts.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = setTimeout(() => void load(search.trim()), 300);
    return () => clearTimeout(timeout);
  }, [load, search]);

  return (
    <div>
      <PageHeader
        title="Dealer Accounts"
        description={loading ? 'Loading live dealer accounts...' : `${total} live dealer accounts`}
        action={
          <Link href={erpRoute('create-customer')}>
            <Button className="bg-yellow-400 text-gray-900 hover:bg-yellow-300">
              New Customer
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search account, contact, territory..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <Link href={erpRoute('customer')} className="text-sm font-semibold text-gray-700 hover:underline">
          Open all customers
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} cols={5} />
      ) : dealers.length === 0 ? (
        <EmptyState
          icon="🤝"
          title={search ? 'No dealer accounts matched' : 'No dealer accounts yet'}
          description={
            search
              ? `No dealer account matches "${search}".`
              : 'Create dealer account records from live commercial customer profiles to populate this list.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Account</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Contact</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Phone</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Territory</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Relationship</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {dealers.map((dealer) => (
                <tr key={dealer.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{dealer.name}</div>
                    <div className="text-xs text-gray-500">
                      {[dealer.dealerCode, dealer.customerState].filter(Boolean).join(' · ') || 'Dealer account'}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-600">{dealerContactLine(dealer) || '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{dealer.phone ?? '-'}</td>
                  <td className="px-4 py-3 text-gray-600">{dealer.territory ?? '-'}</td>
                  <td className="px-4 py-3">
                    <StatusBadge status={dealer.serviceRelationship} />
                  </td>
                  <td className="px-4 py-3">
                    <Link href={customerLookupHref(dealer)} className="font-semibold text-gray-900 hover:underline">
                      Open customer
                    </Link>
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
