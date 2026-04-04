'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Users,
  ArrowRightLeft,
  Plane,
  Bell,
  Plus,
  Loader2,
  RefreshCw,
  ExternalLink,
  Zap,
} from 'lucide-react';
import { getDashboard, scrapeTransferBonuses } from '@/lib/api-client';
import type {
  DashboardData,
  TripRequest,
  AlertEvent,
  TransferBonusDetail,
} from '@/lib/api-client';

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

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

function TransferBonusCard({ bonus }: { bonus: TransferBonusDetail }) {
  const daysLeft = daysUntil(bonus.endsAt);
  const urgency = daysLeft <= 7 ? 'text-red-600' : daysLeft <= 14 ? 'text-amber-600' : 'text-slate-500';

  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-4 py-3 transition-colors hover:border-green-200 hover:bg-green-50/30">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-green-50">
          <Zap className="h-4 w-4 text-green-600" />
        </div>
        <div>
          <p className="text-sm font-medium text-slate-900">
            {bonus.fromProgram} → {bonus.toProgram}
          </p>
          <p className="text-xs text-slate-500">
            {bonus.sourceLabel && <span>{bonus.sourceLabel}</span>}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-semibold text-green-700">
          +{bonus.bonusPercent}%
        </span>
        <div className="text-right">
          <p className={`text-xs font-medium ${urgency}`}>
            {daysLeft > 0 ? `${daysLeft}d left` : 'Ending today'}
          </p>
          <p className="text-xs text-slate-400">
            ends {new Date(bonus.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>
        {bonus.sourceUrl && (
          <a
            href={bonus.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-slate-400 hover:text-blue-600"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [scraping, setScraping] = useState(false);
  const [scrapeMessage, setScrapeMessage] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getDashboard()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  const handleScrapeTPG = async () => {
    setScraping(true);
    setScrapeMessage(null);
    try {
      const result = await scrapeTransferBonuses();
      setScrapeMessage(result.message);
      load();
    } catch (err) {
      setScrapeMessage(err instanceof Error ? err.message : 'Scrape failed');
    } finally {
      setScraping(false);
    }
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

  const transferBonuses = Array.isArray(data.transferBonuses) ? data.transferBonuses : [];
  const activeTripAnalyses = Array.isArray(data.activeTripAnalyses) ? data.activeTripAnalyses : [];
  const recentAlerts = Array.isArray(data.recentAlerts) ? data.recentAlerts : [];

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
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Total Clients" value={data.totalClients ?? 0} icon={Users} color="blue" />
        <StatCard label="Active Transfer Bonuses" value={data.transferBonusCount ?? 0} icon={ArrowRightLeft} color="green" />
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
        <button
          onClick={handleScrapeTPG}
          disabled={scraping}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
        >
          {scraping ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          Sync TPG Bonuses
        </button>
      </div>

      {scrapeMessage && (
        <div className="mb-6 rounded-lg bg-blue-50 px-4 py-3 text-sm text-blue-700">
          {scrapeMessage}
        </div>
      )}

      {/* Transfer Bonuses Section */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div>
            <h2 className="font-semibold text-slate-900">Active Transfer Bonuses</h2>
            <p className="text-xs text-slate-500">Current promotions across loyalty programs</p>
          </div>
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
            {transferBonuses.length} active
          </span>
        </div>
        <div className="divide-y divide-slate-50 p-3">
          {transferBonuses.length === 0 ? (
            <div className="py-8 text-center">
              <ArrowRightLeft className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No active transfer bonuses</p>
              <button
                onClick={handleScrapeTPG}
                disabled={scraping}
                className="mt-3 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Sync from TPG
              </button>
            </div>
          ) : (
            transferBonuses.map((bonus: TransferBonusDetail) => (
              <TransferBonusCard key={bonus.id} bonus={bonus} />
            ))
          )}
        </div>
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
            {activeTripAnalyses.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Plane className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No active analyses</p>
              </div>
            ) : (
              activeTripAnalyses.map((trip: TripRequest) => (
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
            {recentAlerts.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Bell className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No recent alerts</p>
              </div>
            ) : (
              recentAlerts.slice(0, 5).map((alert: AlertEvent) => {
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
