'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { PackageCheck, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '@gg-erp/ui';
import { listBuildPackages, type WorkOrderBuildPackage } from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

function formatDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function stateSummary(pkg: WorkOrderBuildPackage): string {
  return Object.entries(pkg.stateCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => `${count} ${state.replace(/_/g, ' ').toLowerCase()}`)
    .join(' · ');
}

export default function BuildPackagesPage() {
  const [packages, setPackages] = useState<WorkOrderBuildPackage[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);

    listBuildPackages({ search: search || undefined, limit: 100 }, { allowMockFallback: false })
      .then((result) => {
        if (!active) return;
        setPackages(result.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPackages([]);
        setError(err instanceof Error ? err.message : 'Build package catalog failed to load.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadToken, search]);

  const stats = useMemo(() => {
    const workOrderCount = packages.reduce((total, pkg) => total + pkg.workOrderCount, 0);
    const latest = packages[0]?.lastUsedAt;
    return {
      packageCount: packages.length,
      workOrderCount,
      latest,
    };
  }, [packages]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Build Packages"
        description="Released build configuration and approved BOM pairs used by work-order creation."
      />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.packageCount}</div>
            <div className="text-sm text-[#6E625A]">Catalog packages</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.workOrderCount}</div>
            <div className="text-sm text-[#6E625A]">Work orders using packages</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">
              {stats.latest ? formatDate(stats.latest) : 'None'}
            </div>
            <div className="text-sm text-[#6E625A]">Latest package use</div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <CardTitle className="flex items-center gap-2 text-lg">
            <PackageCheck className="h-5 w-5 text-[#E87820]" />
            Planning Catalog
          </CardTitle>
          <div className="flex flex-col gap-2 sm:flex-row">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#9A8F87]" />
              <Input
                className="w-full pl-9 sm:w-72"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search package, BOM, cart, customer"
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
              Loading build packages...
            </div>
          ) : packages.length === 0 ? (
            <div className="border-t border-[#E8DDD2] p-4 text-sm text-[#6E625A]">
              No released build packages matched. Create a work order with engineering-approved
              configuration and BOM references so the package can be reused.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-[#E8DDD2] text-sm">
                <thead className="bg-[#F7F1EA] text-left text-xs uppercase tracking-wide text-[#6E625A]">
                  <tr>
                    <th className="px-4 py-3">Package</th>
                    <th className="px-4 py-3">Last Used</th>
                    <th className="px-4 py-3">Context</th>
                    <th className="px-4 py-3">Status Mix</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EFE6DC]">
                  {packages.map((pkg) => (
                    <tr key={pkg.id} className="bg-white">
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[#211F1E]">{pkg.label}</div>
                        <div className="mt-1 text-xs text-[#6E625A]">
                          Config {pkg.buildConfigurationId} · BOM {pkg.bomId}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#4A4039]">
                        <Link
                          className="font-semibold text-[#9A4A12] hover:underline"
                          href={erpRecordRoute('work-order', pkg.lastWorkOrderId)}
                        >
                          {pkg.lastWorkOrderNumber}
                        </Link>
                        <div className="mt-1 text-xs text-[#6E625A]">
                          {formatDate(pkg.lastUsedAt)}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#4A4039]">
                        <div>{pkg.lastVehicleDisplayName ?? 'Unresolved cart'}</div>
                        <div className="mt-1 text-xs text-[#6E625A]">
                          {pkg.lastCustomerDisplayName ?? 'Unresolved customer'}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-[#4A4039]">
                        {stateSummary(pkg) || 'No work-order state history'}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          className={buttonVariants({ variant: 'outline', size: 'sm' })}
                          href={erpRoute('create-work-order', { buildPackageId: pkg.id })}
                        >
                          Use Package
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
