'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ArrowLeft, Loader2, User, Building2, Plus, X, Search, ChevronDown, Coins } from 'lucide-react';
import { createClient, getLoyaltyPrograms, type LoyaltyProgramRecord, type InitialBalanceEntry } from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

interface BalanceRow {
  loyaltyProgramId: string;
  programName: string;
  balance: string;
}

export default function NewClientPage() {
  const router = useRouter();
  const [form, setForm] = useState({
    clientType: 'individual' as 'individual' | 'business',
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
    dateOfBirth: '',
    notes: '',
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

  const handleRemoveBalance = (index: number) => {
    setBalanceRows((prev) => prev.filter((_, i) => i !== index));
  };

  const handleBalanceChange = (index: number, value: string) => {
    setBalanceRows((prev) => prev.map((row, i) => (i === index ? { ...row, balance: value } : row)));
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
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
      });
      router.push(`/clients/${client.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create client');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl">
      <Link
        href="/clients"
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to clients
      </Link>

      <h1 className="mb-2 text-2xl font-bold text-slate-900">Add Client</h1>
      <p className="mb-8 text-slate-500">Enter your client&apos;s details to get started.</p>

      {error && (
        <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
      )}

      <form onSubmit={onSubmit} className="space-y-6">
        {/* Client Type Selector */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 font-semibold text-slate-900">Client Type</h2>
          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, clientType: 'individual' }))}
              className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                form.clientType === 'individual'
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                form.clientType === 'individual' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                <User className="h-5 w-5" />
              </div>
              <div>
                <p className={`font-medium ${form.clientType === 'individual' ? 'text-blue-900' : 'text-slate-900'}`}>
                  Individual
                </p>
                <p className="text-xs text-slate-500">Person with family members</p>
              </div>
            </button>
            <button
              type="button"
              onClick={() => setForm((f) => ({ ...f, clientType: 'business' }))}
              className={`flex items-center gap-3 rounded-lg border-2 p-4 text-left transition-all ${
                form.clientType === 'business'
                  ? 'border-blue-600 bg-blue-50'
                  : 'border-slate-200 hover:border-slate-300'
              }`}
            >
              <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${
                form.clientType === 'business' ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-500'
              }`}>
                <Building2 className="h-5 w-5" />
              </div>
              <div>
                <p className={`font-medium ${form.clientType === 'business' ? 'text-blue-900' : 'text-slate-900'}`}>
                  Business
                </p>
                <p className="text-xs text-slate-500">Company or organization</p>
              </div>
            </button>
          </div>
        </div>

        {/* Client Details */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-5 font-semibold text-slate-900">
            {form.clientType === 'business' ? 'Business Details' : 'Client Details'}
          </h2>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {form.clientType === 'business' ? 'Company Name *' : 'First Name *'}
              </label>
              <input
                type="text"
                name="firstName"
                required
                value={form.firstName}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder={form.clientType === 'business' ? 'Acme Corp' : 'John'}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                {form.clientType === 'business' ? 'Contact Name *' : 'Last Name *'}
              </label>
              <input
                type="text"
                name="lastName"
                required
                value={form.lastName}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder={form.clientType === 'business' ? 'Jane Doe' : 'Smith'}
              />
            </div>
          </div>

          <div className="mt-4 grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Email</label>
              <input
                type="email"
                name="email"
                value={form.email}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder={form.clientType === 'business' ? 'contact@acme.com' : 'john@example.com'}
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Phone</label>
              <input
                type="tel"
                name="phone"
                value={form.phone}
                onChange={onChange}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                placeholder="+1 (555) 123-4567"
              />
            </div>
          </div>

          {form.clientType === 'individual' && (
            <div className="mt-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Date of Birth</label>
              <SingleDatePicker
                compact
                value={form.dateOfBirth}
                onChange={(v) => setForm((f) => ({ ...f, dateOfBirth: v }))}
                minDate={null}
              />
            </div>
          )}

          <div className="mt-4">
            <label className="mb-1.5 block text-sm font-medium text-slate-700">Notes</label>
            <textarea
              name="notes"
              value={form.notes}
              onChange={onChange}
              rows={3}
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              placeholder={
                form.clientType === 'business'
                  ? 'Annual travel budget, preferred programs...'
                  : 'Prefers business class, anniversary trip in June...'
              }
            />
          </div>
        </div>

        {/* Points / Loyalty Balances */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Coins className="h-5 w-5 text-amber-500" />
              <h2 className="font-semibold text-slate-900">Points &amp; Loyalty Balances</h2>
            </div>
            {!showAddBalance && (
              <button
                type="button"
                onClick={() => setShowAddBalance(true)}
                className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add Program
              </button>
            )}
          </div>

          {showAddBalance && (
            <div ref={programDropdownRef} className="relative mb-4">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search loyalty programs..."
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
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectProgram(p)}
                      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                    >
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded bg-amber-100 text-xs font-medium text-amber-700">
                        {p.name.charAt(0)}
                      </span>
                      <div className="min-w-0">
                        <p className="truncate font-medium text-slate-900">{p.name}</p>
                        <p className="text-xs text-slate-500 capitalize">{p.category}</p>
                      </div>
                    </button>
                  ))}
                </div>
              )}
              {showProgramDropdown && filteredPrograms.length === 0 && programSearch && (
                <div className="absolute left-0 right-0 top-full z-30 mt-1 rounded-lg border border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500 shadow-lg">
                  No programs found
                </div>
              )}
            </div>
          )}

          {balanceRows.length > 0 ? (
            <div className="space-y-3">
              {balanceRows.map((row, index) => (
                <div key={row.loyaltyProgramId} className="flex items-center gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2.5">
                  <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-sm font-medium text-amber-700">
                    {row.programName.charAt(0)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-slate-900">{row.programName}</p>
                  </div>
                  <input
                    type="number"
                    placeholder="Points"
                    min="0"
                    value={row.balance}
                    onChange={(e) => handleBalanceChange(index, e.target.value)}
                    className="w-32 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-right text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    type="button"
                    onClick={() => handleRemoveBalance(index)}
                    className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : !showAddBalance ? (
            <p className="text-sm text-slate-500">
              No loyalty balances added yet. You can add them now or later.
            </p>
          ) : null}
        </div>

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={submitting || !form.firstName.trim() || !form.lastName.trim()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating...
              </>
            ) : (
              `Create ${form.clientType === 'business' ? 'Business' : 'Client'}`
            )}
          </button>
          <Link
            href="/clients"
            className="rounded-lg bg-slate-100 px-6 py-3 font-medium text-slate-700 transition-colors hover:bg-slate-200"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
