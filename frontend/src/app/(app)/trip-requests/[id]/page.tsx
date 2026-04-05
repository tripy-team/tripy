'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  Play,
  RefreshCw,
  Users,
  ChevronRight,
} from 'lucide-react';
import {
  getTripRequest,
  analyzeTripRequest,
  addTripTraveler,
  removeTripTraveler,
  getClients,
} from '@/lib/api-client';
import type { TripRequest, Client, TripTraveler, RecommendationRunSummary } from '@/lib/api-client';
import TradeoffRankingPanel from '@/components/TradeoffRankingPanel';
import ConfidenceMeter from '@/components/ConfidenceMeter';
import TripBriefPanel from '@/components/TripBriefPanel';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600',
    analyzing: 'bg-yellow-50 text-yellow-700',
    complete: 'bg-green-50 text-green-700',
    archived: 'bg-slate-100 text-slate-500',
    pending: 'bg-slate-100 text-slate-600',
    running: 'bg-yellow-50 text-yellow-700',
    completed: 'bg-green-50 text-green-700',
    failed: 'bg-red-50 text-red-700',
  };
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.draft}`}>
      {status}
    </span>
  );
}

export default function TripRequestDetailPage() {
  const params = useParams();
  const router = useRouter();
  const tripId = params.id as string;

  const [trip, setTrip] = useState<TripRequest | null>(null);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [showAddTraveler, setShowAddTraveler] = useState(false);
  const [addingTraveler, setAddingTraveler] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [t, c] = await Promise.all([
        getTripRequest(tripId),
        getClients().catch(() => []),
      ]);
      setTrip(t);
      setAllClients(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load trip request');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      await analyzeTripRequest(tripId);
      await loadData();
    } catch (err) {
      console.error('Failed to start analysis:', err);
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAddTraveler = async (clientId: string) => {
    setAddingTraveler(true);
    try {
      await addTripTraveler(tripId, clientId);
      await loadData();
      setShowAddTraveler(false);
    } catch (err) {
      console.error('Failed to add traveler:', err);
    } finally {
      setAddingTraveler(false);
    }
  };

  const handleRemoveTraveler = async (travelerId: string) => {
    try {
      await removeTripTraveler(tripId, travelerId);
      await loadData();
    } catch (err) {
      console.error('Failed to remove traveler:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading trip request...</span>
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error || 'Trip request not found'}</p>
        <Link href="/trip-requests" className="font-medium text-blue-600 hover:text-blue-700">
          Back to trip requests
        </Link>
      </div>
    );
  }

  const travelerClientIds = new Set(trip.travelers?.map((t) => t.clientId) ?? []);
  const availableClients = allClients.filter((c) => !travelerClientIds.has(c.id));

  return (
    <div className="max-w-5xl">
      <Link
        href="/trip-requests"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to trip requests
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{trip.title}</h1>
          <p className="mt-1 text-sm text-slate-500">
            {trip.originAirports?.join(', ')} → {trip.destinationAirports?.join(', ')}
            {trip.departureDate && (
              <>
                {' '}
                &middot;{' '}
                {new Date(trip.departureDate).toLocaleDateString('en-US', {
                  month: 'long',
                  day: 'numeric',
                  year: 'numeric',
                })}
                {trip.returnDate && (
                  <>
                    {' – '}
                    {new Date(trip.returnDate).toLocaleDateString('en-US', {
                      month: 'long',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </>
                )}
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <StatusBadge status={trip.status} />
          <button
            onClick={handleAnalyze}
            disabled={analyzing}
            className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {analyzing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Play className="h-4 w-4" />
            )}
            Run Analysis
          </button>
        </div>
      </div>

      {/* Trip Info */}
      <div className="mb-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Travelers</p>
          <p className="mt-1 text-lg font-bold text-slate-900">{trip.travelerCount}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Cabin</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {trip.cabinPreference || 'Any'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Flexibility</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {trip.flexibilityDays ? `±${trip.flexibilityDays}d` : 'Exact'}
          </p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs text-slate-500">Budget</p>
          <p className="mt-1 text-lg font-bold text-slate-900">
            {trip.budgetCash ? `$${trip.budgetCash.toLocaleString()}` : 'Open'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Travelers */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Travelers</h2>
            <button
              onClick={() => setShowAddTraveler(!showAddTraveler)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add
            </button>
          </div>

          {showAddTraveler && (
            <div className="border-b border-slate-100 bg-slate-50 p-4">
              <div className="max-h-40 space-y-1 overflow-y-auto">
                {availableClients.length === 0 ? (
                  <p className="py-2 text-center text-xs text-slate-400">No available clients</p>
                ) : (
                  availableClients.map((client) => (
                    <button
                      key={client.id}
                      onClick={() => handleAddTraveler(client.id)}
                      disabled={addingTraveler}
                      className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm hover:bg-blue-50 disabled:opacity-60"
                    >
                      <span className="font-medium text-slate-900">
                        {client.firstName} {client.lastName}
                      </span>
                      <Plus className="h-4 w-4 text-blue-600" />
                    </button>
                  ))
                )}
              </div>
            </div>
          )}

          <div className="divide-y divide-slate-100">
            {!trip.travelers || trip.travelers.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Users className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No travelers assigned</p>
              </div>
            ) : (
              trip.travelers.map((traveler: TripTraveler) => (
                <div key={traveler.id} className="flex items-center justify-between px-5 py-3">
                  <div className="flex items-center gap-3">
                    <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-medium text-blue-600">
                      {traveler.client?.firstName?.[0]}
                      {traveler.client?.lastName?.[0]}
                    </div>
                    <span className="text-sm font-medium text-slate-900">
                      {traveler.client?.firstName} {traveler.client?.lastName}
                    </span>
                  </div>
                  <button
                    onClick={() => handleRemoveTraveler(traveler.id)}
                    className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Recommendation Runs */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-5 py-4">
            <h2 className="font-semibold text-slate-900">Recommendation Runs</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {!trip.recommendationRuns || trip.recommendationRuns.length === 0 ? (
              <div className="px-5 py-8 text-center">
                <Play className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">
                  No analysis runs yet. Click &ldquo;Run Analysis&rdquo; to get started.
                </p>
              </div>
            ) : (
              trip.recommendationRuns.map((run: RecommendationRunSummary) => (
                <button
                  key={run.id}
                  onClick={() => {
                    if (run.status === 'completed') {
                      router.push(`/recommendation-runs/${run.id}`);
                    }
                  }}
                  disabled={run.status !== 'completed'}
                  className="flex w-full items-center justify-between px-5 py-3 text-left transition-colors hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-white"
                >
                  <div>
                    <p className="text-sm font-medium text-slate-900">
                      Run {new Date(run.createdAt).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </p>
                    {run.completedAt && (
                      <p className="text-xs text-slate-500">
                        Completed{' '}
                        {new Date(run.completedAt).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusBadge status={run.status} />
                    {run.status === 'completed' && (
                      <ChevronRight className="h-4 w-4 text-slate-400" />
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Trip Brief */}
      {trip.clientId && (
        <div className="mt-6">
          <TripBriefPanel tripId={tripId} hasCompletedIntake={true} />
        </div>
      )}

      {/* Preference Confidence Meter */}
      <div className="mt-6">
        <ConfidenceMeter tripId={tripId} />
      </div>

      {/* Tradeoff Priorities */}
      <div className="mt-6">
        <TradeoffRankingPanel
          tripRequestId={tripId}
          clientId={trip.clientId}
        />
      </div>

      {/* Notes */}
      {trip.notes && (
        <div className="mt-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-2 text-sm font-semibold text-slate-900">Notes</h3>
          <p className="text-sm text-slate-600">{trip.notes}</p>
        </div>
      )}
    </div>
  );
}
