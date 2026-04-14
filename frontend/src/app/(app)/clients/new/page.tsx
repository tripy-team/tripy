'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, User, Building2, Plus, X, Search, Coins, Users } from 'lucide-react';
import { createClient, getLoyaltyPrograms, type LoyaltyProgramRecord, type InitialBalanceEntry, type GroupType, type GroupDecisionStyle } from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

interface BalanceRow {
  loyaltyProgramId: string;
  programName: string;
  balance: string;
}

const GROUP_TYPES: { value: GroupType; label: string }[] = [
  { value: 'leisure_friends', label: 'Friends / Leisure' },
  { value: 'destination_wedding', label: 'Destination Wedding' },
  { value: 'family_reunion', label: 'Family Reunion' },
  { value: 'corporate_offsite', label: 'Corporate Offsite' },
  { value: 'multi_generational', label: 'Multi-Generational' },
  { value: 'other', label: 'Other' },
];

const DECISION_STYLES: { value: GroupDecisionStyle; label: string; desc: string }[] = [
  { value: 'organizer_decides', label: 'Organizer decides', desc: 'One person leads' },
  { value: 'consensus', label: 'Consensus', desc: 'Group votes' },
  { value: 'advisor_recommends', label: 'Advisor recommends', desc: 'We guide the choice' },
];

const COMPANY_SIZES = ['1–10', '11–50', '51–200', '201–500', '500+'];

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    clientType: 'individual' as 'individual' | 'group' | 'business',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    notes: '',
  });
  const [groupForm, setGroupForm] = useState({
    groupType: 'leisure_friends' as GroupType,
    estimatedSize: '',
    decisionStyle: 'consensus' as GroupDecisionStyle,
    notes: '',
  });
  const [businessForm, setBusinessForm] = useState({
    industry: '',
    companySize: '',
    requiresPreApproval: false,
    travelPolicyNotes: '',
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [loyaltyPrograms, setLoyaltyPrograms] = useState<LoyaltyProgramRecord[]>([]);
  const [balanceRows, setBalanceRows] = useState<BalanceRow[]>([]);
  const [showAddBalance, setShowAddBalance] = useState(false);
  const [programSearch, setProgramSearch] = useState('');
  const [showProgramDropdown, setShowProgramDropdown] = useState(false);
  const programDropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getLoyaltyPrograms().then(setLoyaltyPrograms).catch(() => {});
  }, []);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (programDropdownRef.current && !programDropdownRef.current.contains(e.target as Node)) {
        setShowProgramDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const filteredPrograms = useMemo(() => {
    const alreadyAdded = new Set(balanceRows.map((b) => b.loyaltyProgramId));
    return loyaltyPrograms.filter((p) => {
      if (alreadyAdded.has(p.id)) return false;
      if (!programSearch) return true;
      return p.name.toLowerCase().includes(programSearch.toLowerCase());
    });
  }, [programSearch, balanceRows, loyaltyPrograms]);

  const handleSelectProgram = (program: LoyaltyProgramRecord) => {
    setBalanceRows((prev) => [...prev, { loyaltyProgramId: program.id, programName: program.name, balance: '' }]);
    setProgramSearch('');
    setShowProgramDropdown(false);
    setShowAddBalance(false);
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  };

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.firstName.trim() || !form.lastName.trim()) return;
    setSubmitting(true);
    setError(null);

    try {
      const initialBalances: InitialBalanceEntry[] = balanceRows
        .filter((r) => r.loyaltyProgramId && r.balance && Number(r.balance) > 0)
        .map((r) => ({ loyaltyProgramId: r.loyaltyProgramId, balance: Number(r.balance) }));

      const client = await createClient({
        clientType: form.clientType,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim(),
        email: form.email.trim(),
        phone: form.phone.trim() || undefined,
        dateOfBirth: form.dateOfBirth || undefined,
        notes: form.notes.trim() || undefined,
        initialBalances: initialBalances.length > 0 ? initialBalances : undefined,
        groupProfile: form.clientType === 'group' ? {
          groupType: groupForm.groupType,
          estimatedSize: groupForm.estimatedSize ? Number(groupForm.estimatedSize) : undefined,
          decisionStyle: groupForm.decisionStyle,
          notes: groupForm.notes || undefined,
        } : undefined,
        businessProfile: form.clientType === 'business' ? {
          companyName: form.firstName.trim(),
          industry: businessForm.industry || undefined,
          companySize: businessForm.companySize || undefined,
          requiresPreApproval: businessForm.requiresPreApproval,
          travelPolicyNotes: businessForm.travelPolicyNotes || undefined,
        } : undefined,
      });
      router.push(`/clients/${client.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSubmitting(false);
    }
  };

  const typeConfig = {
    individual: { label: 'Individual', desc: 'Single traveler with family', icon: User },
    group: { label: 'Group', desc: 'Friends, weddings, reunions', icon: Users },
    business: { label: 'Business', desc: 'Company or organization', icon: Building2 },
  };

  return (
    <div className="max-w-2xl">
      <Link href="/clients" className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900">
        <ArrowLeft className="h-4 w-4" />
        Back to clients
      </Link>

      <h1 className="mb-2 text-2xl font-bold text-slate-900">Add Client</h1>
      <p className="mb-8 text-slate-500">Enter your client&apos;s details to get started.</p>

      {error && <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Client Type */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Client Type</h2>
          <div className="grid grid-cols-3 gap-3">
            {(Object.entries(typeConfig) as [typeof form.clientType, typeof typeConfig.individual][]).map(([type, cfg]) => {
              const Icon = cfg.icon;
              const active = form.clientType === type;
              return (
                <button
                  key={type}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, clientType: type }))}
                  className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${active ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                >
                  <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${active ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'}`}>
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <p className={`font-medium ${active ? 'text-blue-900' : 'text-slate-900'}`}>{cfg.label}</p>
                    <p className="text-xs text-slate-500">{cfg.desc}</p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Core Details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 font-semibold text-slate-900">
            {form.clientType === 'business' ? 'Business Details' : form.clientType === 'group' ? 'Group Details' : 'Client Details'}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {form.clientType === 'business' ? 'Company Name *' : form.clientType === 'group' ? 'Group Name *' : 'First Name *'}
              </label>
              <input
                type="text" name="firstName" required value={form.firstName} onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder={form.clientType === 'business' ? 'Acme Corp' : form.clientType === 'group' ? 'Annual Ski Trip' : 'John'}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {form.clientType === 'business' ? 'Contact Name *' : form.clientType === 'group' ? 'Organizer Name *' : 'Last Name *'}
              </label>
              <input
                type="text" name="lastName" required value={form.lastName} onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder={form.clientType === 'business' ? 'Jane Doe' : form.clientType === 'group' ? 'Sarah Chen' : 'Smith'}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email" name="email" value={form.email} onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder={form.clientType === 'business' ? 'contact@acme.com' : 'organizer@example.com'}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone</label>
              <input
                type="tel" name="phone" value={form.phone} onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          {form.clientType === 'individual' && (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date of Birth</label>
              <SingleDatePicker compact value={form.dateOfBirth} onChange={(v) => setForm((f) => ({ ...f, dateOfBirth: v }))} minDate={null} />
            </div>
          )}

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              name="notes" value={form.notes} onChange={onChange} rows={3}
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder={
                form.clientType === 'business' ? 'Annual travel budget, preferred programs...' :
                form.clientType === 'group' ? 'Annual friends trip, typically luxury beach destinations...' :
                'Prefers business class, anniversary trip in June...'
              }
            />
          </div>
        </div>

        {/* Group-specific section */}
        {form.clientType === 'group' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 font-semibold text-slate-900">Group Details</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Group Type</label>
                <select
                  value={groupForm.groupType}
                  onChange={(e) => setGroupForm((f) => ({ ...f, groupType: e.target.value as GroupType }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {GROUP_TYPES.map((gt) => <option key={gt.value} value={gt.value}>{gt.label}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Estimated Size</label>
                <input
                  type="number" min="2" max="500"
                  value={groupForm.estimatedSize}
                  onChange={(e) => setGroupForm((f) => ({ ...f, estimatedSize: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="8"
                />
              </div>
            </div>

            <div className="mt-4">
              <label className="mb-2 block text-sm font-medium text-slate-700">Decision Style</label>
              <div className="grid grid-cols-3 gap-2">
                {DECISION_STYLES.map((ds) => (
                  <button
                    key={ds.value} type="button"
                    onClick={() => setGroupForm((f) => ({ ...f, decisionStyle: ds.value }))}
                    className={`rounded-lg border-2 p-3 text-left transition-all ${groupForm.decisionStyle === ds.value ? 'border-blue-600 bg-blue-50' : 'border-slate-200 hover:border-slate-300'}`}
                  >
                    <p className={`text-xs font-medium ${groupForm.decisionStyle === ds.value ? 'text-blue-900' : 'text-slate-800'}`}>{ds.label}</p>
                    <p className="mt-0.5 text-xs text-slate-500">{ds.desc}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Business-specific section */}
        {form.clientType === 'business' && (
          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-5 font-semibold text-slate-900">Company Details</h2>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Industry</label>
                <input
                  type="text" value={businessForm.industry}
                  onChange={(e) => setBusinessForm((f) => ({ ...f, industry: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="Finance, Tech, Legal..."
                />
              </div>
              <div>
                <label className="mb-1.5 block text-sm font-medium text-slate-700">Company Size</label>
                <select
                  value={businessForm.companySize}
                  onChange={(e) => setBusinessForm((f) => ({ ...f, companySize: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">Select size</option>
                  {COMPANY_SIZES.map((s) => <option key={s} value={s}>{s} employees</option>)}
                </select>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <input
                type="checkbox" id="preApproval"
                checked={businessForm.requiresPreApproval}
                onChange={(e) => setBusinessForm((f) => ({ ...f, requiresPreApproval: e.target.checked }))}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 focus:ring-blue-600"
              />
              <label htmlFor="preApproval" className="text-sm text-slate-700">Requires pre-approval for bookings</label>
            </div>

            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Travel Policy Notes</label>
              <textarea
                value={businessForm.travelPolicyNotes}
                onChange={(e) => setBusinessForm((f) => ({ ...f, travelPolicyNotes: e.target.value }))}
                rows={2}
                className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="Economy domestic, business international for VPs+, max $350/night hotels..."
              />
            </div>
          </div>
        )}

        {/* Points / Loyalty Balances */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              <h2 className="font-semibold text-slate-900">Points &amp; Loyalty Balances</h2>
            </div>
            {!showAddBalance && (
              <button type="button" onClick={() => setShowAddBalance(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
                <Plus className="h-4 w-4" />Add Program
              </button>
            )}
          </div>

          {showAddBalance && (
            <div ref={programDropdownRef} className="relative mb-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text" placeholder="Search loyalty programs..."
                  value={programSearch}
                  onChange={(e) => { setProgramSearch(e.target.value); setShowProgramDropdown(true); }}
                  onFocus={() => setShowProgramDropdown(true)}
                  className="w-full rounded-lg border border-slate-200 py-2.5 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  autoFocus
                />
              </div>
              {showProgramDropdown && filteredPrograms.length > 0 && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                  {filteredPrograms.slice(0, 12).map((p) => (
                    <button key={p.id} type="button" onClick={() => handleSelectProgram(p)} className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50">
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-amber-100 text-xs font-medium text-amber-700">{p.name.charAt(0)}</span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500 capitalize">{p.category}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {balanceRows.length > 0 ? (
            <div className="space-y-3">
              {balanceRows.map((row, index) => (
                <div key={row.loyaltyProgramId} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-sm font-medium text-amber-700">{row.programName.charAt(0)}</span>
                  <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium text-slate-900">{row.programName}</p></div>
                  <input
                    type="number" placeholder="Points" min="0" value={row.balance}
                    onChange={(e) => setBalanceRows((prev) => prev.map((r, i) => i === index ? { ...r, balance: e.target.value } : r))}
                    className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-right text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button type="button" onClick={() => setBalanceRows((prev) => prev.filter((_, i) => i !== index))} className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600">
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : !showAddBalance ? (
            <p className="text-sm text-slate-500">No loyalty balances added yet. You can add them now or later.</p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !form.firstName.trim() || !form.lastName.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? <><Loader2 className="h-4 w-4 animate-spin" />Creating...</> : `Create ${form.clientType === 'business' ? 'Business' : form.clientType === 'group' ? 'Group' : 'Client'}`}
          </button>
          <Link href="/clients" className="rounded-lg bg-slate-100 px-6 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-200">
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
