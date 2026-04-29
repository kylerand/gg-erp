'use client';
import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import {
  getSalesForecast,
  getSalesPipelineStats,
  type SalesForecastMonth,
  type PipelineStats,
} from '@/lib/api-client';
import { erpRoute } from '@/lib/erp-routes';
import { PageHeader, LoadingSkeleton } from '@gg-erp/ui';

export default function ForecastPage() {
  const [forecast, setForecast] = useState<SalesForecastMonth[]>([]);
  const [stats, setStats] = useState<PipelineStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [forecastData, statsData] = await Promise.all([
        getSalesForecast(),
        getSalesPipelineStats(),
      ]);
      setForecast(Array.isArray(forecastData) ? forecastData : []);
      setStats({
        ...statsData,
        byStage: Array.isArray(statsData.byStage) ? statsData.byStage : [],
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sales forecast');
      setForecast([]);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const maxValue = Math.max(...forecast.map((m) => m.weightedValue), 1);
  const rawWinRate = stats?.winRate ?? 0;
  const winRatePercent = rawWinRate <= 1 ? rawWinRate * 100 : rawWinRate;

  return (
    <div>
      {/* Breadcrumb */}
      <div className="flex items-center gap-2 text-sm text-gray-500 mb-4">
        <Link href={erpRoute('sales')} className="hover:text-yellow-600">
          Sales
        </Link>
        <span>/</span>
        <span className="text-gray-900 font-medium">Forecast</span>
      </div>

      <PageHeader title="Sales Forecast" description="Revenue projections and pipeline summary" />

      {loading ? (
        <LoadingSkeleton rows={8} cols={4} />
      ) : error ? (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      ) : (
        <>
          {/* Pipeline summary stats */}
          <div className="grid grid-cols-2 gap-4 mb-8 sm:grid-cols-5">
            {[
              {
                label: 'Total Opportunities',
                value: stats?.totalOpportunities ?? 0,
                color: 'text-gray-700',
              },
              {
                label: 'Total Pipeline Value',
                value: `$${(stats?.totalValue ?? 0).toLocaleString()}`,
                color: 'text-gray-700',
              },
              {
                label: 'Weighted Forecast',
                value: `$${(stats?.weightedForecast ?? 0).toLocaleString()}`,
                color: 'text-green-700',
              },
              { label: 'Win Rate', value: `${winRatePercent.toFixed(1)}%`, color: 'text-blue-700' },
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

          {/* Stage breakdown */}
          {stats && stats.byStage.length > 0 && (
            <div className="mb-8">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Pipeline by Stage</h2>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-gray-50 border-b border-gray-200">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium text-gray-600">Stage</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Count</th>
                      <th className="px-4 py-3 text-right font-medium text-gray-600">Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {stats.byStage.map((s) => (
                      <tr key={s.stage} className="hover:bg-gray-50">
                        <td className="px-4 py-3 text-gray-900">{s.stage.replace(/_/g, ' ')}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-700">{s.count}</td>
                        <td className="px-4 py-3 text-right font-mono text-gray-700">
                          ${s.value.toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Monthly forecast */}
          <div>
            <h2 className="text-sm font-semibold text-gray-700 mb-3">Monthly Forecast</h2>
            {forecast.length === 0 ? (
              <p className="text-sm text-gray-400 py-8 text-center bg-white rounded-lg border border-gray-200">
                No forecast data available.
              </p>
            ) : (
              <div className="bg-white rounded-lg border border-gray-200 p-4">
                <div className="space-y-3">
                  {forecast.map((m) => {
                    const pct = maxValue > 0 ? (m.weightedValue / maxValue) * 100 : 0;
                    return (
                      <div key={m.month}>
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-sm font-medium text-gray-700">{m.month}</span>
                          <div className="flex items-center gap-3 text-xs text-gray-500">
                            <span>{m.dealCount} deals</span>
                            <span className="font-mono font-medium text-gray-900">
                              ${m.weightedValue.toLocaleString()}
                            </span>
                          </div>
                        </div>
                        <div className="h-6 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-yellow-400 rounded-full transition-all"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
