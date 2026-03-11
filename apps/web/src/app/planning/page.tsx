import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';

export default function PlanningPage() {
  return (
    <div>
      <PageHeader title="Planning" description="Build slot and labor capacity planning" />
      <div className="grid grid-cols-2 gap-4 max-w-xl">
        <Link href="/planning/slots" className="bg-white rounded-lg border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-sm transition-all">
          <div className="text-2xl mb-2">📅</div>
          <div className="font-semibold text-sm text-gray-900">Build Slot Planner</div>
          <div className="text-xs text-gray-500 mt-0.5">Adjust capacity, assign work, publish plan</div>
        </Link>
      </div>
    </div>
  );
}
