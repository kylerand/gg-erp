'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  listDealerRelationships,
  type DealerRelationship,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;
const RELATIONSHIP_LIMIT = 100;

function customerLookupHref(row: DealerRelationship): string {
  return erpRoute('customer', { search: row.customerEmail || row.customerName });
}

function dealerLookupHref(row: DealerRelationship): string {
  return erpRoute('dealer', { search: row.dealerCode ?? row.dealerName });
}

function workOrderHref(row: DealerRelationship): string {
  return erpRoute('create-work-order', {
    customerId: row.customerId,
    vehicleId: row.cartVehicleId,
  });
}

function relationshipLabel(type: DealerRelationship['relationshipType']): string {
  return type.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, (char) => char.toUpperCase());
}

function cartDetail(row: DealerRelationship): string {
  return [row.vin, row.serialNumber].filter(Boolean).join(' / ') || 'No cart assigned';
}

function customerDetail(row: DealerRelationship): string {
  return [row.customerEmail, row.customerPhone].filter(Boolean).join(' · ');
}

function rowSearchText(row: DealerRelationship): string {
  return [
    row.dealerName,
    row.dealerCode,
    row.territory,
    row.customerName,
    row.customerEmail,
    row.customerPhone,
    row.cartDisplayName,
    row.vin,
    row.serialNumber,
    row.relationshipType,
    row.relationshipState,
    row.escalationOwner,
    row.notes,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

function relationshipState(row: DealerRelationship): string {
  if (row.relationshipState === 'ENDED') return 'INACTIVE';
  return row.relationshipState;
}

export default function RelationshipsPage() {
  const [relationships, setRelationships] = useState<DealerRelationship[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const relationshipResult = await listDealerRelationships(
        { limit: RELATIONSHIP_LIMIT },
        STRICT_LIVE_DATA,
      );
      setRelationships(relationshipResult.items);
      setTotal(relationshipResult.total);
    } catch (err) {
      setRelationships([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Failed to load dealer relationship records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return relationships;
    return relationships.filter((row) => rowSearchText(row).includes(query));
  }, [relationships, search]);

  return (
    <div>
      <PageHeader
        title="Customer-Dealer Relationships"
        description={
          loading
            ? 'Loading live dealer relationship records...'
            : `${total} live dealer relationship records`
        }
        action={
          <Link href={erpRoute('create-work-order')}>
            <Button className="bg-yellow-400 text-gray-900 hover:bg-yellow-300">
              New Work Order
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search dealer, customer, cart, VIN, serial..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <Link href={erpRoute('dealer')} className="text-sm font-semibold text-gray-700 hover:underline">
          Open dealer accounts
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} cols={5} />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon="🔗"
          title={search ? 'No relationship records matched' : 'No dealer relationships'}
          description={
            search
              ? `No live relationship record matches "${search}".`
              : 'Create dealer accounts or link customer carts to a dealer to populate this view.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Dealer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Cart</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">VIN / Serial</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Relationship</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.map((row) => (
                <tr key={row.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{row.dealerName}</div>
                    <div className="text-xs text-gray-500">
                      {[row.dealerCode, row.territory].filter(Boolean).join(' · ') || 'Dealer account'}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {row.customerName}
                    </div>
                    <div className="text-xs text-gray-500">{customerDetail(row) || 'Customer contact missing'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{row.cartDisplayName ?? 'Customer account'}</div>
                    <div className="text-xs text-gray-500">{row.cartState ?? 'No cart status'}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    <div>{cartDetail(row)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="mb-1 text-gray-700">{relationshipLabel(row.relationshipType)}</div>
                    <StatusBadge status={relationshipState(row)} />
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Link href={dealerLookupHref(row)} className="font-semibold text-gray-900 hover:underline">
                        Open dealer
                      </Link>
                      <Link href={customerLookupHref(row)} className="font-semibold text-gray-900 hover:underline">
                        Open customer
                      </Link>
                      <Link href={workOrderHref(row)} className="font-semibold text-gray-900 hover:underline">
                        Start work order
                      </Link>
                    </div>
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
