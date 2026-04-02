'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Plus,
  Save,
  X,
  Mail,
  Phone,
  Calendar,
  StickyNote,
  RefreshCw,
  Trash2,
  ChevronDown,
  ChevronRight,
  Home,
  Plane,
} from 'lucide-react';
import {
  getClient,
  getClientBalances,
  getClientPreferences,
  addClientBalance,
  updateClientPreferences,
} from '@/lib/api-client';
import type {
  Client,
  LoyaltyBalance,
  ClientPreference,
  LedgerEntry,
} from '@/lib/api-client';

type Tab = 'overview' | 'balances' | 'preferences' | 'households' | 'trips';

export default function ClientDetailPage() {
  const params = useParams();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [balances, setBalances] = useState<LoyaltyBalance[]>([]);
  const [preferences, setPreferences] = useState<ClientPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>('overview');

  // Add balance form
  const [showAddBalance, setShowAddBalance] = useState(false);
  const [balanceForm, setBalanceForm] = useState({ programName: '', balance: '', expirationDate: '' });
  const [savingBalance, setSavingBalance] = useState(false);

  // Preferences form
  const [editingPrefs, setEditingPrefs] = useState(false);
  const [prefsForm, setPrefsForm] = useState({
    cabinPreference: '',
    redemptionStyle: '',
    preferNonstop: false,
    preferredAirlines: '',
  });
  const [savingPrefs, setSavingPrefs] = useState(false);

  // Expanded ledger
  const [expandedBalance, setExpandedBalance] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      const [c, b, p] = await Promise.all([
        getClient(clientId),
        getClientBalances(clientId),
        getClientPreferences(clientId).catch(() => null),
      ]);
      setClient(c);
      setBalances(b);
      setPreferences(p);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load client');
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleAddBalance = async () => {
    if (!balanceForm.programName || !balanceForm.balance) return;
    setSavingBalance(true);
    try {
      const newBalance = await addClientBalance(clientId, {
        programName: balanceForm.programName,
        balance: Number(balanceForm.balance),
        expirationDate: balanceForm.expirationDate || undefined,
      });
      setBalances((prev) => [...prev, newBalance]);
      setBalanceForm({ programName: '', balance: '', expirationDate: '' });
      setShowAddBalance(false);
    } catch (err) {
      console.error('Failed to add balance:', err);
    } finally {
      setSavingBalance(false);
    }
  };

  const handleSavePrefs = async () => {
    setSavingPrefs(true);
    try {
      const updated = await updateClientPreferences(clientId, {
        cabinPreference: prefsForm.cabinPreference || undefined,
        redemptionStyle: prefsForm.redemptionStyle || undefined,
        preferNonstop: prefsForm.preferNonstop,
        preferredAirlines: prefsForm.preferredAirlines
          ? prefsForm.preferredAirlines.split(',').map((a) => a.trim())
          : undefined,
      });
      setPreferences(updated);
      setEditingPrefs(false);
    } catch (err) {
      console.error('Failed to save preferences:', err);
    } finally {
      setSavingPrefs(false);
    }
  };

  const startEditingPrefs = () => {
    setPrefsForm({
      cabinPreference: preferences?.cabinPreference ?? '',
      redemptionStyle: preferences?.redemptionStyle ?? '',
      preferNonstop: preferences?.preferNonstop ?? false,
      preferredAirlines: preferences?.preferredAirlines?.join(', ') ?? '',
    });
    setEditingPrefs(true);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading client...</span>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error || 'Client not found'}</p>
        <Link href="/clients" className="font-medium text-blue-600 hover:text-blue-700">
          Back to clients
        </Link>
      </div>
    );
  }

  const tabs: { key: Tab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'balances', label: 'Balances' },
    { key: 'preferences', label: 'Preferences' },
    { key: 'households', label: 'Households' },
    { key: 'trips', label: 'Trips' },
  ];

  return (
    <div className="max-w-5xl">
      <Link
        href="/clients"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to clients
      </Link>

      {/* Header */}
      <div className="mb-6 flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {client.firstName} {client.lastName}
          </h1>
          <div className="mt-1 flex items-center gap-4 text-sm text-slate-500">
            {client.email && (
              <span className="flex items-center gap-1">
                <Mail className="h-3.5 w-3.5" />
                {client.email}
              </span>
            )}
            {client.phone && (
              <span className="flex items-center gap-1">
                <Phone className="h-3.5 w-3.5" />
                {client.phone}
              </span>
            )}
          </div>
        </div>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${
            client.status === 'active'
              ? 'bg-green-50 text-green-700'
              : 'bg-slate-100 text-slate-600'
          }`}
        >
          {client.status}
        </span>
      </div>

      {/* Tabs */}
      <div className="mb-6 border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`border-b-2 pb-3 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Quick stats */}
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Total Points Value</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {balances.reduce((sum, b) => sum + b.balance, 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Programs</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{balances.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Households</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{client.householdsCount ?? 0}</p>
            </div>
          </div>

          {/* Client info */}
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-4 font-semibold text-slate-900">Client Information</h2>
            <div className="grid grid-cols-2 gap-4 text-sm">
              {client.email && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Mail className="h-4 w-4 text-slate-400" />
                  {client.email}
                </div>
              )}
              {client.phone && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Phone className="h-4 w-4 text-slate-400" />
                  {client.phone}
                </div>
              )}
              {client.dateOfBirth && (
                <div className="flex items-center gap-2 text-slate-600">
                  <Calendar className="h-4 w-4 text-slate-400" />
                  {new Date(client.dateOfBirth).toLocaleDateString()}
                </div>
              )}
              {client.notes && (
                <div className="col-span-2 flex items-start gap-2 text-slate-600">
                  <StickyNote className="mt-0.5 h-4 w-4 text-slate-400" />
                  {client.notes}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {activeTab === 'balances' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Loyalty Balances</h2>
            <button
              onClick={() => setShowAddBalance(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Balance
            </button>
          </div>

          {showAddBalance && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <div className="grid grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Program name"
                  value={balanceForm.programName}
                  onChange={(e) => setBalanceForm((f) => ({ ...f, programName: e.target.value }))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <input
                  type="number"
                  placeholder="Balance"
                  value={balanceForm.balance}
                  onChange={(e) => setBalanceForm((f) => ({ ...f, balance: e.target.value }))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <input
                  type="date"
                  placeholder="Expiration"
                  value={balanceForm.expirationDate}
                  onChange={(e) => setBalanceForm((f) => ({ ...f, expirationDate: e.target.value }))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddBalance}
                  disabled={savingBalance}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingBalance ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </button>
                <button
                  onClick={() => setShowAddBalance(false)}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {balances.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center shadow-sm">
              <p className="text-slate-400">No loyalty balances recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium text-slate-600">Program</th>
                    <th className="px-5 py-3 text-right font-medium text-slate-600">Balance</th>
                    <th className="px-5 py-3 text-right font-medium text-slate-600">Expiration</th>
                    <th className="px-5 py-3 text-right font-medium text-slate-600">Updated</th>
                    <th className="w-10 px-3 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {balances.map((bal) => (
                    <Fragment key={bal.id}>
                      <tr
                        className="cursor-pointer transition-colors hover:bg-slate-50"
                        onClick={() => setExpandedBalance(expandedBalance === bal.id ? null : bal.id)}
                      >
                        <td className="px-5 py-3.5 font-medium text-slate-900">{bal.programName}</td>
                        <td className="px-5 py-3.5 text-right text-slate-900">
                          {bal.balance.toLocaleString()}
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-600">
                          {bal.expirationDate
                            ? new Date(bal.expirationDate).toLocaleDateString()
                            : '—'}
                        </td>
                        <td className="px-5 py-3.5 text-right text-slate-500">
                          {new Date(bal.lastUpdated).toLocaleDateString()}
                        </td>
                        <td className="px-3 py-3.5">
                          {expandedBalance === bal.id ? (
                            <ChevronDown className="h-4 w-4 text-slate-400" />
                          ) : (
                            <ChevronRight className="h-4 w-4 text-slate-400" />
                          )}
                        </td>
                      </tr>
                      {expandedBalance === bal.id && bal.ledgerEntries && bal.ledgerEntries.length > 0 && (
                        <tr key={`${bal.id}-ledger`}>
                          <td colSpan={5} className="bg-slate-50 px-8 py-3">
                            <p className="mb-2 text-xs font-medium text-slate-500">Ledger History</p>
                            <div className="space-y-1">
                              {bal.ledgerEntries.map((entry: LedgerEntry) => (
                                <div
                                  key={entry.id}
                                  className="flex items-center justify-between text-xs"
                                >
                                  <span className="text-slate-600">{entry.reason}</span>
                                  <div className="flex items-center gap-4">
                                    <span
                                      className={
                                        entry.changeAmount > 0
                                          ? 'text-green-600'
                                          : 'text-red-600'
                                      }
                                    >
                                      {entry.changeAmount > 0 ? '+' : ''}
                                      {entry.changeAmount.toLocaleString()}
                                    </span>
                                    <span className="text-slate-400">
                                      {new Date(entry.createdAt).toLocaleDateString()}
                                    </span>
                                  </div>
                                </div>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'preferences' && (
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Travel Preferences</h2>
            {!editingPrefs && (
              <button
                onClick={startEditingPrefs}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                Edit
              </button>
            )}
          </div>

          {editingPrefs ? (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Cabin Preference
                  </label>
                  <select
                    value={prefsForm.cabinPreference}
                    onChange={(e) => setPrefsForm((f) => ({ ...f, cabinPreference: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">No preference</option>
                    <option value="economy">Economy</option>
                    <option value="premium_economy">Premium Economy</option>
                    <option value="business">Business</option>
                    <option value="first">First</option>
                  </select>
                </div>
                <div>
                  <label className="mb-1.5 block text-sm font-medium text-slate-700">
                    Redemption Style
                  </label>
                  <select
                    value={prefsForm.redemptionStyle}
                    onChange={(e) => setPrefsForm((f) => ({ ...f, redemptionStyle: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    <option value="">No preference</option>
                    <option value="maximize_points">Maximize Points</option>
                    <option value="minimize_cash">Minimize Cash</option>
                    <option value="balanced">Balanced</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">
                  Preferred Airlines
                </label>
                <input
                  type="text"
                  value={prefsForm.preferredAirlines}
                  onChange={(e) => setPrefsForm((f) => ({ ...f, preferredAirlines: e.target.value }))}
                  placeholder="e.g., United, Delta, AA"
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input
                  type="checkbox"
                  checked={prefsForm.preferNonstop}
                  onChange={(e) => setPrefsForm((f) => ({ ...f, preferNonstop: e.target.checked }))}
                  className="rounded border-slate-300"
                />
                Prefer nonstop flights
              </label>

              <div className="flex gap-2 pt-2">
                <button
                  onClick={handleSavePrefs}
                  disabled={savingPrefs}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingPrefs ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save
                </button>
                <button
                  onClick={() => setEditingPrefs(false)}
                  className="rounded-lg bg-slate-100 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-200"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-slate-500">Cabin Preference</span>
                <span className="font-medium text-slate-900">
                  {preferences?.cabinPreference || 'Not set'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Redemption Style</span>
                <span className="font-medium text-slate-900">
                  {preferences?.redemptionStyle || 'Not set'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Nonstop Flights</span>
                <span className="font-medium text-slate-900">
                  {preferences?.preferNonstop ? 'Yes' : 'No preference'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Preferred Airlines</span>
                <span className="font-medium text-slate-900">
                  {preferences?.preferredAirlines?.join(', ') || 'None'}
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'households' && (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center shadow-sm">
          <Home className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">
            Household memberships will appear here.
          </p>
          <Link
            href="/households"
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Go to Households
          </Link>
        </div>
      )}

      {activeTab === 'trips' && (
        <div className="rounded-xl border border-slate-200 bg-white py-12 text-center shadow-sm">
          <Plane className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm text-slate-500">
            Trip requests involving this client will appear here.
          </p>
          <Link
            href="/trip-requests"
            className="mt-4 inline-flex items-center gap-2 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            Go to Trip Requests
          </Link>
        </div>
      )}
    </div>
  );
}
