'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { PageHeader, LoadingSkeleton, EmptyState } from '@gg-erp/ui';
import {
  createPurchaseOrder,
  getMaterialPlanByStage,
  type ReplenishmentRecommendation,
  type ReplenishmentVendorGroup,
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

function formatQuantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function formatMoney(value: number): string {
  return value.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  });
}

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function expectedDateFromLeadTime(leadTimeDays?: number): string {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(leadTimeDays ?? 0, 0));
  return date.toISOString();
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
            <th className="px-4 py-2 text-right">Reserved</th>
            <th className="px-4 py-2 text-right">Avail</th>
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
              <td className="px-4 py-2 text-right">{formatQuantity(line.reserved ?? 0)}</td>
              <td className="px-4 py-2 text-right">
                {formatQuantity(line.available ?? line.onHand)}
              </td>
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

function ReplenishmentPanel({
  groups,
  summary,
  selectedRecommendations,
  creatingVendorId,
  createError,
  onToggleRecommendation,
  onCreatePurchaseOrder,
}: {
  groups: ReplenishmentVendorGroup[];
  summary: NonNullable<StageMaterialPlanResponse['replenishment']>['summary'];
  selectedRecommendations: Record<string, boolean>;
  creatingVendorId: string | null;
  createError: string | null;
  onToggleRecommendation: (partId: string) => void;
  onCreatePurchaseOrder: (group: ReplenishmentVendorGroup) => void;
}) {
  return (
    <section id="replenishment" className="mb-6 rounded-lg border border-gray-200 bg-white">
      <header className="flex flex-col gap-3 border-b border-gray-100 px-4 py-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">Replenishment actions</h2>
          <p className="text-sm text-gray-600">
            {summary.recommendationCount > 0
              ? `${summary.recommendationCount} part${summary.recommendationCount === 1 ? '' : 's'} need PO action.`
              : 'No purchase orders are needed from the current inventory position.'}
          </p>
        </div>
        <div className="grid grid-cols-3 gap-3 text-right text-sm">
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Buy</div>
            <div className="font-semibold text-gray-900">
              {formatQuantity(summary.totalRecommendedQuantity)}
            </div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Cost</div>
            <div className="font-semibold text-gray-900">{formatMoney(summary.estimatedCost)}</div>
          </div>
          <div>
            <div className="text-xs uppercase tracking-wide text-gray-500">Vendors</div>
            <div className="font-semibold text-gray-900">{summary.vendorGroupCount}</div>
          </div>
        </div>
      </header>
      {createError && (
        <div className="border-b border-red-100 bg-red-50 px-4 py-3 text-sm text-red-900">
          {createError}
        </div>
      )}
      {summary.recommendationCount === 0 ? (
        <div className="px-4 py-5 text-sm text-gray-600">
          Current available inventory plus open inbound purchase orders covers every reorder point.
        </div>
      ) : (
        <div className="divide-y divide-gray-100">
          {groups.map((group) => (
            <ReplenishmentVendorSection
              key={group.vendorId ?? 'unassigned'}
              group={group}
              selectedRecommendations={selectedRecommendations}
              creating={creatingVendorId === group.vendorId}
              onToggleRecommendation={onToggleRecommendation}
              onCreatePurchaseOrder={onCreatePurchaseOrder}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function ReplenishmentVendorSection({
  group,
  selectedRecommendations,
  creating,
  onToggleRecommendation,
  onCreatePurchaseOrder,
}: {
  group: ReplenishmentVendorGroup;
  selectedRecommendations: Record<string, boolean>;
  creating: boolean;
  onToggleRecommendation: (partId: string) => void;
  onCreatePurchaseOrder: (group: ReplenishmentVendorGroup) => void;
}) {
  const canCreate = Boolean(group.vendorId) && group.vendorState !== 'INACTIVE';
  const selected = group.recommendations.filter(
    (recommendation) => selectedRecommendations[recommendation.part.id],
  );
  const selectedQuantity = selected.reduce(
    (sum, recommendation) => sum + recommendation.recommendedOrderQuantity,
    0,
  );
  const selectedCost = selected.reduce(
    (sum, recommendation) =>
      sum + recommendation.recommendedOrderQuantity * (recommendation.estimatedUnitCost ?? 0),
    0,
  );

  return (
    <section id={`replenishment-${group.vendorId ?? 'unassigned'}`} className="px-4 py-4">
      <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h3 className="text-base font-semibold text-gray-900">{group.vendorName}</h3>
          <p className="text-xs text-gray-500">
            {group.leadTimeDays ? `${group.leadTimeDays} day lead time` : 'Lead time not set'} ·{' '}
            {group.recommendations.length} part{group.recommendations.length === 1 ? '' : 's'} ·{' '}
            {formatQuantity(group.totalRecommendedQuantity)} units recommended
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-right text-xs text-gray-500">
            <div>
              Selected: {formatQuantity(selectedQuantity)} units · {formatMoney(selectedCost)}
            </div>
            {group.vendorState === 'INACTIVE' && (
              <div className="font-semibold text-red-700">Vendor inactive</div>
            )}
          </div>
          <button
            type="button"
            disabled={!canCreate || selected.length === 0 || creating}
            onClick={() => onCreatePurchaseOrder(group)}
            className="rounded-md border border-gray-900 bg-gray-900 px-3 py-2 text-sm font-semibold text-white hover:bg-gray-700 disabled:cursor-not-allowed disabled:border-gray-300 disabled:bg-gray-200 disabled:text-gray-500"
          >
            {creating ? 'Creating PO...' : 'Create draft PO'}
          </button>
        </div>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="w-10 px-3 py-2">Use</th>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">Part</th>
              <th className="px-3 py-2 text-right">Avail</th>
              <th className="px-3 py-2 text-right">Inbound</th>
              <th className="px-3 py-2 text-right">Min</th>
              <th className="px-3 py-2 text-right">Buy</th>
              <th className="px-3 py-2 text-right">Unit Cost</th>
              <th className="px-3 py-2">Next ETA</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {group.recommendations.map((recommendation) => (
              <ReplenishmentRow
                key={recommendation.part.id}
                recommendation={recommendation}
                checked={Boolean(selectedRecommendations[recommendation.part.id])}
                disabled={!canCreate}
                onToggle={() => onToggleRecommendation(recommendation.part.id)}
              />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ReplenishmentRow({
  recommendation,
  checked,
  disabled,
  onToggle,
}: {
  recommendation: ReplenishmentRecommendation;
  checked: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  const severityStyle: Record<ReplenishmentRecommendation['severity'], string> = {
    critical: 'bg-red-50',
    high: 'bg-amber-50',
    medium: '',
  };
  return (
    <tr className={severityStyle[recommendation.severity]}>
      <td className="px-3 py-2">
        <input
          type="checkbox"
          checked={checked}
          disabled={disabled}
          onChange={onToggle}
          aria-label={`Use ${recommendation.part.sku} in replenishment PO`}
          className="h-4 w-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900 disabled:cursor-not-allowed"
        />
      </td>
      <td className="px-3 py-2 font-mono text-xs text-gray-700">
        <Link href={erpRecordRoute('part', recommendation.part.id)} className="hover:underline">
          {recommendation.part.sku}
        </Link>
      </td>
      <td className="px-3 py-2 text-gray-900">
        <div className="font-medium">
          {recommendation.part.name}
          {recommendation.part.variant ? ` (${recommendation.part.variant})` : ''}
        </div>
        <div className="text-xs text-gray-500">{recommendation.reason}</div>
      </td>
      <td className="px-3 py-2 text-right">{formatQuantity(recommendation.available)}</td>
      <td className="px-3 py-2 text-right">{formatQuantity(recommendation.inboundQuantity)}</td>
      <td className="px-3 py-2 text-right">{formatQuantity(recommendation.reorderPoint)}</td>
      <td className="px-3 py-2 text-right font-semibold text-gray-900">
        {formatQuantity(recommendation.recommendedOrderQuantity)}
      </td>
      <td className="px-3 py-2 text-right">{formatMoney(recommendation.estimatedUnitCost ?? 0)}</td>
      <td className="px-3 py-2 text-gray-600">
        {recommendation.nextExpectedAt ? formatDate(recommendation.nextExpectedAt) : 'Not ordered'}
      </td>
    </tr>
  );
}

export default function PlanningPage() {
  const router = useRouter();
  const [plan, setPlan] = useState<StageMaterialPlanResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedRecommendations, setSelectedRecommendations] = useState<Record<string, boolean>>(
    {},
  );
  const [creatingVendorId, setCreatingVendorId] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setLoadError(null);
    getMaterialPlanByStage({ allowMockFallback: false })
      .then((res) => {
        if (!cancelled) setPlan(res);
      })
      .catch((err) => {
        if (!cancelled) {
          setPlan(null);
          setLoadError(
            err instanceof Error ? err.message : 'Material planning data failed to load.',
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const recommendations = plan?.replenishment?.recommendations ?? [];
    setSelectedRecommendations((current) => {
      const next: Record<string, boolean> = {};
      for (const recommendation of recommendations) {
        const canCreate =
          Boolean(recommendation.vendorId) && recommendation.vendorState !== 'INACTIVE';
        next[recommendation.part.id] = current[recommendation.part.id] ?? canCreate;
      }
      return next;
    });
  }, [plan]);

  const summary = useMemo(() => summarizePlan(plan), [plan]);
  const actions = useMemo(() => buildActionQueue(plan), [plan]);
  const todayState = useMemo(
    () => summarizeState(summary, actions.length, plan?.replenishment?.summary),
    [summary, actions, plan],
  );

  const toggleRecommendation = (partId: string) => {
    setSelectedRecommendations((current) => ({ ...current, [partId]: !current[partId] }));
  };

  const handleCreatePurchaseOrder = async (group: ReplenishmentVendorGroup) => {
    setCreateError(null);
    if (!group.vendorId) {
      setCreateError('Assign default vendors before creating replenishment purchase orders.');
      return;
    }
    if (group.vendorState === 'INACTIVE') {
      setCreateError(`${group.vendorName} is inactive. Update the vendor before creating a PO.`);
      return;
    }
    const selected = group.recommendations.filter(
      (recommendation) => selectedRecommendations[recommendation.part.id],
    );
    if (selected.length === 0) {
      setCreateError(`Select at least one ${group.vendorName} line before creating a PO.`);
      return;
    }

    setCreatingVendorId(group.vendorId);
    try {
      const purchaseOrder = await createPurchaseOrder({
        vendorId: group.vendorId,
        expectedAt: expectedDateFromLeadTime(group.leadTimeDays),
        notes: `Inventory replenishment recommendation generated ${new Date().toLocaleString()}.`,
        lines: selected.map((recommendation) => ({
          partId: recommendation.part.id,
          orderedQuantity: recommendation.recommendedOrderQuantity,
          unitCost: recommendation.estimatedUnitCost ?? 0,
        })),
      });
      router.push(erpRecordRoute('purchase-order', purchaseOrder.id));
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Unable to create replenishment PO.');
    } finally {
      setCreatingVendorId(null);
    }
  };

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
      {!loading && loadError && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          {loadError}
        </div>
      )}
      {!loading && plan && actions.length > 0 && <ActionQueue actions={actions} />}
      {!loading && plan?.replenishment && (
        <ReplenishmentPanel
          groups={plan.replenishment.vendorGroups}
          summary={plan.replenishment.summary}
          selectedRecommendations={selectedRecommendations}
          creatingVendorId={creatingVendorId}
          createError={createError}
          onToggleRecommendation={toggleRecommendation}
          onCreatePurchaseOrder={handleCreatePurchaseOrder}
        />
      )}
      {loading ? (
        <LoadingSkeleton rows={4} cols={7} />
      ) : loadError ? null : !plan || (plan.groups.length === 0 && plan.unassigned.length === 0) ? (
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
  const recommendations = plan.replenishment?.recommendations ?? [];
  if (recommendations.length > 0) {
    const actions: QueuedAction[] = recommendations
      .slice(0, TOP_SHORTAGE_LIMIT)
      .map((recommendation) => {
        const stage = recommendation.part.installStage
          ? formatStage(recommendation.part.installStage)
          : 'Unassigned';
        return {
          severity: recommendation.severity === 'critical' ? 'high' : recommendation.severity,
          title: `${recommendation.part.name}${recommendation.part.variant ? ` (${recommendation.part.variant})` : ''} - buy ${formatQuantity(recommendation.recommendedOrderQuantity)}`,
          detail: `${stage} · available ${formatQuantity(recommendation.available)} / min ${formatQuantity(recommendation.reorderPoint)} · inbound ${formatQuantity(recommendation.inboundQuantity)} · SKU ${recommendation.part.sku}${
            recommendation.vendorName ? ` · vendor ${recommendation.vendorName}` : ''
          }.`,
          cta: recommendation.vendorId ? 'Open buying list' : 'Assign vendor',
          href: recommendation.vendorId
            ? `#replenishment-${recommendation.vendorId}`
            : erpRecordRoute('part', recommendation.part.id),
        } satisfies QueuedAction;
      });
    if (recommendations.length > TOP_SHORTAGE_LIMIT) {
      actions.push({
        severity: 'low',
        title: `${recommendations.length - TOP_SHORTAGE_LIMIT} more replenishment part${recommendations.length - TOP_SHORTAGE_LIMIT === 1 ? '' : 's'} need review`,
        detail: 'Remaining lines are grouped by vendor in the replenishment table.',
        cta: 'Open list',
        href: '#replenishment',
      });
    }
    return actions;
  }
  const allShort: StageMaterialPlanLine[] = [
    ...plan.groups.flatMap((g) => g.lines.filter((l) => l.shortfall > 0)),
    ...plan.unassigned.filter((l) => l.shortfall > 0),
  ].sort((a, b) => b.shortfall - a.shortfall);

  if (allShort.length === 0) return [];

  const out: QueuedAction[] = [];
  for (const line of allShort.slice(0, TOP_SHORTAGE_LIMIT)) {
    const stage = line.part.installStage ? formatStage(line.part.installStage) : 'Unassigned';
    const hasVendor = Boolean(line.part.defaultVendorId);
    out.push({
      severity: line.shortfall >= line.reorderPoint ? 'high' : 'medium',
      title: `${line.part.name}${line.part.variant ? ` (${line.part.variant})` : ''} — short ${line.shortfall}`,
      detail: `${stage} · on hand ${line.onHand} / min ${line.reorderPoint} · SKU ${line.part.sku}${
        line.part.defaultVendorName ? ` · vendor ${line.part.defaultVendorName}` : ''
      }.`,
      cta: hasVendor ? 'Review vendor POs →' : 'Open part →',
      href: hasVendor
        ? erpRoute('purchase-order', { vendorId: line.part.defaultVendorId })
        : erpRecordRoute('part', line.part.id),
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

function summarizeState(
  s: PlanSummary,
  actionCount: number,
  replenishment?: NonNullable<StageMaterialPlanResponse['replenishment']>['summary'],
): TodayState {
  if (replenishment) {
    if (replenishment.recommendationCount === 0 && s.totalShortageParts > 0) {
      return {
        tone: 'green',
        headline: 'Open POs cover the current reorder gaps.',
        subhead: `${s.totalShortageParts} part${s.totalShortageParts === 1 ? '' : 's'} are physically below min, but inbound quantities cover the cutoff.`,
      };
    }
    if (replenishment.recommendationCount === 0) {
      return {
        tone: 'green',
        headline: 'Every stage is stocked.',
        subhead: 'No parts below their reorder point. Nothing to do here today.',
      };
    }
    const tone: TodayState['tone'] =
      replenishment.criticalCount > 0 || replenishment.highCount > 0 ? 'red' : 'amber';
    return {
      tone,
      headline: `${replenishment.recommendationCount} replenishment action${replenishment.recommendationCount === 1 ? '' : 's'} ready.`,
      subhead: `${formatQuantity(replenishment.totalRecommendedQuantity)} units recommended across ${replenishment.vendorGroupCount} vendor${replenishment.vendorGroupCount === 1 ? '' : 's'}. Action queue lists the top ${Math.min(actionCount, TOP_SHORTAGE_LIMIT)} by urgency.`,
    };
  }
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
