'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  Plus,
  Search,
  Loader2,
  User,
  RefreshCw,
  Building2,
  Users,
  Plane,
  CreditCard,
  Clock,
  MapPin,
  Mail,
  Phone,
  ChevronRight,
} from 'lucide-react';
import { getClients } from '@/lib/api-client';
import type { Client, ClientBalanceSummary, ClientTripSummary } from '@/lib/api-client';

const CATEGORY_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  airline: { bg: 'bg-sky-50', text: 'text-sky-700', dot: 'bg-sky-400' },
  hotel: { bg: 'bg-amber-50', text: 'text-amber-700', dot: 'bg-amber-400' },
  transferable_bank: { bg: 'bg-violet-50', text: 'text-violet-700', dot: 'bg-violet-400' },
};

function formatPoints(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1)}K`;
  return n.toLocaleString();
}

function BalancePill({ balance }: { balance: ClientBalanceSummary }) {
  const colors = CATEGORY_COLORS[balance.loyaltyProgram.category] ?? CATEGORY_COLORS.airline;
  const isExpiring =
    balance.expirationDate &&
    Math.ceil((new Date(balance.expirationDate).getTime() - Date.now()) / 86400000) <= 30 &&
    Math.ceil((new Date(balance.expirationDate).getTime() - Date.now()) / 86400000) >= 0;

  return (
    <div
      className={`flex items-center gap-2 rounded-lg px-2.5 py-1.5 ${colors.bg} ${isExpiring ? 'ring-1 ring-amber-300' : ''}`}
    >
      <div className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
      <div className="min-w-0 flex-1">
        <p className={`truncate text-[11px] font-medium leading-tight ${colors.text}`}>
          {balance.loyaltyProgram.name}
        </p>
      </div>
      <span className={`shrink-0 text-xs font-bold tabular-nums ${colors.text}`}>
        {formatPoints(balance.balance)}
      </span>
      {isExpiring && <Clock className="h-3 w-3 shrink-0 text-amber-500" />}
    </div>
  );
}

function TripRow({ trip }: { trip: ClientTripSummary }) {
  const destinations = Array.isArray(trip.destinationAirports)
    ? trip.destinationAirports
    : [trip.destinationAirports];
  const isPast = new Date(trip.departureDate) < new Date();
  const statusColor: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-500',
    analyzing: 'bg-yellow-50 text-yellow-700',
    complete: 'bg-green-50 text-green-700',
    archived: 'bg-slate-100 text-slate-400',
  };

  return (
    <div className="flex items-center gap-2.5">
      <div
        className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ${
          isPast ? 'bg-slate-100' : 'bg-blue-50'
        }`}
      >
        <Plane className={`h-3.5 w-3.5 ${isPast ? 'text-slate-400' : 'text-blue-500'}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className={`truncate text-xs font-medium ${isPast ? 'text-slate-400' : 'text-slate-700'}`}>
          {trip.title}
        </p>
        <div className="flex items-center gap-1.5 text-[10px] text-slate-400">
          <MapPin className="h-2.5 w-2.5" />
          <span className="truncate">{destinations.join(', ')}</span>
          <span>&middot;</span>
          <span>
            {new Date(trip.departureDate).toLocaleDateString('en-US', {
              month: 'short',
              day: 'numeric',
            })}
          </span>
        </div>
      </div>
      <span
        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide ${statusColor[trip.status] ?? statusColor.draft}`}
      >
        {trip.status}
      </span>
    </div>
  );
}

function ClientCard({ client, onClick }: { client: Client; onClick: () => void }) {
  const isIndividual = client.clientType === 'individual';
  const balances = client.loyaltyBalances ?? [];
  const trips = client.tripRequests ?? [];
  const totalPoints = balances.reduce((sum, b) => sum + b.balance, 0);
  const tripCount = client._count?.tripRequests ?? trips.length;

  return (
    <div
      onClick={onClick}
      className="group relative flex cursor-pointer flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-all duration-200 hover:border-slate-300 hover:shadow-md"
    >
      {/* Profile Header */}
      <div className="relative px-5 pt-5 pb-4">
        <div className="flex items-start gap-3.5">
          <div
            className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-xl text-base font-bold ${
              isIndividual ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
            }`}
          >
            {isIndividual ? (
              <>
                {client.firstName?.[0]}
                {client.lastName?.[0]}
              </>
            ) : (
              <Building2 className="h-5 w-5" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="truncate text-sm font-semibold text-slate-900">
                {client.firstName} {client.lastName}
              </h3>
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                  client.status === 'active'
                    ? 'bg-green-50 text-green-700'
                    : 'bg-slate-100 text-slate-500'
                }`}
              >
                {client.status}
              </span>
            </div>
            <div className="mt-0.5 flex items-center gap-3 text-[11px] text-slate-400">
              <span
                className={`inline-flex items-center gap-1 ${
                  isIndividual ? 'text-blue-500' : 'text-purple-500'
                }`}
              >
                {isIndividual ? <User className="h-3 w-3" /> : <Building2 className="h-3 w-3" />}
                {isIndividual ? 'Individual' : 'Business'}
              </span>
              {client.email && (
                <span className="flex items-center gap-1 truncate">
                  <Mail className="h-3 w-3 shrink-0" />
                  <span className="truncate">{client.email}</span>
                </span>
              )}
            </div>
            {client.phone && (
              <div className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-400">
                <Phone className="h-3 w-3" />
                {client.phone}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Quick Stats Bar */}
      <div className="mx-5 grid grid-cols-3 divide-x divide-slate-100 rounded-xl bg-slate-50 px-1 py-2.5">
        <div className="flex flex-col items-center">
          <span className="text-base font-bold tabular-nums text-slate-900">
            {formatPoints(totalPoints)}
          </span>
          <span className="text-[10px] text-slate-400">Total Points</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-base font-bold tabular-nums text-slate-900">
            {balances.length}
          </span>
          <span className="text-[10px] text-slate-400">Programs</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-base font-bold tabular-nums text-slate-900">{tripCount}</span>
          <span className="text-[10px] text-slate-400">Trips</span>
        </div>
      </div>

      {/* Point Balances */}
      {balances.length > 0 && (
        <div className="px-5 pt-4">
          <div className="mb-2 flex items-center gap-1.5">
            <CreditCard className="h-3 w-3 text-slate-400" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Point Balances
            </span>
          </div>
          <div className="space-y-1.5">
            {balances.slice(0, 3).map((bal) => (
              <BalancePill key={bal.id} balance={bal} />
            ))}
            {balances.length > 3 && (
              <p className="text-center text-[10px] text-slate-400">
                +{balances.length - 3} more program{balances.length - 3 !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Recent Trips */}
      {trips.length > 0 && (
        <div className="px-5 pt-4">
          <div className="mb-2 flex items-center gap-1.5">
            <Plane className="h-3 w-3 text-slate-400" />
            <span className="text-[11px] font-medium uppercase tracking-wider text-slate-400">
              Recent Trips
            </span>
          </div>
          <div className="space-y-2">
            {trips.slice(0, 2).map((trip) => (
              <TripRow key={trip.id} trip={trip} />
            ))}
            {tripCount > 2 && (
              <p className="text-center text-[10px] text-slate-400">
                +{tripCount - 2} more trip{tripCount - 2 !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Empty state for no data */}
      {balances.length === 0 && trips.length === 0 && (
        <div className="px-5 pt-3">
          <p className="text-center text-xs text-slate-300">
            No balances or trips yet
          </p>
        </div>
      )}

      {/* Card Footer */}
      <div className="mt-auto flex items-center justify-between border-t border-slate-100 px-5 py-3 mt-4">
        <span className="text-[10px] text-slate-300">
          Added {new Date(client.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <span className="flex items-center gap-1 text-[11px] font-medium text-blue-600 opacity-0 transition-opacity group-hover:opacity-100">
          View Profile
          <ChevronRight className="h-3 w-3" />
        </span>
      </div>
    </div>
  );
}

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'individual' | 'business'>('all');

  const load = () => {
    setLoading(true);
    setError(null);
    getClients()
      .then(setClients)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const filtered = clients.filter((c) => {
    if (typeFilter !== 'all' && c.clientType !== typeFilter) return false;
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const name = `${c.firstName} ${c.lastName}`.toLowerCase();
    return name.includes(q) || c.email?.toLowerCase().includes(q);
  });

  const individualCount = clients.filter((c) => c.clientType === 'individual').length;
  const businessCount = clients.filter((c) => c.clientType === 'business').length;
  const totalPoints = clients.reduce(
    (sum, c) => sum + (c.loyaltyBalances ?? []).reduce((s, b) => s + b.balance, 0),
    0,
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading clients...</span>
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
    <div className="max-w-7xl">
      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          <p className="mt-1 text-sm text-slate-500">
            {clients.length} client{clients.length !== 1 ? 's' : ''} &middot;{' '}
            {individualCount} individual{individualCount !== 1 ? 's' : ''},{' '}
            {businessCount} business{businessCount !== 1 ? 'es' : ''}
            {totalPoints > 0 && (
              <>
                {' '}&middot; {formatPoints(totalPoints)} total points managed
              </>
            )}
          </p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          Add Client
        </Link>
      </div>

      {/* Filters */}
      {clients.length > 0 && (
        <div className="mb-6 flex items-center gap-4">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or email..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white py-2.5 pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="flex rounded-lg border border-slate-200 bg-white">
            {(['all', 'individual', 'business'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTypeFilter(t)}
                className={`px-3.5 py-2 text-xs font-medium transition-colors first:rounded-l-lg last:rounded-r-lg ${
                  typeFilter === t
                    ? 'bg-blue-600 text-white'
                    : 'text-slate-600 hover:bg-slate-50'
                }`}
              >
                {t === 'all' ? 'All' : t === 'individual' ? 'Individuals' : 'Businesses'}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {clients.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
          <Users className="mx-auto h-12 w-12 text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">No clients yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Add your first client to start managing their loyalty balances and trip recommendations.
          </p>
          <Link
            href="/clients/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Add Your First Client
          </Link>
        </div>
      ) : (
        /* Card Grid */
        <>
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white py-16 text-center shadow-sm">
              <Search className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-3 text-sm text-slate-500">No clients match your search</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 xl:grid-cols-3">
              {filtered.map((client) => (
                <ClientCard
                  key={client.id}
                  client={client}
                  onClick={() => router.push(`/clients/${client.id}`)}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
