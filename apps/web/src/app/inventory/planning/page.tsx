'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState } from '@gg-erp/ui';
import {
  getMaterialPlanByStage,
  type StageMaterialPlanGroup,
  type StageMaterialPlanResponse,
} from '@/lib/api-client';

function formatStage(value: string): string {
  return value
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function StageCard({ group }: { group: StageMaterialPlanGroup }) {
  const shortages = group.lines.filter((l) => l.shortfall > 0);
  return (
    <section className="rounded-lg border border-gray-200 bg-white">
      <header className="flex items-center justify-between border-b border-gray-100 px-4 py-3">
        <h3 className="text-base font-semibold text-gray-900">{formatStage(group.installStage)}</h3>
        <div className="text-sm text-gray-600">
          {group.lines.length} parts
          {group.totalShortfall > 0 && (
            <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-xs font-medium text-red-700">
              {group.totalShortfall} short
            </span>
          )}
        </div>
      </header>
      <table className="w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-4 py-2">SKU</th>
            <th className="px-4 py-2">Part</th>
            <th className="px-4 py-2 text-right">On Hand</th>
            <th className="px-4 py-2 text-right">Min</th>
            <th className="px-4 py-2 text-right">Short</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {group.lines.map((line) => (
            <tr key={line.part.id} className={line.shortfall > 0 ? 'bg-amber-50/30' : ''}>
              <td className="px-4 py-2 font-mono text-xs text-gray-700">
                <Link href={`/inventory/parts/${line.part.id}`} className="hover:underline">
                  {line.part.sku}
                </Link>
              </td>
              <td className="px-4 py-2 text-gray-900">
                {line.part.name}
                {line.part.variant ? ` (${line.part.variant})` : ''}
              </td>
              <td className="px-4 py-2 text-right">{line.onHand}</td>
              <td className="px-4 py-2 text-right">{line.reorderPoint}</td>
              <td className="px-4 py-2 text-right font-semibold text-red-600">
                {line.shortfall > 0 ? line.shortfall : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {shortages.length === 0 && (
        <div className="border-t border-gray-100 px-4 py-2 text-xs text-gray-500">
          All parts at or above min qty.
        </div>
      )}
    </section>
  );
}

export default function PlanningPage() {
  const [plan, setPlan] = useState<StageMaterialPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getMaterialPlanByStage()
      .then((res) => {
        if (!cancelled) setPlan(res);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div>
      <PageHeader
        title="Material planning by stage"
        description={
          plan?.generatedAt ? `Snapshot at ${new Date(plan.generatedAt).toLocaleString()}` : 'Loading…'
        }
      />
      {loading ? (
        <LoadingSkeleton rows={4} cols={5} />
      ) : !plan || (plan.groups.length === 0 && plan.unassigned.length === 0) ? (
        <EmptyState
          icon="📦"
          title="No parts to plan"
          description="Add parts with an install stage to see planning data."
        />
      ) : (
        <div className="space-y-6">
          {plan.groups.map((group) => (
            <StageCard key={group.installStage} group={group} />
          ))}
          {plan.unassigned.length > 0 && (
            <section className="rounded-lg border border-gray-200 bg-white">
              <header className="border-b border-gray-100 px-4 py-3">
                <h3 className="text-base font-semibold text-gray-900">Unassigned</h3>
                <p className="text-xs text-gray-500">
                  Parts without a default install stage. Assign one on the part detail page.
                </p>
              </header>
              <ul className="divide-y divide-gray-100">
                {plan.unassigned.map((line) => (
                  <li key={line.part.id} className="flex items-center justify-between px-4 py-2 text-sm">
                    <Link
                      href={`/inventory/parts/${line.part.id}`}
                      className="font-mono text-xs text-gray-700 hover:underline"
                    >
                      {line.part.sku}
                    </Link>
                    <span className="text-gray-900">
                      {line.part.name}
                      {line.part.variant ? ` (${line.part.variant})` : ''}
                    </span>
                    <span className="text-gray-500">
                      on hand {line.onHand} / min {line.reorderPoint}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
