'use client';
import { Fragment, useEffect, useState, useCallback, useMemo, useRef } from 'react';
import type { FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle,
  BadgeDollarSign,
  CheckSquare,
  ClipboardCheck,
  Clipboard,
  ClipboardList,
  Download,
  FileUp,
  History,
  PackageSearch,
  SlidersHorizontal,
  ShoppingCart,
  X,
} from 'lucide-react';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  createPart,
  listParts,
  updatePart,
  type CreatePartInput,
  type InstallStage,
  type LifecycleLevel,
  type Part,
  type PartCategory,
  type PartState,
  type PartStockFilter,
  type PartValuationIssue,
  type PartValuationSource,
  type PartValuationSummary,
  type UpdatePartInput,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { downloadCsv, normalizeCsvHeader, parseCsv, type CsvColumn } from '@/lib/csv-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Pagination } from '@/components/ui/pagination';

const PAGE_SIZE = 25;
type StockFilter = PartStockFilter | '';
type ValuationIssueFilter = PartValuationIssue | '';
type ValuationSourceFilter = PartValuationSource | '';

const PART_STATE_OPTIONS: { value: PartState; label: string }[] = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'INACTIVE', label: 'Inactive' },
  { value: 'DISCONTINUED', label: 'Discontinued' },
];

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

const STOCK_OPTIONS: { value: StockFilter; label: string }[] = [
  { value: '', label: 'All stock levels' },
  { value: 'OUT', label: 'Out of stock' },
];

const VALUATION_ISSUE_OPTIONS: { value: ValuationIssueFilter; label: string }[] = [
  { value: '', label: 'All valuation states' },
  { value: 'REORDER_EXPOSURE', label: 'Below minimum stock' },
  { value: 'MISSING_COST', label: 'Missing cost evidence' },
];

const VALUATION_SOURCE_OPTIONS: { value: ValuationSourceFilter; label: string }[] = [
  { value: '', label: 'All cost sources' },
  { value: 'LOT_LEDGER', label: 'Lot cost' },
  { value: 'LATEST_PO', label: 'Latest PO cost' },
  { value: 'NO_COST', label: 'No cost evidence' },
];

type PartImportStatus = 'READY' | 'INVALID' | 'CREATED' | 'FAILED';

interface PartImportRow extends CreatePartInput {
  rowNumber: number;
  status: PartImportStatus;
  message?: string;
}

interface PartEditDraft {
  name: string;
  description: string;
  unitOfMeasure: string;
  reorderPoint: string;
  partState: PartState;
  category: PartCategory | '';
  installStage: InstallStage | '';
  lifecycleLevel: LifecycleLevel;
}

interface PartExceptionHandoffRow {
  sku: string;
  name: string;
  issues: string;
  quantityOnHand: number | string;
  quantityAvailable: number | string;
  reorderPoint: number | string;
  shortfallQuantity: number | string;
  estimatedUnitCost: number | string;
  valuationSource: string;
  partUrl: string;
  ledgerUrl: string;
  costEvidenceUrl: string;
  cycleCountUrl: string;
  stockAdjustmentUrl: string;
  purchaseOrderUrl: string;
}

const PART_EXPORT_COLUMNS: CsvColumn<Part>[] = [
  { header: 'sku', value: (part) => part.sku },
  { header: 'name', value: (part) => part.name },
  { header: 'variant', value: (part) => part.variant },
  { header: 'description', value: (part) => part.description },
  { header: 'unitOfMeasure', value: (part) => part.unitOfMeasure },
  { header: 'partState', value: (part) => part.partState },
  { header: 'category', value: (part) => part.category },
  { header: 'installStage', value: (part) => part.installStage },
  { header: 'lifecycleLevel', value: (part) => part.lifecycleLevel },
  { header: 'manufacturerName', value: (part) => part.manufacturerName },
  { header: 'manufacturerPartNumber', value: (part) => part.manufacturerPartNumber },
  { header: 'defaultVendorName', value: (part) => part.defaultVendorName },
  { header: 'reorderPoint', value: (part) => part.reorderPoint },
  { header: 'quantityOnHand', value: (part) => part.quantityOnHand },
  { header: 'quantityAvailable', value: (part) => part.quantityAvailable },
  { header: 'estimatedUnitCost', value: (part) => part.estimatedUnitCost },
  { header: 'inventoryValue', value: (part) => part.inventoryValue },
  { header: 'shortfallQuantity', value: (part) => part.shortfallQuantity },
  { header: 'shortfallValue', value: (part) => part.shortfallValue },
  { header: 'valuationSource', value: (part) => part.valuationSource },
  { header: 'location', value: (part) => part.defaultLocationName ?? part.location },
];

const PART_IMPORT_COLUMNS: CsvColumn<CreatePartInput>[] = [
  { header: 'sku', value: (part) => part.sku },
  { header: 'name', value: (part) => part.name },
  { header: 'description', value: (part) => part.description },
  { header: 'unitOfMeasure', value: (part) => part.unitOfMeasure },
  { header: 'reorderPoint', value: (part) => part.reorderPoint },
];

const PART_IMPORT_TEMPLATE: CreatePartInput[] = [
  {
    sku: 'GG-SAMPLE-SKU',
    name: 'Sample part',
    description: 'Replace or delete this row',
    unitOfMeasure: 'EA',
    reorderPoint: 0,
  },
];

const PART_EXCEPTION_HANDOFF_COLUMNS: CsvColumn<PartExceptionHandoffRow>[] = [
  { header: 'sku', value: (row) => row.sku },
  { header: 'name', value: (row) => row.name },
  { header: 'issues', value: (row) => row.issues },
  { header: 'quantityOnHand', value: (row) => row.quantityOnHand },
  { header: 'quantityAvailable', value: (row) => row.quantityAvailable },
  { header: 'reorderPoint', value: (row) => row.reorderPoint },
  { header: 'shortfallQuantity', value: (row) => row.shortfallQuantity },
  { header: 'estimatedUnitCost', value: (row) => row.estimatedUnitCost },
  { header: 'valuationSource', value: (row) => row.valuationSource },
  { header: 'partUrl', value: (row) => row.partUrl },
  { header: 'ledgerUrl', value: (row) => row.ledgerUrl },
  { header: 'costEvidenceUrl', value: (row) => row.costEvidenceUrl },
  { header: 'cycleCountUrl', value: (row) => row.cycleCountUrl },
  { header: 'stockAdjustmentUrl', value: (row) => row.stockAdjustmentUrl },
  { header: 'purchaseOrderUrl', value: (row) => row.purchaseOrderUrl },
];

const EMPTY_VALUATION_SUMMARY: PartValuationSummary = {
  partCount: 0,
  stockedPartCount: 0,
  totalQuantityOnHand: 0,
  totalQuantityAvailable: 0,
  totalInventoryValue: 0,
  totalShortfallQuantity: 0,
  totalShortfallValue: 0,
  missingCostPartCount: 0,
};

function formatEnum(value: string | undefined): string {
  if (!value) return '—';
  return value
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

function formatQuantity(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value);
}

function formatMoney(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return '—';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 2,
  }).format(value);
}

function formatValuationSource(value: Part['valuationSource']): string {
  if (value === 'LOT_LEDGER') return 'Lot cost';
  if (value === 'LATEST_PO') return 'Latest PO';
  return 'No cost';
}

function formatHandoffQuantity(value: number | undefined): string {
  const quantity = Math.max(value ?? 0, 1);
  return String(Number(quantity.toFixed(3)));
}

function partNeedsCostEvidence(part: Part): boolean {
  return (
    part.valuationSource === 'NO_COST' ||
    ((part.quantityOnHand ?? 0) > 0 && !part.estimatedUnitCost)
  );
}

function partNeedsReorder(part: Part): boolean {
  return (part.shortfallQuantity ?? 0) > 0;
}

function partCanStockAudit(part: Part): boolean {
  return (part.quantityOnHand ?? 0) > 0;
}

function buildPartIssueLabels(part: Part): string[] {
  const issues: string[] = [];
  if (partNeedsCostEvidence(part)) issues.push('Missing cost evidence');
  if (partNeedsReorder(part)) issues.push('Below minimum stock');
  if (part.valuationSource === 'LOT_LEDGER') issues.push('Lot cost backed');
  if (part.valuationSource === 'LATEST_PO') issues.push('PO cost backed');
  return issues.length ? issues : ['Review'];
}

function buildPartActionHrefs(part: Part) {
  return {
    partUrl: erpRecordRoute('part', part.id),
    ledgerUrl: erpRoute('inventory-ledger', { partId: part.id }),
    costEvidenceUrl:
      partNeedsCostEvidence(part) && partCanStockAudit(part)
        ? erpRoute('inventory-cost-evidence', {
            partId: part.id,
            evidenceReference: `Cost evidence for ${part.sku}.`,
          })
        : '',
    cycleCountUrl: partCanStockAudit(part)
      ? erpRoute('cycle-count', {
          partId: part.id,
          notes: `Count ${part.sku} from valuation review.`,
        })
      : '',
    stockAdjustmentUrl: partCanStockAudit(part)
      ? erpRoute('inventory-adjustment', {
          partId: part.id,
          reasonCode: 'CORRECTION',
          notes: `Valuation review for ${part.sku}.`,
        })
      : '',
    purchaseOrderUrl: partNeedsReorder(part)
      ? erpRoute('purchase-order', {
          new: '1',
          createPartId: part.id,
          createPartSku: part.sku,
          quantity: formatHandoffQuantity(part.shortfallQuantity),
          unitCost: String(part.estimatedUnitCost ?? 0),
          notes: `Replenish ${part.sku} from inventory exception queue.`,
        })
      : '',
  };
}

function buildPartExceptionHandoffRow(part: Part): PartExceptionHandoffRow {
  const hrefs = buildPartActionHrefs(part);
  return {
    sku: part.sku,
    name: part.name,
    issues: buildPartIssueLabels(part).join('; '),
    quantityOnHand: part.quantityOnHand ?? '',
    quantityAvailable: part.quantityAvailable ?? '',
    reorderPoint: part.reorderPoint ?? '',
    shortfallQuantity: part.shortfallQuantity ?? '',
    estimatedUnitCost: part.estimatedUnitCost ?? '',
    valuationSource: formatValuationSource(part.valuationSource),
    ...hrefs,
  };
}

function isOptionValue<T extends string>(
  value: string | null,
  options: ReadonlyArray<{ value: T; label: string }>,
): value is T {
  return options.some((option) => option.value === value);
}

function parsePartState(value: string | null): PartState | '' {
  return isOptionValue(value, PART_STATE_OPTIONS) ? value : '';
}

function parseCategory(value: string | null): PartCategory | '' {
  return isOptionValue(value, CATEGORY_OPTIONS) ? value : '';
}

function parseInstallStage(value: string | null): InstallStage | '' {
  return isOptionValue(value, STAGE_OPTIONS) ? value : '';
}

function parseLifecycleLevel(value: string | null): LifecycleLevel | '' {
  return isOptionValue(value, LIFECYCLE_OPTIONS) ? value : '';
}

function parseStock(value: string | null): StockFilter {
  return value === 'OUT' ? 'OUT' : '';
}

function parseValuationIssue(value: string | null): ValuationIssueFilter {
  return isOptionValue(value, VALUATION_ISSUE_OPTIONS) ? value : '';
}

function parseValuationSource(value: string | null): ValuationSourceFilter {
  return isOptionValue(value, VALUATION_SOURCE_OPTIONS) ? value : '';
}

function nowStamp(): string {
  return new Date().toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Request failed.';
}

function buildPartEditDraft(part: Part): PartEditDraft {
  return {
    name: part.name,
    description: part.description ?? '',
    unitOfMeasure: part.unitOfMeasure,
    reorderPoint: String(part.reorderPoint ?? 0),
    partState: part.partState,
    category: part.category ?? '',
    installStage: part.installStage ?? '',
    lifecycleLevel: part.lifecycleLevel ?? 'RAW_COMPONENT',
  };
}

function importValue(headers: Map<string, number>, row: string[], key: string): string {
  const index = headers.get(normalizeCsvHeader(key));
  return index === undefined ? '' : (row[index] ?? '').trim();
}

function buildPartImportRows(csvRows: string[][]): PartImportRow[] {
  const [headerRow, ...bodyRows] = csvRows;
  if (!headerRow) return [];

  const headers = new Map(
    headerRow.map((header, index) => [normalizeCsvHeader(header), index] as const),
  );

  return bodyRows.map((row, index) => {
    const reorderPointText = importValue(headers, row, 'reorderPoint');
    const reorderPoint = reorderPointText ? Number(reorderPointText) : 0;
    const sku = importValue(headers, row, 'sku').toUpperCase();
    const name = importValue(headers, row, 'name');
    const description = importValue(headers, row, 'description');
    const unitOfMeasure = importValue(headers, row, 'unitOfMeasure') || 'EA';
    const missing: string[] = [];
    if (!sku) missing.push('sku');
    if (!name) missing.push('name');
    if (!unitOfMeasure) missing.push('unitOfMeasure');
    if (!Number.isFinite(reorderPoint) || reorderPoint < 0) missing.push('reorderPoint');

    const importRow = {
      rowNumber: index + 2,
      sku,
      name,
      ...(description ? { description } : {}),
      unitOfMeasure,
      reorderPoint: Number.isFinite(reorderPoint) && reorderPoint >= 0 ? reorderPoint : 0,
      status: missing.length ? 'INVALID' : 'READY',
    } satisfies PartImportRow;

    return missing.length ? { ...importRow, message: `Check ${missing.join(', ')}` } : importRow;
  });
}

export default function PartsPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const importInputRef = useRef<HTMLInputElement>(null);
  const activeSearch = searchParams.get('search') ?? '';
  const activePartState = parsePartState(searchParams.get('partState'));
  const activeCategory = parseCategory(searchParams.get('category'));
  const activeInstallStage = parseInstallStage(searchParams.get('installStage'));
  const activeLifecycleLevel = parseLifecycleLevel(searchParams.get('lifecycleLevel'));
  const activeStock = parseStock(searchParams.get('stock'));
  const activeValuationIssue = parseValuationIssue(searchParams.get('valuationIssue'));
  const activeValuationSource = parseValuationSource(searchParams.get('valuationSource'));
  const [parts, setParts] = useState<Part[]>([]);
  const [total, setTotal] = useState(0);
  const [valuationSummary, setValuationSummary] =
    useState<PartValuationSummary>(EMPTY_VALUATION_SUMMARY);
  const [searchText, setSearchText] = useState(activeSearch);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(PAGE_SIZE);
  const [loading, setLoading] = useState(true);
  const [selectedPartIds, setSelectedPartIds] = useState<string[]>([]);
  const [importRows, setImportRows] = useState<PartImportRow[]>([]);
  const [importing, setImporting] = useState(false);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [editingPartId, setEditingPartId] = useState<string | null>(null);
  const [partEdit, setPartEdit] = useState<PartEditDraft | null>(null);
  const [savingPartId, setSavingPartId] = useState<string | null>(null);
  const [partEditError, setPartEditError] = useState<string | null>(null);

  const load = useCallback(
    async (
      s: string,
      state: PartState | '',
      stock: StockFilter,
      cat: PartCategory | '',
      stage: InstallStage | '',
      level: LifecycleLevel | '',
      valuationIssue: ValuationIssueFilter,
      valuationSource: ValuationSourceFilter,
      p: number,
      ps: number,
    ) => {
      setLoading(true);
      try {
        const r = await listParts({
          search: s || undefined,
          partState: state || undefined,
          stock: stock || undefined,
          category: cat || undefined,
          installStage: stage || undefined,
          lifecycleLevel: level || undefined,
          valuationIssue: valuationIssue || undefined,
          valuationSource: valuationSource || undefined,
          limit: ps,
          offset: (p - 1) * ps,
        });
        setParts(r.items);
        setTotal(r.total);
        setValuationSummary(r.valuationSummary ?? EMPTY_VALUATION_SUMMARY);
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    setSearchText(activeSearch);
  }, [activeSearch]);

  useEffect(() => {
    setPage(1);
  }, [
    activeSearch,
    activePartState,
    activeCategory,
    activeInstallStage,
    activeLifecycleLevel,
    activeStock,
    activeValuationIssue,
    activeValuationSource,
  ]);

  useEffect(() => {
    setSelectedPartIds([]);
    setEditingPartId(null);
    setPartEdit(null);
    setPartEditError(null);
  }, [
    activeSearch,
    activePartState,
    activeCategory,
    activeInstallStage,
    activeLifecycleLevel,
    activeStock,
    activeValuationIssue,
    activeValuationSource,
    page,
    pageSize,
  ]);

  useEffect(() => {
    const timeout = setTimeout(
      () =>
        void load(
          activeSearch,
          activePartState,
          activeStock,
          activeCategory,
          activeInstallStage,
          activeLifecycleLevel,
          activeValuationIssue,
          activeValuationSource,
          page,
          pageSize,
        ),
      300,
    );
    return () => clearTimeout(timeout);
  }, [
    activeSearch,
    activePartState,
    activeCategory,
    activeInstallStage,
    activeLifecycleLevel,
    activeStock,
    activeValuationIssue,
    activeValuationSource,
    page,
    pageSize,
    load,
  ]);

  function buildPartsHref(next: {
    search?: string;
    partState?: PartState | '';
    stock?: StockFilter;
    category?: PartCategory | '';
    installStage?: InstallStage | '';
    lifecycleLevel?: LifecycleLevel | '';
    valuationIssue?: ValuationIssueFilter;
    valuationSource?: ValuationSourceFilter;
  }) {
    const search = next.search !== undefined ? next.search : activeSearch;
    const partState = next.partState !== undefined ? next.partState : activePartState;
    const stock = next.stock !== undefined ? next.stock : activeStock;
    const category = next.category !== undefined ? next.category : activeCategory;
    const installStage = next.installStage !== undefined ? next.installStage : activeInstallStage;
    const lifecycleLevel =
      next.lifecycleLevel !== undefined ? next.lifecycleLevel : activeLifecycleLevel;
    const valuationIssue =
      next.valuationIssue !== undefined ? next.valuationIssue : activeValuationIssue;
    const valuationSource =
      next.valuationSource !== undefined ? next.valuationSource : activeValuationSource;

    return erpRoute('part', {
      search: search.trim() || undefined,
      partState: partState || undefined,
      stock: stock || undefined,
      category: category || undefined,
      installStage: installStage || undefined,
      lifecycleLevel: lifecycleLevel || undefined,
      valuationIssue: valuationIssue || undefined,
      valuationSource: valuationSource || undefined,
    });
  }

  function applySearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildPartsHref({ search: searchText }));
  }

  const hasActiveFilters = Boolean(
    activeSearch ||
    activePartState ||
    activeStock ||
    activeCategory ||
    activeInstallStage ||
    activeLifecycleLevel ||
    activeValuationIssue ||
    activeValuationSource,
  );

  const emptyDescription = hasActiveFilters
    ? 'No parts match the active filters.'
    : 'No parts have been loaded yet.';

  function pushFilter(next: Parameters<typeof buildPartsHref>[0]) {
    router.push(buildPartsHref(next));
  }

  const selectedParts = useMemo(
    () => parts.filter((part) => selectedPartIds.includes(part.id)),
    [parts, selectedPartIds],
  );
  const selectedMissingCostCount = useMemo(
    () => selectedParts.filter(partNeedsCostEvidence).length,
    [selectedParts],
  );
  const selectedReorderCount = useMemo(
    () => selectedParts.filter(partNeedsReorder).length,
    [selectedParts],
  );
  const selectedStockAuditCount = useMemo(
    () => selectedParts.filter(partCanStockAudit).length,
    [selectedParts],
  );
  const selectedExceptionHandoffRows = useMemo(
    () => selectedParts.map(buildPartExceptionHandoffRow),
    [selectedParts],
  );
  const firstSelectedPart = selectedParts[0];
  const firstSelectedHrefs = firstSelectedPart ? buildPartActionHrefs(firstSelectedPart) : null;
  const firstMissingCostPart = selectedParts.find((part) => partNeedsCostEvidence(part));
  const firstCostEvidenceHref = firstMissingCostPart
    ? buildPartActionHrefs(firstMissingCostPart).costEvidenceUrl
    : '';
  const firstReorderPart = selectedParts.find(partNeedsReorder);
  const firstReorderHref = firstReorderPart
    ? buildPartActionHrefs(firstReorderPart).purchaseOrderUrl
    : '';
  const firstStockAuditPart = selectedParts.find(partCanStockAudit);
  const firstStockAuditHrefs = firstStockAuditPart
    ? buildPartActionHrefs(firstStockAuditPart)
    : null;
  const visibleInventoryValue = useMemo(
    () => parts.reduce((sum, part) => sum + (part.inventoryValue ?? 0), 0),
    [parts],
  );
  const missingCostHref = buildPartsHref({ valuationIssue: 'MISSING_COST', valuationSource: '' });
  const reorderExposureHref = buildPartsHref({
    valuationIssue: 'REORDER_EXPOSURE',
    valuationSource: '',
  });
  const noCostSourceHref = buildPartsHref({ valuationIssue: '', valuationSource: 'NO_COST' });
  const lotCostSourceHref = buildPartsHref({ valuationIssue: '', valuationSource: 'LOT_LEDGER' });
  const allVisibleSelected = parts.length > 0 && selectedParts.length === parts.length;
  const readyImportCount = importRows.filter((row) => row.status === 'READY').length;
  const createdImportCount = importRows.filter((row) => row.status === 'CREATED').length;
  const failedImportCount = importRows.filter(
    (row) => row.status === 'FAILED' || row.status === 'INVALID',
  ).length;

  function togglePartSelection(partId: string) {
    setSelectedPartIds((current) =>
      current.includes(partId) ? current.filter((id) => id !== partId) : [...current, partId],
    );
  }

  function toggleVisibleParts() {
    setSelectedPartIds(allVisibleSelected ? [] : parts.map((part) => part.id));
  }

  function exportParts(scope: 'visible' | 'selected') {
    const rows = scope === 'selected' ? selectedParts : parts;
    if (rows.length === 0) {
      setActionMessage('No part rows available to export.');
      return;
    }
    downloadCsv(`gg-parts-${scope}-${nowStamp()}.csv`, rows, PART_EXPORT_COLUMNS);
    setActionMessage(`Exported ${rows.length} part row${rows.length === 1 ? '' : 's'}.`);
  }

  async function copySelectedSkus() {
    if (selectedParts.length === 0) {
      setActionMessage('Select part rows before copying SKUs.');
      return;
    }
    try {
      await navigator.clipboard.writeText(selectedParts.map((part) => part.sku).join('\n'));
      setActionMessage(
        `Copied ${selectedParts.length} SKU${selectedParts.length === 1 ? '' : 's'}.`,
      );
    } catch (err) {
      setActionMessage(`Copy failed: ${errorMessage(err)}`);
    }
  }

  function exportSelectedExceptionHandoffs() {
    if (selectedExceptionHandoffRows.length === 0) {
      setActionMessage('Select part rows before exporting handoffs.');
      return;
    }
    downloadCsv(
      `gg-inventory-exception-handoffs-${nowStamp()}.csv`,
      selectedExceptionHandoffRows,
      PART_EXCEPTION_HANDOFF_COLUMNS,
    );
    setActionMessage(
      `Exported ${selectedExceptionHandoffRows.length} exception handoff row${
        selectedExceptionHandoffRows.length === 1 ? '' : 's'
      }.`,
    );
  }

  async function copySelectedActionBrief() {
    if (selectedParts.length === 0) {
      setActionMessage('Select part rows before copying an action brief.');
      return;
    }

    const brief = selectedParts
      .map((part) => {
        const hrefs = buildPartActionHrefs(part);
        return [
          `${part.sku} — ${part.name}`,
          `Issues: ${buildPartIssueLabels(part).join(', ')}`,
          `On hand: ${formatQuantity(part.quantityOnHand)} | Min: ${formatQuantity(
            part.reorderPoint,
          )} | Shortfall: ${formatQuantity(part.shortfallQuantity)}`,
          `Cost: ${formatMoney(part.estimatedUnitCost)} (${formatValuationSource(
            part.valuationSource,
          )})`,
          `Part: ${hrefs.partUrl}`,
          `Ledger: ${hrefs.ledgerUrl}`,
          hrefs.costEvidenceUrl ? `Cost evidence: ${hrefs.costEvidenceUrl}` : '',
          hrefs.cycleCountUrl ? `Cycle count: ${hrefs.cycleCountUrl}` : '',
          hrefs.stockAdjustmentUrl ? `Adjustment: ${hrefs.stockAdjustmentUrl}` : '',
          hrefs.purchaseOrderUrl ? `Purchase order: ${hrefs.purchaseOrderUrl}` : '',
        ]
          .filter(Boolean)
          .join('\n');
      })
      .join('\n\n');

    try {
      await navigator.clipboard.writeText(brief);
      setActionMessage(
        `Copied action brief for ${selectedParts.length} selected part${
          selectedParts.length === 1 ? '' : 's'
        }.`,
      );
    } catch (err) {
      setActionMessage(`Copy failed: ${errorMessage(err)}`);
    }
  }

  async function handlePartImport(file: File | undefined) {
    if (!file) return;
    try {
      const rows = buildPartImportRows(parseCsv(await file.text()));
      setImportRows(rows);
      setActionMessage(
        rows.length
          ? `Loaded ${rows.length} import row${rows.length === 1 ? '' : 's'}.`
          : 'No import rows found.',
      );
    } catch (err) {
      setImportRows([]);
      setActionMessage(errorMessage(err));
    } finally {
      if (importInputRef.current) importInputRef.current.value = '';
    }
  }

  async function createImportedParts() {
    const rowsToCreate = importRows.filter((row) => row.status === 'READY');
    if (rowsToCreate.length === 0) {
      setActionMessage('No valid import rows are ready to create.');
      return;
    }

    setImporting(true);
    let created = 0;
    try {
      for (const row of rowsToCreate) {
        try {
          const input: CreatePartInput = {
            sku: row.sku,
            name: row.name,
            unitOfMeasure: row.unitOfMeasure,
            reorderPoint: row.reorderPoint,
          };
          if (row.description) input.description = row.description;
          await createPart(input);
          created += 1;
          setImportRows((current) =>
            current.map((candidate) =>
              candidate.rowNumber === row.rowNumber
                ? { ...candidate, status: 'CREATED', message: 'Created' }
                : candidate,
            ),
          );
        } catch (err) {
          setImportRows((current) =>
            current.map((candidate) =>
              candidate.rowNumber === row.rowNumber
                ? { ...candidate, status: 'FAILED', message: errorMessage(err) }
                : candidate,
            ),
          );
        }
      }
      setActionMessage(
        created
          ? `Created ${created} part${created === 1 ? '' : 's'} from import.`
          : 'No imported parts were created.',
      );
      if (created) {
        await load(
          activeSearch,
          activePartState,
          activeStock,
          activeCategory,
          activeInstallStage,
          activeLifecycleLevel,
          activeValuationIssue,
          activeValuationSource,
          page,
          pageSize,
        );
      }
    } finally {
      setImporting(false);
    }
  }

  function beginPartEdit(part: Part) {
    setEditingPartId(part.id);
    setPartEdit(buildPartEditDraft(part));
    setPartEditError(null);
    setActionMessage(null);
  }

  function cancelPartEdit() {
    setEditingPartId(null);
    setPartEdit(null);
    setPartEditError(null);
  }

  async function savePartEdit(part: Part) {
    if (!partEdit) return;
    const name = partEdit.name.trim();
    const unitOfMeasure = partEdit.unitOfMeasure.trim().toUpperCase();
    const reorderPoint = Number(partEdit.reorderPoint);
    if (!name) {
      setPartEditError('Part name is required.');
      return;
    }
    if (!unitOfMeasure) {
      setPartEditError('Unit of measure is required.');
      return;
    }
    if (!Number.isFinite(reorderPoint) || reorderPoint < 0) {
      setPartEditError('Minimum stock must be zero or greater.');
      return;
    }

    const payload: UpdatePartInput = {
      name,
      description: partEdit.description.trim() || null,
      unitOfMeasure,
      reorderPoint,
      partState: partEdit.partState,
      category: partEdit.category || null,
      installStage: partEdit.installStage || null,
      lifecycleLevel: partEdit.lifecycleLevel,
    };

    setSavingPartId(part.id);
    setPartEditError(null);
    try {
      const updated = await updatePart(part.id, payload, { allowMockFallback: false });
      setParts((current) =>
        current.map((candidate) => (candidate.id === part.id ? updated : candidate)),
      );
      setActionMessage(`Saved ${updated.sku}.`);
      cancelPartEdit();
    } catch (err) {
      setPartEditError(errorMessage(err));
    } finally {
      setSavingPartId(null);
    }
  }

  return (
    <div>
      <PageHeader title="Part Lookup" description={`${total} parts match the active filters`} />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <form onSubmit={applySearch} className="flex w-full gap-2 sm:max-w-md">
          <Input
            placeholder="Search SKU, name, variant, MFR #…"
            value={searchText}
            onChange={(event) => setSearchText(event.target.value)}
            className="h-9"
          />
          <button
            type="submit"
            className="h-9 rounded-md bg-yellow-400 px-3 text-sm font-semibold text-gray-900 hover:bg-yellow-300"
          >
            Search
          </button>
        </form>
        <select
          value={activePartState}
          onChange={(event) => pushFilter({ partState: event.target.value as PartState | '' })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All states</option>
          {PART_STATE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={activeStock}
          onChange={(event) => pushFilter({ stock: event.target.value as StockFilter })}
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {STOCK_OPTIONS.map((o) => (
            <option key={o.value || 'ALL'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={activeCategory}
          onChange={(event) => pushFilter({ category: event.target.value as PartCategory | '' })}
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
          value={activeInstallStage}
          onChange={(event) =>
            pushFilter({ installStage: event.target.value as InstallStage | '' })
          }
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
          value={activeLifecycleLevel}
          onChange={(event) =>
            pushFilter({ lifecycleLevel: event.target.value as LifecycleLevel | '' })
          }
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          <option value="">All lifecycle levels</option>
          {LIFECYCLE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={activeValuationIssue}
          onChange={(event) =>
            pushFilter({ valuationIssue: event.target.value as ValuationIssueFilter })
          }
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {VALUATION_ISSUE_OPTIONS.map((o) => (
            <option key={o.value || 'ALL'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <select
          value={activeValuationSource}
          onChange={(event) =>
            pushFilter({ valuationSource: event.target.value as ValuationSourceFilter })
          }
          className="rounded-md border border-gray-300 bg-white px-2 py-1.5 text-sm"
        >
          {VALUATION_SOURCE_OPTIONS.map((o) => (
            <option key={o.value || 'ALL'} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {hasActiveFilters && (
          <Link
            href={erpRoute('part')}
            className="text-xs font-semibold text-[#B1581B] hover:underline"
          >
            Reset filters
          </Link>
        )}
      </div>
      <div className="mb-4 grid gap-3 md:grid-cols-4">
        <Link
          href={lotCostSourceHref}
          className="rounded-lg border border-gray-200 bg-white p-3 transition hover:border-yellow-300 hover:bg-yellow-50/40"
        >
          <div className="text-xs font-semibold uppercase text-gray-500">Stock value</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {formatMoney(valuationSummary.totalInventoryValue)}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {formatMoney(visibleInventoryValue)} on this page
          </div>
        </Link>
        <Link
          href={erpRoute('inventory-ledger')}
          className="rounded-lg border border-gray-200 bg-white p-3 transition hover:border-yellow-300 hover:bg-yellow-50/40"
        >
          <div className="text-xs font-semibold uppercase text-gray-500">Available qty</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {formatQuantity(valuationSummary.totalQuantityAvailable)}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {formatQuantity(valuationSummary.totalQuantityOnHand)} on hand
          </div>
        </Link>
        <Link
          href={reorderExposureHref}
          className="rounded-lg border border-gray-200 bg-white p-3 transition hover:border-yellow-300 hover:bg-yellow-50/40"
        >
          <div className="text-xs font-semibold uppercase text-gray-500">Reorder exposure</div>
          <div className="mt-1 text-2xl font-semibold text-amber-700">
            {formatMoney(valuationSummary.totalShortfallValue)}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {formatQuantity(valuationSummary.totalShortfallQuantity)} units below min
          </div>
        </Link>
        <Link
          href={missingCostHref}
          className="rounded-lg border border-gray-200 bg-white p-3 transition hover:border-yellow-300 hover:bg-yellow-50/40"
        >
          <div className="text-xs font-semibold uppercase text-gray-500">Cost coverage</div>
          <div className="mt-1 text-2xl font-semibold text-gray-900">
            {valuationSummary.stockedPartCount}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            {valuationSummary.missingCostPartCount} stocked parts missing cost evidence
          </div>
        </Link>
      </div>
      <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-amber-950">Valuation Action Queue</h2>
            <p className="text-xs text-amber-900">
              Work the exceptions that affect purchasing and accounting review.
            </p>
          </div>
          <Link
            href={erpRoute('part')}
            className="text-xs font-semibold text-[#B1581B] hover:underline"
          >
            Clear valuation view
          </Link>
        </div>
        <div className="grid gap-2 md:grid-cols-4">
          <Link
            href={missingCostHref}
            className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm transition hover:border-amber-400"
          >
            <span className="flex items-center gap-2 font-semibold text-gray-900">
              <AlertTriangle className="h-4 w-4 text-amber-700" />
              Review missing costs
            </span>
            <span className="mt-1 block text-xs text-gray-500">
              {valuationSummary.missingCostPartCount} stocked parts need evidence
            </span>
          </Link>
          <Link
            href={erpRoute('material-planning')}
            className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm transition hover:border-amber-400"
          >
            <span className="flex items-center gap-2 font-semibold text-gray-900">
              <PackageSearch className="h-4 w-4 text-amber-700" />
              Plan replenishment
            </span>
            <span className="mt-1 block text-xs text-gray-500">
              {formatQuantity(valuationSummary.totalShortfallQuantity)} units below minimum
            </span>
          </Link>
          <Link
            href={noCostSourceHref}
            className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm transition hover:border-amber-400"
          >
            <span className="flex items-center gap-2 font-semibold text-gray-900">
              <AlertTriangle className="h-4 w-4 text-red-600" />
              Show no-cost rows
            </span>
            <span className="mt-1 block text-xs text-gray-500">
              Audit parts before close depends on valuation
            </span>
          </Link>
          <Link
            href={erpRoute('inventory-ledger')}
            className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm transition hover:border-amber-400"
          >
            <span className="flex items-center gap-2 font-semibold text-gray-900">
              <History className="h-4 w-4 text-gray-700" />
              Open movement ledger
            </span>
            <span className="mt-1 block text-xs text-gray-500">
              Confirm receipts, adjustments, transfers, and issues
            </span>
          </Link>
        </div>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white p-3">
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" onClick={() => exportParts('visible')}>
            <Download data-icon="inline-start" />
            Export visible
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={selectedParts.length === 0}
            onClick={() => exportParts('selected')}
          >
            <Download data-icon="inline-start" />
            Export selected
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => importInputRef.current?.click()}
            disabled={importing}
          >
            <FileUp data-icon="inline-start" />
            Import CSV
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() =>
              downloadCsv(
                `gg-parts-import-template-${nowStamp()}.csv`,
                PART_IMPORT_TEMPLATE,
                PART_IMPORT_COLUMNS,
              )
            }
          >
            <Download data-icon="inline-start" />
            Template
          </Button>
          <input
            ref={importInputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => void handlePartImport(event.target.files?.[0])}
          />
        </div>
        <div className="text-sm font-medium text-gray-600">
          {actionMessage ?? `${selectedParts.length} selected`}
        </div>
      </div>
      {selectedParts.length > 0 && (
        <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-sm font-semibold text-amber-950">Selected Exception Workbench</h2>
              <div className="mt-2 flex flex-wrap gap-2 text-xs font-semibold text-amber-900">
                <span className="rounded-md border border-amber-200 bg-white px-2 py-1">
                  {selectedParts.length} selected
                </span>
                <span className="rounded-md border border-amber-200 bg-white px-2 py-1">
                  {selectedMissingCostCount} cost
                </span>
                <span className="rounded-md border border-amber-200 bg-white px-2 py-1">
                  {selectedReorderCount} reorder
                </span>
                <span className="rounded-md border border-amber-200 bg-white px-2 py-1">
                  {selectedStockAuditCount} stock audit
                </span>
              </div>
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copySelectedSkus()}
              >
                <Clipboard data-icon="inline-start" />
                Copy SKUs
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => void copySelectedActionBrief()}
              >
                <ClipboardList data-icon="inline-start" />
                Copy action brief
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={exportSelectedExceptionHandoffs}
              >
                <Download data-icon="inline-start" />
                Export handoffs
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setSelectedPartIds([])}
              >
                <X data-icon="inline-start" />
                Clear
              </Button>
            </div>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            {firstSelectedHrefs && (
              <Link
                href={firstSelectedHrefs.ledgerUrl}
                className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
              >
                <History className="mr-1 h-3.5 w-3.5" />
                First ledger
              </Link>
            )}
            {firstCostEvidenceHref && (
              <Link
                href={firstCostEvidenceHref}
                className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
              >
                <BadgeDollarSign className="mr-1 h-3.5 w-3.5" />
                First cost
              </Link>
            )}
            {firstStockAuditHrefs?.cycleCountUrl && (
              <Link
                href={firstStockAuditHrefs.cycleCountUrl}
                className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
              >
                <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
                First count
              </Link>
            )}
            {firstStockAuditHrefs?.stockAdjustmentUrl && (
              <Link
                href={firstStockAuditHrefs.stockAdjustmentUrl}
                className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
              >
                <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                First adjust
              </Link>
            )}
            {firstReorderHref && (
              <Link
                href={firstReorderHref}
                className="inline-flex h-8 items-center rounded-md border border-amber-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
              >
                <ShoppingCart className="mr-1 h-3.5 w-3.5" />
                First PO
              </Link>
            )}
          </div>
        </div>
      )}
      {importRows.length > 0 && (
        <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span className="font-semibold text-gray-900">{importRows.length} import rows</span>
              <span className="text-green-700">{createdImportCount} created</span>
              <span className="text-amber-700">{readyImportCount} ready</span>
              <span className="text-red-700">{failedImportCount} blocked</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => void createImportedParts()}
                disabled={importing || readyImportCount === 0}
              >
                <CheckSquare data-icon="inline-start" />
                Create valid parts
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setImportRows([]);
                  setActionMessage(null);
                }}
              >
                <X data-icon="inline-start" />
                Dismiss
              </Button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="bg-gray-50 text-left text-xs font-medium uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Row</th>
                  <th className="px-3 py-2">SKU</th>
                  <th className="px-3 py-2">Name</th>
                  <th className="px-3 py-2">UOM</th>
                  <th className="px-3 py-2 text-right">Min</th>
                  <th className="px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {importRows.slice(0, 12).map((row) => (
                  <tr key={row.rowNumber}>
                    <td className="px-3 py-2 text-gray-500">{row.rowNumber}</td>
                    <td className="px-3 py-2 font-mono text-xs font-semibold text-gray-900">
                      {row.sku || 'Missing'}
                    </td>
                    <td className="px-3 py-2 text-gray-700">{row.name || 'Missing'}</td>
                    <td className="px-3 py-2 text-gray-700">{row.unitOfMeasure || 'Missing'}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{row.reorderPoint ?? 0}</td>
                    <td className="px-3 py-2">
                      <StatusBadge status={row.status} />
                      {row.message && (
                        <span className="ml-2 text-xs text-gray-500">{row.message}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
      {loading ? (
        <LoadingSkeleton rows={6} cols={7} />
      ) : parts.length === 0 ? (
        <EmptyState
          icon="🔍"
          title="No parts found"
          description={activeSearch ? `No match for "${activeSearch}"` : emptyDescription}
        />
      ) : (
        <>
          <div className="overflow-x-auto rounded-lg border border-gray-200 bg-white">
            <table className="w-full min-w-[1500px] text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">
                    <input
                      type="checkbox"
                      aria-label="Select visible parts"
                      checked={allVisibleSelected}
                      onChange={toggleVisibleParts}
                      className="h-4 w-4 rounded border-gray-300"
                    />
                  </th>
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
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Unit Cost</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Stock Value</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Location</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Status</th>
                  <th className="px-4 py-3 text-right font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {parts.map((p) => {
                  const isEditing = editingPartId === p.id && partEdit;
                  return (
                    <Fragment key={p.id}>
                      <tr className="hover:bg-gray-50">
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            aria-label={`Select ${p.sku}`}
                            checked={selectedPartIds.includes(p.id)}
                            onChange={() => togglePartSelection(p.id)}
                            className="h-4 w-4 rounded border-gray-300"
                          />
                        </td>
                        <td className="px-4 py-3 font-mono text-xs font-medium text-gray-700">
                          <Link href={erpRecordRoute('part', p.id)} className="hover:underline">
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
                            {p.quantityOnHand === 0 ? '0' : (p.quantityOnHand ?? '—')}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-gray-600">
                          <div>{formatMoney(p.estimatedUnitCost)}</div>
                          <div className="text-xs text-gray-400">
                            {formatValuationSource(p.valuationSource)}
                          </div>
                        </td>
                        <td className="px-4 py-3 font-semibold text-gray-900">
                          {formatMoney(p.inventoryValue)}
                        </td>
                        <td className="px-4 py-3 text-gray-500">
                          {p.defaultLocationName ?? p.location ?? '—'}
                        </td>
                        <td className="px-4 py-3">
                          <StatusBadge status={p.partState} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex flex-wrap justify-end gap-1.5">
                            <Link
                              href={erpRoute('inventory-ledger', { partId: p.id })}
                              className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
                            >
                              <History className="mr-1 h-3.5 w-3.5" />
                              Ledger
                            </Link>
                            {partNeedsCostEvidence(p) && (p.quantityOnHand ?? 0) > 0 && (
                              <Link
                                href={erpRoute('inventory-cost-evidence', {
                                  partId: p.id,
                                  evidenceReference: `Cost evidence for ${p.sku}.`,
                                })}
                                className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
                              >
                                <BadgeDollarSign className="mr-1 h-3.5 w-3.5" />
                                Cost
                              </Link>
                            )}
                            {(p.quantityOnHand ?? 0) > 0 && (
                              <Link
                                href={erpRoute('cycle-count', {
                                  partId: p.id,
                                  notes: `Count ${p.sku} from valuation review.`,
                                })}
                                className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
                              >
                                <ClipboardCheck className="mr-1 h-3.5 w-3.5" />
                                Count
                              </Link>
                            )}
                            {(p.quantityOnHand ?? 0) > 0 && (
                              <Link
                                href={erpRoute('inventory-adjustment', {
                                  partId: p.id,
                                  reasonCode: 'CORRECTION',
                                  notes: `Valuation review for ${p.sku}.`,
                                })}
                                className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
                              >
                                <SlidersHorizontal className="mr-1 h-3.5 w-3.5" />
                                Adjust
                              </Link>
                            )}
                            {(p.shortfallQuantity ?? 0) > 0 && (
                              <Link
                                href={erpRoute('purchase-order', {
                                  new: '1',
                                  createPartId: p.id,
                                  createPartSku: p.sku,
                                  quantity: formatHandoffQuantity(p.shortfallQuantity),
                                  unitCost: String(p.estimatedUnitCost ?? 0),
                                  notes: `Replenish ${p.sku} from inventory exception queue.`,
                                })}
                                className="inline-flex h-8 items-center rounded-md border border-gray-200 bg-white px-2 text-xs font-semibold text-gray-700 hover:border-yellow-400"
                              >
                                <ShoppingCart className="mr-1 h-3.5 w-3.5" />
                                PO
                              </Link>
                            )}
                            <Button
                              type="button"
                              size="sm"
                              variant={isEditing ? 'default' : 'outline'}
                              onClick={() => beginPartEdit(p)}
                            >
                              Edit
                            </Button>
                          </div>
                        </td>
                      </tr>
                      {isEditing && (
                        <tr>
                          <td colSpan={16} className="bg-yellow-50/40 px-4 py-4">
                            <div className="grid gap-3 lg:grid-cols-[1.2fr_0.7fr_0.6fr_0.7fr_0.9fr_0.9fr_1fr]">
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase text-gray-500">
                                  Name
                                </span>
                                <Input
                                  value={partEdit.name}
                                  onChange={(event) =>
                                    setPartEdit((current) =>
                                      current ? { ...current, name: event.target.value } : current,
                                    )
                                  }
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase text-gray-500">
                                  UOM
                                </span>
                                <Input
                                  value={partEdit.unitOfMeasure}
                                  onChange={(event) =>
                                    setPartEdit((current) =>
                                      current
                                        ? { ...current, unitOfMeasure: event.target.value }
                                        : current,
                                    )
                                  }
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase text-gray-500">
                                  Min
                                </span>
                                <Input
                                  type="number"
                                  min="0"
                                  step="1"
                                  value={partEdit.reorderPoint}
                                  onChange={(event) =>
                                    setPartEdit((current) =>
                                      current
                                        ? { ...current, reorderPoint: event.target.value }
                                        : current,
                                    )
                                  }
                                />
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase text-gray-500">
                                  State
                                </span>
                                <select
                                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                                  value={partEdit.partState}
                                  onChange={(event) =>
                                    setPartEdit((current) =>
                                      current
                                        ? {
                                            ...current,
                                            partState: event.target.value as PartState,
                                          }
                                        : current,
                                    )
                                  }
                                >
                                  {PART_STATE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase text-gray-500">
                                  Category
                                </span>
                                <select
                                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                                  value={partEdit.category}
                                  onChange={(event) =>
                                    setPartEdit((current) =>
                                      current
                                        ? {
                                            ...current,
                                            category: event.target.value as PartCategory | '',
                                          }
                                        : current,
                                    )
                                  }
                                >
                                  <option value="">None</option>
                                  {CATEGORY_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase text-gray-500">
                                  Stage
                                </span>
                                <select
                                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                                  value={partEdit.installStage}
                                  onChange={(event) =>
                                    setPartEdit((current) =>
                                      current
                                        ? {
                                            ...current,
                                            installStage: event.target.value as InstallStage | '',
                                          }
                                        : current,
                                    )
                                  }
                                >
                                  <option value="">None</option>
                                  {STAGE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                              <label className="space-y-1">
                                <span className="text-xs font-semibold uppercase text-gray-500">
                                  Lifecycle
                                </span>
                                <select
                                  className="h-10 w-full rounded-md border border-gray-300 bg-white px-2 text-sm"
                                  value={partEdit.lifecycleLevel}
                                  onChange={(event) =>
                                    setPartEdit((current) =>
                                      current
                                        ? {
                                            ...current,
                                            lifecycleLevel: event.target.value as LifecycleLevel,
                                          }
                                        : current,
                                    )
                                  }
                                >
                                  {LIFECYCLE_OPTIONS.map((option) => (
                                    <option key={option.value} value={option.value}>
                                      {option.label}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            </div>
                            <label className="mt-3 block space-y-1">
                              <span className="text-xs font-semibold uppercase text-gray-500">
                                Description
                              </span>
                              <Input
                                value={partEdit.description}
                                onChange={(event) =>
                                  setPartEdit((current) =>
                                    current
                                      ? { ...current, description: event.target.value }
                                      : current,
                                  )
                                }
                              />
                            </label>
                            {partEditError && (
                              <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
                                {partEditError}
                              </div>
                            )}
                            <div className="mt-3 flex justify-end gap-2">
                              <Button
                                type="button"
                                variant="outline"
                                disabled={savingPartId === p.id}
                                onClick={cancelPartEdit}
                              >
                                Cancel
                              </Button>
                              <Button
                                type="button"
                                disabled={savingPartId === p.id}
                                onClick={() => void savePartEdit(p)}
                              >
                                {savingPartId === p.id ? 'Saving...' : 'Save Part'}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
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
