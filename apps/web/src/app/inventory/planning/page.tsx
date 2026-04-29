'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState } from '@gg-erp/ui';
import {
  getMaterialPlanByStage,
  type StageMaterialPlanGroup,
  type StageMaterialPlanLine,
  type StageMaterialPlanResponse,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';

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
                <Link href={erpRecordRoute('part', line.part.id)} className="hover:underline">
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

  const summary = useMemo(() => summarizePlan(plan), [plan]);
  const actions = useMemo(() => buildActionQueue(plan), [plan]);
  const todayState = useMemo(() => summarizeState(summary, actions.length), [summary, actions]);

  return (
    <div>
      <PageHeader
        title="Material planning by stage"
        description={
          plan?.generatedAt
            ? `Snapshot at ${new Date(plan.generatedAt).toLocaleString()}`
            : 'Loading…'
        }
      />
      <TodayBanner state={todayState} loading={loading} />
      {!loading && plan && actions.length > 0 && <ActionQueue actions={actions} />}
      {loading ? (
        <LoadingSkeleton rows={4} cols={5} />
      ) : !plan || (plan.groups.length === 0 && plan.unassigned.length === 0) ? (
        <EmptyState
          icon="📦"
          title="No parts to plan"
          description="Add parts with an install stage to see planning data."
        />
      ) : (
        <details className="mb-2">
          <summary className="cursor-pointer text-sm font-semibold text-gray-700 hover:text-gray-900 py-2">
            Reference: full inventory by stage ({plan.groups.length} stage
            {plan.groups.length === 1 ? '' : 's'}
            {plan.unassigned.length ? `, ${plan.unassigned.length} unassigned` : ''})
          </summary>
          <div className="space-y-6 mt-4">
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
                    <li
                      key={line.part.id}
                      className="flex items-center justify-between px-4 py-2 text-sm"
                    >
                      <Link
                        href={erpRecordRoute('part', line.part.id)}
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
        </details>
      )}
    </div>
  );
}

interface PlanSummary {
  totalShortageParts: number;
  totalShortfallUnits: number;
  stagesWithShortage: number;
  unassignedShortageParts: number;
  worstStage: { stage: string; shortfall: number } | null;
}

function summarizePlan(plan: StageMaterialPlanResponse | null): PlanSummary {
  if (!plan) {
    return {
      totalShortageParts: 0,
      totalShortfallUnits: 0,
      stagesWithShortage: 0,
      unassignedShortageParts: 0,
      worstStage: null,
    };
  }
  let totalShortageParts = 0;
  let totalShortfallUnits = 0;
  let stagesWithShortage = 0;
  let worstStage: { stage: string; shortfall: number } | null = null;
  for (const group of plan.groups) {
    if (group.totalShortfall > 0) {
      stagesWithShortage += 1;
      if (!worstStage || group.totalShortfall > worstStage.shortfall) {
        worstStage = { stage: group.installStage, shortfall: group.totalShortfall };
      }
    }
    totalShortfallUnits += group.totalShortfall;
    totalShortageParts += group.lines.filter((l) => l.shortfall > 0).length;
  }
  const unassignedShortageParts = plan.unassigned.filter((l) => l.shortfall > 0).length;
  totalShortageParts += unassignedShortageParts;
  return {
    totalShortageParts,
    totalShortfallUnits,
    stagesWithShortage,
    unassignedShortageParts,
    worstStage,
  };
}

interface QueuedAction {
  severity: 'high' | 'medium' | 'low' | 'info';
  title: string;
  detail: string;
  cta: string;
  href: string;
}

const TOP_SHORTAGE_LIMIT = 5;

function buildActionQueue(plan: StageMaterialPlanResponse | null): QueuedAction[] {
  if (!plan) return [];
  const allShort: StageMaterialPlanLine[] = [
    ...plan.groups.flatMap((g) => g.lines.filter((l) => l.shortfall > 0)),
    ...plan.unassigned.filter((l) => l.shortfall > 0),
  ].sort((a, b) => b.shortfall - a.shortfall);

  if (allShort.length === 0) return [];

  const out: QueuedAction[] = [];
  for (const line of allShort.slice(0, TOP_SHORTAGE_LIMIT)) {
    const stage = line.part.installStage ? formatStage(line.part.installStage) : 'Unassigned';
    out.push({
      severity: line.shortfall >= line.reorderPoint ? 'high' : 'medium',
      title: `${line.part.name}${line.part.variant ? ` (${line.part.variant})` : ''} — short ${line.shortfall}`,
      detail: `${stage} · on hand ${line.onHand} / min ${line.reorderPoint} · SKU ${line.part.sku}. Open the part to adjust on-hand or kick off a reorder.`,
      cta: 'Open part →',
      href: erpRecordRoute('part', line.part.id),
    });
  }
  if (allShort.length > TOP_SHORTAGE_LIMIT) {
    out.push({
      severity: 'low',
      title: `${allShort.length - TOP_SHORTAGE_LIMIT} more part${allShort.length - TOP_SHORTAGE_LIMIT === 1 ? '' : 's'} short below the cutoff`,
      detail:
        "Smaller shortages are listed in the reference table. Reorder when convenient — they aren't blocking today's builds.",
      cta: 'Browse parts →',
      href: erpRoute('part'),
    });
  }
  return out;
}

interface TodayState {
  tone: 'green' | 'amber' | 'red' | 'neutral';
  headline: string;
  subhead: string;
}

function summarizeState(s: PlanSummary, actionCount: number): TodayState {
  if (s.totalShortageParts === 0) {
    return {
      tone: 'green',
      headline: 'Every stage is stocked.',
      subhead: 'No parts below their reorder point. Nothing to do here today.',
    };
  }
  if (s.stagesWithShortage >= 2 || s.totalShortfallUnits >= 20) {
    const worst = s.worstStage
      ? ` Worst: ${formatStage(s.worstStage.stage)} (${s.worstStage.shortfall} units).`
      : '';
    return {
      tone: 'red',
      headline: `${s.totalShortageParts} part${s.totalShortageParts === 1 ? '' : 's'} short across ${s.stagesWithShortage} stage${s.stagesWithShortage === 1 ? '' : 's'}.`,
      subhead: `${s.totalShortfallUnits} units total below min.${worst} Action queue lists the top ${Math.min(actionCount, TOP_SHORTAGE_LIMIT)} by shortfall.`,
    };
  }
  return {
    tone: 'amber',
    headline: `${s.totalShortageParts} part${s.totalShortageParts === 1 ? '' : 's'} below min.`,
    subhead: 'Not blocking yet, but worth reordering before the next build batch.',
  };
}

function TodayBanner({ state, loading }: { state: TodayState; loading: boolean }) {
  if (loading) {
    return (
      <div className="mb-6 bg-gray-50 border border-gray-200 rounded-lg p-4 animate-pulse">
        <div className="h-5 w-64 bg-gray-200 rounded" />
        <div className="h-3 w-96 bg-gray-100 rounded mt-2" />
      </div>
    );
  }
  const toneStyles: Record<TodayState['tone'], string> = {
    green: 'bg-green-50 border-green-200 text-green-900',
    amber: 'bg-yellow-50 border-yellow-200 text-yellow-900',
    red: 'bg-red-50 border-red-200 text-red-900',
    neutral: 'bg-gray-50 border-gray-200 text-gray-900',
  };
  return (
    <div className={`mb-4 border rounded-lg p-4 ${toneStyles[state.tone]}`}>
      <div className="font-semibold text-base">{state.headline}</div>
      <div className="text-sm mt-1 opacity-80">{state.subhead}</div>
    </div>
  );
}

function ActionQueue({ actions }: { actions: QueuedAction[] }) {
  return (
    <div className="mb-6 space-y-2">
      {actions.map((a, i) => (
        <ActionRow key={i} action={a} />
      ))}
    </div>
  );
}

function ActionRow({ action }: { action: QueuedAction }) {
  const styles: Record<QueuedAction['severity'], { dot: string; border: string }> = {
    high: { dot: 'bg-red-500', border: 'border-red-200 bg-red-50/50' },
    medium: { dot: 'bg-amber-500', border: 'border-amber-200 bg-amber-50/50' },
    low: { dot: 'bg-blue-500', border: 'border-blue-200 bg-blue-50/50' },
    info: { dot: 'bg-green-500', border: 'border-green-200 bg-green-50/30' },
  };
  const s = styles[action.severity];
  return (
    <div className={`border rounded-lg p-4 flex items-start gap-3 ${s.border}`}>
      <span className={`mt-1.5 h-2 w-2 rounded-full flex-shrink-0 ${s.dot}`} aria-hidden />
      <div className="flex-1 min-w-0">
        <div className="font-semibold text-sm text-gray-900">{action.title}</div>
        <p className="text-xs text-gray-600 mt-1">{action.detail}</p>
      </div>
      <Link
        href={action.href}
        className="flex-shrink-0 text-xs font-semibold text-gray-900 bg-white border border-gray-300 rounded-md px-3 py-1.5 hover:border-gray-500 hover:bg-gray-50"
      >
        {action.cta}
      </Link>
    </div>
  );
}
