'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Users, Search, Loader2, DollarSign, Plane, User } from 'lucide-react';
import { clientsAPI } from '@/lib/api';
import type { Client } from '@/types/org';

export default function ClientsPage() {
  const router = useRouter();
  const [clients, setClients] = useState<Client[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(() => {
    const load = async () => {
      try {
        const data = await clientsAPI.list();
        setClients(data);
      } catch (err) {
        console.error('Failed to load clients:', err);
        setError('Failed to load clients. Please try again.');
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const filtered = clients.filter(c => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return (
      c.name.toLowerCase().includes(q) ||
      c.email?.toLowerCase().includes(q) ||
      c.homeAirport?.toLowerCase().includes(q)
    );
  });

  const nonSelfClients = filtered.filter(c => !c.isSelfClient);

  if (isLoading) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="ml-3 text-slate-600">Loading clients...</span>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="text-center py-24">
          <p className="text-red-600 mb-4">{error}</p>
          <button onClick={() => window.location.reload()} className="text-blue-600 hover:text-blue-700 font-medium">
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Clients</h1>
          <p className="text-slate-600 mt-1">{nonSelfClients.length} client{nonSelfClients.length !== 1 ? 's' : ''}</p>
        </div>
        <Link
          href="/clients/new"
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm"
        >
          <Plus className="w-4 h-4" />
          Add Client
        </Link>
      </div>

      {nonSelfClients.length > 0 && (
        <div className="relative mb-6">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search clients..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-10 pr-4 py-2.5 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
          />
        </div>
      )}

      {nonSelfClients.length === 0 ? (
        <div className="text-center py-24 border-2 border-dashed border-slate-200 rounded-2xl">
          <Users className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-lg font-semibold text-slate-900 mb-2">No clients yet</h2>
          <p className="text-slate-600 mb-6 max-w-md mx-auto">
            Add your first client to start managing their loyalty balances and trip recommendations.
          </p>
          <Link
            href="/clients/new"
            className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium"
          >
            <Plus className="w-4 h-4" />
            Add Your First Client
          </Link>
        </div>
      ) : (
        <div className="grid gap-4">
          {nonSelfClients.map(client => (
            <button
              key={client.clientId}
              onClick={() => router.push(`/clients/${client.clientId}`)}
              className="w-full text-left bg-white border border-slate-200 rounded-xl p-5 hover:border-blue-300 hover:shadow-sm transition-all group"
            >
              <div className="flex items-center gap-4">
                <div className="w-11 h-11 bg-blue-50 rounded-full flex items-center justify-center flex-shrink-0 group-hover:bg-blue-100 transition-colors">
                  <User className="w-5 h-5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-3">
                    <h3 className="font-semibold text-slate-900 truncate">{client.name}</h3>
                    {client.homeAirport && (
                      <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full flex-shrink-0">
                        {client.homeAirport}
                      </span>
                    )}
                  </div>
                  {client.email && <p className="text-sm text-slate-500 truncate">{client.email}</p>}
                </div>
                <div className="flex items-center gap-6 text-sm text-slate-600 flex-shrink-0">
                  <div className="flex items-center gap-1.5" title="Total trips">
                    <Plane className="w-4 h-4 text-slate-400" />
                    <span>{client.stats?.totalTrips ?? 0}</span>
                  </div>
                  <div className="flex items-center gap-1.5" title="Total savings">
                    <DollarSign className="w-4 h-4 text-slate-400" />
                    <span>${(client.stats?.totalSavings ?? 0).toLocaleString()}</span>
                  </div>
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
