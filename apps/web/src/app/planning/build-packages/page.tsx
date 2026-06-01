'use client';

import Link from 'next/link';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ClipboardList,
  History,
  PackageCheck,
  Plus,
  RefreshCw,
  Route,
  Search,
} from 'lucide-react';
import { PageHeader } from '@gg-erp/ui';
import {
  approveBom,
  createBom,
  createBuildConfiguration,
  createRoutingTemplate,
  listBoms,
  listBuildConfigurations,
  listBuildPackages,
  listCartVehicles,
  listParts,
  listRoutingTemplates,
  transitionRoutingTemplate,
  transitionBuildConfiguration,
  type BuildBom,
  type BuildConfiguration,
  type CartVehicle,
  type Part,
  type RoutingTemplate,
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

interface DraftRoutingStep {
  operationCode: string;
  operationName: string;
  workstationCode: string;
  estimatedMinutes: string;
  laborRateDollars: string;
  requiredSkillCode: string;
  jobCardTitle: string;
  jobCardInstructions: string;
  qcRequired: boolean;
  evidenceRequired: boolean;
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

function nextRouteCode(config?: BuildConfiguration): string {
  const base = config?.configurationCode ?? 'BUILD';
  return `RT-${base}`;
}

function defaultRoutingStep(): DraftRoutingStep {
  return {
    operationCode: '',
    operationName: '',
    workstationCode: '',
    estimatedMinutes: '60',
    laborRateDollars: '',
    requiredSkillCode: '',
    jobCardTitle: '',
    jobCardInstructions: '',
    qcRequired: false,
    evidenceRequired: false,
  };
}

function dollarsToCents(value: string): number | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed * 100) : undefined;
}

function formatCurrencyCents(value: number): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(value / 100);
}

function dateInputToIso(value: string, exclusiveEnd = false): string {
  const date = new Date(`${value}T00:00:00`);
  if (exclusiveEnd) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

export default function BuildPackagesPage() {
  const [packages, setPackages] = useState<WorkOrderBuildPackage[]>([]);
  const [configs, setConfigs] = useState<BuildConfiguration[]>([]);
  const [boms, setBoms] = useState<BuildBom[]>([]);
  const [routingTemplates, setRoutingTemplates] = useState<RoutingTemplate[]>([]);
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

  const [routeCode, setRouteCode] = useState('');
  const [routeName, setRouteName] = useState('');
  const [routeBuildConfigurationId, setRouteBuildConfigurationId] = useState('');
  const [routeEffectiveFrom, setRouteEffectiveFrom] = useState('');
  const [routeEffectiveTo, setRouteEffectiveTo] = useState('');
  const [routeNotes, setRouteNotes] = useState('');
  const [routingSteps, setRoutingSteps] = useState<DraftRoutingStep[]>([defaultRoutingStep()]);
  const [routeApprovalNotes, setRouteApprovalNotes] = useState<Record<string, string>>({});

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(undefined);

    Promise.all([
      listBuildPackages({ search: search || undefined, limit: 100 }, { allowMockFallback: false }),
      listBuildConfigurations({ search: search || undefined, limit: 100 }, { allowMockFallback: false }),
      listBoms({ search: search || undefined, limit: 100 }, { allowMockFallback: false }),
      listRoutingTemplates(
        { search: search || undefined, limit: 100 },
        { allowMockFallback: false },
      ),
      listCartVehicles({ limit: 100 }, { allowMockFallback: false }),
      listParts({ partState: 'ACTIVE', limit: 100 }, { allowMockFallback: false }),
    ])
      .then(([packageResult, configResult, bomResult, routingResult, vehicleResult, partResult]) => {
        if (!active) return;
        setPackages(packageResult.items);
        setConfigs(configResult.items);
        setBoms(bomResult.items);
        setRoutingTemplates(routingResult.items);
        setVehicles(vehicleResult.items);
        setParts(partResult.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setPackages([]);
        setConfigs([]);
        setBoms([]);
        setRoutingTemplates([]);
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
  const selectedRouteConfig = configs.find((config) => config.id === routeBuildConfigurationId);

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

  useEffect(() => {
    if (selectedRouteConfig && !routeCode) {
      setRouteCode(nextRouteCode(selectedRouteConfig));
    }
  }, [routeCode, selectedRouteConfig]);

  const stats = useMemo(() => {
    const workOrderCount = packages.reduce((total, pkg) => total + pkg.workOrderCount, 0);
    return {
      packageCount: packages.length,
      releasedConfigs: configs.filter((config) => config.configurationStatus === 'RELEASED').length,
      approvedBoms: boms.filter((bom) => bom.bomStatus === 'APPROVED').length,
      activeRoutes: routingTemplates.filter((template) => template.templateStatus === 'ACTIVE').length,
      workOrderCount,
    };
  }, [boms, configs, packages, routingTemplates]);

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

  async function submitRoutingTemplate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const steps = routingSteps
      .filter((step) => step.operationCode.trim() || step.operationName.trim())
      .map((step, index) => ({
        sequenceNo: (index + 1) * 10,
        operationCode: step.operationCode.trim(),
        operationName: step.operationName.trim(),
        workstationCode: step.workstationCode.trim() || undefined,
        estimatedMinutes: Number(step.estimatedMinutes),
        laborRateCents: dollarsToCents(step.laborRateDollars),
        requiredSkillCode: step.requiredSkillCode.trim() || undefined,
        jobCardTitle: step.jobCardTitle.trim() || undefined,
        jobCardInstructions: step.jobCardInstructions.trim() || undefined,
        qcRequired: step.qcRequired,
        evidenceRequired: step.evidenceRequired,
      }));
    if (!routeCode.trim() || !routeName.trim()) {
      toast.error('Route code and name are required.');
      return;
    }
    if (steps.length === 0) {
      toast.error('Add at least one routing step.');
      return;
    }
    if (steps.some((step) => !step.operationCode || !step.operationName || !step.estimatedMinutes)) {
      toast.error('Each routing step needs a code, name, and estimated minutes.');
      return;
    }
    if (routingSteps.some((step) => step.laborRateDollars && dollarsToCents(step.laborRateDollars) === undefined)) {
      toast.error('Labor rates must be zero or greater.');
      return;
    }

    setSaving(true);
    try {
      await createRoutingTemplate({
        routeCode: routeCode.trim(),
        routeName: routeName.trim(),
        buildConfigurationId: routeBuildConfigurationId || undefined,
        effectiveFrom: routeEffectiveFrom ? dateInputToIso(routeEffectiveFrom) : undefined,
        effectiveTo: routeEffectiveTo ? dateInputToIso(routeEffectiveTo, true) : undefined,
        notes: routeNotes.trim() || undefined,
        steps,
      });
      toast.success('Routing template created');
      setRouteCode('');
      setRouteName('');
      setRouteBuildConfigurationId('');
      setRouteEffectiveFrom('');
      setRouteEffectiveTo('');
      setRouteNotes('');
      setRoutingSteps([defaultRoutingStep()]);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create routing template.');
    } finally {
      setSaving(false);
    }
  }

  async function transitionRoute(template: RoutingTemplate, status: 'ACTIVE' | 'RETIRED'): Promise<void> {
    const approvalNote = routeApprovalNotes[template.id]?.trim();
    if (!approvalNote) {
      toast.error('Add an approval note before changing route status.');
      return;
    }
    setSaving(true);
    try {
      await transitionRoutingTemplate(template.id, status, {
        approvalNote,
        changeSummary:
          status === 'ACTIVE'
            ? `Approved activation of ${template.routeCode} v${template.routeVersion}.`
            : `Approved retirement of ${template.routeCode} v${template.routeVersion}.`,
      });
      toast.success(status === 'ACTIVE' ? 'Routing template activated' : 'Routing template retired');
      setRouteApprovalNotes((current) => ({ ...current, [template.id]: '' }));
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update routing template.');
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

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
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
            <div className="text-2xl font-bold text-[#211F1E]">{stats.activeRoutes}</div>
            <div className="text-sm text-[#6E625A]">Active routes</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-2xl font-bold text-[#211F1E]">{stats.workOrderCount}</div>
            <div className="text-sm text-[#6E625A]">Work orders</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
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

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <Route className="h-5 w-5 text-[#E87820]" />
              Routing Template
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={submitRoutingTemplate} className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="routeCode">Route Code</Label>
                  <Input
                    id="routeCode"
                    value={routeCode}
                    onChange={(event) => setRouteCode(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="routeName">Route Name</Label>
                  <Input
                    id="routeName"
                    value={routeName}
                    onChange={(event) => setRouteName(event.target.value)}
                    required
                  />
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="routeBuildConfigurationId">Configuration</Label>
                <select
                  id="routeBuildConfigurationId"
                  className="h-10 w-full rounded-md border border-[#D9CCBE] bg-white px-3 text-sm"
                  value={routeBuildConfigurationId}
                  onChange={(event) => {
                    setRouteBuildConfigurationId(event.target.value);
                    setRouteCode('');
                  }}
                >
                  <option value="">Reusable route</option>
                  {configs.map((config) => (
                    <option key={config.id} value={config.id}>
                      {config.configurationCode} · {statusText(config.configurationStatus)}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="routeEffectiveFrom">Effective From</Label>
                  <Input
                    id="routeEffectiveFrom"
                    type="date"
                    value={routeEffectiveFrom}
                    onChange={(event) => setRouteEffectiveFrom(event.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="routeEffectiveTo">Effective Through</Label>
                  <Input
                    id="routeEffectiveTo"
                    type="date"
                    value={routeEffectiveTo}
                    onChange={(event) => setRouteEffectiveTo(event.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Job Card Steps</Label>
                {routingSteps.map((step, index) => (
                  <div key={index} className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="grid gap-2 sm:grid-cols-[96px_1fr_88px]">
                      <Input
                        aria-label="Operation code"
                        value={step.operationCode}
                        onChange={(event) =>
                          setRoutingSteps((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, operationCode: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="FRAME"
                        required
                      />
                      <Input
                        aria-label="Operation name"
                        value={step.operationName}
                        onChange={(event) =>
                          setRoutingSteps((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, operationName: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="Frame assembly"
                        required
                      />
                      <Input
                        aria-label="Estimated minutes"
                        value={step.estimatedMinutes}
                        onChange={(event) =>
                          setRoutingSteps((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, estimatedMinutes: event.target.value }
                                : item,
                            ),
                          )
                        }
                        type="number"
                        min="1"
                        required
                      />
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Input
                        aria-label="Workstation code"
                        value={step.workstationCode}
                        onChange={(event) =>
                          setRoutingSteps((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, workstationCode: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="BAY-1"
                      />
                      <Input
                        aria-label="Labor rate dollars per hour"
                        value={step.laborRateDollars}
                        onChange={(event) =>
                          setRoutingSteps((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, laborRateDollars: event.target.value }
                                : item,
                            ),
                          )
                        }
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="95.00 / hr"
                      />
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <Input
                        aria-label="Skill code"
                        value={step.requiredSkillCode}
                        onChange={(event) =>
                          setRoutingSteps((current) =>
                            current.map((item, itemIndex) =>
                              itemIndex === index
                                ? { ...item, requiredSkillCode: event.target.value }
                                : item,
                            ),
                          )
                        }
                        placeholder="MECHANICAL"
                      />
                    </div>
                    <Input
                      className="mt-2"
                      aria-label="Job card title"
                      value={step.jobCardTitle}
                      onChange={(event) =>
                        setRoutingSteps((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, jobCardTitle: event.target.value }
                              : item,
                          ),
                        )
                      }
                      placeholder="Job card title"
                    />
                    <Textarea
                      className="mt-2"
                      aria-label="Job card instructions"
                      value={step.jobCardInstructions}
                      onChange={(event) =>
                        setRoutingSteps((current) =>
                          current.map((item, itemIndex) =>
                            itemIndex === index
                              ? { ...item, jobCardInstructions: event.target.value }
                              : item,
                          ),
                        )
                      }
                      rows={2}
                      placeholder="Torque specs, inspection notes, and handoff requirements"
                    />
                    <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap gap-3 text-sm text-[#4A4039]">
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={step.qcRequired}
                            onChange={(event) =>
                              setRoutingSteps((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, qcRequired: event.target.checked }
                                    : item,
                                ),
                              )
                            }
                          />
                          QC
                        </label>
                        <label className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={step.evidenceRequired}
                            onChange={(event) =>
                              setRoutingSteps((current) =>
                                current.map((item, itemIndex) =>
                                  itemIndex === index
                                    ? { ...item, evidenceRequired: event.target.checked }
                                    : item,
                                ),
                              )
                            }
                          />
                          Evidence
                        </label>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setRoutingSteps((current) =>
                            current.filter((_, itemIndex) => itemIndex !== index),
                          )
                        }
                        disabled={routingSteps.length === 1}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setRoutingSteps((current) => [...current, defaultRoutingStep()])}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  Add Step
                </Button>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="routeNotes">Notes</Label>
                <Textarea
                  id="routeNotes"
                  value={routeNotes}
                  onChange={(event) => setRouteNotes(event.target.value)}
                  rows={2}
                />
              </div>
              <Button type="submit" disabled={saving || loading}>
                <Plus className="mr-2 h-4 w-4" />
                Create Route
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

      <div className="grid gap-4 xl:grid-cols-3">
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

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Routing Templates</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {routingTemplates.slice(0, 8).map((template) => (
              <div
                key={template.id}
                className="flex flex-col gap-2 border-b border-[#EFE6DC] pb-3 last:border-b-0"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="font-semibold text-[#211F1E]">
                      {template.routeCode} · {template.routeName}
                    </div>
                    <div className="text-xs text-[#6E625A]">
                      v{template.routeVersion} · {statusText(template.templateStatus)} ·{' '}
                      {template.stepCount} steps · {template.estimatedMinutes} min ·{' '}
                      {formatCurrencyCents(template.estimatedLaborCostCents)}
                    </div>
                    <div className="mt-1 text-xs text-[#6E625A]">
                      Effective {formatDate(template.effectiveFrom)}
                      {template.effectiveTo ? ` to ${formatDate(template.effectiveTo)}` : ''}
                    </div>
                    {template.configurationCode && (
                      <div className="mt-1 text-xs text-[#6E625A]">
                        {template.configurationCode}
                      </div>
                    )}
                    {template.changeEvents[0] && (
                      <div className="mt-2 flex items-start gap-2 rounded-md bg-[#F7F1EA] px-3 py-2 text-xs text-[#4A4039]">
                        <History className="mt-0.5 h-3.5 w-3.5 text-[#A85D18]" />
                        <div>
                          <div className="font-semibold text-[#211F1E]">
                            {statusText(template.changeEvents[0].changeKind)} ·{' '}
                            {formatDate(template.changeEvents[0].createdAt)}
                          </div>
                          <div>{template.changeEvents[0].changeSummary}</div>
                          {template.changeEvents[0].approvalNote && (
                            <div className="mt-1 text-[#6E625A]">
                              {template.changeEvents[0].approvalNote}
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="w-full space-y-2 sm:w-60">
                    <Input
                      aria-label="Route approval note"
                      disabled={template.templateStatus === 'RETIRED'}
                      value={routeApprovalNotes[template.id] ?? ''}
                      onChange={(event) =>
                        setRouteApprovalNotes((current) => ({
                          ...current,
                          [template.id]: event.target.value,
                        }))
                      }
                      placeholder="Approval note / ECO"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      disabled={
                        saving ||
                        template.templateStatus === 'RETIRED' ||
                        !(routeApprovalNotes[template.id] ?? '').trim()
                      }
                      onClick={() =>
                        transitionRoute(
                          template,
                          template.templateStatus === 'ACTIVE' ? 'RETIRED' : 'ACTIVE',
                        )
                      }
                    >
                      <CheckCircle2 className="mr-2 h-4 w-4" />
                      {template.templateStatus === 'RETIRED'
                        ? 'Retired'
                        : template.templateStatus === 'ACTIVE'
                          ? 'Retire'
                          : 'Activate'}
                    </Button>
                  </div>
                </div>
                {template.steps.slice(0, 4).map((step) => (
                  <div
                    key={step.id}
                    className="rounded-md bg-[#F7F1EA] px-3 py-2 text-xs text-[#4A4039]"
                  >
                    <span className="font-semibold text-[#211F1E]">
                      {step.sequenceNo}. {step.operationCode}
                    </span>{' '}
                    {step.operationName} · {step.estimatedMinutes} min
                    {step.laborCostCents > 0 && (
                      <span className="ml-2 text-[#6E625A]">
                        {formatCurrencyCents(step.laborCostCents)}
                      </span>
                    )}
                    {(step.qcRequired || step.evidenceRequired) && (
                      <span className="ml-2 text-[#6E625A]">
                        {[step.qcRequired ? 'QC' : '', step.evidenceRequired ? 'Evidence' : '']
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            ))}
            {routingTemplates.length === 0 && (
              <div className="text-sm text-[#6E625A]">No routing templates matched.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
