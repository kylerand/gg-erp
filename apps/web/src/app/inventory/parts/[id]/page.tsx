'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import { getPartChain, type Part, type PartChain, type PartChainNode } from '@/lib/api-client';
import { erpRecordRoute } from '@/lib/erp-routes';

function formatEnum(value: string | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function DetailField({ label, value }: { label: string; value: string | number | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase text-gray-500">{label}</dt>
      <dd className="mt-0.5 text-sm text-gray-900">
        {value === undefined || value === '' ? '—' : value}
      </dd>
    </div>
  );
}

function ChainLink({ node, current }: { node: PartChainNode; current?: boolean }) {
  const { part, producedViaStage } = node;
  return (
    <div
      className={`rounded-md border ${current ? 'border-blue-500 bg-blue-50' : 'border-gray-200 bg-white'} px-3 py-2`}
    >
      <div className="text-xs uppercase text-gray-500">{formatEnum(part.lifecycleLevel)}</div>
      <Link
        href={erpRecordRoute('part', part.id)}
        className="font-mono text-xs text-gray-800 hover:underline"
      >
        {part.sku}
      </Link>
      <div className="text-sm text-gray-900">
        {part.name}
        {part.variant ? ` (${part.variant})` : ''}
      </div>
      {producedViaStage && (
        <div className="mt-1 text-xs text-gray-500">via {formatEnum(producedViaStage)}</div>
      )}
    </div>
  );
}

export default function PartDetailPage() {
  const params = useParams<{ id: string }>();
  const id = params?.id;
  const [chain, setChain] = useState<PartChain | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    setLoading(true);
    getPartChain(id)
      .then((res) => {
        if (!cancelled) setChain(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <div>
        <PageHeader title="Part" description="Loading…" />
        <LoadingSkeleton rows={6} cols={4} />
      </div>
    );
  }

  if (!chain) {
    return (
      <div>
        <PageHeader title="Part" description="Not found" />
        <EmptyState icon="⚠️" title="Part not found" description={`No part with id ${id}`} />
      </div>
    );
  }

  const part: Part = chain.part;
  return (
    <div>
      <PageHeader
        title={part.name + (part.variant ? ` — ${part.variant}` : '')}
        description={part.sku}
      />
      <div className="mb-6 grid grid-cols-2 gap-4 rounded-lg border border-gray-200 bg-white p-4 md:grid-cols-4">
        <DetailField label="Status" value={part.partState} />
        <DetailField label="Lifecycle" value={formatEnum(part.lifecycleLevel)} />
        <DetailField label="Category" value={formatEnum(part.category)} />
        <DetailField label="Install Stage" value={formatEnum(part.installStage)} />
        <DetailField label="Color" value={formatEnum(part.color)} />
        <DetailField label="Unit" value={part.unitOfMeasure} />
        <DetailField label="Min Qty" value={part.reorderPoint} />
        <DetailField label="On Hand" value={part.quantityOnHand ?? '—'} />
        <DetailField label="Manufacturer" value={part.manufacturerName} />
        <DetailField label="MFR Part #" value={part.manufacturerPartNumber} />
        <DetailField label="Default Vendor" value={part.defaultVendorName} />
        <DetailField label="Default Location" value={part.defaultLocationName ?? part.location} />
      </div>

      <div className="mb-3 flex items-center gap-3">
        <h2 className="text-lg font-semibold text-gray-900">Transformation chain</h2>
        <StatusBadge status={part.lifecycleLevel ?? 'RAW_COMPONENT'} />
      </div>
      {chain.ancestors.length === 0 && chain.descendants.length === 0 ? (
        <EmptyState
          icon="🧩"
          title="No transformation chain"
          description="This part is not linked to a predecessor or successor part."
        />
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          {chain.ancestors.map((n) => (
            <div key={n.part.id} className="flex items-center gap-3">
              <ChainLink node={n} />
              <span className="text-gray-400">→</span>
            </div>
          ))}
          <ChainLink node={{ part, producedViaStage: part.producedViaStage }} current />
          {chain.descendants.map((n) => (
            <div key={n.part.id} className="flex items-center gap-3">
              <span className="text-gray-400">→</span>
              <ChainLink node={n} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
