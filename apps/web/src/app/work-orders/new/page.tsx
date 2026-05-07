'use client';

import { type FormEvent, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import {
  createWorkOrder,
  listCartVehicles,
  listCustomers,
  listWorkOrders,
  type CartVehicle,
  type Customer,
  type WorkOrder,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
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

function buildPackageOptions(workOrders: WorkOrder[]): BuildPackageOption[] {
  const seen = new Set<string>();
  const options: BuildPackageOption[] = [];

  for (const workOrder of workOrders) {
    const key = `${workOrder.buildConfigurationId}:${workOrder.bomId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    options.push({
      id: key,
      buildConfigurationId: workOrder.buildConfigurationId,
      bomId: workOrder.bomId,
      label: `Build package from ${workOrder.workOrderNumber}`,
      description: `Configuration ${workOrder.buildConfigurationId} · BOM ${workOrder.bomId}`,
      meta: `Last used on vehicle ${workOrder.vehicleId}`,
    });
  }

  return options;
}

export default function NewWorkOrderPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [referenceLoading, setReferenceLoading] = useState(true);
  const [referenceError, setReferenceError] = useState<string | undefined>();
  const [workOrderNumber, setWorkOrderNumber] = useState('');
  const [customerId, setCustomerId] = useState('');
  const [vehicleId, setVehicleId] = useState('');
  const [buildPackageId, setBuildPackageId] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [description, setDescription] = useState('');
  const [customerSearch, setCustomerSearch] = useState('');
  const [vehicleSearch, setVehicleSearch] = useState('');
  const [buildPackageSearch, setBuildPackageSearch] = useState('');
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [vehicles, setVehicles] = useState<CartVehicle[]>([]);
  const [recentWorkOrders, setRecentWorkOrders] = useState<WorkOrder[]>([]);

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
      listWorkOrders({ limit: 100 }, { allowMockFallback: false }),
    ])
      .then(([customerResult, vehicleResult, workOrderResult]) => {
        if (!active) return;
        setCustomers(customerResult.items);
        setVehicles(vehicleResult.items);
        setRecentWorkOrders(workOrderResult.items);
      })
      .catch((err: unknown) => {
        if (!active) return;
        setCustomers([]);
        setVehicles([]);
        setRecentWorkOrders([]);
        setReferenceError(err instanceof Error ? err.message : 'Failed to load selector data.');
      })
      .finally(() => {
        if (active) setReferenceLoading(false);
      });

    return () => {
      active = false;
    };
  }, [customerId, customerSearch, vehicleSearch]);

  const customerOptions = useMemo(() => customers.map(customerOption), [customers]);
  const vehicleOptions = useMemo(() => vehicles.map(vehicleOption), [vehicles]);
  const packageOptions = useMemo(() => buildPackageOptions(recentWorkOrders), [recentWorkOrders]);
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
    if (!selectedBuildPackage) {
      toast.error('Select a build package before creating the work order.');
      return;
    }

    setLoading(true);
    try {
      await createWorkOrder({
        workOrderNumber: workOrderNumber.trim(),
        vehicleId,
        customerId: customerId || undefined,
        buildConfigurationId: selectedBuildPackage.buildConfigurationId,
        bomId: selectedBuildPackage.bomId,
        description: description.trim() || undefined,
        scheduledDate: scheduledDate ? new Date(scheduledDate).toISOString() : undefined,
      });
      toast.success('Work order created');
      router.push(erpRoute('work-order'));
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
        description="Select the customer, cart, and build package from live planning records."
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
              placeholder="Search recent build packages"
              emptyText="No build packages are available from recent work orders. A dedicated build configuration and BOM catalog is needed before new packages can be selected here."
              onSearchChange={setBuildPackageSearch}
              onChange={setBuildPackageId}
            />

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
                disabled={loading || !vehicleId || !selectedBuildPackage}
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
