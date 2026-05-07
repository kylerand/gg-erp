'use client';
import { useEffect, useState, useCallback } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  listParts,
  type InstallStage,
  type LifecycleLevel,
  type Part,
  type PartCategory,
  type PartState,
  type PartStockFilter,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
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

export default function PartsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
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
