import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';

export default function TrainingPage() {
  return (
    <div>
      <PageHeader title="Training" description="SOP/OJT management and progression" />
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'My OJT', description: 'Your training modules and progress', href: '/training/my-ojt', icon: '🎓' },
          { label: 'Team Assignments', description: 'Assign and track team training', href: '/training/assignments', icon: '📋' },
          { label: 'SOP Library', description: 'Browse and manage SOPs', href: '/training/sop', icon: '📖' },
        ].map(item => (
          <Link key={item.href} href={item.href} className="bg-white rounded-lg border border-gray-200 p-5 hover:border-yellow-400 hover:shadow-sm transition-all">
            <div className="text-2xl mb-2">{item.icon}</div>
            <div className="font-semibold text-sm text-gray-900">{item.label}</div>
            <div className="text-xs text-gray-500 mt-0.5">{item.description}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
