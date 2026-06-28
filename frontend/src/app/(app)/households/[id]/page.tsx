'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Search,
  AlertTriangle,
  Users,
} from 'lucide-react';
import {
  getHousehold,
  getPortfolioSummary,
  addHouseholdMember,
  removeHouseholdMember,
  getClients,
} from '@/lib/api-client';
import type { Household, PortfolioSummary, Client, HouseholdMember } from '@/lib/api-client';

export default function HouseholdDetailPage() {
  const params = useParams();
  const householdId = params.id as string;

  const [household, setHousehold] = useState<Household | null>(null);
  const [portfolio, setPortfolio] = useState<PortfolioSummary | null>(null);
  const [allClients, setAllClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Add member
  const [showAddMember, setShowAddMember] = useState(false);
  const [memberSearch, setMemberSearch] = useState('');
  const [addingMember, setAddingMember] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [h, p, c] = await Promise.all([
        getHousehold(householdId),
        getPortfolioSummary(householdId).catch(() => null),
        getClients().catch(() => []),
      ]);
      setHousehold(h);
      setPortfolio(p);
      setAllClients(c);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load household');
    } finally {
      setLoading(false);
    }
  }, [householdId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddMember = async (clientId: string) => {
    setAddingMember(true);
    try {
      await addHouseholdMember(householdId, clientId);
      await loadData();
      setShowAddMember(false);
      setMemberSearch('');
    } catch (err) {
      console.error('Failed to add member:', err);
    } finally {
      setAddingMember(false);
    }
  };

  const handleRemoveMember = async (memberId: string) => {
    try {
      await removeHouseholdMember(householdId, memberId);
      await loadData();
    } catch (err) {
      console.error('Failed to remove member:', err);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading household...</span>
      </div>
    );
  }

  if (error || !household) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error || 'Household not found'}</p>
        <Link href="/households" className="font-medium text-blue-600 hover:text-blue-700">
          Back to households
        </Link>
      </div>
    );
  }

  const memberClientIds = new Set(household.members?.map((m) => m.clientId) ?? []);
  const availableClients = allClients.filter((c) => {
    if (memberClientIds.has(c.id)) return false;
    if (!memberSearch.trim()) return true;
    const q = memberSearch.toLowerCase();
    return `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q);
  });

  const maxExposure = portfolio?.programExposure.reduce((max, p) => Math.max(max, p.value), 0) ?? 1;

  return (
    <div className="max-w-5xl">
      <Link
        href="/households"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to households
      </Link>

      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">{household.name}</h1>
        {household.notes && <p className="mt-1 text-sm text-slate-500">{household.notes}</p>}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Members */}
        <div className="lg:col-span-2">
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <h2 className="font-semibold text-slate-900">
                Members ({household.members?.length ?? 0})
              </h2>
              <button
                onClick={() => setShowAddMember(!showAddMember)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add Member
              </button>
            </div>

            {showAddMember && (
              <div className="border-b border-slate-100 bg-slate-50 p-4">
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    placeholder="Search travelers..."
                    value={memberSearch}
                    onChange={(e) => setMemberSearch(e.target.value)}
                    className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div className="max-h-40 space-y-1 overflow-y-auto">
                  {availableClients.length === 0 ? (
                    <p className="py-2 text-center text-xs text-slate-400">
                      No matching clients
                    </p>
                  ) : (
                    availableClients.slice(0, 10).map((client) => (
                      <button
                        key={client.id}
                        onClick={() => handleAddMember(client.id)}
                        disabled={addingMember}
                        className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-blue-50 disabled:opacity-60"
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
              {!household.members || household.members.length === 0 ? (
                <div className="px-5 py-8 text-center">
                  <Users className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-500">No members yet</p>
                </div>
              ) : (
                household.members.map((member: HouseholdMember) => (
                  <div key={member.id} className="flex items-center justify-between px-5 py-3">
                    <div className="flex items-center gap-3">
                      <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-50 text-xs font-medium text-blue-600">
                        {member.client?.firstName?.[0]}
                        {member.client?.lastName?.[0]}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-slate-900">
                          {member.client?.firstName} {member.client?.lastName}
                        </p>
                        {member.client?.email && (
                          <p className="text-xs text-slate-500">{member.client.email}</p>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveMember(member.id)}
                      className="rounded p-1 text-slate-400 transition-colors hover:bg-red-50 hover:text-red-600"
                      title="Remove member"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Portfolio Summary */}
        <div className="space-y-4">
          {portfolio && (
            <>
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <p className="text-sm text-slate-500">Total Estimated Value</p>
                <p className="mt-1 text-2xl font-bold text-slate-900">
                  ${portfolio.totalEstimatedValue.toLocaleString()}
                </p>
              </div>

              {/* Program Exposure */}
              {portfolio.programExposure.length > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                  <h3 className="mb-3 text-sm font-semibold text-slate-900">Program Exposure</h3>
                  <div className="space-y-2">
                    {portfolio.programExposure.map((prog) => (
                      <div key={prog.program}>
                        <div className="mb-1 flex items-center justify-between text-xs">
                          <span className="text-slate-600">{prog.program}</span>
                          <span className="font-medium text-slate-900">
                            {prog.percentage}%
                          </span>
                        </div>
                        <div className="h-2 overflow-hidden rounded-full bg-slate-100">
                          <div
                            className="h-full rounded-full bg-blue-600 transition-all"
                            style={{ width: `${(prog.value / maxExposure) * 100}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Flexibility */}
              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <h3 className="mb-3 text-sm font-semibold text-slate-900">
                  Flexibility Breakdown
                </h3>
                <div className="flex gap-4">
                  <div className="flex-1">
                    <p className="text-xs text-slate-500">Flexible</p>
                    <p className="text-lg font-bold text-green-600">
                      {portfolio.flexibilityBreakdown.flexible.toLocaleString()}
                    </p>
                  </div>
                  <div className="flex-1">
                    <p className="text-xs text-slate-500">Locked</p>
                    <p className="text-lg font-bold text-slate-600">
                      {portfolio.flexibilityBreakdown.locked.toLocaleString()}
                    </p>
                  </div>
                </div>
              </div>

              {/* Expiring Balances */}
              {portfolio.expiringBalances.length > 0 && (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-5">
                  <div className="mb-2 flex items-center gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-600" />
                    <h3 className="text-sm font-semibold text-amber-800">
                      Expiring Balances
                    </h3>
                  </div>
                  <div className="space-y-2">
                    {portfolio.expiringBalances.map((bal, i) => (
                      <div key={i} className="text-xs text-amber-700">
                        <span className="font-medium">{bal.clientName}</span> &mdash;{' '}
                        {bal.program}: {bal.balance.toLocaleString()} pts expires{' '}
                        {new Date(bal.expirationDate).toLocaleDateString()}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
