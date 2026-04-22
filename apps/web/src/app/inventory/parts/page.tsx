'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  listParts,
  type InstallStage,
  type LifecycleLevel,
  type Part,
  type PartCategory,
} from '@/lib/api-client';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';

const PAGE_SIZE = 25;

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

function formatEnum(value: string | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export default function PartsPage() {
  const [parts, setParts] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<PartCategory | ''>('');
  const [installStage, setInstallStage] = useState<InstallStage | ''>('');
  const [lifecycleLevel, setLifecycleLevel] = useState<LifecycleLevel | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);

  const load = useCallback(
    async (
      s: string,
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
    const timeout = setTimeout(
      () => void load(search, category, installStage, lifecycleLevel, page, pageSize),
      300,
    );
    return () => clearTimeout(timeout);
  }, [search, category, installStage, lifecycleLevel, page, pageSize, load]);

  function handleFilterChange<T>(setter: (v: T) => void, value: T) {
    setter(value);
    setPage(1);
  }

  return (
    <div>
      <PageHeader title="Part Lookup" description={`${total} parts total`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          placeholder="Search SKU, name, variant, MFR #…"
          value={search}
          onChange={(e) => handleFilterChange(setSearch, e.target.value)}
          className="max-w-sm"
        />
        <select
          value={category}
          onChange={(e) => handleFilterChange<PartCategory | ''>(setCategory, e.target.value as PartCategory | '')}
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
          value={installStage}
          onChange={(e) => handleFilterChange<InstallStage | ''>(setInstallStage, e.target.value as InstallStage | '')}
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
          value={lifecycleLevel}
          onChange={(e) => handleFilterChange<LifecycleLevel | ''>(setLifecycleLevel, e.target.value as LifecycleLevel | '')}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All lifecycle levels</option>
          {LIFECYCLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      {loading ? (
        <LoadingSkeleton rows={6} cols={7} />
      ) : parts.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No parts found"
          description={search ? `No match for "${search}"` : 'No parts match the current filters.'}
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
                      <Link href={`/inventory/parts/${p.id}`} className="hover:underline">
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
