'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, X, Search, Users, Star, Trash2, Loader2 } from 'lucide-react';
import {
  getGroupMembers, addGroupMember, removeGroupMember, updateGroupMember,
  getGroupProfile, upsertGroupProfile, getClients,
  type GroupMember, type GroupProfile, type GroupType, type GroupDecisionStyle, type Client, type LinkedClientSummary,
} from '@/lib/api-client';

const GROUP_TYPE_LABELS: Record<GroupType, string> = {
  leisure_friends: 'Friends / Leisure',
  destination_wedding: 'Destination Wedding',
  family_reunion: 'Family Reunion',
  corporate_offsite: 'Corporate Offsite',
  multi_generational: 'Multi-Generational',
  other: 'Other',
};

const DECISION_LABELS: Record<GroupDecisionStyle, string> = {
  organizer_decides: 'Organizer decides',
  consensus: 'Consensus',
  advisor_recommends: 'Advisor recommends',
};

export default function GroupMembersPanel({ clientId, client, onMembersChange }: { clientId: string; client: Client; onMembersChange?: (count: number) => void }) {
  const [profile, setProfile] = useState<GroupProfile | null>(null);
  const [members, setMembers] = useState<GroupMember[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [saving, setSaving] = useState(false);

  const [allClients, setAllClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedLinked, setSelectedLinked] = useState<LinkedClientSummary | null>(null);
  const clientSearchRef = useRef<HTMLDivElement>(null);

  const [addForm, setAddForm] = useState({ name: '', email: '', isOrganizer: false });

  useEffect(() => {
    Promise.all([getGroupProfile(clientId), getGroupMembers(clientId), getClients()])
      .then(([p, m, c]) => {
        setProfile(p);
        setMembers(m);
        setAllClients(c.filter((x) => x.id !== clientId));
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (clientSearchRef.current && !clientSearchRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return [];
    const q = clientSearch.toLowerCase();
    const memberLinkedIds = new Set(members.map((m) => m.linkedClientId).filter(Boolean));
    return allClients
      .filter((c) => !memberLinkedIds.has(c.id))
      .filter((c) => `${c.firstName} ${c.lastName} ${c.email ?? ''}`.toLowerCase().includes(q))
      .slice(0, 8);
  }, [clientSearch, allClients, members]);

  const handleSelectLinked = (c: Client) => {
    setSelectedLinked({ id: c.id, firstName: c.firstName, lastName: c.lastName, email: c.email, phone: c.phone });
    setAddForm((f) => ({ ...f, name: `${c.firstName} ${c.lastName}`, email: c.email ?? '' }));
    setClientSearch('');
    setShowClientDropdown(false);
  };

  const handleAdd = async () => {
    if (!addForm.name.trim() && !selectedLinked) return;
    setSaving(true);
    try {
      const member = await addGroupMember(clientId, {
        linkedClientId: selectedLinked?.id,
        name: addForm.name.trim() || `${selectedLinked?.firstName} ${selectedLinked?.lastName}`,
        email: addForm.email.trim() || undefined,
        isOrganizer: addForm.isOrganizer,
      });
      setMembers((prev) => {
        const next = [...prev, member];
        onMembersChange?.(next.length);
        return next;
      });
      setShowAdd(false);
      setAddForm({ name: '', email: '', isOrganizer: false });
      setSelectedLinked(null);

      // Update estimated size if profile exists
      if (profile) {
        const newSize = (profile.estimatedSize ?? members.length) < members.length + 1
          ? members.length + 1
          : profile.estimatedSize;
        const updated = await upsertGroupProfile(clientId, { estimatedSize: newSize });
        setProfile(updated);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleRemove = async (memberId: string) => {
    await removeGroupMember(clientId, memberId);
    setMembers((prev) => {
      const next = prev.filter((m) => m.id !== memberId);
      onMembersChange?.(next.length);
      return next;
    });
  };

  const handleToggleOrganizer = async (member: GroupMember) => {
    const updated = await updateGroupMember(clientId, member.id, { isOrganizer: !member.isOrganizer });
    setMembers((prev) => prev.map((m) => (m.id === member.id ? updated : m)));
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  const organizers = members.filter((m) => m.isOrganizer);
  const regularMembers = members.filter((m) => !m.isOrganizer);

  return (
    <div className="space-y-6">
      {/* Group Profile Summary */}
      {profile && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-700">
              <Users className="h-3.5 w-3.5" />
              {GROUP_TYPE_LABELS[profile.groupType]}
            </div>
            {profile.estimatedSize && (
              <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
                ~{profile.estimatedSize} travelers
              </span>
            )}
            <span className="rounded-full bg-slate-100 px-3 py-1 text-sm text-slate-600">
              {DECISION_LABELS[profile.decisionStyle]}
            </span>
            {profile.sharedBilling && (
              <span className="rounded-full bg-amber-50 px-3 py-1 text-sm text-amber-700">Shared billing</span>
            )}
          </div>
          {profile.notes && <p className="mt-3 text-sm text-slate-500">{profile.notes}</p>}
        </div>
      )}

      {/* Members list */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <h2 className="font-semibold text-slate-900">
            Members <span className="ml-1 text-sm font-normal text-slate-400">({members.length})</span>
          </h2>
          <button
            onClick={() => setShowAdd(true)}
            className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
          >
            <Plus className="h-4 w-4" />Add Member
          </button>
        </div>

        {showAdd && (
          <div className="border-b border-slate-100 bg-blue-50/40 p-5">
            <div ref={clientSearchRef} className="relative mb-3">
              {selectedLinked ? (
                <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <span className="text-sm font-medium text-slate-900">{selectedLinked.firstName} {selectedLinked.lastName}</span>
                  <button onClick={() => { setSelectedLinked(null); setAddForm((f) => ({ ...f, name: '', email: '' })); }} className="rounded p-1 text-slate-400 hover:text-slate-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text" placeholder="Link an existing client, or fill in below..."
                      value={clientSearch}
                      onChange={(e) => { setClientSearch(e.target.value); setShowClientDropdown(true); }}
                      onFocus={() => { if (clientSearch.trim()) setShowClientDropdown(true); }}
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  {showClientDropdown && filteredClients.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      {filteredClients.map((c) => (
                        <button key={c.id} type="button" onClick={() => handleSelectLinked(c)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">{c.firstName[0]}{c.lastName?.[0] ?? ''}</div>
                          <div>
                            <p className="font-medium text-slate-900">{c.firstName} {c.lastName}</p>
                            {c.email && <p className="text-xs text-slate-500">{c.email}</p>}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2">
              <input type="text" placeholder="Name *" value={addForm.name} onChange={(e) => setAddForm((f) => ({ ...f, name: e.target.value }))} disabled={!!selectedLinked}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm disabled:bg-slate-100 disabled:text-slate-500 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              <input type="email" placeholder="Email" value={addForm.email} onChange={(e) => setAddForm((f) => ({ ...f, email: e.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              <label className="flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2">
                <input type="checkbox" checked={addForm.isOrganizer} onChange={(e) => setAddForm((f) => ({ ...f, isOrganizer: e.target.checked }))} className="h-4 w-4 rounded text-blue-600" />
                <span className="text-sm text-slate-700">Group organizer</span>
              </label>
            </div>

            <div className="mt-3 flex gap-2">
              <button onClick={handleAdd} disabled={saving || (!addForm.name.trim() && !selectedLinked)}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                Add
              </button>
              <button onClick={() => { setShowAdd(false); setSelectedLinked(null); setAddForm({ name: '', email: '', isOrganizer: false }); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
            </div>
          </div>
        )}

        {members.length === 0 && !showAdd ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
            <Users className="h-8 w-8" />
            <p className="text-sm">No members yet. Add members to build the group roster.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {[...organizers, ...regularMembers].map((m) => (
              <div key={m.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                  {m.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{m.name}</p>
                    {m.isOrganizer && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-700">
                        <Star className="h-3 w-3" />Organizer
                      </span>
                    )}
                    {m.linkedClientId && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">Linked</span>
                    )}
                  </div>
                  <div className="flex gap-3 text-xs text-slate-400">
                    {m.email && <span>{m.email}</span>}
                    {m.departureCity && <span>Departs: {m.departureCity}</span>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button onClick={() => handleToggleOrganizer(m)} title={m.isOrganizer ? 'Remove organizer' : 'Mark as organizer'}
                    className={`rounded p-1.5 transition-colors ${m.isOrganizer ? 'text-amber-500 hover:bg-amber-50' : 'text-slate-300 hover:bg-slate-100 hover:text-amber-400'}`}>
                    <Star className="h-3.5 w-3.5" />
                  </button>
                  <button onClick={() => handleRemove(m.id)} className="rounded p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
