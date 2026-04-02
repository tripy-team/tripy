'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Plane, Loader2, RefreshCw } from 'lucide-react';
import { getTripRequests } from '@/lib/api-client';
import type { TripRequest } from '@/lib/api-client';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-600',
    analyzing: 'bg-yellow-50 text-yellow-700',
    complete: 'bg-green-50 text-green-700',
    archived: 'bg-slate-100 text-slate-500',
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[status] ?? styles.draft}`}
    >
      {status}
    </span>
  );
}

export default function TripRequestsPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<TripRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getTripRequests()
      .then(setTrips)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading trip requests...</span>
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

  return (
    <div className="max-w-6xl">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Trip Requests</h1>
          <p className="mt-1 text-sm text-slate-500">
            {trips.length} trip request{trips.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/trip-requests/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Trip
        </Link>
      </div>

      {trips.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
          <Plane className="mx-auto h-12 w-12 text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">No trip requests yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Create a trip request to start analyzing the best redemption strategies for your
            clients.
          </p>
          <Link
            href="/trip-requests/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Create Your First Trip
          </Link>
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
          <table className="w-full text-sm">
            <thead className="border-b border-slate-200 bg-slate-50">
              <tr>
                <th className="px-5 py-3 text-left font-medium text-slate-600">Title</th>
                <th className="px-5 py-3 text-left font-medium text-slate-600">Route</th>
                <th className="px-5 py-3 text-left font-medium text-slate-600">Dates</th>
                <th className="px-5 py-3 text-left font-medium text-slate-600">Cabin</th>
                <th className="px-5 py-3 text-left font-medium text-slate-600">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {trips.map((trip) => (
                <tr
                  key={trip.id}
                  onClick={() => router.push(`/trip-requests/${trip.id}`)}
                  className="cursor-pointer transition-colors hover:bg-slate-50"
                >
                  <td className="px-5 py-3.5">
                    <span className="font-medium text-slate-900">{trip.title}</span>
                    {trip.client && (
                      <p className="text-xs text-slate-500">
                        {trip.client.firstName} {trip.client.lastName}
                      </p>
                    )}
                    {trip.household && (
                      <p className="text-xs text-slate-500">{trip.household.name}</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {trip.originAirports?.join(', ')} → {trip.destinationAirports?.join(', ')}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {trip.departureDate
                      ? new Date(trip.departureDate).toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        })
                      : '—'}
                    {trip.returnDate
                      ? ` – ${new Date(trip.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                      : ''}
                  </td>
                  <td className="px-5 py-3.5 text-slate-600">
                    {trip.cabinPreference || '—'}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={trip.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
