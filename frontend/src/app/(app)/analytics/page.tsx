'use client';

import { useEffect, useState } from 'react';
import { analyticsAPI } from '@/lib/api';

interface ROIMetrics {
  period_days: number;
  time_savings: {
    estimated_hours_saved: number;
    trips_optimized: number;
    avg_time_per_trip_minutes: number;
  };
  value_metrics: {
    total_savings_generated: number;
    avg_savings_per_trip: number;
    total_points_optimized: number;
  };
  engagement_metrics: {
    proposals_sent: number;
    proposals_per_trip: number;
    proposal_views: number;
  };
  portfolio_metrics: {
    total_clients: number;
    active_clients: number;
    total_trips: number;
    trips_per_advisor: Record<string, number>;
    clients_per_advisor: Record<string, number>;
  };
  monthly_trend: {
    month: string;
    trips: number;
    savings: number;
  }[];
}

function MetricCard({ label, value, subtitle }: { label: string; value: string; subtitle?: string }) {
  return (
    <div className="rounded-xl border border-gray-200 bg-white p-6">
      <p className="text-sm font-medium text-gray-500">{label}</p>
      <p className="mt-2 text-3xl font-bold text-gray-900">{value}</p>
      {subtitle && <p className="mt-1 text-sm text-gray-400">{subtitle}</p>}
    </div>
  );
}

export default function AnalyticsPage() {
  const [metrics, setMetrics] = useState<ROIMetrics | null>(null);
  const [loading, setLoading] = useState(true);
  const [period, setPeriod] = useState(30);

  useEffect(() => {
    setLoading(true);
    analyticsAPI.getROIDashboard(period)
      .then((data) => setMetrics(data as unknown as ROIMetrics))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [period]);

  const handleExport = async () => {
    try {
      const csv = await analyticsAPI.exportCSV(90);
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'tripy-roi-report.csv';
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Export failed:', e);
    }
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200" />
          <div className="grid grid-cols-4 gap-4">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-28 rounded-xl bg-gray-200" />
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-gray-500">Unable to load analytics.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-6 py-8">
      <div className="mb-8 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">ROI Dashboard</h1>
          <p className="text-sm text-gray-500">Track the value TripsHacker delivers to your practice</p>
        </div>
        <div className="flex items-center gap-3">
          <select
            value={period}
            onChange={(e) => setPeriod(Number(e.target.value))}
            className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
          >
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
          <button
            onClick={handleExport}
            className="rounded-lg border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Hero metrics */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          label="Total Savings"
          value={`$${metrics.value_metrics.total_savings_generated.toLocaleString()}`}
          subtitle={`$${metrics.value_metrics.avg_savings_per_trip.toLocaleString()} avg per trip`}
        />
        <MetricCard
          label="Hours Saved"
          value={`${metrics.time_savings.estimated_hours_saved}`}
          subtitle={`${metrics.time_savings.trips_optimized} trips optimized`}
        />
        <MetricCard
          label="Active Clients"
          value={`${metrics.portfolio_metrics.active_clients}`}
          subtitle={`${metrics.portfolio_metrics.total_clients} total`}
        />
        <MetricCard
          label="Proposals Sent"
          value={`${metrics.engagement_metrics.proposals_sent}`}
          subtitle={`${metrics.engagement_metrics.proposal_views} total views`}
        />
      </div>

      {/* Points optimized */}
      <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Points Optimized</h3>
        <p className="text-4xl font-bold text-blue-600">
          {metrics.value_metrics.total_points_optimized.toLocaleString()}
        </p>
        <p className="text-sm text-gray-500 mt-1">Total loyalty points strategically deployed</p>
      </div>

      {/* Monthly trend */}
      {metrics.monthly_trend.length > 0 && (
        <div className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Monthly Trend</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Month</th>
                  <th className="pb-2 font-medium text-right">Trips</th>
                  <th className="pb-2 font-medium text-right">Savings</th>
                </tr>
              </thead>
              <tbody>
                {metrics.monthly_trend.map((m) => (
                  <tr key={m.month} className="border-b border-gray-100">
                    <td className="py-2 font-medium text-gray-900">{m.month}</td>
                    <td className="py-2 text-right text-gray-700">{m.trips}</td>
                    <td className="py-2 text-right text-green-600 font-medium">
                      ${m.savings.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Per-advisor breakdown */}
      {Object.keys(metrics.portfolio_metrics.trips_per_advisor).length > 1 && (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Team Breakdown</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-2 font-medium">Advisor</th>
                  <th className="pb-2 font-medium text-right">Trips</th>
                  <th className="pb-2 font-medium text-right">Clients</th>
                </tr>
              </thead>
              <tbody>
                {Object.entries(metrics.portfolio_metrics.trips_per_advisor).map(([advisor, trips]) => (
                  <tr key={advisor} className="border-b border-gray-100">
                    <td className="py-2 text-gray-900">{advisor}</td>
                    <td className="py-2 text-right text-gray-700">{trips}</td>
                    <td className="py-2 text-right text-gray-700">
                      {metrics.portfolio_metrics.clients_per_advisor[advisor] || 0}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
