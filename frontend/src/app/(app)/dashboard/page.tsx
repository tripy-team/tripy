'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  Home,
  Clock,
  ArrowRightLeft,
  Plane,
  Bell,
  Plus,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { getDashboard } from '@/lib/api-client';
import type { DashboardData, TripRequest, AlertEvent } from '@/lib/api-client';

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    slate: 'bg-slate-50 text-slate-600',
    amber: 'bg-amber-50 text-amber-600',
    green: 'bg-green-50 text-green-600',
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color] ?? colorMap.blue}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        </div>
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600',
    analyzing: 'bg-yellow-50 text-yellow-700',
    complete: 'bg-green-50 text-green-700',
    archived: 'bg-slate-100 text-slate-500',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getDashboard()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading dashboard...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-32 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome back{data.advisorName ? `, ${data.advisorName}` : ''}
        </h1>
        <p className="mt-1 text-slate-500">Here&apos;s what&apos;s happening across your practice.</p>
      </div>

      {/* Stats Grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Clients" value={data.totalClients} icon={Users} color="blue" />
        <StatCard label="Total Households" value={data.totalHouseholds} icon={Home} color="slate" />
        <StatCard label="Expiring Points (30d)" value={data.expiringPointsNext30Days} icon={Clock} color="amber" />
        <StatCard label="Active Transfer Bonuses" value={data.activeTransferBonuses} icon={ArrowRightLeft} color="green" />
      </div>

      {/* Quick Actions */}
      <div className="mb-8 flex flex-wrap gap-3">
        <Link
          href="/clients/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Client
        </Link>
        <Link
          href="/trip-requests/new"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <Plane className="h-4 w-4" />
          New Trip Request
        </Link>
        <Link
          href="/settings"
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
        >
          <ArrowRightLeft className="h-4 w-4" />
          View Transfer Bonuses
        </Link>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Active Trip Analyses */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Active Trip Analyses</h2>
            <Link href="/trip-requests" className="text-sm font-medium text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {data.activeTripAnalyses.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Plane className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No active analyses</p>
              </div>
            ) : (
              data.activeTripAnalyses.map((trip: TripRequest) => (
                <Link
                  key={trip.id}
                  href={`/trip-requests/${trip.id}`}
                  className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">{trip.title}</p>
                    <p className="text-xs text-slate-500">
                      {trip.originAirports?.join(', ')} → {trip.destinationAirports?.join(', ')}
                    </p>
                  </div>
                  <StatusBadge status={trip.status} />
                </Link>
              ))
            )}
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Recent Alerts</h2>
            <Link href="/alerts" className="text-sm font-medium text-blue-600 hover:text-blue-700">
              View all
            </Link>
          </div>
          <div className="divide-y divide-slate-100">
            {data.recentAlerts.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Bell className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No recent alerts</p>
              </div>
            ) : (
              data.recentAlerts.slice(0, 5).map((alert: AlertEvent) => {
                const severityColors: Record<string, string> = {
                  info: 'bg-blue-500',
                  warning: 'bg-amber-500',
                  critical: 'bg-red-500',
                };
                return (
                  <div key={alert.id} className="flex items-start gap-3 px-5 py-3">
                    <div className={`mt-1.5 h-2 w-2 flex-shrink-0 rounded-full ${severityColors[alert.severity] ?? severityColors.info}`} />
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-slate-900">{alert.title}</p>
                      <p className="truncate text-xs text-slate-500">{alert.body}</p>
                    </div>
                    <span className="flex-shrink-0 text-xs text-slate-400">
                      {new Date(alert.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
