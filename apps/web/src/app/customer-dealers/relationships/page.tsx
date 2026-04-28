import { PageHeader, EmptyState } from '@gg-erp/ui';

export default function RelationshipsPage() {
  return (
    <div>
      <PageHeader
        title="Customer-Dealer Relationships"
        description="Dealer relationship records"
      />
      <EmptyState
        icon="🔗"
        title="No relationship records"
        description="Customer-dealer relationship storage is not configured yet."
      />
    </div>
  );
}
