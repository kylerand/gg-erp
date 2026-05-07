'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import { PageHeader, EmptyState, LoadingSkeleton } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  getQbStatus,
  listDimensionMappings,
  listIntegrationAccounts,
  listTaxMappings,
  upsertDimensionMapping,
  upsertTaxMapping,
  type DimensionMapping,
  type DimensionMappingType,
  type IntegrationAccount,
  type QbAccountSummary,
  type TaxMapping,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';

const DIMENSION_TYPES: DimensionMappingType[] = [
  'INCOME_ACCOUNT',
  'AR_ACCOUNT',
  'ITEM',
  'PAYMENT_METHOD',
];
const REQUIRED_DIMENSIONS: DimensionMappingType[] = ['INCOME_ACCOUNT', 'AR_ACCOUNT'];

interface DimensionFormState {
  mappingType: DimensionMappingType;
  internalCode: string;
  externalId: string;
  displayName: string;
}

interface TaxFormState {
  taxRegionCode: string;
  internalTaxCode: string;
  externalTaxCodeId: string;
  externalRateName: string;
}

const INITIAL_DIMENSION_FORM: DimensionFormState = {
  mappingType: 'INCOME_ACCOUNT',
  internalCode: 'INCOME_DEFAULT',
  externalId: '',
  displayName: '',
};

const INITIAL_TAX_FORM: TaxFormState = {
  taxRegionCode: 'US',
  internalTaxCode: 'TAX_STANDARD',
  externalTaxCodeId: '',
  externalRateName: '',
};

export default function AdminAccountingSettingsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const accountFromUrl = searchParams.get('accountId') ?? '';
  const [accounts, setAccounts] = useState<IntegrationAccount[]>([]);
  const [qbAccounts, setQbAccounts] = useState<QbAccountSummary[]>([]);
  const [selectedAccountId, setSelectedAccountId] = useState(accountFromUrl);
  const [dimensionMappings, setDimensionMappings] = useState<DimensionMapping[]>([]);
  const [taxMappings, setTaxMappings] = useState<TaxMapping[]>([]);
  const [dimensionForm, setDimensionForm] = useState<DimensionFormState>(INITIAL_DIMENSION_FORM);
  const [taxForm, setTaxForm] = useState<TaxFormState>(INITIAL_TAX_FORM);
  const [loadingAccounts, setLoadingAccounts] = useState(true);
  const [loadingMappings, setLoadingMappings] = useState(false);
  const [savingDimension, setSavingDimension] = useState(false);
  const [savingTax, setSavingTax] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    setSelectedAccountId(accountFromUrl);
  }, [accountFromUrl]);

  useEffect(() => {
    let cancelled = false;
    setLoadingAccounts(true);
    setLoadError(null);
    Promise.all([
      listIntegrationAccounts({ allowMockFallback: false }),
      getQbStatus({ allowMockFallback: false }).catch(() => null),
    ])
      .then(([accountResponse, qbStatus]) => {
        if (cancelled) return;
        setAccounts(accountResponse.items);
        setQbAccounts(qbStatus?.overview?.accounts ?? []);
        if (!accountFromUrl && accountResponse.items[0]) {
          updateAccountRoute(accountResponse.items[0].id, false);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setLoadError(
            error instanceof Error ? error.message : 'Failed to load accounting settings',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingAccounts(false);
      });
    return () => {
      cancelled = true;
    };
    // The initial route seed should run once; explicit account changes are handled separately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedAccount = accounts.find((account) => account.id === selectedAccountId);

  const loadMappings = useCallback(async (integrationAccountId: string) => {
    setLoadingMappings(true);
    setLoadError(null);
    try {
      const [dimensions, taxes] = await Promise.all([
        listDimensionMappings({ integrationAccountId }, { allowMockFallback: false }),
        listTaxMappings({ integrationAccountId }, { allowMockFallback: false }),
      ]);
      setDimensionMappings(dimensions.items);
      setTaxMappings(taxes.items);
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'Failed to load accounting mappings');
      setDimensionMappings([]);
      setTaxMappings([]);
    } finally {
      setLoadingMappings(false);
    }
  }, []);

  useEffect(() => {
    if (selectedAccountId) void loadMappings(selectedAccountId);
  }, [loadMappings, selectedAccountId]);

  const readiness = useMemo(
    () =>
      REQUIRED_DIMENSIONS.map((type) => ({
        type,
        mapping: dimensionMappings.find((mapping) => mapping.mappingType === type),
      })),
    [dimensionMappings],
  );
  const readyCount = readiness.filter((item) => item.mapping).length;
  const activeDimensionCount = dimensionMappings.filter((mapping) => mapping.isActive).length;
  const activeTaxCount = taxMappings.filter((mapping) => mapping.isActive).length;

  function updateAccountRoute(accountId: string | null, push = true) {
    if (!accountId) return;
    setSelectedAccountId(accountId);
    const href = erpRoute('accounting-settings', { accountId });
    if (push) router.push(href);
    else window.history.replaceState(null, '', href);
  }

  async function saveDimension(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccountId) return;
    setSavingDimension(true);
    try {
      await upsertDimensionMapping({
        integrationAccountId: selectedAccountId,
        mappingType: dimensionForm.mappingType,
        internalCode: dimensionForm.internalCode.trim(),
        externalId: dimensionForm.externalId.trim(),
        displayName: dimensionForm.displayName.trim() || undefined,
      });
      toast.success('Dimension mapping saved');
      setDimensionForm((current) => ({
        ...current,
        externalId: '',
        displayName: '',
      }));
      await loadMappings(selectedAccountId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save dimension mapping');
    } finally {
      setSavingDimension(false);
    }
  }

  async function saveTax(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedAccountId) return;
    setSavingTax(true);
    try {
      await upsertTaxMapping({
        integrationAccountId: selectedAccountId,
        taxRegionCode: taxForm.taxRegionCode.trim(),
        internalTaxCode: taxForm.internalTaxCode.trim(),
        externalTaxCodeId: taxForm.externalTaxCodeId.trim(),
        externalRateName: taxForm.externalRateName.trim() || undefined,
      });
      toast.success('Tax mapping saved');
      setTaxForm((current) => ({
        ...current,
        externalTaxCodeId: '',
        externalRateName: '',
      }));
      await loadMappings(selectedAccountId);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to save tax mapping');
    } finally {
      setSavingTax(false);
    }
  }

  function editDimension(mapping: DimensionMapping) {
    setDimensionForm({
      mappingType: mapping.mappingType,
      internalCode: mapping.internalCode,
      externalId: mapping.externalId,
      displayName: mapping.displayName ?? '',
    });
  }

  function editTax(mapping: TaxMapping) {
    setTaxForm({
      taxRegionCode: mapping.taxRegionCode,
      internalTaxCode: mapping.internalTaxCode,
      externalTaxCodeId: mapping.externalTaxCodeId,
      externalRateName: mapping.externalRateName ?? '',
    });
  }

  return (
    <div>
      <PageHeader
        title="Accounting Settings"
        description="Configure the mappings required before ERP records sync to QuickBooks"
        action={
          <Link href={erpRoute('accounting-sync', { view: 'accounts' })}>
            <Button variant="outline">Open sync accounts</Button>
          </Link>
        }
      />

      {loadError && (
        <div className="mb-6 rounded-lg border border-yellow-200 bg-yellow-50 px-4 py-3 text-sm text-yellow-900">
          {loadError}
        </div>
      )}

      {loadingAccounts ? (
        <LoadingSkeleton rows={4} cols={4} />
      ) : accounts.length === 0 ? (
        <EmptyState
          icon="QB"
          title="No integration accounts"
          description="Connect QuickBooks before configuring accounting mappings."
        />
      ) : (
        <>
          <section className="mb-6 rounded-lg border border-gray-200 bg-white p-4">
            <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
              <div>
                <h2 className="text-sm font-semibold text-gray-900">Integration Account</h2>
                <p className="mt-1 text-xs text-gray-500">
                  Choose the provider account whose export mappings should be reviewed or updated.
                </p>
              </div>
              <div className="w-full lg:max-w-md">
                <Select
                  value={selectedAccountId}
                  onValueChange={(accountId) => updateAccountRoute(accountId)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select integration account" />
                  </SelectTrigger>
                  <SelectContent>
                    {accounts.map((account) => (
                      <SelectItem key={account.id} value={account.id}>
                        {account.displayName ?? account.name ?? account.provider ?? account.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            {selectedAccount && (
              <div className="mt-4 grid grid-cols-1 gap-3 text-xs text-gray-500 md:grid-cols-3">
                <div>
                  <span className="font-semibold text-gray-700">Provider:</span>{' '}
                  {selectedAccount.provider ?? 'Unknown'}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">Status:</span>{' '}
                  {selectedAccount.accountStatus ?? selectedAccount.accountType ?? 'Unknown'}
                </div>
                <div>
                  <span className="font-semibold text-gray-700">External key:</span>{' '}
                  {selectedAccount.accountKey ?? selectedAccount.qbId ?? selectedAccount.id}
                </div>
              </div>
            )}
          </section>

          <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-3">
            <MetricBlock
              label="Invoice Required Mappings"
              value={`${readyCount}/${REQUIRED_DIMENSIONS.length}`}
              tone={readyCount === REQUIRED_DIMENSIONS.length ? 'green' : 'red'}
            />
            <MetricBlock label="Dimension Mappings" value={String(activeDimensionCount)} />
            <MetricBlock label="Tax Mappings" value={String(activeTaxCount)} />
          </div>

          {loadingMappings ? (
            <LoadingSkeleton rows={5} cols={5} />
          ) : (
            <div className="space-y-6">
              <section>
                <h2 className="mb-3 text-sm font-semibold text-gray-900">
                  Invoice Export Readiness
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {readiness.map(({ type, mapping }) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() =>
                        mapping
                          ? editDimension(mapping)
                          : setDimensionForm((current) => ({
                              ...current,
                              mappingType: type,
                              internalCode: type === 'AR_ACCOUNT' ? 'AR_DEFAULT' : 'INCOME_DEFAULT',
                            }))
                      }
                      className={`rounded-lg border p-4 text-left transition-colors ${
                        mapping
                          ? 'border-green-200 bg-green-50/40 hover:border-green-400'
                          : 'border-red-200 bg-red-50/40 hover:border-red-400'
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-sm font-semibold text-gray-900">
                          {formatCode(type)}
                        </span>
                        <span
                          className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                            mapping ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                          }`}
                        >
                          {mapping ? 'Mapped' : 'Missing'}
                        </span>
                      </div>
                      <p className="mt-2 text-xs text-gray-600">
                        {mapping
                          ? `${mapping.internalCode} -> ${mapping.displayName ?? mapping.externalId}`
                          : 'Add this mapping before invoice sync can export reliably.'}
                      </p>
                    </button>
                  ))}
                </div>
              </section>

              <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <DimensionMappingsTable mappings={dimensionMappings} onEdit={editDimension} />
                <DimensionMappingForm
                  value={dimensionForm}
                  qbAccounts={qbAccounts}
                  saving={savingDimension}
                  onChange={setDimensionForm}
                  onSubmit={saveDimension}
                />
              </section>

              <section className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_380px]">
                <TaxMappingsTable mappings={taxMappings} onEdit={editTax} />
                <TaxMappingForm
                  value={taxForm}
                  saving={savingTax}
                  onChange={setTaxForm}
                  onSubmit={saveTax}
                />
              </section>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MetricBlock({
  label,
  value,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  tone?: 'neutral' | 'green' | 'red';
}) {
  const color =
    tone === 'green' ? 'text-green-700' : tone === 'red' ? 'text-red-600' : 'text-gray-900';
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4">
      <div className={`text-2xl font-bold ${color}`}>{value}</div>
      <div className="mt-1 text-xs text-gray-500">{label}</div>
    </div>
  );
}

function DimensionMappingsTable({
  mappings,
  onEdit,
}: {
  mappings: DimensionMapping[];
  onEdit: (mapping: DimensionMapping) => void;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Financial Dimension Mappings</h2>
      {mappings.length === 0 ? (
        <EmptyState
          icon="MAP"
          title="No dimension mappings"
          description="Add income, AR, item, or payment mappings for the selected integration account."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Type</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Internal</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">QuickBooks</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {mappings.map((mapping) => (
                <tr key={mapping.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs font-semibold text-gray-700">
                    {formatCode(mapping.mappingType)}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {mapping.internalCode}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">
                      {mapping.displayName ?? mapping.externalId}
                    </div>
                    <div className="font-mono text-[11px] text-gray-400">{mapping.externalId}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatDateTime(mapping.updatedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => onEdit(mapping)}>
                      Edit
                    </Button>
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

function DimensionMappingForm({
  value,
  qbAccounts,
  saving,
  onChange,
  onSubmit,
}: {
  value: DimensionFormState;
  qbAccounts: QbAccountSummary[];
  saving: boolean;
  onChange: (value: DimensionFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Save Dimension Mapping</h3>
      <div className="mt-4 space-y-3">
        <div>
          <Label htmlFor="mapping-type">Mapping type</Label>
          <Select
            value={value.mappingType}
            onValueChange={(next) =>
              onChange({ ...value, mappingType: next as DimensionMappingType })
            }
          >
            <SelectTrigger id="mapping-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIMENSION_TYPES.map((type) => (
                <SelectItem key={type} value={type}>
                  {formatCode(type)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label htmlFor="internal-code">Internal code</Label>
          <Input
            id="internal-code"
            required
            value={value.internalCode}
            onChange={(event) => onChange({ ...value, internalCode: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="external-id">QuickBooks external ID</Label>
          <Input
            id="external-id"
            required
            list="qb-account-options"
            value={value.externalId}
            onChange={(event) => onChange({ ...value, externalId: event.target.value })}
          />
          <datalist id="qb-account-options">
            {qbAccounts.map((account) => (
              <option
                key={account.id}
                value={account.id}
                label={`${account.name} (${account.accountType})`}
              />
            ))}
          </datalist>
        </div>
        <div>
          <Label htmlFor="display-name">Display name</Label>
          <Input
            id="display-name"
            value={value.displayName}
            onChange={(event) => onChange({ ...value, displayName: event.target.value })}
          />
        </div>
        <Button type="submit" disabled={saving} className="w-full bg-yellow-400 text-gray-900">
          {saving ? 'Saving...' : 'Save dimension mapping'}
        </Button>
      </div>
    </form>
  );
}

function TaxMappingsTable({
  mappings,
  onEdit,
}: {
  mappings: TaxMapping[];
  onEdit: (mapping: TaxMapping) => void;
}) {
  return (
    <div>
      <h2 className="mb-3 text-sm font-semibold text-gray-900">Tax Mappings</h2>
      {mappings.length === 0 ? (
        <EmptyState
          icon="TAX"
          title="No tax mappings"
          description="Add tax-region mappings for invoice tax export."
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Region</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Internal</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">QuickBooks</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Updated</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {mappings.map((mapping) => (
                <tr key={mapping.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {mapping.taxRegionCode}
                  </td>
                  <td className="px-4 py-3 font-mono text-xs text-gray-700">
                    {mapping.internalTaxCode}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-sm font-medium text-gray-900">
                      {mapping.externalRateName ?? mapping.externalTaxCodeId}
                    </div>
                    <div className="font-mono text-[11px] text-gray-400">
                      {mapping.externalTaxCodeId}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {formatDateTime(mapping.updatedAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="sm" variant="outline" onClick={() => onEdit(mapping)}>
                      Edit
                    </Button>
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

function TaxMappingForm({
  value,
  saving,
  onChange,
  onSubmit,
}: {
  value: TaxFormState;
  saving: boolean;
  onChange: (value: TaxFormState) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}) {
  return (
    <form onSubmit={onSubmit} className="rounded-lg border border-gray-200 bg-white p-4">
      <h3 className="text-sm font-semibold text-gray-900">Save Tax Mapping</h3>
      <div className="mt-4 space-y-3">
        <div>
          <Label htmlFor="tax-region">Tax region</Label>
          <Input
            id="tax-region"
            required
            value={value.taxRegionCode}
            onChange={(event) => onChange({ ...value, taxRegionCode: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="internal-tax">Internal tax code</Label>
          <Input
            id="internal-tax"
            required
            value={value.internalTaxCode}
            onChange={(event) => onChange({ ...value, internalTaxCode: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="external-tax">QuickBooks tax code ID</Label>
          <Input
            id="external-tax"
            required
            value={value.externalTaxCodeId}
            onChange={(event) => onChange({ ...value, externalTaxCodeId: event.target.value })}
          />
        </div>
        <div>
          <Label htmlFor="external-tax-name">Rate name</Label>
          <Input
            id="external-tax-name"
            value={value.externalRateName}
            onChange={(event) => onChange({ ...value, externalRateName: event.target.value })}
          />
        </div>
        <Button type="submit" disabled={saving} className="w-full bg-yellow-400 text-gray-900">
          {saving ? 'Saving...' : 'Save tax mapping'}
        </Button>
      </div>
    </form>
  );
}

function formatCode(value: string): string {
  return value
    .split('_')
    .map((part) => part.charAt(0) + part.slice(1).toLowerCase())
    .join(' ');
}

function formatDateTime(value?: string | null): string {
  if (!value) return '-';
  return new Date(value).toLocaleString([], {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}
