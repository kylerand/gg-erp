'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { toast } from 'sonner';
import {
  createExecutionWorkOrder,
  listBuildPackages,
  listCartVehicles,
  listCustomers,
  listRoutingTemplates,
  type CartVehicle,
  type Customer,
  type RoutingTemplate,
  type WorkOrderBuildPackage,
} from '@/lib/api-client';
import { erpRecordRoute, erpRoute } from '@/lib/erp-routes';
import { PageHeader } from '@gg-erp/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SearchableSelect, type SearchableSelectOption } from '@/components/ui/searchable-select';

interface BuildPackageOption extends SearchableSelectOption {
  buildConfigurationId: string;
  bomId: string;
  workOrderCount: number;
  lastUsedAt: string;
}

interface RoutingTemplateOption extends SearchableSelectOption {
  stepCount: number;
  estimatedMinutes: number;
}

function customerOption(customer: Customer): SearchableSelectOption {
  return {
    id: customer.id,
    label: customer.companyName ?? customer.fullName,
    description: [customer.fullName, customer.email, customer.phone].filter(Boolean).join(' · '),
    meta: customer.state,
  };
}

function vehicleOption(vehicle: CartVehicle): SearchableSelectOption {
  return {
    id: vehicle.id,
    label: `${vehicle.modelYear} ${vehicle.modelCode} · ${vehicle.serialNumber}`,
    description: vehicle.vin,
    meta: vehicle.state.replace(/_/g, ' '),
  };
}

function buildPackageOption(pkg: WorkOrderBuildPackage): BuildPackageOption {
  return {
    id: pkg.id,
    buildConfigurationId: pkg.buildConfigurationId,
    bomId: pkg.bomId,
    workOrderCount: pkg.workOrderCount,
    lastUsedAt: pkg.lastUsedAt,
    label: pkg.label,
    description: pkg.description,
    meta: `${pkg.workOrderCount} work order${pkg.workOrderCount === 1 ? '' : 's'}`,
  };
}

function routingTemplateOption(template: RoutingTemplate): RoutingTemplateOption {
  return {
    id: template.id,
    stepCount: template.stepCount,
    estimatedMinutes: template.estimatedMinutes,
    label: `${template.routeCode} · ${template.routeName}`,
    description: [
      template.configurationCode,
      `${template.stepCount} steps`,
      `${template.estimatedMinutes} min`,
    ]
      .filter(Boolean)
      .join(' · '),
    meta: template.templateStatus.toLowerCase(),
  };
}

export default function NewWorkOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState<string | undefined>();
  const [workOrderNumber, setWorkOrderNumber] = useState('');
  const [customerId, setCustomerId] = useState(searchParams.get('customerId') ?? '');
  const [vehicleId, setVehicleId] = useState(searchParams.get('vehicleId') ?? '');
  const [buildPackageId, setBuildPackageId] = useState(searchParams.get('buildPackageId') ?? '');
  const [routingTemplateId, setRoutingTemplateId] = useState(searchParams.get('routingTemplateId') ?? '');
  const [manualBuildConfigurationId, setManualBuildConfigurationId] = useState('');
  const [manualBomId, setManualBomId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [description, setDescription] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [buildPackageSearch, setBuildPackageSearch] = useState('');
  const [routingTemplateSearch, setRoutingTemplateSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<CartVehicle[]>([]);
  const [buildPackages, setBuildPackages] = useState<WorkOrderBuildPackage[]>([]);
  const [routingTemplates, setRoutingTemplates] = useState<RoutingTemplate[]>([]);

  useEffect(() => {
    let active = true;
    setReferenceLoading(true);
    setReferenceError(undefined);

    Promise.all([
      listCustomers(
        { search: customerSearch || undefined, state: 'ACTIVE', limit: 25 },
        { allowMockFallback: false },
      ),
      listCartVehicles(
        {
          customerId: customerId || undefined,
          search: vehicleSearch || undefined,
          limit: 25,
        },
        { allowMockFallback: false },
      ),
      listBuildPackages(
        { search: buildPackageSearch || undefined, limit: 100 },
        { allowMockFallback: false },
      ),
      listRoutingTemplates(
        {
          search: routingTemplateSearch || undefined,
          status: 'ACTIVE',
          limit: 100,
        },
        { allowMockFallback: false },
      ),
    ])
      .then(([customerResult, vehicleResult, buildPackageResult, routingTemplateResult]) => {
        if (!active) return;
        setCustomers(customerResult.items);
        setVehicles(vehicleResult.items);
        setBuildPackages(buildPackageResult.items);
        setRoutingTemplates(routingTemplateResult.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCustomers([]);
        setVehicles([]);
        setBuildPackages([]);
        setRoutingTemplates([]);
        setReferenceError(err instanceof Error ? err.message : 'Failed to load selector data.');
      })
      .finally(() => {
        if (active) setReferenceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [
    buildPackageSearch,
    customerId,
    customerSearch,
    routingTemplateSearch,
    vehicleSearch,
  ]);

  const customerOptions = useMemo(() => customers.map(customerOption), [customers]);
  const vehicleOptions = useMemo(() => vehicles.map(vehicleOption), [vehicles]);
  const packageOptions = useMemo(() => buildPackages.map(buildPackageOption), [buildPackages]);
  const routingTemplateOptions = useMemo(
    () => routingTemplates.map(routingTemplateOption),
    [routingTemplates],
  );
  const filteredPackageOptions = useMemo(() => {
    const query = buildPackageSearch.trim().toLowerCase();
    if (!query) return packageOptions;
    return packageOptions.filter((option) =>
      [option.label, option.description, option.meta].some((value) =>
        value?.toLowerCase().includes(query),
      ),
    );
  }, [buildPackageSearch, packageOptions]);

  const selectedCustomer = customerOptions.find((option) => option.id === customerId);
  const selectedVehicle = vehicleOptions.find((option) => option.id === vehicleId);
  const selectedBuildPackage = packageOptions.find((option) => option.id === buildPackageId);
  const selectedRoutingTemplate = routingTemplateOptions.find((option) => option.id === routingTemplateId);
  const resolvedBuildConfigurationId =
    selectedBuildPackage?.buildConfigurationId ?? manualBuildConfigurationId.trim();
  const resolvedBomId = selectedBuildPackage?.bomId ?? manualBomId.trim();
  const hasBuildPackage = Boolean(resolvedBuildConfigurationId && resolvedBomId);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();

    if (!workOrderNumber.trim()) {
      toast.error('Work order number is required.');
      return;
    }
    if (!vehicleId || !selectedVehicle) {
      toast.error('Select a cart before creating the work order.');
      return;
    }
    if (!hasBuildPackage) {
      toast.error('Select a build package or enter released build references.');
      return;
    }

    setLoading(true);
    try {
      const created = await createExecutionWorkOrder({
        workOrderNumber: workOrderNumber.trim(),
        vehicleId,
        customerId: customerId || undefined,
        buildConfigurationId: resolvedBuildConfigurationId,
        bomId: resolvedBomId,
        routingTemplateId: routingTemplateId || undefined,
        description: description.trim() || undefined,
        scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : undefined,
      });
      toast.success('Work order created');
      router.push(erpRecordRoute('work-order', created.id));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create work order');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="max-w-3xl">
      <PageHeader
        title="New Work Order"
        description="Select the customer, cart, and released build package from the planning catalog."
      />
      <Card>
        <CardHeader>
          <CardTitle>Work Order Details</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-5">
            {referenceError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {referenceError}
              </div>
            )}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="workOrderNumber">
                  Work Order # <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="workOrderNumber"
                  value={workOrderNumber}
                  onChange={(event) => setWorkOrderNumber(event.target.value)}
                  required
                  placeholder="WO-001"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="scheduledDate">Scheduled Date</Label>
                <Input
                  id="scheduledDate"
                  value={scheduledDate}
                  onChange={(event) => setScheduledDate(event.target.value)}
                  type="date"
                />
              </div>
            </div>

            <SearchableSelect
              id="customer"
              label="Customer"
              value={customerId}
              selectedOption={selectedCustomer}
              searchValue={customerSearch}
              options={customerOptions}
              loading={referenceLoading}
              error={referenceError}
              placeholder="Search customers by name, company, or email"
              emptyText="No active customers matched this search."
              onSearchChange={setCustomerSearch}
              onChange={(nextCustomerId) => {
                setCustomerId(nextCustomerId);
                setVehicleId('');
              }}
            />

            <SearchableSelect
              id="vehicle"
              label="Cart"
              required
              value={vehicleId}
              selectedOption={selectedVehicle}
              searchValue={vehicleSearch}
              options={vehicleOptions}
              loading={referenceLoading}
              error={referenceError}
              placeholder="Search carts by VIN, serial, or model"
              emptyText={
                customerId
                  ? 'No carts are registered for this customer.'
                  : 'No registered carts are available to select.'
              }
              onSearchChange={setVehicleSearch}
              onChange={setVehicleId}
            />

            <SearchableSelect
              id="buildPackage"
              label="Build Package"
              required
              value={buildPackageId}
              selectedOption={selectedBuildPackage}
              searchValue={buildPackageSearch}
              options={filteredPackageOptions}
              loading={referenceLoading}
              error={referenceError}
              placeholder="Search package, cart, customer, or reference"
              emptyText="No released build packages matched. Enter engineering-approved references below."
              onSearchChange={setBuildPackageSearch}
              onChange={(nextPackageId) => {
                setBuildPackageId(nextPackageId);
                const nextPackage = packageOptions.find((option) => option.id === nextPackageId);
                if (nextPackage) {
                  setManualBuildConfigurationId(nextPackage.buildConfigurationId);
                  setManualBomId(nextPackage.bomId);
                }
              }}
            />

            <SearchableSelect
              id="routingTemplate"
              label="Routing Template"
              value={routingTemplateId}
              selectedOption={selectedRoutingTemplate}
              searchValue={routingTemplateSearch}
              options={routingTemplateOptions}
              loading={referenceLoading}
              error={referenceError}
              placeholder="Search active routes and job-card templates"
              emptyText="No active routing templates matched this search."
              onSearchChange={setRoutingTemplateSearch}
              onChange={setRoutingTemplateId}
            />

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="buildConfigurationReference">Build Configuration Reference</Label>
                <Input
                  id="buildConfigurationReference"
                  value={manualBuildConfigurationId}
                  onChange={(event) => {
                    setManualBuildConfigurationId(event.target.value);
                    setBuildPackageId('');
                  }}
                  placeholder="Released configuration reference"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="bomReference">Approved BOM Reference</Label>
                <Input
                  id="bomReference"
                  value={manualBomId}
                  onChange={(event) => {
                    setManualBomId(event.target.value);
                    setBuildPackageId('');
                  }}
                  placeholder="Approved materials reference"
                />
              </div>
            </div>

            {selectedBuildPackage && (
              <div className="rounded-lg border border-[#D9CCBE] bg-[#FFF8EF] px-4 py-3 text-sm text-[#6E625A]">
                <span className="font-semibold text-[#211F1E]">{selectedBuildPackage.label}</span>{' '}
                has been used on {selectedBuildPackage.workOrderCount} work order
                {selectedBuildPackage.workOrderCount === 1 ? '' : 's'}.
              </div>
            )}

            <div className="space-y-1.5">
              <Label htmlFor="description">Description</Label>
              <Textarea
                id="description"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={3}
                placeholder="Describe the work to be done..."
              />
            </div>
            <div className="flex gap-3 pt-2">
              <Button
                type="submit"
                disabled={loading || !vehicleId || !hasBuildPackage}
                className="bg-yellow-400 text-gray-900 hover:bg-yellow-300"
              >
                {loading ? 'Creating...' : 'Create Work Order'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => router.push(erpRoute('work-order'))}
              >
                Cancel
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
