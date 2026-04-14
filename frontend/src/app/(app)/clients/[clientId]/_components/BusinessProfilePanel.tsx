'use client';

import { useState, useEffect, useRef, useMemo } from 'react';
import { Plus, X, Search, Building2, Briefcase, Trash2, Loader2, Save } from 'lucide-react';
import {
  getBusinessProfile, upsertBusinessProfile, getBusinessTravelers, addBusinessTraveler, removeBusinessTraveler,
  getClients,
  type BusinessProfile, type BusinessTraveler, type Client,
} from '@/lib/api-client';

const SENIORITY_OPTIONS = ['executive', 'director', 'staff', 'ea'];
const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–500', '500+'];

export default function BusinessProfilePanel({ clientId, client }: { clientId: string; client: Client }) {
  const [profile, setProfile] = useState<BusinessProfile | null>(null);
  const [travelers, setTravelers] = useState<BusinessTraveler[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingPolicy, setEditingPolicy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showAdd, setShowAdd] = useState(false);

  const [policyForm, setPolicyForm] = useState({
    companyName: '', industry: '', companySize: '', billingContactName: '', billingContactEmail: '',
    requiresPreApproval: false, maxNightlyRateUsd: '', travelPolicyNotes: '',
  });

  const [allClients, setAllClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedLinked, setSelectedLinked] = useState<Client | null>(null);
  const clientSearchRef = useRef<HTMLDivElement>(null);
  const [addForm, setAddForm] = useState({ name: '', email: '', role: '', seniorityTier: '' });

  useEffect(() => {
    Promise.all([getBusinessProfile(clientId), getBusinessTravelers(clientId), getClients()])
      .then(([p, t, c]) => {
        setProfile(p);
        setTravelers(t);
        setAllClients(c.filter((x) => x.id !== clientId));
        if (p) {
          setPolicyForm({
            companyName: p.companyName ?? '',
            industry: p.industry ?? '',
            companySize: p.companySize ?? '',
            billingContactName: p.billingContactName ?? '',
            billingContactEmail: p.billingContactEmail ?? '',
            requiresPreApproval: p.requiresPreApproval ?? false,
            maxNightlyRateUsd: p.maxNightlyRateUsd?.toString() ?? '',
            travelPolicyNotes: p.travelPolicyNotes ?? '',
          });
        } else {
          setPolicyForm((f) => ({ ...f, companyName: `${client.firstName} ${client.lastName}`.trim() }));
        }
      })
      .finally(() => setLoading(false));
  }, [clientId, client.firstName, client.lastName]);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (clientSearchRef.current && !clientSearchRef.current.contains(e.target as Node)) setShowClientDropdown(false);
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const filteredClients = useMemo(() => {
    if (!clientSearch.trim()) return [];
    const q = clientSearch.toLowerCase();
    const linked = new Set(travelers.map((t) => t.linkedClientId).filter(Boolean));
    return allClients.filter((c) => !linked.has(c.id) && `${c.firstName} ${c.lastName} ${c.email ?? ''}`.toLowerCase().includes(q)).slice(0, 8);
  }, [clientSearch, allClients, travelers]);

  const handleSavePolicy = async () => {
    if (!policyForm.companyName.trim()) return;
    setSaving(true);
    try {
      const updated = await upsertBusinessProfile(clientId, {
        companyName: policyForm.companyName.trim(),
        industry: policyForm.industry || undefined,
        companySize: policyForm.companySize || undefined,
        billingContactName: policyForm.billingContactName || undefined,
        billingContactEmail: policyForm.billingContactEmail || undefined,
        requiresPreApproval: policyForm.requiresPreApproval,
        maxNightlyRateUsd: policyForm.maxNightlyRateUsd ? Number(policyForm.maxNightlyRateUsd) : undefined,
        travelPolicyNotes: policyForm.travelPolicyNotes || undefined,
      });
      setProfile(updated);
      setEditingPolicy(false);
    } finally {
      setSaving(false);
    }
  };

  const handleSelectLinked = (c: Client) => {
    setSelectedLinked(c);
    setAddForm((f) => ({ ...f, name: `${c.firstName} ${c.lastName}`, email: c.email ?? '' }));
    setClientSearch('');
    setShowClientDropdown(false);
  };

  const handleAddTraveler = async () => {
    if (!addForm.name.trim() && !selectedLinked) return;
    setSaving(true);
    try {
      const t = await addBusinessTraveler(clientId, {
        linkedClientId: selectedLinked?.id,
        name: addForm.name.trim() || `${selectedLinked?.firstName} ${selectedLinked?.lastName}`,
        email: addForm.email || undefined,
        role: addForm.role || undefined,
        seniorityTier: addForm.seniorityTier || undefined,
      });
      setTravelers((prev) => [...prev, t]);
      setShowAdd(false);
      setAddForm({ name: '', email: '', role: '', seniorityTier: '' });
      setSelectedLinked(null);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex items-center justify-center py-12"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  return (
    <div className="space-y-6">
      {/* Travel Policy */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Briefcase className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-900">Travel Policy</h2>
          </div>
          {!editingPolicy && (
            <button onClick={() => setEditingPolicy(true)} className="text-sm font-medium text-blue-600 hover:text-blue-700">Edit</button>
          )}
        </div>

        {editingPolicy ? (
          <div className="p-5 space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Company Name</label>
                <input type="text" value={policyForm.companyName} onChange={(e) => setPolicyForm((f) => ({ ...f, companyName: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Industry</label>
                <input type="text" value={policyForm.industry} onChange={(e) => setPolicyForm((f) => ({ ...f, industry: e.target.value }))}
                  placeholder="Finance, Tech, Legal..."
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Company Size</label>
                <select value={policyForm.companySize} onChange={(e) => setPolicyForm((f) => ({ ...f, companySize: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600">
                  <option value="">Select size</option>
                  {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Max Nightly Rate (USD)</label>
                <input type="number" value={policyForm.maxNightlyRateUsd} onChange={(e) => setPolicyForm((f) => ({ ...f, maxNightlyRateUsd: e.target.value }))}
                  placeholder="350"
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Billing Contact Name</label>
                <input type="text" value={policyForm.billingContactName} onChange={(e) => setPolicyForm((f) => ({ ...f, billingContactName: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div>
                <label className="mb-1.5 block text-xs font-medium text-slate-600">Billing Contact Email</label>
                <input type="email" value={policyForm.billingContactEmail} onChange={(e) => setPolicyForm((f) => ({ ...f, billingContactEmail: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={policyForm.requiresPreApproval} onChange={(e) => setPolicyForm((f) => ({ ...f, requiresPreApproval: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600" />
              <span className="text-sm text-slate-700">Requires pre-approval for bookings</span>
            </label>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-600">Travel Policy Notes</label>
              <textarea value={policyForm.travelPolicyNotes} onChange={(e) => setPolicyForm((f) => ({ ...f, travelPolicyNotes: e.target.value }))} rows={3}
                placeholder="Economy domestic, business international for VPs+..."
                className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
            </div>
            <div className="flex gap-2">
              <button onClick={handleSavePolicy} disabled={saving || !policyForm.companyName.trim()}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}Save
              </button>
              <button onClick={() => setEditingPolicy(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        ) : profile ? (
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 p-5 text-sm">
            {profile.companyName && <div><p className="text-xs text-slate-400">Company</p><p className="font-medium text-slate-800">{profile.companyName}</p></div>}
            {profile.industry && <div><p className="text-xs text-slate-400">Industry</p><p className="font-medium text-slate-800">{profile.industry}</p></div>}
            {profile.companySize && <div><p className="text-xs text-slate-400">Company Size</p><p className="font-medium text-slate-800">{profile.companySize} employees</p></div>}
            {profile.maxNightlyRateUsd && <div><p className="text-xs text-slate-400">Max Nightly Rate</p><p className="font-medium text-slate-800">${profile.maxNightlyRateUsd}/night</p></div>}
            {profile.billingContactName && <div><p className="text-xs text-slate-400">Billing Contact</p><p className="font-medium text-slate-800">{profile.billingContactName}</p></div>}
            <div><p className="text-xs text-slate-400">Pre-Approval</p><p className="font-medium text-slate-800">{profile.requiresPreApproval ? 'Required' : 'Not required'}</p></div>
            {profile.travelPolicyNotes && (
              <div className="col-span-2"><p className="text-xs text-slate-400">Policy Notes</p><p className="text-slate-700">{profile.travelPolicyNotes}</p></div>
            )}
          </div>
        ) : (
          <div className="p-5 text-center text-sm text-slate-400">
            No travel policy configured yet.{' '}
            <button onClick={() => setEditingPolicy(true)} className="font-medium text-blue-600 hover:text-blue-700">Add policy</button>
          </div>
        )}
      </div>

      {/* Traveler Roster */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-slate-400" />
            <h2 className="font-semibold text-slate-900">Traveler Roster <span className="ml-1 text-sm font-normal text-slate-400">({travelers.length})</span></h2>
          </div>
          <button onClick={() => setShowAdd(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
            <Plus className="h-4 w-4" />Add Traveler
          </button>
        </div>

        {showAdd && (
          <div className="border-b border-slate-100 bg-blue-50/40 p-5">
            <div ref={clientSearchRef} className="relative mb-3">
              {selectedLinked ? (
                <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                  <span className="text-sm font-medium text-slate-900">{selectedLinked.firstName} {selectedLinked.lastName}</span>
                  <button onClick={() => { setSelectedLinked(null); setAddForm((f) => ({ ...f, name: '', email: '' })); }} className="rounded p-1 text-slate-400 hover:text-slate-600"><X className="h-3.5 w-3.5" /></button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                    <input type="text" placeholder="Link existing client or fill in below..."
                      value={clientSearch}
                      onChange={(e) => { setClientSearch(e.target.value); setShowClientDropdown(true); }}
                      onFocus={() => { if (clientSearch.trim()) setShowClientDropdown(true); }}
                      className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  </div>
                  {showClientDropdown && filteredClients.length > 0 && (
                    <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      {filteredClients.map((c) => (
                        <button key={c.id} type="button" onClick={() => handleSelectLinked(c)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm hover:bg-slate-50">
                          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">{c.firstName[0]}{c.lastName?.[0] ?? ''}</div>
                          <div><p className="font-medium text-slate-900">{c.firstName} {c.lastName}</p>{c.email && <p className="text-xs text-slate-500">{c.email}</p>}</div>
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
              <input type="text" placeholder="Role (e.g. VP Finance)" value={addForm.role} onChange={(e) => setAddForm((f) => ({ ...f, role: e.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              <select value={addForm.seniorityTier} onChange={(e) => setAddForm((f) => ({ ...f, seniorityTier: e.target.value }))}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600">
                <option value="">Seniority tier</option>
                {SENIORITY_OPTIONS.map((s) => <option key={s} value={s} className="capitalize">{s}</option>)}
              </select>
            </div>
            <div className="mt-3 flex gap-2">
              <button onClick={handleAddTraveler} disabled={saving || (!addForm.name.trim() && !selectedLinked)}
                className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}Add
              </button>
              <button onClick={() => { setShowAdd(false); setSelectedLinked(null); setAddForm({ name: '', email: '', role: '', seniorityTier: '' }); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            </div>
          </div>
        )}

        {travelers.length === 0 && !showAdd ? (
          <div className="flex flex-col items-center gap-2 py-10 text-slate-400">
            <Building2 className="h-8 w-8" />
            <p className="text-sm">No travelers added yet.</p>
          </div>
        ) : (
          <div className="divide-y divide-slate-100">
            {travelers.map((t) => (
              <div key={t.id} className="flex items-center gap-3 px-5 py-3">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-purple-50 text-xs font-medium text-purple-600">
                  {t.name.charAt(0).toUpperCase()}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">{t.name}</p>
                    {t.seniorityTier && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600 capitalize">{t.seniorityTier}</span>
                    )}
                    {t.linkedClientId && <span className="rounded-full bg-blue-50 px-2 py-0.5 text-xs text-blue-600">Linked</span>}
                  </div>
                  <div className="flex gap-3 text-xs text-slate-400">
                    {t.email && <span>{t.email}</span>}
                    {t.role && <span>{t.role}</span>}
                  </div>
                </div>
                <button onClick={() => removeBusinessTraveler(clientId, t.id).then(() => setTravelers((prev) => prev.filter((x) => x.id !== t.id)))}
                  className="rounded p-1.5 text-slate-300 transition-colors hover:bg-red-50 hover:text-red-500">
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
