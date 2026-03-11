import Link from 'next/link';
import { PageHeader } from '@gg-erp/ui';

export default function AdminPage() {
  return (
    <div>
      <PageHeader title="Admin" description="Platform controls and audit visibility" />
      <div className="grid grid-cols-3 gap-4">
        {[
          { label: 'User Access', description: 'Manage roles and permissions', href: '/admin/access', icon: '🔐' },
          { label: 'Audit Trail', description: 'Review privileged change history', href: '/admin/audit', icon: '📜' },
          { label: 'Integration Health', description: 'Connector status and freshness', href: '/admin/integrations', icon: '🔌' },
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
