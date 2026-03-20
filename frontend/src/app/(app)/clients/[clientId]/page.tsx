'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft, Loader2, Plus, Trash2, Save, Plane, DollarSign,
  TrendingUp, Mail, MapPin, StickyNote, Edit2, X,
} from 'lucide-react';
import { clientsAPI } from '@/lib/api';
import type { Client, ClientPointsBalance } from '@/types/org';
import type { SoloTripResponse } from '@/lib/api';
import { VALID_PROGRAMS } from '@/types/programs';
import { getProgramLabel } from '@/lib/programLabels';

interface PointsEntry {
  program: string;
  balance: string;
}

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [pointsList, setPointsList] = useState<ClientPointsBalance[]>([]);
  const [trips, setTrips] = useState<SoloTripResponse[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Points editor state
  const [editingPoints, setEditingPoints] = useState(false);
  const [pointsForm, setPointsForm] = useState<PointsEntry[]>([]);
  const [savingPoints, setSavingPoints] = useState(false);

  // Profile edit state
  const [editingProfile, setEditingProfile] = useState(false);
  const [profileForm, setProfileForm] = useState({ name: '', email: '', homeAirport: '', notes: '' });
  const [savingProfile, setSavingProfile] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [clientData, pts, tripsData] = await Promise.all([
        clientsAPI.get(clientId),
        clientsAPI.getPoints(clientId),
        clientsAPI.getTrips(clientId),
      ]);
      setClient(clientData);
      setPointsList(pts);
      setTrips(tripsData);
    } catch (err) {
      console.error('Failed to load client:', err);
      setError('Failed to load client data.');
    } finally {
      setIsLoading(false);
    }
  }, [clientId]);

  useEffect(() => { loadData(); }, [loadData]);

  const startEditingPoints = () => {
    setPointsForm(pointsList.map(p => ({ program: p.program, balance: String(p.balance) })));
    setEditingPoints(true);
  };

  const addPointsRow = () => {
    setPointsForm(prev => [...prev, { program: VALID_PROGRAMS[0], balance: '' }]);
  };

  const updatePointsEntry = (idx: number, field: keyof PointsEntry, value: string) => {
    setPointsForm(prev => prev.map((e, i) => i === idx ? { ...e, [field]: value } : e));
  };

  const removePointsEntry = (idx: number) => {
    setPointsForm(prev => prev.filter((_, i) => i !== idx));
  };

  const savePoints = async () => {
    setSavingPoints(true);
    try {
      const payload = pointsForm
        .filter(p => p.program && Number(p.balance) > 0)
        .map(p => ({ program: p.program, balance: Number(p.balance) }));
      const updated = await clientsAPI.updatePoints(clientId, payload);
      setPointsList(updated);
      setEditingPoints(false);
    } catch (err) {
      console.error('Failed to save points:', err);
    } finally {
      setSavingPoints(false);
    }
  };

  const startEditingProfile = () => {
    if (!client) return;
    setProfileForm({
      name: client.name,
      email: client.email || '',
      homeAirport: client.homeAirport || '',
      notes: client.notes || '',
    });
    setEditingProfile(true);
  };

  const saveProfile = async () => {
    setSavingProfile(true);
    try {
      const updated = await clientsAPI.update(clientId, {
        name: profileForm.name.trim(),
        email: profileForm.email.trim() || undefined,
        homeAirport: profileForm.homeAirport.trim().toUpperCase() || undefined,
        notes: profileForm.notes.trim() || undefined,
      });
      setClient(updated);
      setEditingProfile(false);
    } catch (err) {
      console.error('Failed to update client:', err);
    } finally {
      setSavingProfile(false);
    }
  };

  if (isLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="flex items-center justify-center py-24">
          <Loader2 className="w-6 h-6 animate-spin text-blue-600" />
          <span className="ml-3 text-slate-600">Loading client...</span>
        </div>
      </div>
    );
  }

  if (error || !client) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
        <div className="text-center py-24">
          <p className="text-red-600 mb-4">{error || 'Client not found'}</p>
          <Link href="/clients" className="text-blue-600 hover:text-blue-700 font-medium">Back to clients</Link>
        </div>
      </div>
    );
  }

  const usedPrograms = new Set(pointsForm.map(p => p.program));

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link href="/clients" className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-6">
        <ArrowLeft className="w-4 h-4" />
        Back to clients
      </Link>

      {/* Client header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">{client.name}</h1>
          <div className="flex items-center gap-4 mt-2 text-sm text-slate-500">
            {client.email && <span className="flex items-center gap-1"><Mail className="w-3.5 h-3.5" />{client.email}</span>}
            {client.homeAirport && <span className="flex items-center gap-1"><MapPin className="w-3.5 h-3.5" />{client.homeAirport}</span>}
          </div>
        </div>
        <Link
          href={`/solo/setup?clientId=${clientId}`}
          className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm"
        >
          <Plane className="w-4 h-4" />
          New Trip
        </Link>
      </div>

      {/* Stats cards */}
      <div className="grid grid-cols-3 gap-4 mb-8">
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <Plane className="w-4 h-4" />
            Trips
          </div>
          <p className="text-2xl font-bold text-slate-900">{client.stats?.totalTrips ?? trips.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <DollarSign className="w-4 h-4" />
            Total Savings
          </div>
          <p className="text-2xl font-bold text-slate-900">${(client.stats?.totalSavings ?? 0).toLocaleString()}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm text-slate-500 mb-1">
            <TrendingUp className="w-4 h-4" />
            Points Optimized
          </div>
          <p className="text-2xl font-bold text-slate-900">{(client.stats?.totalPointsOptimized ?? 0).toLocaleString()}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Profile section */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Profile</h2>
            {!editingProfile && (
              <button onClick={startEditingProfile} className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                <Edit2 className="w-3.5 h-3.5" />
                Edit
              </button>
            )}
          </div>

          {editingProfile ? (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
                <input
                  type="text"
                  value={profileForm.name}
                  onChange={e => setProfileForm(f => ({ ...f, name: e.target.value }))}
                  className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Email</label>
                <input
                  type="email"
                  value={profileForm.email}
                  onChange={e => setProfileForm(f => ({ ...f, email: e.target.value }))}
                  className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Home Airport</label>
                <input
                  type="text"
                  value={profileForm.homeAirport}
                  onChange={e => setProfileForm(f => ({ ...f, homeAirport: e.target.value }))}
                  maxLength={4}
                  className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 uppercase focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Notes</label>
                <textarea
                  value={profileForm.notes}
                  onChange={e => setProfileForm(f => ({ ...f, notes: e.target.value }))}
                  rows={3}
                  className="block w-full px-3 py-2 border border-slate-200 rounded-lg text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent resize-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button onClick={saveProfile} disabled={savingProfile} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-60 flex items-center gap-1.5">
                  {savingProfile ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button onClick={() => setEditingProfile(false)} className="px-4 py-2 text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 text-sm font-medium flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-3 text-sm">
              {client.email && (
                <div className="flex items-start gap-2">
                  <Mail className="w-4 h-4 text-slate-400 mt-0.5" />
                  <span className="text-slate-700">{client.email}</span>
                </div>
              )}
              {client.homeAirport && (
                <div className="flex items-start gap-2">
                  <MapPin className="w-4 h-4 text-slate-400 mt-0.5" />
                  <span className="text-slate-700">{client.homeAirport}</span>
                </div>
              )}
              {client.notes && (
                <div className="flex items-start gap-2">
                  <StickyNote className="w-4 h-4 text-slate-400 mt-0.5" />
                  <span className="text-slate-700">{client.notes}</span>
                </div>
              )}
              {!client.email && !client.homeAirport && !client.notes && (
                <p className="text-slate-400">No details added yet.</p>
              )}
            </div>
          )}
        </div>

        {/* Points section */}
        <div className="bg-white border border-slate-200 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-slate-900">Loyalty Balances</h2>
            {!editingPoints ? (
              <button onClick={startEditingPoints} className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                <Edit2 className="w-3.5 h-3.5" />
                Edit
              </button>
            ) : (
              <button onClick={addPointsRow} className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1">
                <Plus className="w-3.5 h-3.5" />
                Add
              </button>
            )}
          </div>

          {editingPoints ? (
            <div className="space-y-3">
              {pointsForm.length === 0 && (
                <p className="text-sm text-slate-400 py-2">No balances yet.</p>
              )}
              {pointsForm.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <select
                    value={entry.program}
                    onChange={e => updatePointsEntry(idx, 'program', e.target.value)}
                    className="flex-1 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white"
                  >
                    {VALID_PROGRAMS.map(prog => (
                      <option key={prog} value={prog} disabled={usedPrograms.has(prog) && entry.program !== prog}>
                        {getProgramLabel(prog)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    value={entry.balance}
                    onChange={e => updatePointsEntry(idx, 'balance', e.target.value)}
                    min={0}
                    placeholder="0"
                    className="w-28 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button onClick={() => removePointsEntry(idx)} className="p-1.5 text-slate-400 hover:text-red-500">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <div className="flex items-center gap-2 pt-2">
                <button onClick={savePoints} disabled={savingPoints} className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium disabled:opacity-60 flex items-center gap-1.5">
                  {savingPoints ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                  Save
                </button>
                <button onClick={() => setEditingPoints(false)} className="px-4 py-2 text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 text-sm font-medium flex items-center gap-1.5">
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              {pointsList.length === 0 ? (
                <p className="text-sm text-slate-400 py-2">No loyalty balances recorded yet.</p>
              ) : (
                pointsList.map(p => (
                  <div key={p.program} className="flex items-center justify-between py-2 border-b border-slate-100 last:border-0">
                    <span className="text-sm text-slate-700">{getProgramLabel(p.program)}</span>
                    <span className="text-sm font-medium text-slate-900">{p.balance.toLocaleString()}</span>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>

      {/* Trip history */}
      <div className="mt-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-semibold text-slate-900">Trip History</h2>
          <Link
            href={`/solo/setup?clientId=${clientId}`}
            className="text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
          >
            <Plus className="w-3.5 h-3.5" />
            New Trip
          </Link>
        </div>

        {trips.length === 0 ? (
          <div className="bg-white border border-slate-200 rounded-xl p-8 text-center">
            <Plane className="w-8 h-8 text-slate-300 mx-auto mb-3" />
            <p className="text-slate-500 mb-4">No trips yet for this client.</p>
            <Link
              href={`/solo/setup?clientId=${clientId}`}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              <Plane className="w-4 h-4" />
              Create First Trip
            </Link>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-5 py-3 font-medium text-slate-600">Trip</th>
                  <th className="text-left px-5 py-3 font-medium text-slate-600">Dates</th>
                  <th className="text-left px-5 py-3 font-medium text-slate-600">Status</th>
                  <th className="text-right px-5 py-3 font-medium text-slate-600">Est. Savings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {trips.map(trip => (
                  <tr
                    key={trip.tripId}
                    onClick={() => router.push(`/solo/results?trip_id=${trip.tripId}`)}
                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <span className="font-medium text-slate-900">{trip.title || trip.destinations?.join(' → ') || 'Trip'}</span>
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
