'use client';

import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  listDealerRelationships,
  updateDealerRelationship,
  type DealerRelationship,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;
const RELATIONSHIP_LIMIT = 100;
const RELATIONSHIP_STATE_OPTIONS = ['ACTIVE', 'INACTIVE', 'ENDED'] as const;

interface RelationshipDraft {
  relationshipState: DealerRelationship['relationshipState'];
  escalationOwner: string;
  notes: string;
}

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

function relationshipDraft(row: DealerRelationship): RelationshipDraft {
  return {
    relationshipState: row.relationshipState,
    escalationOwner: row.escalationOwner ?? '',
    notes: row.notes ?? '',
  };
}

export default function RelationshipsPage() {
  const [relationships, setRelationships] = useState<DealerRelationship[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [editingRelationshipId, setEditingRelationshipId] = useState<string | undefined>();
  const [relationshipEditDraft, setRelationshipEditDraft] = useState<RelationshipDraft | undefined>();
  const [savingRelationshipId, setSavingRelationshipId] = useState<string | undefined>();
  const [relationshipSaveError, setRelationshipSaveError] = useState<string | undefined>();

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

  const beginRelationshipEdit = (row: DealerRelationship) => {
    setEditingRelationshipId(row.id);
    setRelationshipEditDraft(relationshipDraft(row));
    setRelationshipSaveError(undefined);
  };

  const cancelRelationshipEdit = () => {
    setEditingRelationshipId(undefined);
    setRelationshipEditDraft(undefined);
    setRelationshipSaveError(undefined);
  };

  const saveRelationship = async (row: DealerRelationship) => {
    if (!relationshipEditDraft) return;
    setSavingRelationshipId(row.id);
    setRelationshipSaveError(undefined);
    try {
      const updated = await updateDealerRelationship(row.id, {
        relationshipState: relationshipEditDraft.relationshipState,
        escalationOwner: relationshipEditDraft.escalationOwner || null,
        notes: relationshipEditDraft.notes || null,
      });
      setRelationships((current) =>
        current.map((item) => (item.id === updated.id ? updated : item)),
      );
      cancelRelationshipEdit();
    } catch (err) {
      setRelationshipSaveError(
        err instanceof Error ? err.message : 'Failed to save dealer relationship.',
      );
    } finally {
      setSavingRelationshipId(undefined);
    }
  };

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
              {filteredRows.map((row) => {
                const isEditing = editingRelationshipId === row.id;
                return (
                  <Fragment key={row.id}>
                    <tr className="hover:bg-gray-50">
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
                        <div className="mt-2 text-xs text-gray-500">
                          {row.escalationOwner ? `Owner: ${row.escalationOwner}` : 'No escalation owner'}
                        </div>
                        {row.notes && <div className="mt-1 text-xs text-gray-500">{row.notes}</div>}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col items-start gap-1">
                          <Link href={dealerLookupHref(row)} className="font-semibold text-gray-900 hover:underline">
                            Open dealer
                          </Link>
                          <Link href={customerLookupHref(row)} className="font-semibold text-gray-900 hover:underline">
                            Open customer
                          </Link>
                          <Link href={workOrderHref(row)} className="font-semibold text-gray-900 hover:underline">
                            Start work order
                          </Link>
                          <button
                            type="button"
                            onClick={() => beginRelationshipEdit(row)}
                            className="font-semibold text-gray-900 hover:underline"
                          >
                            Update relationship
                          </button>
                        </div>
                      </td>
                    </tr>
                    {isEditing && relationshipEditDraft && (
                      <tr>
                        <td colSpan={6} className="border-t border-yellow-200 bg-yellow-50 px-4 py-4">
                          <div className="grid gap-3 md:grid-cols-[180px_220px_1fr_auto] md:items-end">
                            <label className="text-sm font-medium text-gray-700">
                              State
                              <select
                                value={relationshipEditDraft.relationshipState}
                                onChange={(event) =>
                                  setRelationshipEditDraft((current) =>
                                    current
                                      ? {
                                          ...current,
                                          relationshipState: event.target.value as DealerRelationship['relationshipState'],
                                        }
                                      : current,
                                  )
                                }
                                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                              >
                                {RELATIONSHIP_STATE_OPTIONS.map((state) => (
                                  <option key={state} value={state}>
                                    {state}
                                  </option>
                                ))}
                              </select>
                            </label>
                            <label className="text-sm font-medium text-gray-700">
                              Escalation Owner
                              <Input
                                value={relationshipEditDraft.escalationOwner}
                                onChange={(event) =>
                                  setRelationshipEditDraft((current) =>
                                    current ? { ...current, escalationOwner: event.target.value } : current,
                                  )
                                }
                                placeholder="Manager or owner"
                                className="mt-1"
                              />
                            </label>
                            <label className="text-sm font-medium text-gray-700">
                              Notes
                              <textarea
                                value={relationshipEditDraft.notes}
                                onChange={(event) =>
                                  setRelationshipEditDraft((current) =>
                                    current ? { ...current, notes: event.target.value } : current,
                                  )
                                }
                                rows={2}
                                className="mt-1 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                                placeholder="Service coverage, billing context, warranty instructions"
                              />
                            </label>
                            <div className="flex gap-2 md:justify-end">
                              <Button
                                type="button"
                                className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
                                disabled={savingRelationshipId === row.id}
                                onClick={() => void saveRelationship(row)}
                              >
                                {savingRelationshipId === row.id ? 'Saving...' : 'Save Relationship'}
                              </Button>
                              <Button type="button" variant="outline" onClick={cancelRelationshipEdit}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                          {relationshipSaveError && (
                            <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                              {relationshipSaveError}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
