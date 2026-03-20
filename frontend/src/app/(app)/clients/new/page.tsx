'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Plus, Trash2 } from 'lucide-react';
import { clientsAPI } from '@/lib/api';
import { VALID_PROGRAMS } from '@/types/programs';
import { getProgramLabel } from '@/lib/programLabels';

interface PointsEntry {
  program: string;
  balance: string;
}

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    name: '',
    email: '',
    homeAirport: '',
    notes: '',
  });
  const [points, setPoints] = useState<PointsEntry[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onFieldChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm(f => ({ ...f, [e.target.name]: e.target.value }));
  };

  const addPointsRow = () => {
    setPoints(p => [...p, { program: VALID_PROGRAMS[0], balance: '' }]);
  };

  const updatePoints = (idx: number, field: keyof PointsEntry, value: string) => {
    setPoints(prev => prev.map((entry, i) => i === idx ? { ...entry, [field]: value } : entry));
  };

  const removePoints = (idx: number) => {
    setPoints(prev => prev.filter((_, i) => i !== idx));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const initialPoints = points
        .filter(p => p.program && Number(p.balance) > 0)
        .map(p => ({ program: p.program, balance: Number(p.balance) }));

      const client = await clientsAPI.create({
        name: form.name.trim(),
        email: form.email.trim() || undefined,
        homeAirport: form.homeAirport.trim().toUpperCase() || undefined,
        notes: form.notes.trim() || undefined,
        initialPoints: initialPoints.length > 0 ? initialPoints : undefined,
      });

      router.push(`/clients/${client.clientId}`);
    } catch (err) {
      console.error('Failed to create client:', err);
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSubmitting(false);
    }
  };

  const usedPrograms = new Set(points.map(p => p.program));

  return (
    <div className="max-w-2xl mx-auto px-4 sm:px-6 lg:px-8 py-10">
      <Link
        href="/clients"
        className="inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900 mb-6"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to clients
      </Link>

      <h1 className="text-2xl font-bold text-slate-900 mb-2">Add Client</h1>
      <p className="text-slate-600 mb-8">Enter your client&apos;s details and their loyalty point balances.</p>

      {error && (
        <div className="mb-6 rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-5">
          <h2 className="font-semibold text-slate-900">Client Details</h2>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Name *</label>
            <input
              type="text"
              name="name"
              required
              value={form.name}
              onChange={onFieldChange}
              className="block w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
              placeholder="John Smith"
            />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={onFieldChange}
                className="block w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                placeholder="john@example.com"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Home Airport</label>
              <input
                type="text"
                name="homeAirport"
                value={form.homeAirport}
                onChange={onFieldChange}
                maxLength={4}
                className="block w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent uppercase"
                placeholder="JFK"
              />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={onFieldChange}
              rows={3}
              className="block w-full px-3 py-2.5 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent resize-none"
              placeholder="Prefers business class, anniversary trip in June..."
            />
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Loyalty Balances</h2>
            <button
              type="button"
              onClick={addPointsRow}
              className="inline-flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              <Plus className="w-4 h-4" />
              Add Program
            </button>
          </div>

          {points.length === 0 ? (
            <p className="text-sm text-slate-500 py-2">No loyalty balances added yet. You can add them now or later.</p>
          ) : (
            <div className="space-y-3">
              {points.map((entry, idx) => (
                <div key={idx} className="flex items-center gap-3">
                  <select
                    value={entry.program}
                    onChange={e => updatePoints(idx, 'program', e.target.value)}
                    className="flex-1 px-3 py-2.5 border border-slate-200 rounded-xl text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent bg-white"
                  >
                    {VALID_PROGRAMS.map(prog => (
                      <option key={prog} value={prog} disabled={usedPrograms.has(prog) && entry.program !== prog}>
                        {getProgramLabel(prog)}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="Balance"
                    value={entry.balance}
                    onChange={e => updatePoints(idx, 'balance', e.target.value)}
                    min={0}
                    className="w-36 px-3 py-2.5 border border-slate-200 rounded-xl text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => removePoints(idx)}
                    className="p-2 text-slate-400 hover:text-red-500 transition-colors"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !form.name.trim()}
            className="flex-1 py-3 px-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:ring-offset-2 transition-all font-medium disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
          >
            {submitting ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Client'
            )}
          </button>
          <Link
            href="/clients"
            className="py-3 px-6 text-slate-700 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors font-medium"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
