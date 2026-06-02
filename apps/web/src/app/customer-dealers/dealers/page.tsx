'use client';

import { Fragment, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  createDealer,
  listDealers,
  updateDealer,
  type Customer,
  type Dealer,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { CustomerSelector } from '@/components/customers/CustomerSelector';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;

interface DealerDraft {
  dealerCode: string;
  territory: string;
  serviceRelationship: Dealer['serviceRelationship'];
  accountOwner: string;
  notes: string;
}

interface CreateDealerDraft extends DealerDraft {
  customerId: string;
}

function dealerContactLine(dealer: Dealer): string {
  return [dealer.primaryContact, dealer.contactEmail].filter(Boolean).join(' · ');
}

function customerLookupHref(dealer: Dealer): string {
  return dealer.customerId
    ? `/customer-dealers/customers/${dealer.customerId}`
    : erpRoute('customer', {
        search: dealer.contactEmail ?? dealer.primaryContact ?? dealer.name,
      });
}

function dealerDraft(dealer: Dealer): DealerDraft {
  return {
    dealerCode: dealer.dealerCode ?? '',
    territory: dealer.territory ?? '',
    serviceRelationship: dealer.serviceRelationship,
    accountOwner: dealer.accountOwner ?? '',
    notes: dealer.notes ?? '',
  };
}

function createDealerDraft(): CreateDealerDraft {
  return {
    customerId: '',
    dealerCode: '',
    territory: '',
    serviceRelationship: 'ACTIVE',
    accountOwner: '',
    notes: '',
  };
}

function nullableText(value: string): string | null {
  return value.trim() || null;
}

export default function DealersPage() {
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState('');
  const [createPanelOpen, setCreatePanelOpen] = useState(false);
  const [createDraft, setCreateDraft] = useState<CreateDealerDraft>(() => createDealerDraft());
  const [selectedCustomer, setSelectedCustomer] = useState<Customer | undefined>();
  const [customerLoading, setCustomerLoading] = useState(false);
  const [creatingDealer, setCreatingDealer] = useState(false);
  const [createError, setCreateError] = useState<string | undefined>();
  const [createSuccess, setCreateSuccess] = useState<string | undefined>();
  const [editingDealerId, setEditingDealerId] = useState<string | undefined>();
  const [dealerEditDraft, setDealerEditDraft] = useState<DealerDraft | undefined>();
  const [savingDealerId, setSavingDealerId] = useState<string | undefined>();
  const [dealerSaveError, setDealerSaveError] = useState<string | undefined>();

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

  const resetCreateDraft = () => {
    setCreateDraft(createDealerDraft());
    setSelectedCustomer(undefined);
  };

  const createDealerAccount = async () => {
    setCreateError(undefined);
    setCreateSuccess(undefined);
    if (!createDraft.customerId || !selectedCustomer) {
      setCreateError('Select an active customer before creating a dealer account.');
      return;
    }
    if (selectedCustomer.state !== 'ACTIVE') {
      setCreateError('Only active customers can become dealer accounts.');
      return;
    }

    setCreatingDealer(true);
    try {
      const created = await createDealer({
        customerId: createDraft.customerId,
        dealerCode: nullableText(createDraft.dealerCode),
        territory: nullableText(createDraft.territory),
        serviceRelationship: createDraft.serviceRelationship,
        accountOwner: nullableText(createDraft.accountOwner),
        notes: nullableText(createDraft.notes),
      });
      setDealers((current) => [created, ...current.filter((dealer) => dealer.id !== created.id)]);
      setTotal((current) => current + (dealers.some((dealer) => dealer.id === created.id) ? 0 : 1));
      setCreateSuccess(`Dealer account created for ${created.name}.`);
      resetCreateDraft();
      setCreatePanelOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create dealer account.');
    } finally {
      setCreatingDealer(false);
    }
  };

  const beginDealerEdit = (dealer: Dealer) => {
    setEditingDealerId(dealer.id);
    setDealerEditDraft(dealerDraft(dealer));
    setDealerSaveError(undefined);
  };

  const saveDealer = async (dealer: Dealer) => {
    if (!dealerEditDraft) return;
    setSavingDealerId(dealer.id);
    setDealerSaveError(undefined);
    try {
      const updated = await updateDealer(dealer.id, {
        dealerCode: nullableText(dealerEditDraft.dealerCode),
        territory: nullableText(dealerEditDraft.territory),
        serviceRelationship: dealerEditDraft.serviceRelationship,
        accountOwner: nullableText(dealerEditDraft.accountOwner),
        notes: nullableText(dealerEditDraft.notes),
      });
      setDealers((current) => current.map((row) => (row.id === updated.id ? updated : row)));
      setEditingDealerId(undefined);
      setDealerEditDraft(undefined);
    } catch (err) {
      setDealerSaveError(err instanceof Error ? err.message : 'Failed to update dealer account.');
    } finally {
      setSavingDealerId(undefined);
    }
  };

  return (
    <div>
      <PageHeader
        title="Dealer Accounts"
        description={loading ? 'Loading live dealer accounts...' : `${total} live dealer accounts`}
        action={
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
              onClick={() => {
                setCreatePanelOpen((current) => !current);
                setCreateError(undefined);
                setCreateSuccess(undefined);
              }}
            >
              {createPanelOpen ? 'Close Dealer Form' : 'New Dealer Account'}
            </Button>
            <Link href={erpRoute('create-customer')}>
              <Button variant="outline">New Customer</Button>
            </Link>
          </div>
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

      {createSuccess && (
        <div className="mb-4 rounded-lg border border-green-200 bg-green-50 px-4 py-3 text-sm text-green-800">
          {createSuccess}
        </div>
      )}

      {createPanelOpen && (
        <div className="mb-5 rounded-lg border border-yellow-200 bg-yellow-50 p-4">
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Create Dealer Account</h2>
              <p className="mt-1 text-sm text-gray-600">
                Promote an active customer profile into a live dealer account for service, sales, and warranty work.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetCreateDraft();
                setCreateError(undefined);
              }}
            >
              Reset
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <CustomerSelector
              id="dealerAccountCustomer"
              label="Customer"
              required
              value={createDraft.customerId}
              onLoadingChange={setCustomerLoading}
              onResolvedCustomer={setSelectedCustomer}
              onChange={(customerId, customer) => {
                setCreateDraft((current) => ({ ...current, customerId }));
                setSelectedCustomer(customer);
              }}
            />

            <label className="text-sm font-medium text-gray-700">
              Service Relationship
              <select
                value={createDraft.serviceRelationship}
                onChange={(event) =>
                  setCreateDraft((current) => ({
                    ...current,
                    serviceRelationship: event.target.value as Dealer['serviceRelationship'],
                  }))
                }
                className="mt-1 h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
              >
                <option value="ACTIVE">Active</option>
                <option value="INACTIVE">Inactive</option>
              </select>
            </label>

            <label className="text-sm font-medium text-gray-700">
              Dealer Code
              <Input
                className="mt-1"
                placeholder="DEALER-RIVER"
                value={createDraft.dealerCode}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, dealerCode: event.target.value }))
                }
              />
            </label>

            <label className="text-sm font-medium text-gray-700">
              Territory
              <Input
                className="mt-1"
                placeholder="Central Florida"
                value={createDraft.territory}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, territory: event.target.value }))
                }
              />
            </label>

            <label className="text-sm font-medium text-gray-700">
              Account Owner
              <Input
                className="mt-1"
                placeholder="Service manager or sales owner"
                value={createDraft.accountOwner}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, accountOwner: event.target.value }))
                }
              />
            </label>

            <label className="text-sm font-medium text-gray-700">
              Notes
              <textarea
                value={createDraft.notes}
                onChange={(event) =>
                  setCreateDraft((current) => ({ ...current, notes: event.target.value }))
                }
                className="mt-1 min-h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                placeholder="Warranty coverage, escalation preferences, or service territory notes"
              />
            </label>
          </div>

          {createError && (
            <div className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
              {createError}
            </div>
          )}

          <div className="mt-4 flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                resetCreateDraft();
                setCreatePanelOpen(false);
                setCreateError(undefined);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
              disabled={creatingDealer || customerLoading || !createDraft.customerId}
              onClick={() => void createDealerAccount()}
            >
              {creatingDealer ? 'Creating...' : 'Create Dealer Account'}
            </Button>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {dealerSaveError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {dealerSaveError}
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
              {dealers.map((dealer) => {
                const isEditing = editingDealerId === dealer.id && dealerEditDraft;
                return (
                  <Fragment key={dealer.id}>
                    <tr className="hover:bg-gray-50">
                      <td className="px-4 py-3 align-top">
                        <div className="font-medium text-gray-900">{dealer.name}</div>
                        {isEditing ? (
                          <Input
                            className="mt-2"
                            placeholder="Dealer code"
                            value={dealerEditDraft.dealerCode}
                            onChange={(event) =>
                              setDealerEditDraft((current) =>
                                current ? { ...current, dealerCode: event.target.value } : current,
                              )
                            }
                          />
                        ) : (
                          <div className="text-xs text-gray-500">
                            {[dealer.dealerCode, dealer.customerState].filter(Boolean).join(' · ') ||
                              'Dealer account'}
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600">
                        {dealerContactLine(dealer) || '-'}
                      </td>
                      <td className="px-4 py-3 align-top text-gray-600">{dealer.phone ?? '-'}</td>
                      <td className="px-4 py-3 align-top text-gray-600">
                        {isEditing ? (
                          <Input
                            placeholder="Territory"
                            value={dealerEditDraft.territory}
                            onChange={(event) =>
                              setDealerEditDraft((current) =>
                                current ? { ...current, territory: event.target.value } : current,
                              )
                            }
                          />
                        ) : (
                          dealer.territory ?? '-'
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {isEditing ? (
                          <select
                            value={dealerEditDraft.serviceRelationship}
                            onChange={(event) =>
                              setDealerEditDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      serviceRelationship: event.target.value as Dealer['serviceRelationship'],
                                    }
                                  : current,
                              )
                            }
                            className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm text-gray-900"
                          >
                            <option value="ACTIVE">Active</option>
                            <option value="INACTIVE">Inactive</option>
                          </select>
                        ) : (
                          <StatusBadge status={dealer.serviceRelationship} />
                        )}
                      </td>
                      <td className="px-4 py-3 align-top">
                        {isEditing ? (
                          <div className="flex flex-wrap gap-2">
                            <Button
                              type="button"
                              className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
                              disabled={savingDealerId === dealer.id}
                              onClick={() => void saveDealer(dealer)}
                            >
                              {savingDealerId === dealer.id ? 'Saving...' : 'Save'}
                            </Button>
                            <Button
                              type="button"
                              variant="outline"
                              disabled={savingDealerId === dealer.id}
                              onClick={() => {
                                setEditingDealerId(undefined);
                                setDealerEditDraft(undefined);
                                setDealerSaveError(undefined);
                              }}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <div className="flex flex-wrap gap-3">
                            <Link href={customerLookupHref(dealer)} className="font-semibold text-gray-900 hover:underline">
                              Open customer
                            </Link>
                            <button
                              type="button"
                              className="font-semibold text-gray-900 hover:underline"
                              onClick={() => beginDealerEdit(dealer)}
                            >
                              Edit
                            </button>
                          </div>
                        )}
                      </td>
                    </tr>
                    {isEditing && (
                      <tr className="bg-yellow-50/60">
                        <td colSpan={6} className="px-4 py-3">
                          <div className="grid gap-3 lg:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
                            <label className="text-sm font-medium text-gray-700">
                              Account Owner
                              <Input
                                className="mt-1"
                                placeholder="Owner"
                                value={dealerEditDraft.accountOwner}
                                onChange={(event) =>
                                  setDealerEditDraft((current) =>
                                    current ? { ...current, accountOwner: event.target.value } : current,
                                  )
                                }
                              />
                            </label>
                            <label className="text-sm font-medium text-gray-700">
                              Notes
                              <textarea
                                value={dealerEditDraft.notes}
                                onChange={(event) =>
                                  setDealerEditDraft((current) =>
                                    current ? { ...current, notes: event.target.value } : current,
                                  )
                                }
                                className="mt-1 min-h-20 w-full rounded-md border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900"
                              />
                            </label>
                          </div>
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
