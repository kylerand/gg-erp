'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ClipboardList, FileText, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '@gg-erp/ui';
import {
  listPlanningChangeEvents,
  type PlanningChangeEntityType,
  type PlanningChangeEvent,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const ENTITY_FILTERS: Array<{ label: string; value?: PlanningChangeEntityType }> = [
  { label: 'All' },
  { label: 'Configurations', value: 'CONFIGURATION' },
  { label: 'BOMs', value: 'BOM' },
  { label: 'Routes', value: 'ROUTE' },
];

function formatDate(value?: string): string {
  if (!value) return 'Not recorded';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusText(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}

function entityLabel(value: PlanningChangeEntityType): string {
  if (value === 'CONFIGURATION') return 'Configuration';
  if (value === 'BOM') return 'BOM';
  return 'Route';
}

function actorLabel(row: PlanningChangeEvent): string {
  return row.appliedBy ?? row.approvedBy ?? 'system';
}

export default function EngineeringChangesPage() {
  const searchParams = useSearchParams();
  const routeSearch = searchParams.get('search') ?? '';
  const [rows, setRows] = useState<PlanningChangeEvent[]>([]);
  const [search, setSearch] = useState(routeSearch);
  const [entityType, setEntityType] = useState<PlanningChangeEntityType | undefined>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    setSearch(routeSearch);
  }, [routeSearch]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);

    listPlanningChangeEvents(
      {
        search: search || undefined,
        entityType,
        limit: 200,
      },
      { allowMockFallback: false },
    )
      .then((result) => {
        if (!active) return;
        setRows(result.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setRows([]);
        setError(err instanceof Error ? err.message : 'Engineering changes failed to load.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [entityType, reloadToken, search]);

  const stats = useMemo(() => {
    return {
      total: rows.length,
      configurations: rows.filter((row) => row.entityType === 'CONFIGURATION').length,
      boms: rows.filter((row) => row.entityType === 'BOM').length,
      routes: rows.filter((row) => row.entityType === 'ROUTE').length,
      withApprovalNotes: rows.filter((row) => row.approvalNote).length,
    };
  }, [rows]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Engineering Changes"
        description="Review full planning master change history for configurations, BOMs, and route versions."
      />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.total}</div>
            <div className="text-sm text-[#6E625A]">Change events</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.configurations}</div>
            <div className="text-sm text-[#6E625A]">Configurations</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.boms}</div>
            <div className="text-sm text-[#6E625A]">BOM events</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.routes}</div>
            <div className="text-sm text-[#6E625A]">Route events</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.withApprovalNotes}</div>
            <div className="text-sm text-[#6E625A]">Approval notes</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <FileText className="h-5 w-5 text-[#E87820]" />
            ECO History
          </CardTitle>
          <div className="flex flex-col gap-2 lg:flex-row lg:items-center">
            <div className="flex flex-wrap gap-2">
              {ENTITY_FILTERS.map((filter) => (
                <Button
                  key={filter.label}
                  type="button"
                  variant={filter.value === entityType ? 'default' : 'outline'}
                  size="sm"
                  onClick={() => setEntityType(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9A8F87]" />
              <Input
                className="w-full pl-9 lg:w-72"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search ECO, code, actor"
              />
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => setReloadToken((current) => current + 1)}
              disabled={loading}
            >
              <RefreshCw className="mr-2 h-4 w-4" />
              Refresh
            </Button>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {error ? (
            <div className="border-t border-red-200 bg-red-50 p-4 text-sm text-red-700">
              {error}
            </div>
          ) : loading ? (
            <div className="border-t border-[#E8DDD2] p-4 text-sm text-[#6E625A]">
              Loading engineering changes...
            </div>
          ) : rows.length === 0 ? (
            <div className="border-t border-[#E8DDD2] p-4 text-sm text-[#6E625A]">
              No engineering changes matched.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#E8DDD2] text-sm">
                <thead className="bg-[#F7F1EA] text-left text-xs uppercase tracking-wide text-[#6E625A]">
                  <tr>
                    <th className="px-4 py-3">Record</th>
                    <th className="px-4 py-3">Change</th>
                    <th className="px-4 py-3">Approval Evidence</th>
                    <th className="px-4 py-3">Applied</th>
                    <th className="px-4 py-3 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE6DC]">
                  {rows.map((row) => (
                    <tr key={row.id} className="bg-white align-top">
                      <td className="px-4 py-3">
                        <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                          {entityLabel(row.entityType)}
                        </div>
                        <div className="font-semibold text-[#211F1E]">{row.recordCode}</div>
                        <div className="mt-1 text-xs text-[#6E625A]">{row.versionLabel}</div>
                      </td>
                      <td className="px-4 py-3 text-[#4A4039]">
                        <div className="font-semibold text-[#211F1E]">{statusText(row.changeKind)}</div>
                        <div className="mt-1">{row.changeSummary}</div>
                        <div className="mt-1 text-xs text-[#6E625A]">
                          {row.previousStatus
                            ? `${statusText(row.previousStatus)} to ${statusText(row.newStatus)}`
                            : statusText(row.newStatus)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#4A4039]">
                        {row.approvalNote ? (
                          <div className="rounded-md bg-[#F7F1EA] px-3 py-2 text-xs">
                            {row.approvalNote}
                          </div>
                        ) : (
                          <span className="text-[#6E625A]">No approval note required</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[#4A4039]">
                        <div>{formatDate(row.createdAt)}</div>
                        <div className="mt-1 text-xs text-[#6E625A]">{actorLabel(row)}</div>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                          href={erpRoute('build-package', { search: row.recordCode })}
                        >
                          <ClipboardList className="mr-2 h-4 w-4" />
                          Review Master
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
