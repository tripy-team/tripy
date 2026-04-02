'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Bell,
  Loader2,
  RefreshCw,
  CheckCircle,
  AlertTriangle,
  Info,
  AlertCircle,
  Filter,
} from 'lucide-react';
import {
  getAlerts,
  markAlertRead,
  getAlertSubscriptions,
  updateAlertSubscription,
} from '@/lib/api-client';
import type { AlertEvent, AlertSubscription } from '@/lib/api-client';

type FilterType = 'all' | 'unread' | 'transfer_bonuses' | 'expirations';

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'critical') return <AlertCircle className="h-5 w-5 text-red-500" />;
  if (severity === 'warning') return <AlertTriangle className="h-5 w-5 text-amber-500" />;
  return <Info className="h-5 w-5 text-blue-500" />;
}

export default function AlertsPage() {
  const [alerts, setAlerts] = useState<AlertEvent[]>([]);
  const [subscriptions, setSubscriptions] = useState<AlertSubscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');
  const [showSubscriptions, setShowSubscriptions] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    Promise.all([getAlerts(), getAlertSubscriptions().catch(() => [])])
      .then(([a, s]) => {
        setAlerts(a);
        setSubscriptions(s);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleMarkRead = async (alertId: string) => {
    try {
      const updated = await markAlertRead(alertId);
      setAlerts((prev) => prev.map((a) => (a.id === alertId ? updated : a)));
    } catch (err) {
      console.error('Failed to mark alert as read:', err);
    }
  };

  const handleToggleSubscription = async (subId: string, enabled: boolean) => {
    try {
      const updated = await updateAlertSubscription(subId, enabled);
      setSubscriptions((prev) => prev.map((s) => (s.id === subId ? updated : s)));
    } catch (err) {
      console.error('Failed to update subscription:', err);
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    if (filter === 'unread') return !a.isRead;
    if (filter === 'transfer_bonuses') return a.category === 'transfer_bonus';
    if (filter === 'expirations') return a.category === 'expiration';
    return true;
  });

  const unreadCount = alerts.filter((a) => !a.isRead).length;

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading alerts...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error}</p>
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

  const filterButtons: { key: FilterType; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'unread', label: `Unread (${unreadCount})` },
    { key: 'transfer_bonuses', label: 'Transfer Bonuses' },
    { key: 'expirations', label: 'Expirations' },
  ];

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Alerts</h1>
          <p className="mt-1 text-sm text-slate-500">
            {unreadCount > 0
              ? `${unreadCount} unread alert${unreadCount !== 1 ? 's' : ''}`
              : 'All caught up!'}
          </p>
        </div>
        <button
          onClick={() => setShowSubscriptions(!showSubscriptions)}
          className="inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
        >
          <Filter className="h-4 w-4" />
          Subscriptions
        </button>
      </div>

      {/* Filter tabs */}
      <div className="mb-6 flex gap-2">
        {filterButtons.map((btn) => (
          <button
            key={btn.key}
            onClick={() => setFilter(btn.key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === btn.key
                ? 'bg-blue-50 text-blue-700'
                : 'text-slate-500 hover:bg-slate-50 hover:text-slate-700'
            }`}
          >
            {btn.label}
          </button>
        ))}
      </div>

      {/* Subscriptions panel */}
      {showSubscriptions && subscriptions.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-4 font-semibold text-slate-900">Alert Subscriptions</h3>
          <div className="space-y-3">
            {subscriptions.map((sub) => (
              <div key={sub.id} className="flex items-center justify-between">
                <span className="text-sm text-slate-700 capitalize">
                  {sub.category.replace(/_/g, ' ')}
                </span>
                <label className="relative inline-flex cursor-pointer items-center">
                  <input
                    type="checkbox"
                    checked={sub.enabled}
                    onChange={(e) => handleToggleSubscription(sub.id, e.target.checked)}
                    className="peer sr-only"
                  />
                  <div className="peer h-6 w-11 rounded-full bg-slate-200 after:absolute after:left-[2px] after:top-[2px] after:h-5 after:w-5 after:rounded-full after:border after:border-gray-300 after:bg-white after:transition-all after:content-[''] peer-checked:bg-blue-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-600" />
                </label>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Alerts list */}
      {filteredAlerts.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
          <Bell className="mx-auto h-12 w-12 text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">No alerts</h2>
          <p className="mt-2 text-sm text-slate-500">
            {filter !== 'all'
              ? 'No alerts match the current filter.'
              : "You're all caught up. No new alerts."}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredAlerts.map((alert) => {
            const severityBorder: Record<string, string> = {
              info: 'border-l-blue-500',
              warning: 'border-l-amber-500',
              critical: 'border-l-red-500',
            };

            return (
              <div
                key={alert.id}
                className={`rounded-lg border border-slate-200 border-l-4 bg-white p-4 shadow-sm transition-colors ${
                  severityBorder[alert.severity] ?? severityBorder.info
                } ${!alert.isRead ? 'bg-blue-50/30' : ''}`}
              >
                <div className="flex items-start gap-3">
                  <SeverityIcon severity={alert.severity} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <h3
                        className={`text-sm ${alert.isRead ? 'text-slate-700' : 'font-semibold text-slate-900'}`}
                      >
                        {alert.title}
                      </h3>
                      <span className="flex-shrink-0 text-xs text-slate-400">
                        {new Date(alert.createdAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-slate-600">{alert.body}</p>
                    <div className="mt-2 flex items-center gap-3">
                      {!alert.isRead && (
                        <button
                          onClick={() => handleMarkRead(alert.id)}
                          className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          <CheckCircle className="h-3.5 w-3.5" />
                          Mark as Read
                        </button>
                      )}
                      {alert.entityType && alert.entityId && (
                        <Link
                          href={`/${alert.entityType}s/${alert.entityId}`}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          View {alert.entityType}
                        </Link>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
