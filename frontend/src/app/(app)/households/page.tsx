'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Plus, Home, Loader2, RefreshCw, Users } from 'lucide-react';
import { getHouseholds } from '@/lib/api-client';
import type { Household } from '@/lib/api-client';

export default function HouseholdsPage() {
  const router = useRouter();
  const [households, setHouseholds] = useState<Household[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getHouseholds()
      .then(setHouseholds)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading households...</span>
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
          <h1 className="text-2xl font-bold text-slate-900">Households</h1>
          <p className="mt-1 text-sm text-slate-500">
            {households.length} household{households.length !== 1 ? 's' : ''}
          </p>
        </div>
        <Link
          href="/households/new"
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Household
        </Link>
      </div>

      {households.length === 0 ? (
        <div className="rounded-xl border-2 border-dashed border-slate-200 py-16 text-center">
          <Home className="mx-auto h-12 w-12 text-slate-300" />
          <h2 className="mt-4 text-lg font-semibold text-slate-900">No households yet</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
            Create a household to group the people you travel with and manage your combined loyalty balances.
          </p>
          <Link
            href="/households/new"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            Create Your First Household
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {households.map((household) => (
            <button
              key={household.id}
              onClick={() => router.push(`/households/${household.id}`)}
              className="group rounded-xl border border-slate-200 bg-white p-5 text-left shadow-sm transition-all hover:border-blue-300 hover:shadow-md"
            >
              <div className="mb-3 flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-slate-50 transition-colors group-hover:bg-blue-50">
                  <Home className="h-5 w-5 text-slate-400 group-hover:text-blue-600" />
                </div>
                <h3 className="font-semibold text-slate-900">{household.name}</h3>
              </div>
              <div className="flex items-center gap-4 text-sm text-slate-500">
                <span className="flex items-center gap-1">
                  <Users className="h-3.5 w-3.5" />
                  {household.memberCount} member{household.memberCount !== 1 ? 's' : ''}
                </span>
                {household.estimatedPortfolioValue != null && (
                  <span className="font-medium text-slate-700">
                    ~${household.estimatedPortfolioValue.toLocaleString()}
                  </span>
                )}
              </div>
              {household.notes && (
                <p className="mt-2 truncate text-xs text-slate-400">{household.notes}</p>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
