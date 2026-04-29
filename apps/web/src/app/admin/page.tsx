import { PageHeader } from '@gg-erp/ui';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';

export default function AdminPage() {
  return (
    <div>
      <PageHeader title="Admin" description="Platform controls and audit visibility" />
      <WorkspaceLinkGrid moduleKey="admin" />
    </div>
  );
}
