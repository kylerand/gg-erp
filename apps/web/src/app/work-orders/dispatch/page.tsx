import { PageHeader } from '@gg-erp/ui';
import { listWorkOrders } from '@/lib/api-client';
import { DispatchClient } from './DispatchClient';

export default async function DispatchPage() {
  const { items } = await listWorkOrders({ limit: 50 });
  return (
    <div>
      <PageHeader title="Dispatch Board" description="Balance workload and clear bottlenecks" />
      <DispatchClient initialItems={items} />
    </div>
  );
}
