'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import {
  CheckCircle2,
  ClipboardList,
  Copy,
  FileText,
  GitCompareArrows,
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
  getBuildPackageReviewPack,
  listBoms,
  listBuildConfigurations,
  listBuildPackages,
  listCartVehicles,
  listParts,
  listRoutingTemplates,
  signOffBuildPackage,
  transitionRoutingTemplate,
  transitionBuildConfiguration,
  type BuildPackageReviewPack,
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

interface VersionDiffSummary {
  id: string;
  label: string;
  compareLabel: string;
  status: string;
  changes: string[];
  actionLabel: string;
}

interface EcoReportRow {
  id: string;
  type: 'Configuration' | 'BOM' | 'Route';
  label: string;
  versionLabel: string;
  status: string;
  changeKind: string;
  summary: string;
  approvalNote?: string;
  appliedBy?: string;
  createdAt: string;
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
    .filter(([, count]) => count > 0)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([state, count]) => `${count} ${statusText(state)}`)
    .join(' · ');
}

function reviewPackSummaryText(reviewPack: BuildPackageReviewPack): string {
  const routeLines = reviewPack.routeTemplates.length
    ? reviewPack.routeTemplates.map(
        (route) =>
          `${route.routeCode} v${route.routeVersion}: ${route.stepCount} steps, ${route.estimatedMinutes} minutes`,
      )
    : ['No active route template linked'];

  return [
    `ECO Review Pack: ${reviewPack.package.label}`,
    `Generated: ${formatDate(reviewPack.generatedAt)}`,
    `Configuration: ${reviewPack.configuration.configurationCode} v${reviewPack.configuration.configurationVersion} (${statusText(reviewPack.configuration.configurationStatus)})`,
    `BOM: ${reviewPack.bom.bomCode} rev ${reviewPack.bom.revision} (${statusText(reviewPack.bom.bomStatus)})`,
    `BOM lines: ${reviewPack.summary.bomLineCount}`,
    `Route coverage: ${routeLines.join('; ')}`,
    `Approval evidence: ${reviewPack.summary.approvalCount} approvals across ${reviewPack.summary.changeCount} changes`,
  ].join('\n');
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

function centsToDollarsInput(value?: number): string {
  return value === undefined || value === null ? '' : (value / 100).toFixed(2);
}

function dateInputToIso(value: string, exclusiveEnd = false): string {
  const date = new Date(`${value}T00:00:00`);
  if (exclusiveEnd) date.setDate(date.getDate() + 1);
  return date.toISOString();
}

function isoToDateInput(value?: string): string {
  if (!value) return '';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function nextConfigRevisionCode(config: BuildConfiguration): string {
  return `${config.configurationCode}-R${(config.configurationVersion + 1).toString().padStart(2, '0')}`;
}

function nextBomRevisionCode(bom: BuildBom): string {
  const nextRevision = (bom.revision + 1).toString().padStart(2, '0');
  if (/-R\d+$/i.test(bom.bomCode)) return bom.bomCode.replace(/-R\d+$/i, `-R${nextRevision}`);
  return `${bom.bomCode}-R${nextRevision}`;
}

function listChanges(changes: string[]): string[] {
  return changes.length > 0 ? changes : ['No field-level differences captured; review approval history.'];
}

function configDiff(current: BuildConfiguration, previous?: BuildConfiguration): string[] {
  if (!previous) {
    return listChanges([
      `Initial option set: ${current.selectedOptions.length ? current.selectedOptions.join(', ') : 'none captured'}.`,
      current.notes ? 'Configuration notes captured on this version.' : 'No configuration notes captured.',
    ]);
  }

  const previousOptions = new Set(previous.selectedOptions);
  const currentOptions = new Set(current.selectedOptions);
  const added = current.selectedOptions.filter((option) => !previousOptions.has(option));
  const removed = previous.selectedOptions.filter((option) => !currentOptions.has(option));
  const changes: string[] = [];

  if (added.length) changes.push(`Options added: ${added.join(', ')}.`);
  if (removed.length) changes.push(`Options removed: ${removed.join(', ')}.`);
  if ((current.notes ?? '') !== (previous.notes ?? '')) changes.push('Engineering notes changed.');
  if (current.configurationStatus !== previous.configurationStatus) {
    changes.push(
      `Status changed from ${statusText(previous.configurationStatus)} to ${statusText(
        current.configurationStatus,
      )}.`,
    );
  }

  return listChanges(changes);
}

function bomDiff(current: BuildBom, previous?: BuildBom): string[] {
  if (!previous) {
    return listChanges([
      `Initial BOM revision with ${current.lines.length} line${current.lines.length === 1 ? '' : 's'}.`,
    ]);
  }

  const previousLines = new Map(previous.lines.map((line) => [line.partId, line]));
  const currentLines = new Map(current.lines.map((line) => [line.partId, line]));
  const changes: string[] = [];

  for (const line of current.lines) {
    const prior = previousLines.get(line.partId);
    if (!prior) {
      changes.push(`Added ${line.sku} x ${line.quantityPerUnit}.`);
      continue;
    }
    if (line.quantityPerUnit !== prior.quantityPerUnit || line.scrapFactor !== prior.scrapFactor) {
      changes.push(
        `${line.sku} changed from ${prior.quantityPerUnit} (+${prior.scrapFactor} scrap) to ${line.quantityPerUnit} (+${line.scrapFactor} scrap).`,
      );
    }
  }

  for (const line of previous.lines) {
    if (!currentLines.has(line.partId)) changes.push(`Removed ${line.sku}.`);
  }
  if ((current.notes ?? '') !== (previous.notes ?? '')) changes.push('BOM notes changed.');
  if (current.bomStatus !== previous.bomStatus) {
    changes.push(`Status changed from ${statusText(previous.bomStatus)} to ${statusText(current.bomStatus)}.`);
  }

  return listChanges(changes);
}

function routeDiff(current: RoutingTemplate, previous?: RoutingTemplate): string[] {
  if (!previous) {
    return listChanges([
      `Initial route version with ${current.stepCount} step${current.stepCount === 1 ? '' : 's'} and ${current.estimatedMinutes} estimated minutes.`,
    ]);
  }

  const previousSteps = new Map(previous.steps.map((step) => [step.operationCode, step]));
  const currentSteps = new Map(current.steps.map((step) => [step.operationCode, step]));
  const changes: string[] = [];

  for (const step of current.steps) {
    const prior = previousSteps.get(step.operationCode);
    if (!prior) {
      changes.push(`Added ${step.operationCode} · ${step.operationName}.`);
      continue;
    }
    if (step.sequenceNo !== prior.sequenceNo) {
      changes.push(`${step.operationCode} moved from sequence ${prior.sequenceNo} to ${step.sequenceNo}.`);
    }
    if (step.operationName !== prior.operationName) changes.push(`${step.operationCode} name changed.`);
    if (step.estimatedMinutes !== prior.estimatedMinutes) {
      changes.push(`${step.operationCode} changed from ${prior.estimatedMinutes} min to ${step.estimatedMinutes} min.`);
    }
    if ((step.laborRateCents ?? 0) !== (prior.laborRateCents ?? 0)) {
      changes.push(`${step.operationCode} labor rate changed.`);
    }
    if (step.qcRequired !== prior.qcRequired || step.evidenceRequired !== prior.evidenceRequired) {
      changes.push(`${step.operationCode} QC/evidence requirements changed.`);
    }
  }

  for (const step of previous.steps) {
    if (!currentSteps.has(step.operationCode)) changes.push(`Removed ${step.operationCode} · ${step.operationName}.`);
  }
  if (current.estimatedMinutes !== previous.estimatedMinutes) {
    changes.push(`Total estimated minutes changed from ${previous.estimatedMinutes} to ${current.estimatedMinutes}.`);
  }
  if (current.estimatedLaborCostCents !== previous.estimatedLaborCostCents) {
    changes.push(
      `Estimated labor changed from ${formatCurrencyCents(previous.estimatedLaborCostCents)} to ${formatCurrencyCents(
        current.estimatedLaborCostCents,
      )}.`,
    );
  }
  if ((current.notes ?? '') !== (previous.notes ?? '')) changes.push('Route notes changed.');
  if (current.templateStatus !== previous.templateStatus) {
    changes.push(`Status changed from ${statusText(previous.templateStatus)} to ${statusText(current.templateStatus)}.`);
  }

  return listChanges(changes);
}

export default function BuildPackagesPage() {
  const searchParams = useSearchParams();
  const routeSearch = searchParams.get('search') ?? '';
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
  const [configurationApprovalNotes, setConfigurationApprovalNotes] = useState<Record<string, string>>({});
  const [bomApprovalNotes, setBomApprovalNotes] = useState<Record<string, string>>({});
  const [routeApprovalNotes, setRouteApprovalNotes] = useState<Record<string, string>>({});
  const [selectedReviewPack, setSelectedReviewPack] = useState<BuildPackageReviewPack | undefined>();
  const [reviewPackLoading, setReviewPackLoading] = useState(false);
  const [reviewPackError, setReviewPackError] = useState<string | undefined>();
  const [signoffNote, setSignoffNote] = useState('');
  const [signoffSubmitting, setSignoffSubmitting] = useState(false);

  useEffect(() => {
    setSearch(routeSearch);
  }, [routeSearch]);

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

  const versionDiffs = useMemo(() => {
    const configsByVehicle = new Map<string, BuildConfiguration[]>();
    for (const config of configs) {
      const group = configsByVehicle.get(config.vehicleId) ?? [];
      group.push(config);
      configsByVehicle.set(config.vehicleId, group);
    }

    const configDiffs: VersionDiffSummary[] = configs
      .slice()
      .sort((left, right) => right.configurationVersion - left.configurationVersion)
      .map((config) => {
        const previous = (configsByVehicle.get(config.vehicleId) ?? [])
          .filter((candidate) => candidate.configurationVersion < config.configurationVersion)
          .sort((left, right) => right.configurationVersion - left.configurationVersion)[0];
        return {
          id: config.id,
          label: config.configurationCode,
          compareLabel: previous
            ? `v${config.configurationVersion} vs v${previous.configurationVersion}`
            : `v${config.configurationVersion} baseline`,
          status: statusText(config.configurationStatus),
          changes: configDiff(config, previous),
          actionLabel: 'New config revision',
        };
      });

    const bomsByConfiguration = new Map<string, BuildBom[]>();
    for (const bom of boms) {
      const group = bomsByConfiguration.get(bom.buildConfigurationId) ?? [];
      group.push(bom);
      bomsByConfiguration.set(bom.buildConfigurationId, group);
    }

    const bomDiffs: VersionDiffSummary[] = boms
      .slice()
      .sort((left, right) => right.revision - left.revision)
      .map((bom) => {
        const previous = (bomsByConfiguration.get(bom.buildConfigurationId) ?? [])
          .filter((candidate) => candidate.revision < bom.revision)
          .sort((left, right) => right.revision - left.revision)[0];
        return {
          id: bom.id,
          label: bom.bomCode,
          compareLabel: previous ? `rev ${bom.revision} vs rev ${previous.revision}` : `rev ${bom.revision} baseline`,
          status: statusText(bom.bomStatus),
          changes: bomDiff(bom, previous),
          actionLabel: 'New BOM revision',
        };
      });

    const routesByCode = new Map<string, RoutingTemplate[]>();
    for (const route of routingTemplates) {
      const group = routesByCode.get(route.routeCode) ?? [];
      group.push(route);
      routesByCode.set(route.routeCode, group);
    }

    const routeDiffs: VersionDiffSummary[] = routingTemplates
      .slice()
      .sort((left, right) => right.routeVersion - left.routeVersion)
      .map((route) => {
        const previous = (routesByCode.get(route.routeCode) ?? [])
          .filter((candidate) => candidate.routeVersion < route.routeVersion)
          .sort((left, right) => right.routeVersion - left.routeVersion)[0];
        return {
          id: route.id,
          label: route.routeCode,
          compareLabel: previous ? `v${route.routeVersion} vs v${previous.routeVersion}` : `v${route.routeVersion} baseline`,
          status: statusText(route.templateStatus),
          changes: routeDiff(route, previous),
          actionLabel: 'New route version',
        };
      });

    return {
      configurations: configDiffs.slice(0, 4),
      boms: bomDiffs.slice(0, 4),
      routes: routeDiffs.slice(0, 4),
    };
  }, [boms, configs, routingTemplates]);

  const ecoReportRows = useMemo(() => {
    const rows: EcoReportRow[] = [];
    for (const config of configs) {
      for (const event of config.changeEvents) {
        rows.push({
          id: event.id,
          type: 'Configuration',
          label: event.configurationCode,
          versionLabel: `v${event.configurationVersion}`,
          status: statusText(event.newStatus),
          changeKind: statusText(event.changeKind),
          summary: event.changeSummary,
          approvalNote: event.approvalNote,
          appliedBy: event.appliedBy ?? event.approvedBy,
          createdAt: event.createdAt,
        });
      }
    }
    for (const bom of boms) {
      for (const event of bom.changeEvents) {
        rows.push({
          id: event.id,
          type: 'BOM',
          label: event.bomCode,
          versionLabel: `rev ${event.revision}`,
          status: statusText(event.newStatus),
          changeKind: statusText(event.changeKind),
          summary: event.changeSummary,
          approvalNote: event.approvalNote,
          appliedBy: event.appliedBy ?? event.approvedBy,
          createdAt: event.createdAt,
        });
      }
    }
    for (const template of routingTemplates) {
      for (const event of template.changeEvents) {
        rows.push({
          id: event.id,
          type: 'Route',
          label: event.routeCode,
          versionLabel: `v${event.routeVersion}`,
          status: statusText(event.newStatus),
          changeKind: statusText(event.changeKind),
          summary: event.changeSummary,
          approvalNote: event.approvalNote,
          appliedBy: event.appliedBy ?? event.approvedBy,
          createdAt: event.createdAt,
        });
      }
    }

    return rows
      .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime())
      .slice(0, 12);
  }, [boms, configs, routingTemplates]);

  function reload(): void {
    setReloadToken((current) => current + 1);
  }

  async function loadReviewPack(pkg: WorkOrderBuildPackage): Promise<void> {
    setReviewPackLoading(true);
    setReviewPackError(undefined);
    try {
      const reviewPack = await getBuildPackageReviewPack(
        {
          buildConfigurationId: pkg.buildConfigurationId,
          bomId: pkg.bomId,
        },
        { allowMockFallback: false },
      );
      setSelectedReviewPack(reviewPack);
      setSignoffNote(reviewPack.latestSignoff?.signoffNote ?? '');
      toast.success('Review pack loaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Review pack failed to load.';
      setReviewPackError(message);
      toast.error(message);
    } finally {
      setReviewPackLoading(false);
    }
  }

  async function copyReviewPack(reviewPack: BuildPackageReviewPack): Promise<void> {
    try {
      await navigator.clipboard.writeText(reviewPackSummaryText(reviewPack));
      toast.success('Review summary copied');
    } catch {
      toast.error('Review summary could not be copied.');
    }
  }

  async function submitPackageSignoff(reviewPack: BuildPackageReviewPack): Promise<void> {
    const note = signoffNote.trim();
    if (!note) {
      toast.error('Add a sign-off note before approving the package.');
      return;
    }
    if (reviewPack.summary.routeCount === 0) {
      toast.error('Add an active routing template before signing off this package.');
      return;
    }

    setSignoffSubmitting(true);
    try {
      const signoff = await signOffBuildPackage(
        {
          buildConfigurationId: reviewPack.configuration.id,
          bomId: reviewPack.bom.id,
          signoffNote: note,
        },
        { allowMockFallback: false },
      );
      setSelectedReviewPack({
        ...reviewPack,
        latestSignoff: signoff,
        package: {
          ...reviewPack.package,
          stateCounts: {
            ...reviewPack.package.stateCounts,
            PACKAGE_SIGNED_OFF: 1,
            PACKAGE_NEEDS_SIGNOFF: 0,
          },
        },
        summary: {
          ...reviewPack.summary,
          signoffCount: 1,
        },
      });
      setPackages((current) =>
        current.map((pkg) =>
          pkg.id === reviewPack.package.id
            ? {
                ...pkg,
                stateCounts: {
                  ...pkg.stateCounts,
                  PACKAGE_SIGNED_OFF: 1,
                  PACKAGE_NEEDS_SIGNOFF: 0,
                },
              }
            : pkg,
        ),
      );
      toast.success('Build package signed off');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Build package sign-off failed.';
      toast.error(message);
    } finally {
      setSignoffSubmitting(false);
    }
  }

  function scrollToForm(id: string): void {
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function prepareConfigurationRevision(config: BuildConfiguration): void {
    setVehicleId(config.vehicleId);
    setConfigurationCode(nextConfigRevisionCode(config));
    setSelectedOptionsText(config.selectedOptions.join(', '));
    setConfigurationNotes(
      `Revision from ${config.configurationCode} v${config.configurationVersion}.${config.notes ? ` ${config.notes}` : ''}`,
    );
    scrollToForm('configurationCode');
    toast.success('Configuration revision draft loaded');
  }

  function prepareBomRevision(bom: BuildBom): void {
    setBuildConfigurationId(bom.buildConfigurationId);
    setBomCode(nextBomRevisionCode(bom));
    setBomRevision(String(bom.revision + 1));
    setBomNotes(`Revision from ${bom.bomCode} rev ${bom.revision}.${bom.notes ? ` ${bom.notes}` : ''}`);
    setBomLines(
      bom.lines.length
        ? bom.lines.map((line) => ({
            partId: line.partId,
            quantityPerUnit: String(line.quantityPerUnit),
            scrapFactor: String(line.scrapFactor),
          }))
        : [{ partId: '', quantityPerUnit: '1', scrapFactor: '0' }],
    );
    scrollToForm('buildConfigurationId');
    toast.success('BOM revision draft loaded');
  }

  function prepareRouteRevision(template: RoutingTemplate): void {
    setRouteCode(template.routeCode);
    setRouteName(template.routeName);
    setRouteBuildConfigurationId(template.buildConfigurationId ?? '');
    setRouteEffectiveFrom(isoToDateInput(template.effectiveFrom));
    setRouteEffectiveTo(isoToDateInput(template.effectiveTo));
    setRouteNotes(
      `Revision from ${template.routeCode} v${template.routeVersion}.${template.notes ? ` ${template.notes}` : ''}`,
    );
    setRoutingSteps(
      template.steps.length
        ? template.steps
            .slice()
            .sort((left, right) => left.sequenceNo - right.sequenceNo)
            .map((step) => ({
              operationCode: step.operationCode,
              operationName: step.operationName,
              workstationCode: step.workstationCode ?? '',
              estimatedMinutes: String(step.estimatedMinutes),
              laborRateDollars: centsToDollarsInput(step.laborRateCents),
              requiredSkillCode: step.requiredSkillCode ?? '',
              jobCardTitle: step.jobCardTitle ?? '',
              jobCardInstructions: step.jobCardInstructions ?? '',
              qcRequired: step.qcRequired,
              evidenceRequired: step.evidenceRequired,
            }))
        : [defaultRoutingStep()],
    );
    scrollToForm('routeCode');
    toast.success('Route version draft loaded');
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
    const approvalNote = configurationApprovalNotes[config.id]?.trim();
    if (!approvalNote) {
      toast.error('Add an approval note before changing configuration status.');
      return;
    }
    setSaving(true);
    try {
      const nextState = config.configurationStatus === 'DRAFT' ? 'LOCKED' : 'RELEASED';
      await transitionBuildConfiguration(config.id, nextState, {
        approvalNote,
        changeSummary:
          nextState === 'LOCKED'
            ? `Approved engineering lock for ${config.configurationCode} v${config.configurationVersion}.`
            : `Approved production release for ${config.configurationCode} v${config.configurationVersion}.`,
      });
      toast.success(nextState === 'LOCKED' ? 'Configuration locked' : 'Configuration released');
      setConfigurationApprovalNotes((current) => ({ ...current, [config.id]: '' }));
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
    const approvalNote = bomApprovalNotes[bom.id]?.trim();
    if (!approvalNote) {
      toast.error('Add an approval note before approving the BOM.');
      return;
    }
    setSaving(true);
    try {
      await approveBom(bom.id, {
        approvalNote,
        changeSummary: `Approved ${bom.bomCode} rev ${bom.revision} for production.`,
      });
      toast.success('BOM approved');
      setBomApprovalNotes((current) => ({ ...current, [bom.id]: '' }));
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

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)]">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <GitCompareArrows className="h-5 w-5 text-[#E87820]" />
              Version Review
            </CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-3">
            <section className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-[#211F1E]">Configuration Diffs</div>
                <div className="text-xs text-[#6E625A]">Latest cart option changes by version</div>
              </div>
              {versionDiffs.configurations.length === 0 ? (
                <div className="rounded-md border border-[#E8DDD2] p-3 text-sm text-[#6E625A]">
                  No configuration versions loaded.
                </div>
              ) : (
                versionDiffs.configurations.map((diff) => (
                  <div key={diff.id} className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#211F1E]">{diff.label}</div>
                        <div className="text-xs text-[#6E625A]">
                          {diff.compareLabel} · {diff.status}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const config = configs.find((item) => item.id === diff.id);
                          if (config) prepareConfigurationRevision(config);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Revise
                      </Button>
                    </div>
                    <ul className="mt-3 space-y-1 text-xs text-[#4A4039]">
                      {diff.changes.slice(0, 4).map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-[#211F1E]">BOM Diffs</div>
                <div className="text-xs text-[#6E625A]">Added, removed, and quantity changes</div>
              </div>
              {versionDiffs.boms.length === 0 ? (
                <div className="rounded-md border border-[#E8DDD2] p-3 text-sm text-[#6E625A]">
                  No BOM revisions loaded.
                </div>
              ) : (
                versionDiffs.boms.map((diff) => (
                  <div key={diff.id} className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#211F1E]">{diff.label}</div>
                        <div className="text-xs text-[#6E625A]">
                          {diff.compareLabel} · {diff.status}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const bom = boms.find((item) => item.id === diff.id);
                          if (bom) prepareBomRevision(bom);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Revise
                      </Button>
                    </div>
                    <ul className="mt-3 space-y-1 text-xs text-[#4A4039]">
                      {diff.changes.slice(0, 4).map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>

            <section className="space-y-3">
              <div>
                <div className="text-sm font-semibold text-[#211F1E]">Route Diffs</div>
                <div className="text-xs text-[#6E625A]">Step, labor, and gate changes</div>
              </div>
              {versionDiffs.routes.length === 0 ? (
                <div className="rounded-md border border-[#E8DDD2] p-3 text-sm text-[#6E625A]">
                  No routing versions loaded.
                </div>
              ) : (
                versionDiffs.routes.map((diff) => (
                  <div key={diff.id} className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <div className="font-semibold text-[#211F1E]">{diff.label}</div>
                        <div className="text-xs text-[#6E625A]">
                          {diff.compareLabel} · {diff.status}
                        </div>
                      </div>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => {
                          const template = routingTemplates.find((item) => item.id === diff.id);
                          if (template) prepareRouteRevision(template);
                        }}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        Revise
                      </Button>
                    </div>
                    <ul className="mt-3 space-y-1 text-xs text-[#4A4039]">
                      {diff.changes.slice(0, 4).map((change) => (
                        <li key={change}>{change}</li>
                      ))}
                    </ul>
                  </div>
                ))
              )}
            </section>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileText className="h-5 w-5 text-[#E87820]" />
              ECO Report
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {ecoReportRows.length === 0 ? (
              <div className="rounded-md border border-[#E8DDD2] p-3 text-sm text-[#6E625A]">
                No engineering change events loaded.
              </div>
            ) : (
              ecoReportRows.map((row) => (
                <div key={row.id} className="rounded-md border border-[#E8DDD2] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                        {row.type} · {row.changeKind}
                      </div>
                      <div className="font-semibold text-[#211F1E]">
                        {row.label} · {row.versionLabel}
                      </div>
                    </div>
                    <div className="text-right text-xs text-[#6E625A]">
                      <div>{formatDate(row.createdAt)}</div>
                      <div>{row.status}</div>
                    </div>
                  </div>
                  <div className="mt-2 text-sm text-[#4A4039]">{row.summary}</div>
                  {row.approvalNote && (
                    <div className="mt-2 rounded-md bg-[#F7F1EA] px-3 py-2 text-xs text-[#4A4039]">
                      {row.approvalNote}
                    </div>
                  )}
                  {row.appliedBy && (
                    <div className="mt-2 text-xs text-[#6E625A]">Applied by {row.appliedBy}</div>
                  )}
                </div>
              ))
            )}
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
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void loadReviewPack(pkg)}
                            disabled={reviewPackLoading}
                          >
                            <FileText className="mr-2 h-4 w-4" />
                            Review Pack
                          </Button>
                          <Link
                            className={buttonVariants({ variant: 'outline', size: 'sm' })}
                            href={erpRoute('create-work-order', { buildPackageId: pkg.id })}
                          >
                            Use Package
                          </Link>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {(selectedReviewPack || reviewPackError || reviewPackLoading) && (
        <Card>
          <CardHeader className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <ClipboardList className="h-5 w-5 text-[#E87820]" />
                ECO Review Pack
              </CardTitle>
              <p className="mt-1 text-sm text-[#6E625A]">
                {selectedReviewPack?.package.label ?? 'Loading released package evidence'}
              </p>
            </div>
            {selectedReviewPack && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => void copyReviewPack(selectedReviewPack)}
                >
                  <Copy className="mr-2 h-4 w-4" />
                  Copy Summary
                </Button>
                <Link
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}
                  href={erpRoute('planning-change-event', {
                    search: selectedReviewPack.configuration.configurationCode,
                  })}
                >
                  Change History
                </Link>
              </div>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            {reviewPackError ? (
              <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {reviewPackError}
              </div>
            ) : reviewPackLoading && !selectedReviewPack ? (
              <div className="rounded-md border border-[#E8DDD2] p-3 text-sm text-[#6E625A]">
                Loading review pack...
              </div>
            ) : selectedReviewPack ? (
              <>
                <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-6">
                  <div className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                      Configuration
                    </div>
                    <div className="mt-1 font-semibold text-[#211F1E]">
                      {selectedReviewPack.configuration.configurationCode} v
                      {selectedReviewPack.configuration.configurationVersion}
                    </div>
                    <div className="mt-1 text-xs text-[#6E625A]">
                      {statusText(selectedReviewPack.configuration.configurationStatus)}
                    </div>
                  </div>
                  <div className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                      BOM
                    </div>
                    <div className="mt-1 font-semibold text-[#211F1E]">
                      {selectedReviewPack.bom.bomCode} rev {selectedReviewPack.bom.revision}
                    </div>
                    <div className="mt-1 text-xs text-[#6E625A]">
                      {selectedReviewPack.summary.bomLineCount} lines
                    </div>
                  </div>
                  <div className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                      Routes
                    </div>
                    <div className="mt-1 font-semibold text-[#211F1E]">
                      {selectedReviewPack.summary.routeCount}
                    </div>
                    <div className="mt-1 text-xs text-[#6E625A]">
                      {selectedReviewPack.summary.routeStepCount} steps
                    </div>
                  </div>
                  <div className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                      Labor
                    </div>
                    <div className="mt-1 font-semibold text-[#211F1E]">
                      {selectedReviewPack.summary.estimatedMinutes} min
                    </div>
                    <div className="mt-1 text-xs text-[#6E625A]">
                      {formatCurrencyCents(selectedReviewPack.summary.estimatedLaborCostCents)}
                    </div>
                  </div>
                  <div className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                      Approvals
                    </div>
                    <div className="mt-1 font-semibold text-[#211F1E]">
                      {selectedReviewPack.summary.approvalCount}
                    </div>
                    <div className="mt-1 text-xs text-[#6E625A]">
                      {selectedReviewPack.summary.changeCount} changes
                    </div>
                  </div>
                  <div className="rounded-md border border-[#E8DDD2] p-3">
                    <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                      Last Used
                    </div>
                    <div className="mt-1 font-semibold text-[#211F1E]">
                      {selectedReviewPack.package.lastWorkOrderNumber ?? 'No work orders'}
                    </div>
                    <div className="mt-1 text-xs text-[#6E625A]">
                      {formatDate(selectedReviewPack.package.lastUsedAt)}
                    </div>
                  </div>
                </div>

                <section className="rounded-md border border-[#E8DDD2]">
                  <div className="flex flex-col gap-3 border-b border-[#E8DDD2] px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2 font-semibold text-[#211F1E]">
                        <CheckCircle2 className="h-4 w-4 text-[#2F7D32]" />
                        Package Sign-off
                      </div>
                      <div className="mt-1 text-xs text-[#6E625A]">
                        {selectedReviewPack.latestSignoff
                          ? `${selectedReviewPack.latestSignoff.signedOffBy ?? 'system'} · ${formatDate(
                              selectedReviewPack.latestSignoff.signedOffAt,
                            )}`
                          : selectedReviewPack.summary.routeCount === 0
                            ? 'Active route required'
                            : 'Ready for approval'}
                      </div>
                    </div>
                    {!selectedReviewPack.latestSignoff && (
                      <Button
                        type="button"
                        size="sm"
                        disabled={
                          signoffSubmitting ||
                          selectedReviewPack.summary.routeCount === 0 ||
                          signoffNote.trim().length === 0
                        }
                        onClick={() => void submitPackageSignoff(selectedReviewPack)}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {signoffSubmitting ? 'Signing Off...' : 'Sign Off Package'}
                      </Button>
                    )}
                  </div>
                  <div className="p-4">
                    {selectedReviewPack.latestSignoff ? (
                      <div className="rounded-md bg-[#F7F1EA] px-3 py-2 text-sm text-[#4A4039]">
                        {selectedReviewPack.latestSignoff.signoffNote}
                      </div>
                    ) : (
                      <Textarea
                        value={signoffNote}
                        onChange={(event) => setSignoffNote(event.target.value)}
                        placeholder="Approval note"
                        rows={3}
                        disabled={selectedReviewPack.summary.routeCount === 0 || signoffSubmitting}
                      />
                    )}
                  </div>
                </section>

                <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
                  <section className="rounded-md border border-[#E8DDD2]">
                    <div className="border-b border-[#E8DDD2] px-4 py-3 font-semibold text-[#211F1E]">
                      BOM Lines
                    </div>
                    <div className="overflow-x-auto">
                      <table className="min-w-full divide-y divide-[#EFE6DC] text-sm">
                        <thead className="bg-[#F7F1EA] text-left text-xs uppercase tracking-wide text-[#6E625A]">
                          <tr>
                            <th className="px-4 py-2">Part</th>
                            <th className="px-4 py-2">Qty</th>
                            <th className="px-4 py-2">Scrap</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-[#EFE6DC]">
                          {selectedReviewPack.bom.lines.map((line) => (
                            <tr key={line.id}>
                              <td className="px-4 py-2">
                                <div className="font-semibold text-[#211F1E]">{line.sku}</div>
                                <div className="text-xs text-[#6E625A]">{line.partName}</div>
                              </td>
                              <td className="px-4 py-2 text-[#4A4039]">
                                {line.quantityPerUnit} {line.unitOfMeasure}
                              </td>
                              <td className="px-4 py-2 text-[#4A4039]">{line.scrapFactor}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>

                  <section className="rounded-md border border-[#E8DDD2]">
                    <div className="border-b border-[#E8DDD2] px-4 py-3 font-semibold text-[#211F1E]">
                      Approval Evidence
                    </div>
                    <div className="divide-y divide-[#EFE6DC]">
                      {selectedReviewPack.approvalEvidence.length === 0 ? (
                        <div className="p-4 text-sm text-[#6E625A]">No approval evidence found.</div>
                      ) : (
                        selectedReviewPack.approvalEvidence.map((event) => (
                          <div key={event.id} className="p-4 text-sm">
                            <div className="flex items-start justify-between gap-3">
                              <div>
                                <div className="text-xs font-semibold uppercase tracking-wide text-[#9A4A12]">
                                  {statusText(event.entityType)} · {statusText(event.changeKind)}
                                </div>
                                <div className="font-semibold text-[#211F1E]">
                                  {event.recordCode} · {event.versionLabel}
                                </div>
                              </div>
                              <div className="text-right text-xs text-[#6E625A]">
                                {formatDate(event.approvedAt ?? event.createdAt)}
                              </div>
                            </div>
                            {event.approvalNote && (
                              <div className="mt-2 rounded-md bg-[#F7F1EA] px-3 py-2 text-xs text-[#4A4039]">
                                {event.approvalNote}
                              </div>
                            )}
                            <div className="mt-2 text-xs text-[#6E625A]">
                              {event.approvedBy ?? event.appliedBy ?? 'system'}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                <section className="rounded-md border border-[#E8DDD2]">
                  <div className="border-b border-[#E8DDD2] px-4 py-3 font-semibold text-[#211F1E]">
                    Active Routes
                  </div>
                  <div className="divide-y divide-[#EFE6DC]">
                    {selectedReviewPack.routeTemplates.length === 0 ? (
                      <div className="p-4 text-sm text-[#6E625A]">No active route is linked.</div>
                    ) : (
                      selectedReviewPack.routeTemplates.map((route) => (
                        <div key={route.id} className="p-4">
                          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                            <div>
                              <div className="font-semibold text-[#211F1E]">
                                {route.routeCode} v{route.routeVersion}
                              </div>
                              <div className="text-sm text-[#6E625A]">{route.routeName}</div>
                            </div>
                            <div className="text-sm text-[#4A4039]">
                              {route.stepCount} steps · {route.estimatedMinutes} min ·{' '}
                              {formatCurrencyCents(route.estimatedLaborCostCents)}
                            </div>
                          </div>
                          <div className="mt-3 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
                            {route.steps.map((step) => (
                              <div key={step.id} className="rounded-md bg-[#F7F1EA] px-3 py-2 text-sm">
                                <div className="font-semibold text-[#211F1E]">
                                  {step.sequenceNo}. {step.operationCode}
                                </div>
                                <div className="text-xs text-[#6E625A]">
                                  {step.operationName} · {step.estimatedMinutes} min
                                </div>
                                {(step.qcRequired || step.evidenceRequired) && (
                                  <div className="mt-1 text-xs text-[#9A4A12]">
                                    {[
                                      step.qcRequired ? 'QC' : undefined,
                                      step.evidenceRequired ? 'Evidence' : undefined,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ')}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </>
            ) : null}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 xl:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Configurations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {configs.slice(0, 8).map((config) => {
              const latestChange = config.changeEvents[0];
              const transitionAllowed =
                config.configurationStatus === 'DRAFT' || config.configurationStatus === 'LOCKED';
              return (
                <div
                  key={config.id}
                  className="flex flex-col gap-2 border-b border-[#EFE6DC] pb-3 last:border-b-0"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-semibold text-[#211F1E]">{config.configurationCode}</div>
                      <div className="text-xs text-[#6E625A]">
                        {config.vehicleDisplayName ?? config.vehicleId} · v{config.configurationVersion} ·{' '}
                        {statusText(config.configurationStatus)}
                      </div>
                      {latestChange && (
                        <div className="mt-2 flex items-start gap-2 rounded-md bg-[#F7F1EA] px-3 py-2 text-xs text-[#4A4039]">
                          <History className="mt-0.5 h-3.5 w-3.5 text-[#A85D18]" />
                          <div>
                            <div className="font-semibold text-[#211F1E]">
                              {statusText(latestChange.changeKind)} · {formatDate(latestChange.createdAt)}
                            </div>
                            <div>{latestChange.changeSummary}</div>
                            {latestChange.approvalNote && (
                              <div className="mt-1 text-[#6E625A]">{latestChange.approvalNote}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="w-full space-y-2 sm:w-56">
                      <Input
                        aria-label="Configuration approval note"
                        disabled={!transitionAllowed}
                        value={configurationApprovalNotes[config.id] ?? ''}
                        onChange={(event) =>
                          setConfigurationApprovalNotes((current) => ({
                            ...current,
                            [config.id]: event.target.value,
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
                          !transitionAllowed ||
                          !(configurationApprovalNotes[config.id] ?? '').trim()
                        }
                        onClick={() => releaseConfiguration(config)}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {config.configurationStatus === 'DRAFT'
                          ? 'Lock'
                          : config.configurationStatus === 'LOCKED'
                            ? 'Release'
                            : statusText(config.configurationStatus)}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => prepareConfigurationRevision(config)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        New Revision
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-lg">BOM Revisions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {boms.slice(0, 8).map((bom) => {
              const latestChange = bom.changeEvents[0];
              const canApprove = bom.bomStatus === 'DRAFT';
              return (
                <div
                  key={bom.id}
                  className="flex flex-col gap-2 border-b border-[#EFE6DC] pb-3 last:border-b-0"
                >
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="font-semibold text-[#211F1E]">{bom.bomCode}</div>
                      <div className="text-xs text-[#6E625A]">
                        {bom.configurationCode ?? bom.buildConfigurationId} · rev {bom.revision} ·{' '}
                        {statusText(bom.bomStatus)} · {bom.lines.length} lines
                      </div>
                      {latestChange && (
                        <div className="mt-2 flex items-start gap-2 rounded-md bg-[#F7F1EA] px-3 py-2 text-xs text-[#4A4039]">
                          <History className="mt-0.5 h-3.5 w-3.5 text-[#A85D18]" />
                          <div>
                            <div className="font-semibold text-[#211F1E]">
                              {statusText(latestChange.changeKind)} · {formatDate(latestChange.createdAt)}
                            </div>
                            <div>{latestChange.changeSummary}</div>
                            {latestChange.approvalNote && (
                              <div className="mt-1 text-[#6E625A]">{latestChange.approvalNote}</div>
                            )}
                          </div>
                        </div>
                      )}
                    </div>
                    <div className="w-full space-y-2 sm:w-56">
                      <Input
                        aria-label="BOM approval note"
                        disabled={!canApprove}
                        value={bomApprovalNotes[bom.id] ?? ''}
                        onChange={(event) =>
                          setBomApprovalNotes((current) => ({
                            ...current,
                            [bom.id]: event.target.value,
                          }))
                        }
                        placeholder="Approval note / ECO"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        disabled={saving || !canApprove || !(bomApprovalNotes[bom.id] ?? '').trim()}
                        onClick={() => approveRevision(bom)}
                      >
                        <CheckCircle2 className="mr-2 h-4 w-4" />
                        {canApprove ? 'Approve' : statusText(bom.bomStatus)}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="w-full"
                        onClick={() => prepareBomRevision(bom)}
                      >
                        <Copy className="mr-2 h-4 w-4" />
                        New Revision
                      </Button>
                    </div>
                  </div>
                </div>
              );
            })}
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
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() => prepareRouteRevision(template)}
                    >
                      <Copy className="mr-2 h-4 w-4" />
                      New Version
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
