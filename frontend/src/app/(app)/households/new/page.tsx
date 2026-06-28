'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, Plus, X, Search } from 'lucide-react';
import { createHousehold, addHouseholdMember, getClients } from '@/lib/api-client';
import type { Client } from '@/lib/api-client';

export default function NewHouseholdPage() {
  const router = useRouter();
  const [name, setName] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // After creation, add members
  const [householdId, setHouseholdId] = useState<string | null>(null);
  const [clients, setClients] = useState<Client[]>([]);
  const [selectedClientIds, setSelectedClientIds] = useState<Set<string>>(new Set());
  const [clientSearch, setClientSearch] = useState('');
  const [addingMembers, setAddingMembers] = useState(false);

  useEffect(() => {
    getClients()
      .then(setClients)
      .catch(() => {});
  }, []);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const household = await createHousehold({
        name: name.trim(),
        notes: notes.trim() || undefined,
      });
      setHouseholdId(household.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create household');
    } finally {
      setSubmitting(false);
    }
  };

  const toggleClient = (id: string) => {
    setSelectedClientIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAddMembers = async () => {
    if (!householdId || selectedClientIds.size === 0) {
      router.push(`/households/${householdId}`);
      return;
    }
    setAddingMembers(true);
    try {
      await Promise.all(
        Array.from(selectedClientIds).map((clientId) =>
          addHouseholdMember(householdId, clientId),
        ),
      );
      router.push(`/households/${householdId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add members');
      setAddingMembers(false);
    }
  };

  const filteredClients = clients.filter((c) => {
    if (!clientSearch.trim()) return true;
    const q = clientSearch.toLowerCase();
    return `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) || c.email?.toLowerCase().includes(q);
  });

  // Step 2: Add members
  if (householdId) {
    return (
      <div className="max-w-2xl">
        <h1 className="mb-2 text-2xl font-bold text-slate-900">Add Members</h1>
        <p className="mb-6 text-slate-500">
          Select travelers to add to this household, or skip this step.
        </p>

        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        <div className="relative mb-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            placeholder="Search travelers..."
            value={clientSearch}
            onChange={(e) => setClientSearch(e.target.value)}
            className="w-full rounded-lg border border-slate-200 py-2.5 pl-10 pr-4 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>

        <div className="mb-6 max-h-80 space-y-2 overflow-y-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
          {filteredClients.length === 0 ? (
            <p className="py-4 text-center text-sm text-slate-400">No clients found</p>
          ) : (
            filteredClients.map((client) => (
              <label
                key={client.id}
                className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 transition-colors ${
                  selectedClientIds.has(client.id)
                    ? 'bg-blue-50 ring-1 ring-blue-200'
                    : 'hover:bg-slate-50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={selectedClientIds.has(client.id)}
                  onChange={() => toggleClient(client.id)}
                  className="rounded border-slate-300"
                />
                <div>
                  <p className="text-sm font-medium text-slate-900">
                    {client.firstName} {client.lastName}
                  </p>
                  {client.email && (
                    <p className="text-xs text-slate-500">{client.email}</p>
                  )}
                </div>
              </label>
            ))
          )}
        </div>

        <div className="flex gap-3">
          <button
            onClick={handleAddMembers}
            disabled={addingMembers}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {addingMembers ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Adding...
              </>
            ) : selectedClientIds.size > 0 ? (
              `Add ${selectedClientIds.size} Member${selectedClientIds.size !== 1 ? 's' : ''}`
            ) : (
              'Skip & Go to Household'
            )}
          </button>
        </div>
      </div>
    );
  }

  // Step 1: Create household
  return (
    <div className="max-w-2xl">
      <Link
        href="/households"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to households
      </Link>

      <h1 className="mb-2 text-2xl font-bold text-slate-900">New Household</h1>
      <p className="mb-8 text-slate-500">Create a household to group the people you travel with.</p>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div>
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Household Name *</label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="The Smith Family"
            />
          </div>
          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder="Additional notes about this household..."
            />
          </div>
        </div>

        <div className="flex gap-3">
          <button
            type="submit"
            disabled={submitting || !name.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              'Create Household'
            )}
          </button>
          <Link
            href="/households"
            className="rounded-lg bg-slate-100 px-6 py-3 font-medium text-slate-700 hover:bg-slate-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
