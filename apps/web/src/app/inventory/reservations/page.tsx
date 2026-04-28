import { PageHeader, EmptyState } from '@gg-erp/ui';

export default function ReservationsPage() {
  return (
    <div>
      <PageHeader title="Reservations" description="Pick list and shortage handling" />
      <EmptyState
        icon="📦"
        title="No reservation records"
        description="Inventory reservation workflow storage is not connected to this screen yet."
      />
    </div>
  );
}
