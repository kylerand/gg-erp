'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { listOpportunities, type SalesOpportunity } from '@/lib/api-client';
import { PageHeader, LoadingSkeleton } from '@gg-erp/ui';

const STAGES = [
  { key: 'PROSPECT', label: 'Prospect', color: 'bg-blue-50 border-blue-300 text-blue-800' },
  { key: 'QUALIFIED', label: 'Qualified', color: 'bg-yellow-50 border-yellow-300 text-yellow-800' },
  { key: 'PROPOSAL', label: 'Proposal', color: 'bg-orange-50 border-orange-300 text-orange-800' },
  { key: 'NEGOTIATION', label: 'Negotiation', color: 'bg-purple-50 border-purple-300 text-purple-800' },
  { key: 'CLOSED_WON', label: 'Closed Won', color: 'bg-green-50 border-green-300 text-green-800' },
  { key: 'CLOSED_LOST', label: 'Closed Lost', color: 'bg-red-50 border-red-300 text-red-800' },
] as const;

export default function PipelinePage() {
  const [opportunities, setOpportunities] = useState<SalesOpportunity[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listOpportunities({ limit: 200 });
      setOpportunities(res.items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grouped = STAGES.map((stage) => {
    const items = opportunities.filter((o) => o.stage === stage.key);
    const totalValue = items.reduce((sum, o) => sum + (o.estimatedValue ?? 0), 0);
    return { ...stage, items, totalValue };
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <PageHeader title="Pipeline" description="Sales opportunities by stage" />
        <Link
          href="/sales/quotes/new"
          className="bg-yellow-400 hover:bg-yellow-500 text-gray-900 font-semibold px-4 py-2 rounded-lg text-sm transition-colors"
        >
          + New Opportunity
        </Link>
      </div>

      {loading ? (
        <LoadingSkeleton rows={8} cols={6} />
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-4">
          {grouped.map((stage) => (
            <div key={stage.key} className="flex-shrink-0 w-72">
              {/* Column header */}
              <div className={`rounded-t-lg border px-3 py-2 ${stage.color}`}>
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-sm">{stage.label}</span>
                  <span className="text-xs font-mono">{stage.items.length}</span>
                </div>
                <div className="text-xs mt-0.5 opacity-75">
                  ${stage.totalValue.toLocaleString()}
                </div>
              </div>

              {/* Cards */}
              <div className="bg-gray-50 border border-t-0 border-gray-200 rounded-b-lg min-h-[200px] p-2 space-y-2">
                {stage.items.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-8">No deals</p>
                ) : (
                  stage.items.map((opp) => (
                    <Link
                      key={opp.id}
                      href={`/sales/opportunities/${opp.id}`}
                      className="block bg-white rounded-lg border border-gray-200 p-3 hover:border-yellow-400 hover:shadow-sm transition-all"
                    >
                      <div className="text-sm font-medium text-gray-900 truncate">
                        {opp.title}
                      </div>
                      {opp.estimatedValue != null && (
                        <div className="text-xs font-mono text-green-700 mt-1">
                          ${opp.estimatedValue.toLocaleString()}
                        </div>
                      )}
                      <div className="flex items-center justify-between mt-2 text-xs text-gray-500">
                        <span>{opp.source}</span>
                        <span>{opp.probability}%</span>
                      </div>
                      {opp.expectedCloseDate && (
                        <div className="text-xs text-gray-400 mt-1">
                          Close: {new Date(opp.expectedCloseDate).toLocaleDateString()}
                        </div>
                      )}
                    </Link>
                  ))
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
