'use client';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { CheckSquare, Clipboard, Download, FileUp, X } from 'lucide-react';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  createPart,
  listParts,
  type CreatePartInput,
  type InstallStage,
  type LifecycleLevel,
  type Part,
  type PartCategory,
  type PartState,
  type PartStockFilter,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { downloadCsv, normalizeCsvHeader, parseCsv, type CsvColumn } from '@/lib/csv-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';

const PAGE_SIZE = 25;
type StockFilter = PartStockFilter | '';

const PART_STATE_OPTIONS: { value: PartState; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'DISCONTINUED', label: 'Discontinued' },
];

const CATEGORY_OPTIONS: { value: PartCategory; label: string }[] = [
  { value: 'ELECTRONICS', label: 'Electronics' },
  { value: 'AUDIO', label: 'Audio' },
  { value: 'FABRICATION', label: 'Fabrication' },
  { value: 'HARDWARE', label: 'Hardware' },
  { value: 'SMALL_PARTS', label: 'Small Parts' },
  { value: 'DRIVE_TRAIN', label: 'Drive Train' },
];

const STAGE_OPTIONS: { value: InstallStage; label: string }[] = [
  { value: 'FABRICATION', label: 'Fabrication' },
  { value: 'FRAME', label: 'Frame' },
  { value: 'WIRING', label: 'Wiring' },
  { value: 'PARTS_PREP', label: 'Parts Prep' },
  { value: 'FINAL_ASSEMBLY', label: 'Final Assembly' },
];

const LIFECYCLE_OPTIONS: { value: LifecycleLevel; label: string }[] = [
  { value: 'RAW_MATERIAL', label: 'Raw Material' },
  { value: 'RAW_COMPONENT', label: 'Raw Component' },
  { value: 'PREPARED_COMPONENT', label: 'Prepared' },
  { value: 'ASSEMBLED_COMPONENT', label: 'Assembled' },
];

const STOCK_OPTIONS: { value: StockFilter; label: string }[] = [
  { value: '', label: 'All stock levels' },
  { value: 'OUT', label: 'Out of stock' },
];

type PartImportStatus = 'READY' | 'INVALID' | 'CREATED' | 'FAILED';

interface PartImportRow extends CreatePartInput {
  rowNumber: number;
  status: PartImportStatus;
  message?: string;
}

const PART_EXPORT_COLUMNS: CsvColumn<Part>[] = [
  { header: 'sku', value: (part) => part.sku },
  { header: 'name', value: (part) => part.name },
  { header: 'variant', value: (part) => part.variant },
  { header: 'description', value: (part) => part.description },
  { header: 'unitOfMeasure', value: (part) => part.unitOfMeasure },
  { header: 'partState', value: (part) => part.partState },
  { header: 'category', value: (part) => part.category },
  { header: 'installStage', value: (part) => part.installStage },
  { header: 'lifecycleLevel', value: (part) => part.lifecycleLevel },
  { header: 'manufacturerName', value: (part) => part.manufacturerName },
  { header: 'manufacturerPartNumber', value: (part) => part.manufacturerPartNumber },
  { header: 'defaultVendorName', value: (part) => part.defaultVendorName },
  { header: 'reorderPoint', value: (part) => part.reorderPoint },
  { header: 'quantityOnHand', value: (part) => part.quantityOnHand },
  { header: 'location', value: (part) => part.defaultLocationName ?? part.location },
];

const PART_IMPORT_COLUMNS: CsvColumn<CreatePartInput>[] = [
  { header: 'sku', value: (part) => part.sku },
  { header: 'name', value: (part) => part.name },
  { header: 'description', value: (part) => part.description },
  { header: 'unitOfMeasure', value: (part) => part.unitOfMeasure },
  { header: 'reorderPoint', value: (part) => part.reorderPoint },
];

const PART_IMPORT_TEMPLATE: CreatePartInput[] = [
  {
    sku: 'GG-SAMPLE-SKU',
    name: 'Sample part',
    description: 'Replace or delete this row',
    unitOfMeasure: 'EA',
    reorderPoint: 0,
  },
];

function formatEnum(value: string | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function isOptionValue<T extends string>(
  value: string | null,
  options: ReadonlyArray<{ value: T; label: string }>,
): value is T {
  return options.some((option) => option.value === value);
}

function parsePartState(value: string | null): PartState | '' {
  return isOptionValue(value, PART_STATE_OPTIONS) ? value : '';
}

function parseCategory(value: string | null): PartCategory | '' {
  return isOptionValue(value, CATEGORY_OPTIONS) ? value : '';
}

function parseInstallStage(value: string | null): InstallStage | '' {
  return isOptionValue(value, STAGE_OPTIONS) ? value : '';
}

function parseLifecycleLevel(value: string | null): LifecycleLevel | '' {
  return isOptionValue(value, LIFECYCLE_OPTIONS) ? value : '';
}

function parseStock(value: string | null): StockFilter {
  return value === 'OUT' ? 'OUT' : '';
}

function nowStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function importValue(headers: Map<string, number>, row: string[], key: string): string {
  const index = headers.get(normalizeCsvHeader(key));
  return index === undefined ? '' : (row[index] ?? '').trim();
}

function buildPartImportRows(csvRows: string[][]): PartImportRow[] {
  const [headerRow, ...bodyRows] = csvRows;
  if (!headerRow) return [];

  const headers = new Map(
    headerRow.map((header, index) => [normalizeCsvHeader(header), index] as const),
  );

  return bodyRows.map((row, index) => {
    const reorderPointText = importValue(headers, row, 'reorderPoint');
    const reorderPoint = reorderPointText ? Number(reorderPointText) : 0;
    const sku = importValue(headers, row, 'sku').toUpperCase();
    const name = importValue(headers, row, 'name');
    const description = importValue(headers, row, 'description');
    const unitOfMeasure = importValue(headers, row, 'unitOfMeasure') || 'EA';
    const missing: string[] = [];
    if (!sku) missing.push('sku');
    if (!name) missing.push('name');
    if (!unitOfMeasure) missing.push('unitOfMeasure');
    if (!Number.isFinite(reorderPoint) || reorderPoint < 0) missing.push('reorderPoint');

    const importRow = {
      rowNumber: index + 2,
      sku,
      name,
      ...(description ? { description } : {}),
      unitOfMeasure,
      reorderPoint: Number.isFinite(reorderPoint) && reorderPoint >= 0 ? reorderPoint : 0,
      status: missing.length ? 'INVALID' : 'READY',
    } satisfies PartImportRow;

    return missing.length ? { ...importRow, message: `Check ${missing.join(', ')}` } : importRow;
  });
}

export default function PartsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const importInputRef = useRef<HTMLInputElement>(null);
  const activeSearch = searchParams.get('search') ?? '';
  const activePartState = parsePartState(searchParams.get('partState'));
  const activeCategory = parseCategory(searchParams.get('category'));
  const activeInstallStage = parseInstallStage(searchParams.get('installStage'));
  const activeLifecycleLevel = parseLifecycleLevel(searchParams.get('lifecycleLevel'));
  const activeStock = parseStock(searchParams.get('stock'));
  const [parts, setParts] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [searchText, setSearchText] = useState(activeSearch);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<PartImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);

  const load = useCallback(
    async (
      s: string,
      state: PartState | '',
      stock: StockFilter,
      cat: PartCategory | '',
      stage: InstallStage | '',
      level: LifecycleLevel | '',
      p: number,
      ps: number,
    ) => {
      setLoading(true);
      try {
        const r = await listParts({
          search: s || undefined,
          partState: state || undefined,
          stock: stock || undefined,
          category: cat || undefined,
          installStage: stage || undefined,
          lifecycleLevel: level || undefined,
          limit: ps,
          offset: (p - 1) * ps,
        });
        setParts(r.items);
        setTotal(r.total);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setSearchText(activeSearch);
  }, [activeSearch]);

  useEffect(() => {
    setPage(1);
  }, [
    activeSearch,
    activePartState,
    activeCategory,
    activeInstallStage,
    activeLifecycleLevel,
    activeStock,
  ]);

  useEffect(() => {
    setSelectedPartIds([]);
  }, [
    activeSearch,
    activePartState,
    activeCategory,
    activeInstallStage,
    activeLifecycleLevel,
    activeStock,
    page,
    pageSize,
  ]);

  useEffect(() => {
    const timeout = setTimeout(
      () =>
        void load(
          activeSearch,
          activePartState,
          activeStock,
          activeCategory,
          activeInstallStage,
          activeLifecycleLevel,
          page,
          pageSize,
        ),
      300,
    );
    return () => clearTimeout(timeout);
  }, [
    activeSearch,
    activePartState,
    activeCategory,
    activeInstallStage,
    activeLifecycleLevel,
    activeStock,
    page,
    pageSize,
    load,
  ]);

  function buildPartsHref(next: {
    search?: string;
    partState?: PartState | '';
    stock?: StockFilter;
    category?: PartCategory | '';
    installStage?: InstallStage | '';
    lifecycleLevel?: LifecycleLevel | '';
  }) {
    const search = next.search !== undefined ? next.search : activeSearch;
    const partState = next.partState !== undefined ? next.partState : activePartState;
    const stock = next.stock !== undefined ? next.stock : activeStock;
    const category = next.category !== undefined ? next.category : activeCategory;
    const installStage = next.installStage !== undefined ? next.installStage : activeInstallStage;
    const lifecycleLevel =
      next.lifecycleLevel !== undefined ? next.lifecycleLevel : activeLifecycleLevel;

    return erpRoute('part', {
      search: search.trim() || undefined,
      partState: partState || undefined,
      stock: stock || undefined,
      category: category || undefined,
      installStage: installStage || undefined,
      lifecycleLevel: lifecycleLevel || undefined,
    });
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildPartsHref({ search: searchText }));
  }

  const hasActiveFilters = Boolean(
    activeSearch ||
    activePartState ||
    activeStock ||
    activeCategory ||
    activeInstallStage ||
    activeLifecycleLevel,
  );

  const emptyDescription = hasActiveFilters
    ? 'No parts match the active filters.'
    : 'No parts have been loaded yet.';

  function pushFilter(next: Parameters<typeof buildPartsHref>[0]) {
    router.push(buildPartsHref(next));
  }

  const selectedParts = useMemo(
    () => parts.filter((part) => selectedPartIds.includes(part.id)),
    [parts, selectedPartIds],
  );
  const allVisibleSelected = parts.length > 0 && selectedParts.length === parts.length;
  const readyImportCount = importRows.filter((row) => row.status === 'READY').length;
  const createdImportCount = importRows.filter((row) => row.status === 'CREATED').length;
  const failedImportCount = importRows.filter(
    (row) => row.status === 'FAILED' || row.status === 'INVALID',
  ).length;

  function togglePartSelection(partId: string) {
    setSelectedPartIds((current) =>
      current.includes(partId) ? current.filter((id) => id !== partId) : [...current, partId],
    );
  }

  function toggleVisibleParts() {
    setSelectedPartIds(allVisibleSelected ? [] : parts.map((part) => part.id));
  }

  function exportParts(scope: 'visible' | 'selected') {
    const rows = scope === 'selected' ? selectedParts : parts;
    if (rows.length === 0) {
      setActionMessage('No part rows available to export.');
      return;
    }
    downloadCsv(`gg-parts-${scope}-${nowStamp()}.csv`, rows, PART_EXPORT_COLUMNS);
    setActionMessage(`Exported ${rows.length} part row${rows.length === 1 ? '' : 's'}.`);
  }

  async function copySelectedSkus() {
    if (selectedParts.length === 0) {
      setActionMessage('Select part rows before copying SKUs.');
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedParts.map((part) => part.sku).join('\n'));
      setActionMessage(
        `Copied ${selectedParts.length} SKU${selectedParts.length === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setActionMessage(`Copy failed: ${errorMessage(err)}`);
    }
  }

  async function handlePartImport(file: File | undefined) {
    if (!file) return;
    try {
      const rows = buildPartImportRows(parseCsv(await file.text()));
      setImportRows(rows);
      setActionMessage(
        rows.length
          ? `Loaded ${rows.length} import row${rows.length === 1 ? '' : 's'}.`
          : 'No import rows found.',
      );
    } catch (err) {
      setImportRows([]);
      setActionMessage(errorMessage(err));
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function createImportedParts() {
    const rowsToCreate = importRows.filter((row) => row.status === 'READY');
    if (rowsToCreate.length === 0) {
      setActionMessage('No valid import rows are ready to create.');
      return;
    }

    setImporting(true);
    let created = 0;
    try {
      for (const row of rowsToCreate) {
        try {
          const input: CreatePartInput = {
            sku: row.sku,
            name: row.name,
            unitOfMeasure: row.unitOfMeasure,
            reorderPoint: row.reorderPoint,
          };
          if (row.description) input.description = row.description;
          await createPart(input);
          created += 1;
          setImportRows((current) =>
            current.map((candidate) =>
              candidate.rowNumber === row.rowNumber
                ? { ...candidate, status: 'CREATED', message: 'Created' }
                : candidate,
            ),
          );
        } catch (err) {
          setImportRows((current) =>
            current.map((candidate) =>
              candidate.rowNumber === row.rowNumber
                ? { ...candidate, status: 'FAILED', message: errorMessage(err) }
                : candidate,
            ),
          );
        }
      }
      setActionMessage(
        created
          ? `Created ${created} part${created === 1 ? '' : 's'} from import.`
          : 'No imported parts were created.',
      );
      if (created) {
        await load(
          activeSearch,
          activePartState,
          activeStock,
          activeCategory,
          activeInstallStage,
          activeLifecycleLevel,
          page,
          pageSize,
        );
      }
    } finally {
      setImporting(false);
    }
  }

  return (
    <div>
      <PageHeader title="Part Lookup" description={`${total} parts match the active filters`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={applySearch} className="flex w-full gap-2 sm:max-w-md">
          <Input
            placeholder="Search SKU, name, variant, MFR #…"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="h-9"
          />
          <button
            type="submit"
            className="h-9 rounded-md bg-yellow-400 px-3 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
          >
            Search
          </button>
        </form>
        <select
          value={activePartState}
          onChange={(event) => pushFilter({ partState: event.target.value as PartState | '' })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All states</option>
          {PART_STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={activeStock}
          onChange={(event) => pushFilter({ stock: event.target.value as StockFilter })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {STOCK_OPTIONS.map((o) => (
            <option key={o.value || 'ALL'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={activeCategory}
          onChange={(event) => pushFilter({ category: event.target.value as PartCategory | '' })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All categories</option>
          {CATEGORY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={activeInstallStage}
          onChange={(event) =>
            pushFilter({ installStage: event.target.value as InstallStage | '' })
          }
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All stages</option>
          {STAGE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={activeLifecycleLevel}
          onChange={(event) =>
            pushFilter({ lifecycleLevel: event.target.value as LifecycleLevel | '' })
          }
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All lifecycle levels</option>
          {LIFECYCLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hasActiveFilters && (
          <Link
            href={erpRoute('part')}
            className="text-xs font-semibold text-[#B1581B] hover:underline"
          >
            Reset filters
          </Link>
        )}
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => exportParts('visible')}>
            <Download data-icon="inline-start" />
            Export visible
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={selectedParts.length === 0}
            onClick={() => exportParts('selected')}
          >
            <Download data-icon="inline-start" />
            Export selected
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
          >
            <FileUp data-icon="inline-start" />
            Import CSV
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              downloadCsv(
                `gg-parts-import-template-${nowStamp()}.csv`,
                PART_IMPORT_TEMPLATE,
                PART_IMPORT_COLUMNS,
              )
            }
          >
            <Download data-icon="inline-start" />
            Template
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => void handlePartImport(event.target.files?.[0])}
          />
        </div>
        <div className="text-sm font-medium text-gray-600">
          {actionMessage ?? `${selectedParts.length} selected`}
        </div>
      </div>
      {selectedParts.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <span className="text-sm font-semibold text-amber-900">
            {selectedParts.length} selected
          </span>
          <Button type="button" size="sm" variant="outline" onClick={() => void copySelectedSkus()}>
            <Clipboard data-icon="inline-start" />
            Copy SKUs
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={() => setSelectedPartIds([])}>
            <X data-icon="inline-start" />
            Clear
          </Button>
        </div>
      )}
      {importRows.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-gray-900">{importRows.length} import rows</span>
              <span className="text-green-700">{createdImportCount} created</span>
              <span className="text-amber-700">{readyImportCount} ready</span>
              <span className="text-red-700">{failedImportCount} blocked</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => void createImportedParts()}
                disabled={importing || readyImportCount === 0}
              >
                <CheckSquare data-icon="inline-start" />
                Create valid parts
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setImportRows([]);
                  setActionMessage(null);
                }}
              >
                <X data-icon="inline-start" />
                Dismiss
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">UOM</th>
                  <th className="px-3 py-2 text-right">Min</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {importRows.slice(0, 12).map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-3 py-2 text-gray-500">{row.rowNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-900">
                      {row.sku || 'Missing'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.name || 'Missing'}</td>
                    <td className="px-3 py-2 text-gray-700">{row.unitOfMeasure || 'Missing'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.reorderPoint ?? 0}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} />
                      {row.message && (
                        <span className="ml-2 text-xs text-gray-500">{row.message}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {loading ? (
        <LoadingSkeleton rows={6} cols={7} />
      ) : parts.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No parts found"
          description={activeSearch ? `No match for "${activeSearch}"` : emptyDescription}
        />
      ) : (
        <>
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    <input
                      type="checkbox"
                      aria-label="Select visible parts"
                      checked={allVisibleSelected}
                      onChange={toggleVisibleParts}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">SKU</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Name / Variant</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Lifecycle</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Category</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Stage</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">MFR</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">MFR #</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Vendor</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Min</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">On Hand</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parts.map((p) => (
                  <tr key={p.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <input
                        type="checkbox"
                        aria-label={`Select ${p.sku}`}
                        checked={selectedPartIds.includes(p.id)}
                        onChange={() => togglePartSelection(p.id)}
                        className="h-4 w-4 rounded border-gray-300"
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-700 font-medium">
                      <Link href={erpRecordRoute('part', p.id)} className="hover:underline">
                        {p.sku}
                      </Link>
                    </td>
                    <td className="px-4 py-3 text-gray-900">
                      <div>{p.name}</div>
                      {p.variant && <div className="text-xs text-gray-500">{p.variant}</div>}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{formatEnum(p.lifecycleLevel)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatEnum(p.category)}</td>
                    <td className="px-4 py-3 text-gray-600">{formatEnum(p.installStage)}</td>
                    <td className="px-4 py-3 text-gray-600">{p.manufacturerName ?? '—'}</td>
                    <td className="px-4 py-3 font-mono text-xs text-gray-500">
                      {p.manufacturerPartNumber ?? '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-600">{p.defaultVendorName ?? '—'}</td>
                    <td className="px-4 py-3 text-gray-600">{p.reorderPoint}</td>
                    <td className="px-4 py-3">
                      <span
                        className={`font-semibold ${
                          p.quantityOnHand === 0
                            ? 'text-red-600'
                            : (p.quantityOnHand ?? 0) < p.reorderPoint
                              ? 'text-amber-600'
                              : 'text-gray-900'
                        }`}
                      >
                        {p.quantityOnHand === 0 ? '⚠️ 0' : (p.quantityOnHand ?? '—')}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {p.defaultLocationName ?? p.location ?? '—'}
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={p.partState} />
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
