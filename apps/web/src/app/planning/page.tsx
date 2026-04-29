import { PageHeader } from '@gg-erp/ui';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';

export default function PlanningPage() {
  return (
    <div>
      <PageHeader title="Planning" description="Build slot and labor capacity planning" />
      <WorkspaceLinkGrid moduleKey="planning" className="grid max-w-xl grid-cols-2 gap-4" />
    </div>
  );
}
