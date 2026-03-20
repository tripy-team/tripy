'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Plane, Users, DollarSign, TrendingUp, Loader2 } from 'lucide-react';
import { clientsAPI, orgs, trips as tripsAPI, users } from '@/lib/api';
import type { Client } from '@/types/org';

interface RecentTrip {
  tripId: string;
  title: string;
  clientName?: string;
  destinations?: string[];
  startDate?: string;
  endDate?: string;
  status: string;
  estimatedSavings?: number;
}

export default function Dashboard() {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [recentTrips, setRecentTrips] = useState<RecentTrip[]>([]);
  const [totalSavings, setTotalSavings] = useState(0);
  const [tripsThisMonth, setTripsThisMonth] = useState(0);
  const [orgName, setOrgName] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        const [orgData, clientsData, tripsData] = await Promise.all([
          orgs.getMyOrg().catch(() => null),
          clientsAPI.list().catch(() => []),
          tripsAPI.list({ limit: 10, offset: 0, includeDetails: false }).catch(() => ({ trips: [], total: 0, has_more: false })),
        ]);

        if (orgData) setOrgName(orgData.branding?.brandName || orgData.name);
        setClients(clientsData);

        // Build client lookup
        const clientMap = new Map(clientsData.map(c => [c.clientId, c]));

        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
        let monthCount = 0;

        const mapped: RecentTrip[] = (tripsData.trips || []).map((t: Record<string, unknown>) => {
          const created = t.createdAt ? new Date(t.createdAt as string) : null;
          if (created && created >= monthStart) monthCount++;

          const cId = t.clientId as string | undefined;
          const client = cId ? clientMap.get(cId) : undefined;

          return {
            tripId: t.tripId as string,
            title: (t.title as string) || (t.firstDestination as string) || 'Trip',
            clientName: client?.isSelfClient ? 'Myself' : client?.name,
            destinations: t.destinations as string[] | undefined,
            startDate: t.startDate as string | undefined,
            endDate: t.endDate as string | undefined,
            status: t.status as string,
            estimatedSavings: t.estimatedSavings as number | undefined,
          };
        });

        setRecentTrips(mapped);
        setTripsThisMonth(monthCount);

        // Aggregate savings from client stats
        const savings = clientsData.reduce((sum, c) => sum + (c.stats?.totalSavings ?? 0), 0);
        if (savings > 0) {
          setTotalSavings(savings);
        } else {
          try {
            const s = await users.calculateSavings();
            setTotalSavings(s.total_savings || 0);
          } catch {
            /* non-blocking */
          }
        }
      } catch (err) {
        console.error('Dashboard load error:', err);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const activeClients = clients.filter(c => !c.isSelfClient);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="ml-3 text-slate-600">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">
          {orgName ? `${orgName}` : 'Your Workspace'}
        </h1>
        <p className="text-slate-600 mt-1">Manage your clients and trip recommendations</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Users className="w-4 h-4" />
            Active Clients
          </div>
          <p className="text-3xl font-bold text-slate-900">{activeClients.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Plane className="w-4 h-4" />
            Trips This Month
          </div>
          <p className="text-3xl font-bold text-slate-900">{tripsThisMonth}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <DollarSign className="w-4 h-4" />
            Total Savings Generated
          </div>
          <p className="text-3xl font-bold text-green-600">${totalSavings.toLocaleString()}</p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
        <Link
          href="/clients/new"
          className="flex items-center gap-4 bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
        >
          <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-100 transition-colors">
            <Users className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">Add Client</h3>
            <p className="text-sm text-slate-500">Add a new client to your portfolio</p>
          </div>
        </Link>
        <Link
          href="/solo/setup"
          className="flex items-center gap-4 bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
        >
          <div className="w-11 h-11 bg-blue-50 rounded-xl flex items-center justify-center group-hover:bg-blue-100 transition-colors">
            <Plane className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <h3 className="font-semibold text-slate-900">New Trip</h3>
            <p className="text-sm text-slate-500">Optimize a trip for a client</p>
          </div>
        </Link>
      </div>

      {/* Recent trips */}
      <div>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-slate-900">Recent Trips</h2>
          <Link href="/my-trips" className="text-sm text-blue-600 hover:text-blue-700 font-medium">
            View all
          </Link>
        </div>

        {recentTrips.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-12 text-center">
            <Plane className="w-10 h-10 text-slate-300 mx-auto mb-3" />
            <h3 className="font-semibold text-slate-900 mb-1">No trips yet</h3>
            <p className="text-slate-500 mb-6">Create your first trip to get started.</p>
            <Link
              href="/solo/setup"
              className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 font-medium"
            >
              <Plus className="w-4 h-4" />
              New Trip
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3 font-medium text-slate-600">Trip</th>
                  <th className="text-left px-5 py-3 font-medium text-slate-600">Client</th>
                  <th className="text-left px-5 py-3 font-medium text-slate-600">Dates</th>
                  <th className="text-left px-5 py-3 font-medium text-slate-600">Status</th>
                  <th className="text-right px-5 py-3 font-medium text-slate-600">Est. Savings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {recentTrips.map(trip => (
                  <tr
                    key={trip.tripId}
                    onClick={() => router.push(`/solo/results?trip_id=${trip.tripId}`)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-slate-900">{trip.title}</span>
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">
                      {trip.clientName || '—'}
                    </td>
                    <td className="px-5 py-3.5 text-slate-600">
                      {trip.startDate ? new Date(trip.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'}
                      {trip.endDate ? ` – ${new Date(trip.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}` : ''}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-medium ${
                        trip.status === 'completed' ? 'bg-green-50 text-green-700' :
                        trip.status === 'optimized' || trip.status === 'selected' ? 'bg-blue-50 text-blue-700' :
                        'bg-slate-100 text-slate-600'
                      }`}>
                        {trip.status}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-right font-medium text-slate-900">
                      {trip.estimatedSavings != null ? `$${trip.estimatedSavings.toLocaleString()}` : '—'}
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
