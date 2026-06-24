'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  ArrowDown,
  ArrowUp,
  AlertTriangle,
  Clock,
  TrendingDown,
  Calendar,
  Shield,
  Sparkles,
  ExternalLink,
} from 'lucide-react';

const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';

interface DeltaBullet {
  type: string;
  label: string;
  detail: string;
  direction: string;
  subtype?: string;
}

interface UpdateData {
  update_id: string;
  detected_at: string;
  severity: string;
  baseline_summary: Record<string, unknown>;
  new_candidate_summary: Record<string, unknown>;
  deltas: {
    bullets: DeltaBullet[];
    recommendation: string;
    caveat: string;
  };
  trip_id: string;
  subscription_tier: string;
  // Degraded response fields
  degraded?: boolean;
  message?: string;
  // Error fields
  error?: string;
}

function getDirectionIcon(direction: string) {
  if (direction === 'improvement') return <ArrowDown className="w-4 h-4 text-green-600" />;
  if (direction === 'regression') return <ArrowUp className="w-4 h-4 text-red-600" />;
  return <Clock className="w-4 h-4 text-slate-400" />;
}

function getTypeIcon(type: string) {
  if (type === 'price_drop') return <TrendingDown className="w-5 h-5 text-green-600" />;
  if (type === 'schedule_change') return <Calendar className="w-5 h-5 text-amber-600" />;
  if (type === 'points_improvement') return <Sparkles className="w-5 h-5 text-indigo-600" />;
  if (type === 'risk_change') return <Shield className="w-5 h-5 text-red-600" />;
  return <AlertTriangle className="w-5 h-5 text-slate-500" />;
}

function formatTimeAgo(isoDate: string): string {
  try {
    const detected = new Date(isoDate);
    const now = new Date();
    const diffMs = now.getTime() - detected.getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) return 'Less than an hour ago';
    if (diffHours < 24) return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`;
    if (diffDays < 30) return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`;
    return detected.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  } catch {
    return '';
  }
}

function formatDate(isoDate: string): string {
  try {
    return new Date(isoDate).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      timeZoneName: 'short',
    });
  } catch {
    return isoDate;
  }
}

function UpdatePageContent() {
  const params = useParams();
  const router = useRouter();
  const updateId = params?.update_id as string;

  const [data, setData] = useState<UpdateData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  useEffect(() => {
    if (!updateId) return;

    async function fetchUpdate() {
      try {
        const res = await fetch(`${BACKEND_URL}/solo/api/monitoring/updates/${updateId}`);

        if (res.status === 410) {
          setExpired(true);
          setLoading(false);
          return;
        }

        if (!res.ok) {
          setError('Update not found.');
          setLoading(false);
          return;
        }

        const json = await res.json();
        setData(json);
      } catch (err) {
        setError('Failed to load update. Please try again.');
      } finally {
        setLoading(false);
      }
    }

    fetchUpdate();
  }, [updateId]);

  // Loading state
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-50">
        <div className="text-center">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600" />
          <p className="mt-4 text-slate-600">Loading update...</p>
        </div>
      </div>
    );
  }

  // Expired state
  if (expired) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center shadow-sm">
          <div className="w-12 h-12 bg-slate-100 rounded-xl flex items-center justify-center mx-auto mb-4">
            <Clock className="w-6 h-6 text-slate-400" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">This update has expired</h2>
          <p className="text-slate-500 mb-6">
            Monitoring updates are available for 90 days after detection. This one is no longer available.
          </p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            Search current prices
          </button>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !data) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center shadow-sm">
          <div className="w-12 h-12 bg-red-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-red-500" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Update not found</h2>
          <p className="text-slate-500 mb-6">{error || 'This update could not be loaded.'}</p>
          <button
            onClick={() => router.push('/')}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
          >
            Go to TripsHacker
          </button>
        </div>
      </div>
    );
  }

  // Degraded view
  if (data.degraded) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
        <div className="bg-white border border-slate-200 rounded-2xl p-8 max-w-md text-center shadow-sm">
          <div className="w-12 h-12 bg-amber-50 rounded-xl flex items-center justify-center mx-auto mb-4">
            <AlertTriangle className="w-6 h-6 text-amber-500" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Older update format</h2>
          <p className="text-slate-500 mb-6">{data.message}</p>
          {data.trip_id && (
            <button
              onClick={() => router.push(`/solo/booking?trip_id=${data.trip_id}`)}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors"
            >
              Check current prices
            </button>
          )}
        </div>
      </div>
    );
  }

  // Full comparison view
  const timeAgo = formatTimeAgo(data.detected_at);
  const dateStr = formatDate(data.detected_at);
  const isStale = (() => {
    try {
      const detected = new Date(data.detected_at);
      const hoursSince = (Date.now() - detected.getTime()) / (1000 * 60 * 60);
      return hoursSince > 24;
    } catch {
      return false;
    }
  })();

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-2xl mx-auto space-y-6">
        {/* Header */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <div className="flex items-start gap-3 mb-4">
            <div className={`w-10 h-10 ${data.severity === 'high' ? 'bg-green-50' : 'bg-blue-50'} rounded-xl flex items-center justify-center flex-shrink-0`}>
              {data.severity === 'high' ? (
                <TrendingDown className="w-5 h-5 text-green-600" />
              ) : (
                <AlertTriangle className="w-5 h-5 text-blue-600" />
              )}
            </div>
            <div>
              <h1 className="text-xl font-semibold text-slate-900">
                Something changed on your trip
              </h1>
              <p className="text-slate-500 mt-1">
                Detected: {dateStr} ({timeAgo})
              </p>
            </div>
          </div>

          {/* Staleness warning */}
          {isStale && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-sm text-amber-800">
                This deal may no longer be available. Check current prices to confirm.
              </p>
            </div>
          )}
        </div>

        {/* Delta bullets */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h2 className="font-semibold text-slate-900 text-lg mb-4">What changed</h2>
          <div className="space-y-3">
            {data.deltas.bullets.map((bullet, i) => (
              <div key={i} className="flex items-start gap-3 p-3 bg-slate-50 rounded-xl">
                <div className="flex-shrink-0 mt-0.5">
                  {getTypeIcon(bullet.type)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-slate-900">{bullet.label}</span>
                    {getDirectionIcon(bullet.direction)}
                  </div>
                  <p className="text-sm text-slate-500 mt-0.5">{bullet.detail}</p>
                </div>
              </div>
            ))}
          </div>

          {/* Recommendation */}
          {data.deltas.recommendation && (
            <div className="mt-4 p-4 bg-blue-50 border border-blue-200 rounded-xl">
              <p className="text-blue-900">{data.deltas.recommendation}</p>
            </div>
          )}

          {/* Caveat */}
          {data.deltas.caveat && (
            <p className="mt-3 text-sm text-slate-500">{data.deltas.caveat}</p>
          )}
        </div>

        {/* Comparison cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {/* Baseline */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 shadow-sm">
            <h3 className="font-semibold text-slate-500 text-sm uppercase tracking-wide mb-3">
              Your Booking
            </h3>
            <ComparisonCard data={data.baseline_summary} />
          </div>

          {/* New candidate */}
          <div className="bg-green-50 border border-green-200 rounded-2xl p-5 shadow-sm">
            <h3 className="font-semibold text-green-700 text-sm uppercase tracking-wide mb-3">
              New Option Found
            </h3>
            <ComparisonCard data={data.new_candidate_summary} />
          </div>
        </div>

        {/* CTA */}
        <div className="text-center">
          <button
            onClick={() => {
              if (data.trip_id) {
                router.push(`/solo/booking?trip_id=${data.trip_id}`);
              } else {
                router.push('/');
              }
            }}
            className="inline-flex items-center gap-2 px-8 py-3.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl transition-colors shadow-sm"
          >
            Check current prices
            <ExternalLink className="w-4 h-4" />
          </button>
        </div>

        {/* Provenance footer */}
        <p className="text-center text-xs text-slate-400">
          This alert was sent because you signed up for trip monitoring on TripsHacker.
        </p>
      </div>
    </div>
  );
}

function ComparisonCard({ data }: { data: Record<string, unknown> }) {
  const cashPrice = data.cash_price as number | undefined;
  const pointsCost = data.points_cost as number | undefined;
  const stops = data.stops as number | undefined;
  const segments = data.segments as Array<Record<string, unknown>> | undefined;
  const carrier = segments?.[0]?.carrier as string | undefined;

  return (
    <div className="space-y-2">
      {carrier && (
        <p className="text-slate-900 font-medium">{carrier}</p>
      )}
      {cashPrice !== undefined && (
        <p className="text-slate-700">
          <span className="font-semibold">${cashPrice.toLocaleString()}</span>
          <span className="text-slate-500"> cash</span>
        </p>
      )}
      {pointsCost !== undefined && (
        <p className="text-slate-700">
          <span className="font-semibold">{pointsCost.toLocaleString()}</span>
          <span className="text-slate-500"> points</span>
        </p>
      )}
      {stops !== undefined && (
        <p className="text-sm text-slate-500">
          {stops === 0 ? 'Nonstop' : `${stops} stop${stops > 1 ? 's' : ''}`}
        </p>
      )}
    </div>
  );
}

export default function UpdatePage() {
  return <UpdatePageContent />;
}
