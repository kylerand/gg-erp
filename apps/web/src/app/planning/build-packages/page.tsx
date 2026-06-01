'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { CheckCircle2, ClipboardList, PackageCheck, Plus, RefreshCw, Search } from 'lucide-react';
import { PageHeader } from '@gg-erp/ui';
import {
  approveBom,
  createBom,
  createBuildConfiguration,
  listBoms,
  listBuildConfigurations,
  listBuildPackages,
  listCartVehicles,
  listParts,
  transitionBuildConfiguration,
  type BuildBom,
  type BuildConfiguration,
  type CartVehicle,
  type Part,
  type WorkOrderBuildPackage,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

interface DraftBomLine {
  partId: string;
  quantityPerUnit: string;
  scrapFactor: string;
}

function formatDate(value?: string): string {
  if (!value) return 'Not used';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return parsed.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function statusText(value: string): string {
  return value.replace(/_/g, ' ').toLowerCase();
}

function stateSummary(pkg: WorkOrderBuildPackage): string {
  return Object.entries(pkg.stateCounts)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => `${count} ${statusText(state)}`)
    .join(' · ');
}

function vehicleLabel(vehicle: CartVehicle): string {
  return `${vehicle.modelYear} ${vehicle.modelCode} · ${vehicle.serialNumber}`;
}

function partLabel(part: Part): string {
  return `${part.sku} · ${part.name}`;
}

function nextConfigCode(vehicle?: CartVehicle): string {
  const base = vehicle ? `${vehicle.modelCode}-${vehicle.serialNumber}` : 'BUILD';
  return `CFG-${base}-${new Date().toISOString().slice(2, 10).replace(/-/g, '')}`;
}

function nextBomCode(config?: BuildConfiguration): string {
  const base = config?.configurationCode ?? 'BUILD';
  return `BOM-${base}-R${(config?.configurationVersion ?? 1).toString().padStart(2, '0')}`;
}

export default function BuildPackagesPage() {
  const [packages, setPackages] = useState<WorkOrderBuildPackage[]>([]);
  const [configs, setConfigs] = useState<BuildConfiguration[]>([]);
  const [boms, setBoms] = useState<BuildBom[]>([]);
  const [vehicles, setVehicles] = useState<CartVehicle[]>([]);
  const [parts, setParts] = useState<Part[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();
  const [reloadToken, setReloadToken] = useState(0);

  const [configurationCode, setConfigurationCode] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [selectedOptionsText, setSelectedOptionsText] = useState('');
  const [configurationNotes, setConfigurationNotes] = useState('');

  const [bomCode, setBomCode] = useState('');
  const [buildConfigurationId, setBuildConfigurationId] = useState('');
  const [bomRevision, setBomRevision] = useState('');
  const [bomNotes, setBomNotes] = useState('');
  const [bomLines, setBomLines] = useState<DraftBomLine[]>([
    { partId: '', quantityPerUnit: '1', scrapFactor: '0' },
  ]);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);

    Promise.all([
      listBuildPackages({ search: search || undefined, limit: 100 }, { allowMockFallback: false }),
      listBuildConfigurations({ search: search || undefined, limit: 100 }, { allowMockFallback: false }),
      listBoms({ search: search || undefined, limit: 100 }, { allowMockFallback: false }),
      listCartVehicles({ limit: 100 }, { allowMockFallback: false }),
      listParts({ partState: 'ACTIVE', limit: 100 }, { allowMockFallback: false }),
    ])
      .then(([packageResult, configResult, bomResult, vehicleResult, partResult]) => {
        if (!active) return;
        setPackages(packageResult.items);
        setConfigs(configResult.items);
        setBoms(bomResult.items);
        setVehicles(vehicleResult.items);
        setParts(partResult.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPackages([]);
        setConfigs([]);
        setBoms([]);
        setError(err instanceof Error ? err.message : 'Planning catalog failed to load.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [reloadToken, search]);

  const selectedVehicle = vehicles.find((vehicle) => vehicle.id === vehicleId);
  const selectedConfig = configs.find((config) => config.id === buildConfigurationId);

  useEffect(() => {
    if (selectedVehicle && !configurationCode) {
      setConfigurationCode(nextConfigCode(selectedVehicle));
    }
  }, [configurationCode, selectedVehicle]);

  useEffect(() => {
    if (selectedConfig && !bomCode) {
      setBomCode(nextBomCode(selectedConfig));
    }
  }, [bomCode, selectedConfig]);

  const stats = useMemo(() => {
    const workOrderCount = packages.reduce((total, pkg) => total + pkg.workOrderCount, 0);
    return {
      packageCount: packages.length,
      releasedConfigs: configs.filter((config) => config.configurationStatus === 'RELEASED').length,
      approvedBoms: boms.filter((bom) => bom.bomStatus === 'APPROVED').length,
      workOrderCount,
    };
  }, [boms, configs, packages]);

  function reload(): void {
    setReloadToken((current) => current + 1);
  }

  async function submitConfiguration(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!vehicleId) {
      toast.error('Select a cart.');
      return;
    }
    setSaving(true);
    try {
      const created = await createBuildConfiguration({
        configurationCode: configurationCode.trim(),
        vehicleId,
        selectedOptions: selectedOptionsText
          .split(',')
          .map((option) => option.trim())
          .filter(Boolean),
        notes: configurationNotes.trim() || undefined,
      });
      toast.success('Build configuration created');
      setBuildConfigurationId(created.id);
      setConfigurationCode('');
      setSelectedOptionsText('');
      setConfigurationNotes('');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create build configuration.');
    } finally {
      setSaving(false);
    }
  }

  async function releaseConfiguration(config: BuildConfiguration): Promise<void> {
    setSaving(true);
    try {
      const nextState = config.configurationStatus === 'DRAFT' ? 'LOCKED' : 'RELEASED';
      await transitionBuildConfiguration(config.id, nextState);
      toast.success(nextState === 'LOCKED' ? 'Configuration locked' : 'Configuration released');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update configuration.');
    } finally {
      setSaving(false);
    }
  }

  async function submitBom(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const lines = bomLines
      .filter((line) => line.partId)
      .map((line) => ({
        partId: line.partId,
        quantityPerUnit: Number(line.quantityPerUnit),
        scrapFactor: Number(line.scrapFactor || 0),
      }));
    if (!buildConfigurationId) {
      toast.error('Select a build configuration.');
      return;
    }
    if (lines.length === 0) {
      toast.error('Add at least one BOM line.');
      return;
    }
    setSaving(true);
    try {
      await createBom({
        bomCode: bomCode.trim(),
        buildConfigurationId,
        revision: bomRevision ? Number(bomRevision) : undefined,
        notes: bomNotes.trim() || undefined,
        lines,
      });
      toast.success('BOM revision created');
      setBomCode('');
      setBomRevision('');
      setBomNotes('');
      setBomLines([{ partId: '', quantityPerUnit: '1', scrapFactor: '0' }]);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create BOM.');
    } finally {
      setSaving(false);
    }
  }

  async function approveRevision(bom: BuildBom): Promise<void> {
    setSaving(true);
    try {
      await approveBom(bom.id);
      toast.success('BOM approved');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve BOM.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Build Packages"
        description="Release build configurations, approve BOM revisions, and reuse them in work orders."
      />

      <div className="grid gap-3 sm:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.packageCount}</div>
            <div className="text-sm text-[#6E625A]">Reusable packages</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.releasedConfigs}</div>
            <div className="text-sm text-[#6E625A]">Released configs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.approvedBoms}</div>
            <div className="text-sm text-[#6E625A]">Approved BOMs</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.workOrderCount}</div>
            <div className="text-sm text-[#6E625A]">Work orders</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <ClipboardList className="h-5 w-5 text-[#E87820]" />
              Build Configuration
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitConfiguration} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="configurationCode">Configuration Code</Label>
                  <Input
                    id="configurationCode"
                    value={configurationCode}
                    onChange={(event) => setConfigurationCode(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="vehicleId">Cart</Label>
                  <select
                    id="vehicleId"
                    className="h-10 w-full rounded-md border border-[#D9CCBE] bg-white px-3 text-sm"
                    value={vehicleId}
                    onChange={(event) => {
                      setVehicleId(event.target.value);
                      setConfigurationCode('');
                    }}
                    required
                  >
                    <option value="">Select cart</option>
                    {vehicles.map((vehicle) => (
                      <option key={vehicle.id} value={vehicle.id}>
                        {vehicleLabel(vehicle)}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="selectedOptions">Selected Options</Label>
                <Input
                  id="selectedOptions"
                  value={selectedOptionsText}
                  onChange={(event) => setSelectedOptionsText(event.target.value)}
                  placeholder="Lift kit, lithium pack, audio"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="configurationNotes">Notes</Label>
                <Textarea
                  id="configurationNotes"
                  value={configurationNotes}
                  onChange={(event) => setConfigurationNotes(event.target.value)}
                  rows={3}
                />
              </div>
              <Button type="submit" disabled={saving || loading}>
                <Plus className="mr-2 h-4 w-4" />
                Create Config
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <PackageCheck className="h-5 w-5 text-[#E87820]" />
              BOM Revision
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitBom} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="buildConfigurationId">Configuration</Label>
                  <select
                    id="buildConfigurationId"
                    className="h-10 w-full rounded-md border border-[#D9CCBE] bg-white px-3 text-sm"
                    value={buildConfigurationId}
                    onChange={(event) => {
                      setBuildConfigurationId(event.target.value);
                      setBomCode('');
                    }}
                    required
                  >
                    <option value="">Select configuration</option>
                    {configs.map((config) => (
                      <option key={config.id} value={config.id}>
                        {config.configurationCode} · {statusText(config.configurationStatus)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bomCode">BOM Code</Label>
                  <Input
                    id="bomCode"
                    value={bomCode}
                    onChange={(event) => setBomCode(event.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-[120px_1fr]">
                <div className="space-y-1.5">
                  <Label htmlFor="bomRevision">Revision</Label>
                  <Input
                    id="bomRevision"
                    value={bomRevision}
                    onChange={(event) => setBomRevision(event.target.value)}
                    type="number"
                    min="1"
                    placeholder="Auto"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="bomNotes">Notes</Label>
                  <Input
                    id="bomNotes"
                    value={bomNotes}
                    onChange={(event) => setBomNotes(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>BOM Lines</Label>
                {bomLines.map((line, index) => (
                  <div key={index} className="grid gap-2 sm:grid-cols-[1fr_96px_96px_40px]">
                    <select
                      className="h-10 rounded-md border border-[#D9CCBE] bg-white px-3 text-sm"
                      value={line.partId}
                      onChange={(event) =>
                        setBomLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, partId: event.target.value } : item,
                          ),
                        )
                      }
                      required
                    >
                      <option value="">Select part</option>
                      {parts.map((part) => (
                        <option key={part.id} value={part.id}>
                          {partLabel(part)}
                        </option>
                      ))}
                    </select>
                    <Input
                      aria-label="Quantity per unit"
                      value={line.quantityPerUnit}
                      onChange={(event) =>
                        setBomLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, quantityPerUnit: event.target.value }
                              : item,
                          ),
                        )
                      }
                      type="number"
                      min="0.0001"
                      step="0.0001"
                    />
                    <Input
                      aria-label="Scrap factor"
                      value={line.scrapFactor}
                      onChange={(event) =>
                        setBomLines((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index ? { ...item, scrapFactor: event.target.value } : item,
                          ),
                        )
                      }
                      type="number"
                      min="0"
                      step="0.0001"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() =>
                        setBomLines((current) => current.filter((_, itemIndex) => itemIndex !== index))
                      }
                      disabled={bomLines.length === 1}
                    >
                      x
                    </Button>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setBomLines((current) => [
                      ...current,
                      { partId: '', quantityPerUnit: '1', scrapFactor: '0' },
                    ])
                  }
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Line
                </Button>
              </div>
              <Button type="submit" disabled={saving || loading}>
                <Plus className="mr-2 h-4 w-4" />
                Create BOM
              </Button>
            </form>
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
            <Button type="button" variant="outline" onClick={reload} disabled={loading}>
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
              No released build packages matched.
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
                        {pkg.lastWorkOrderId && pkg.lastWorkOrderNumber ? (
                          <Link
                            className="font-semibold text-[#9A4A12] hover:underline"
                            href={erpRecordRoute('work-order', pkg.lastWorkOrderId)}
                          >
                            {pkg.lastWorkOrderNumber}
                          </Link>
                        ) : (
                          <span className="font-semibold text-[#6E625A]">No work orders</span>
                        )}
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
                        {stateSummary(pkg) || statusText(pkg.source)}
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

      <div className="grid gap-4 xl:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configurations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {configs.slice(0, 8).map((config) => (
              <div
                key={config.id}
                className="flex flex-col gap-2 border-b border-[#EFE6DC] pb-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-semibold text-[#211F1E]">{config.configurationCode}</div>
                  <div className="text-xs text-[#6E625A]">
                    {config.vehicleDisplayName ?? config.vehicleId} · v{config.configurationVersion} ·{' '}
                    {statusText(config.configurationStatus)}
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving || config.configurationStatus === 'RELEASED'}
                  onClick={() => releaseConfiguration(config)}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  {config.configurationStatus === 'DRAFT' ? 'Lock' : 'Release'}
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">BOM Revisions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {boms.slice(0, 8).map((bom) => (
              <div
                key={bom.id}
                className="flex flex-col gap-2 border-b border-[#EFE6DC] pb-3 last:border-b-0 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="font-semibold text-[#211F1E]">{bom.bomCode}</div>
                  <div className="text-xs text-[#6E625A]">
                    {bom.configurationCode ?? bom.buildConfigurationId} · rev {bom.revision} ·{' '}
                    {statusText(bom.bomStatus)} · {bom.lines.length} lines
                  </div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={saving || bom.bomStatus === 'APPROVED'}
                  onClick={() => approveRevision(bom)}
                >
                  <CheckCircle2 className="mr-2 h-4 w-4" />
                  Approve
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
