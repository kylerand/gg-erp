'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { getSalesDashboard, type SalesDashboard } from '@/lib/api-client';
import { erpRecordRoute } from '@/lib/erp-routes';
import { PageHeader, LoadingSkeleton, StatusBadge } from '@gg-erp/ui';
import { WorkspaceLinkGrid } from '@/components/WorkspaceLinkGrid';

export default function SalesPage() {
  const [dashboard, setDashboard] = useState<SalesDashboard | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getSalesDashboard();
      setDashboard(data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const stats = dashboard?.pipelineStats;

  return (
    <div>
      <PageHeader title="Sales" description="Pipeline, quotes, and forecasting" />

      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-4">
        {[
          {
            label: 'Total Opportunities',
            value: stats?.totalOpportunities ?? 0,
            color: 'text-gray-700',
          },
          {
            label: 'Weighted Forecast',
            value: `$${(stats?.weightedForecast ?? 0).toLocaleString()}`,
            color: 'text-green-700',
          },
          {
            label: 'Win Rate',
            value: `${(stats?.winRate ?? 0).toFixed(1)}%`,
            color: 'text-blue-700',
          },
          {
            label: 'Avg Deal Size',
            value: `$${(stats?.avgDealSize ?? 0).toLocaleString()}`,
            color: 'text-purple-700',
          },
        ].map((stat) => (
          <div key={stat.label} className="bg-white rounded-lg border border-gray-200 p-4">
            <div className={`text-2xl font-bold ${stat.color}`}>{stat.value}</div>
            <div className="text-xs text-gray-500 mt-1">{stat.label}</div>
          </div>
        ))}
      </div>

      {/* Navigation cards */}
      <WorkspaceLinkGrid moduleKey="sales" />

      {/* Recent Activity */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Recent Activity</h2>
        {loading ? (
          <LoadingSkeleton rows={5} cols={3} />
        ) : (dashboard?.recentActivities ?? []).length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No recent activity.</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 divide-y divide-gray-100">
            {(dashboard?.recentActivities ?? []).slice(0, 5).map((a) => (
              <div key={a.id} className="px-4 py-3 flex items-center gap-3">
                <span className="text-lg">
                  {a.activityType === 'CALL'
                    ? '📞'
                    : a.activityType === 'EMAIL'
                      ? '✉️'
                      : a.activityType === 'MEETING'
                        ? '🤝'
                        : '📝'}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-900 truncate">{a.subject}</div>
                  <div className="text-xs text-gray-500">
                    {a.activityType} · {new Date(a.createdAt).toLocaleDateString()}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top Opportunities */}
      <div className="mt-8">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Top Opportunities</h2>
        {loading ? (
          <LoadingSkeleton rows={5} cols={4} />
        ) : (dashboard?.topOpportunities ?? []).length === 0 ? (
          <p className="text-sm text-gray-400 py-8 text-center">No opportunities yet.</p>
        ) : (
          <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Title</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Stage</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Value</th>
                  <th className="px-4 py-3 text-left font-medium text-gray-600">Close Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {(dashboard?.topOpportunities ?? []).map((opp) => (
                  <tr key={opp.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <Link
                        href={erpRecordRoute('sales-opportunity', opp.id)}
                        className="font-medium text-gray-900 hover:text-yellow-600"
                      >
                        {opp.title}
                      </Link>
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge status={opp.stage} />
                    </td>
                    <td className="px-4 py-3 font-mono text-gray-700">
                      {opp.estimatedValue != null ? `$${opp.estimatedValue.toLocaleString()}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-gray-500">
                      {opp.expectedCloseDate
                        ? new Date(opp.expectedCloseDate).toLocaleDateString()
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
