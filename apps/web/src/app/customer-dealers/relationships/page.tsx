'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { PageHeader, LoadingSkeleton, EmptyState, StatusBadge } from '@gg-erp/ui';
import {
  listCartVehicles,
  listCustomers,
  type CartVehicle,
  type Customer,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

const STRICT_LIVE_DATA = { allowMockFallback: false } as const;
const VEHICLE_LIMIT = 100;
const CUSTOMER_LIMIT = 500;

interface RelationshipRow {
  vehicle: CartVehicle;
  customer?: Customer;
}

function customerDisplayName(customer?: Customer): string {
  if (!customer) return 'Customer lookup needed';
  return customer.companyName?.trim() || customer.fullName || customer.email;
}

function customerDetail(customer?: Customer): string {
  if (!customer) return 'Customer record was not included in the current live result window.';
  return [customer.fullName, customer.email, customer.phone].filter(Boolean).join(' · ');
}

function cartDisplayName(vehicle: CartVehicle): string {
  return `${vehicle.modelYear} ${vehicle.modelCode}`;
}

function customerLookupHref(customer?: Customer): string {
  if (!customer) return erpRoute('customer');
  return erpRoute('customer', { search: customer.email || customer.fullName });
}

function workOrderHref(row: RelationshipRow): string {
  return erpRoute('create-work-order', {
    customerId: row.customer?.id ?? row.vehicle.customerId,
    vehicleId: row.vehicle.id,
  });
}

function rowSearchText(row: RelationshipRow): string {
  const { customer, vehicle } = row;
  return [
    customerDisplayName(customer),
    customer?.fullName,
    customer?.email,
    customer?.phone,
    vehicle.vin,
    vehicle.serialNumber,
    vehicle.modelCode,
    vehicle.state,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
}

export default function RelationshipsPage() {
  const [vehicles, setVehicles] = useState<CartVehicle[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [search, setSearch] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(undefined);
    try {
      const [vehicleResult, customerResult] = await Promise.all([
        listCartVehicles({ limit: VEHICLE_LIMIT }, STRICT_LIVE_DATA),
        listCustomers({ limit: CUSTOMER_LIMIT }, STRICT_LIVE_DATA),
      ]);
      setVehicles(vehicleResult.items);
      setCustomers(customerResult.items);
      setTotal(vehicleResult.total);
    } catch (err) {
      setVehicles([]);
      setCustomers([]);
      setTotal(0);
      setError(err instanceof Error ? err.message : 'Failed to load customer relationship records.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const customerById = useMemo(
    () => new Map(customers.map((customer) => [customer.id, customer])),
    [customers],
  );

  const rows = useMemo<RelationshipRow[]>(
    () =>
      vehicles.map((vehicle) => ({
        vehicle,
        customer: customerById.get(vehicle.customerId),
      })),
    [customerById, vehicles],
  );

  const filteredRows = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return rows;
    return rows.filter((row) => rowSearchText(row).includes(query));
  }, [rows, search]);

  return (
    <div>
      <PageHeader
        title="Customer-Dealer Relationships"
        description={
          loading
            ? 'Loading live customer and cart links...'
            : `${total} live customer-cart ownership links`
        }
        action={
          <Link href={erpRoute('create-work-order')}>
            <Button className="bg-yellow-400 text-gray-900 hover:bg-yellow-300">
              New Work Order
            </Button>
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input
          placeholder="Search customer, cart, VIN, serial..."
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className="max-w-sm"
        />
        <Link href={erpRoute('dealer')} className="text-sm font-semibold text-gray-700 hover:underline">
          Open dealer accounts
        </Link>
      </div>

      {error && (
        <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {loading ? (
        <LoadingSkeleton rows={5} cols={5} />
      ) : filteredRows.length === 0 ? (
        <EmptyState
          icon="🔗"
          title={search ? 'No relationship records matched' : 'No customer-cart links'}
          description={
            search
              ? `No live relationship record matches "${search}".`
              : 'Register carts or import customer vehicles to populate this relationship view.'
          }
        />
      ) : (
        <div className="overflow-hidden rounded-lg border border-gray-200 bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-gray-200 bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Customer</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Cart</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">VIN / Serial</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Cart Status</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Relationship</th>
                <th className="px-4 py-3 text-left font-medium text-gray-600">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredRows.map((row) => (
                <tr key={row.vehicle.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">
                      {customerDisplayName(row.customer)}
                    </div>
                    <div className="text-xs text-gray-500">{customerDetail(row.customer)}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-medium text-gray-900">{cartDisplayName(row.vehicle)}</div>
                    <div className="text-xs text-gray-500">{row.vehicle.modelCode}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    <div>{row.vehicle.vin}</div>
                    <div>{row.vehicle.serialNumber}</div>
                  </td>
                  <td className="px-4 py-3">
                    <StatusBadge status={row.vehicle.state} />
                  </td>
                  <td className="px-4 py-3 text-gray-600">Customer owned cart</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-col gap-1">
                      <Link href={customerLookupHref(row.customer)} className="font-semibold text-gray-900 hover:underline">
                        Open customer
                      </Link>
                      <Link href={workOrderHref(row)} className="font-semibold text-gray-900 hover:underline">
                        Start work order
                      </Link>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
