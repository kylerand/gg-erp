import { PageHeader, SyncStatusBadge } from '@gg-erp/ui';
import type { SyncStatus } from '@gg-erp/ui';

interface Integration {
  id: string;
  name: string;
  description: string;
  status: SyncStatus;
  lastSync?: string;
  errorMessage?: string;
  icon: string;
}

const INTEGRATIONS: Integration[] = [
  { id: 'qb',  name: 'QuickBooks Online',   description: 'Invoice and payment sync',  status: 'SYNCED',  lastSync: '2026-03-10T09:00:00Z', icon: '💼' },
  { id: 'eb',  name: 'AWS EventBridge',      description: 'Domain event bus',          status: 'SYNCED',  lastSync: '2026-03-10T09:15:00Z', icon: '⚡' },
  { id: 'sm',  name: 'ShopMonkey Migration', description: 'One-time data import',      status: 'PENDING',                                   icon: '📦' },
  { id: 'cog', name: 'AWS Cognito',          description: 'Authentication & identity', status: 'SYNCED',  lastSync: '2026-03-10T09:20:00Z', icon: '🔐' },
];

export default function IntegrationsPage() {
  return (
    <div>
      <PageHeader title="Integration Health" description="Connector status and freshness" />
      <div className="grid grid-cols-2 gap-4">
        {INTEGRATIONS.map(i => (
          <div key={i.id} className="bg-white rounded-lg border border-gray-200 p-5">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-start gap-3">
                <span className="text-2xl">{i.icon}</span>
                <div>
                  <p className="font-semibold text-sm text-gray-900">{i.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{i.description}</p>
                  {i.lastSync && <p className="text-xs text-gray-400 mt-1">Last sync: {new Date(i.lastSync).toLocaleString()}</p>}
                  {i.errorMessage && <p className="text-xs text-red-500 mt-1">{i.errorMessage}</p>}
                </div>
              </div>
              <SyncStatusBadge status={i.status} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
