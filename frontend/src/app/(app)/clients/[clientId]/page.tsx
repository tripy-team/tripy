'use client';

import { useState, useEffect, useCallback, Fragment } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  ChevronDown,
  ChevronRight,
  Plane,
  User,
  Building2,
  Users,
  Trash2,
  Clock,
  MessageSquare,
  HelpCircle,
  Check,
  SkipForward,
  Send,
  AlertTriangle,
  Copy,
  ClipboardList,
  Lightbulb,
  XCircle,
  Sparkles,
} from 'lucide-react';
import {
  getClient,
  getClientBalances,
  getFamilyMembers,
  getClientTrips,
  addClientBalance,
  addFamilyMember,
  removeFamilyMember,
  createClientTrip,
  getTripConfidence,
  getClientIntakes,
  duplicateClientIntake,
  deleteClientIntake,
  getInferredPreferences,
  generateInferredPreferences,
  resolveInferredPreference,
  getFollowUpSuggestions,
  generateFollowUpSuggestions,
  updateSuggestionStatus,
  getSuggestionMessageDraft,
  getMeetingSessions,
  createMeetingSession,
} from '@/lib/api-client';
import type {
  Client,
  LoyaltyBalance,
  LedgerEntry,
  FamilyMember,
  TripRequest,
  ConfidenceResult,
  InferredPreference,
  FollowUpSuggestion,
  SuggestionStatus,
  MessageDraft,
  ClientIntake,
  MeetingSession,
} from '@/lib/api-client';
import { ConfidenceBadge } from '@/components/ConfidenceMeter';
import PreferenceProfile from '@/components/PreferenceProfile';

type Tab = 'overview' | 'balances' | 'preferences' | 'family' | 'trips' | 'insights' | 'follow_ups' | 'intake' | 'meetings';

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [balances, setBalances] = useState<LoyaltyBalance[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [trips, setTrips] = useState<TripRequest[]>([]);
  const [intakes, setIntakes] = useState<ClientIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      if (p.get('tab') === 'intake') return 'intake';
    }
    return 'overview';
  });

  const [showAddBalance, setShowAddBalance] = useState(false);
  const [balanceForm, setBalanceForm] = useState({ programName: '', balance: '', expirationDate: '' });
  const [savingBalance, setSavingBalance] = useState(false);

  const [showAddFamily, setShowAddFamily] = useState(false);
  const [familyForm, setFamilyForm] = useState({ name: '', relationship: '', email: '', phone: '' });
  const [savingFamily, setSavingFamily] = useState(false);

  const [expandedBalance, setExpandedBalance] = useState<string | null>(null);

  const [showAddTrip, setShowAddTrip] = useState(false);
  const [tripForm, setTripForm] = useState({
    title: '',
    originAirports: '',
    destinationAirports: '',
    departureDate: '',
    returnDate: '',
    travelerCount: '1',
    cabinPreference: '',
    flexibilityDays: '',
    budgetUsd: '',
    notes: '',
  });
  const [savingTrip, setSavingTrip] = useState(false);

  const [tripConfidence, setTripConfidence] = useState<Record<string, ConfidenceResult>>({});

  const [inferences, setInferences] = useState<InferredPreference[]>([]);
  const [inferenceLoading, setInferenceLoading] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  // Follow-up suggestions state
  const [meetings, setMeetings] = useState<MeetingSession[]>([]);
  const [creatingMeeting, setCreatingMeeting] = useState(false);
  const [meetingTitle, setMeetingTitle] = useState('');

  const [suggestions, setSuggestions] = useState<FollowUpSuggestion[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsGenerating, setSuggestionsGenerating] = useState(false);
  const [messageDraft, setMessageDraft] = useState<MessageDraft | null>(null);
  const [draftLoading, setDraftLoading] = useState<string | null>(null);
  const [statusUpdating, setStatusUpdating] = useState<string | null>(null);
  const [suggestionsFilter, setSuggestionsFilter] = useState<SuggestionStatus | 'all'>('all');
  const [copiedDraft, setCopiedDraft] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [c, b, fm, t, intk, mtgs] = await Promise.all([
        getClient(clientId),
        getClientBalances(clientId),
        getFamilyMembers(clientId).catch(() => []),
        getClientTrips(clientId).catch(() => []),
        getClientIntakes(clientId).catch(() => []),
        getMeetingSessions(clientId).catch(() => []),
      ]);
      setClient(c);
      setBalances(b);
      setFamilyMembers(fm);
      setTrips(t);
      setIntakes(intk);
      setMeetings(mtgs);

      if (t.length > 0) {
        const confidenceResults = await Promise.all(
          t.map((trip) =>
            getTripConfidence(trip.id)
              .then((r) => ({ id: trip.id, result: r }))
              .catch(() => null),
          ),
        );
        const map: Record<string, ConfidenceResult> = {};
        for (const entry of confidenceResults) {
          if (entry) map[entry.id] = entry.result;
        }
        setTripConfidence(map);
      }

      getInferredPreferences(clientId).then(setInferences).catch(() => {});
      getFollowUpSuggestions(clientId).then(setSuggestions).catch(() => {});
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

  const handleAddFamilyMember = async () => {
    if (!familyForm.name || !familyForm.relationship) return;
    setSavingFamily(true);
    try {
      const member = await addFamilyMember(clientId, {
        name: familyForm.name,
        relationship: familyForm.relationship,
        email: familyForm.email || undefined,
        phone: familyForm.phone || undefined,
      });
      setFamilyMembers((prev) => [...prev, member]);
      setFamilyForm({ name: '', relationship: '', email: '', phone: '' });
      setShowAddFamily(false);
    } catch (err) {
      console.error('Failed to add family member:', err);
    } finally {
      setSavingFamily(false);
    }
  };

  const handleRemoveFamilyMember = async (memberId: string) => {
    try {
      await removeFamilyMember(clientId, memberId);
      setFamilyMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err) {
      console.error('Failed to remove family member:', err);
    }
  };

  const handleAddTrip = async () => {
    if (!tripForm.title.trim() || !tripForm.originAirports || !tripForm.destinationAirports || !tripForm.departureDate) return;
    setSavingTrip(true);
    try {
      const trip = await createClientTrip(clientId, {
        title: tripForm.title.trim(),
        originAirports: tripForm.originAirports.split(',').map((a) => a.trim().toUpperCase()).filter(Boolean),
        destinationAirports: tripForm.destinationAirports.split(',').map((a) => a.trim().toUpperCase()).filter(Boolean),
        departureDate: tripForm.departureDate,
        returnDate: tripForm.returnDate || undefined,
        travelerCount: parseInt(tripForm.travelerCount) || 1,
        cabinPreference: tripForm.cabinPreference || undefined,
        flexibilityDays: tripForm.flexibilityDays ? parseInt(tripForm.flexibilityDays) : undefined,
        budgetUsd: tripForm.budgetUsd ? parseFloat(tripForm.budgetUsd) : undefined,
        notes: tripForm.notes.trim() || undefined,
      });
      setTrips((prev) => [trip, ...prev]);
      setTripForm({ title: '', originAirports: '', destinationAirports: '', departureDate: '', returnDate: '', travelerCount: '1', cabinPreference: '', flexibilityDays: '', budgetUsd: '', notes: '' });
      setShowAddTrip(false);
    } catch (err) {
      console.error('Failed to create trip:', err);
    } finally {
      setSavingTrip(false);
    }
  };

  const handleRunInference = async () => {
    setInferenceLoading(true);
    try {
      const result = await generateInferredPreferences(clientId);
      setInferences(result.inferences);
    } catch (err) {
      console.error('Failed to generate inferences:', err);
    } finally {
      setInferenceLoading(false);
    }
  };

  const handleResolveInference = async (inferenceId: string, status: 'accepted' | 'rejected') => {
    setResolvingId(inferenceId);
    try {
      const updated = await resolveInferredPreference(clientId, inferenceId, status);
      setInferences((prev) =>
        prev.map((inf) => (inf.id === inferenceId ? { ...inf, ...updated } : inf)),
      );
    } catch (err) {
      console.error('Failed to resolve inference:', err);
    } finally {
      setResolvingId(null);
    }
  };

  const handleGenerateSuggestions = async () => {
    setSuggestionsGenerating(true);
    try {
      const result = await generateFollowUpSuggestions(clientId);
      setSuggestions(result);
    } catch (err) {
      console.error('Failed to generate suggestions:', err);
    } finally {
      setSuggestionsGenerating(false);
    }
  };

  const handleUpdateSuggestionStatus = async (suggestionId: string, status: SuggestionStatus) => {
    setStatusUpdating(suggestionId);
    try {
      const updated = await updateSuggestionStatus(clientId, suggestionId, status);
      setSuggestions((prev) =>
        prev.map((s) => (s.id === suggestionId ? { ...s, ...updated } : s)),
      );
    } catch (err) {
      console.error('Failed to update suggestion status:', err);
    } finally {
      setStatusUpdating(null);
    }
  };

  const handleCreateMessageDraft = async (suggestionId: string) => {
    setDraftLoading(suggestionId);
    try {
      const draft = await getSuggestionMessageDraft(clientId, suggestionId);
      setMessageDraft(draft);
      setSuggestions((prev) =>
        prev.map((s) => (s.id === suggestionId ? { ...s, status: 'asked' as SuggestionStatus } : s)),
      );
    } catch (err) {
      console.error('Failed to create message draft:', err);
    } finally {
      setDraftLoading(null);
    }
  };

  const handleCopyDraft = () => {
    if (!messageDraft) return;
    navigator.clipboard.writeText(`Subject: ${messageDraft.subject}\n\n${messageDraft.body}`);
    setCopiedDraft(true);
    setTimeout(() => setCopiedDraft(false), 2000);
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

  const isIndividual = client.clientType === 'individual';

  const pendingInferences = inferences.filter((i) => i.status === 'pending');
  const pendingSuggestions = suggestions.filter((s) => s.status === 'pending');

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'balances', label: 'Balances', show: true },
    { key: 'preferences', label: 'Preference Profile', show: true },
    { key: 'family', label: `Family (${familyMembers.length})`, show: isIndividual },
    { key: 'trips', label: `Trips (${trips.length})`, show: true },
    { key: 'insights', label: `Insights${pendingInferences.length > 0 ? ` (${pendingInferences.length})` : ''}`, show: true },
    { key: 'intake', label: `Intake (${intakes.length})`, show: true },
    { key: 'follow_ups', label: `Follow-Ups${pendingSuggestions.length > 0 ? ` (${pendingSuggestions.length})` : ''}`, show: true },
    { key: 'meetings', label: `Meetings (${meetings.length})`, show: true },
  ];

  const expiringBalances = balances.filter((b) => {
    if (!b.expirationDate) return false;
    const daysLeft = Math.ceil((new Date(b.expirationDate).getTime() - Date.now()) / 86400000);
    return daysLeft >= 0 && daysLeft <= 30;
  });

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
        <div className="flex items-start gap-4">
          <div className={`flex h-12 w-12 items-center justify-center rounded-xl text-lg font-semibold ${
            isIndividual ? 'bg-blue-50 text-blue-600' : 'bg-purple-50 text-purple-600'
          }`}>
            {isIndividual ? (
              <>{client.firstName?.[0]}{client.lastName?.[0]}</>
            ) : (
              <Building2 className="h-6 w-6" />
            )}
          </div>
          <div>
            <h1 className="text-2xl font-bold text-slate-900">
              {client.firstName} {client.lastName}
            </h1>
            <div className="mt-1 flex items-center gap-4 text-sm text-slate-500">
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                isIndividual ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
              }`}>
                {isIndividual ? 'Individual' : 'Business'}
              </span>
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

      {/* Expiring Points Warning */}
      {expiringBalances.length > 0 && (
        <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <Clock className="h-4 w-4" />
            {expiringBalances.length} balance{expiringBalances.length !== 1 ? 's' : ''} expiring within 30 days
          </div>
          <div className="mt-2 space-y-1">
            {expiringBalances.map((b) => {
              const daysLeft = Math.ceil((new Date(b.expirationDate!).getTime() - Date.now()) / 86400000);
              return (
                <p key={b.id} className="text-xs text-amber-700">
                  {b.programName}: {b.balance.toLocaleString()} pts &middot; expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
                </p>
              );
            })}
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="mb-6 border-b border-slate-200">
        <nav className="-mb-px flex gap-6">
          {tabs.filter((t) => t.show).map((tab) => (
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
          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Total Points</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {balances.reduce((sum, b) => sum + b.balance, 0).toLocaleString()}
              </p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">Programs</p>
              <p className="mt-1 text-2xl font-bold text-slate-900">{balances.length}</p>
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="text-sm text-slate-500">
                {isIndividual ? 'Family Members' : 'Client Type'}
              </p>
              <p className="mt-1 text-2xl font-bold text-slate-900">
                {isIndividual ? familyMembers.length : 'Business'}
              </p>
            </div>
          </div>

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

          {pendingSuggestions.length > 0 && (
            <button
              onClick={() => setActiveTab('follow_ups')}
              className="flex w-full items-center gap-3 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-left transition-colors hover:bg-indigo-100"
            >
              <HelpCircle className="h-5 w-5 text-indigo-600" />
              <div className="flex-1">
                <p className="text-sm font-medium text-indigo-900">
                  {pendingSuggestions.length} follow-up question{pendingSuggestions.length !== 1 ? 's' : ''} suggested
                </p>
                <p className="mt-0.5 text-xs text-indigo-600">
                  Clarify preferences and resolve conflicts before recommending trips
                </p>
              </div>
              <ChevronRight className="h-4 w-4 text-indigo-400" />
            </button>
          )}
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
                  {balances.map((bal) => {
                    const isExpiringSoon = bal.expirationDate &&
                      Math.ceil((new Date(bal.expirationDate).getTime() - Date.now()) / 86400000) <= 30 &&
                      Math.ceil((new Date(bal.expirationDate).getTime() - Date.now()) / 86400000) >= 0;
                    return (
                      <Fragment key={bal.id}>
                        <tr
                          className={`cursor-pointer transition-colors hover:bg-slate-50 ${isExpiringSoon ? 'bg-amber-50/50' : ''}`}
                          onClick={() => setExpandedBalance(expandedBalance === bal.id ? null : bal.id)}
                        >
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              <span className="font-medium text-slate-900">{bal.programName}</span>
                              {isExpiringSoon && (
                                <Clock className="h-3.5 w-3.5 text-amber-500" />
                              )}
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-right text-slate-900">
                            {bal.balance.toLocaleString()}
                          </td>
                          <td className={`px-5 py-3.5 text-right ${isExpiringSoon ? 'font-medium text-amber-600' : 'text-slate-600'}`}>
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
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'preferences' && (
        <PreferenceProfile clientId={clientId} />
      )}

      {activeTab === 'family' && isIndividual && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Family Members</h2>
            <button
              onClick={() => setShowAddFamily(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Family Member
            </button>
          </div>

          {showAddFamily && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="Full name *"
                  value={familyForm.name}
                  onChange={(e) => setFamilyForm((f) => ({ ...f, name: e.target.value }))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <select
                  value={familyForm.relationship}
                  onChange={(e) => setFamilyForm((f) => ({ ...f, relationship: e.target.value }))}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  <option value="">Relationship *</option>
                  <option value="spouse">Spouse</option>
                  <option value="partner">Partner</option>
                  <option value="child">Child</option>
                  <option value="parent">Parent</option>
                  <option value="sibling">Sibling</option>
                  <option value="other">Other</option>
                </select>
                <input
                  type="email"
                  placeholder="Email (optional)"
                  value={familyForm.email}
                  onChange={(e) => setFamilyForm((f) => ({ ...f, email: e.target.value }))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <input
                  type="tel"
                  placeholder="Phone (optional)"
                  value={familyForm.phone}
                  onChange={(e) => setFamilyForm((f) => ({ ...f, phone: e.target.value }))}
                  className="rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddFamilyMember}
                  disabled={savingFamily || !familyForm.name || !familyForm.relationship}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingFamily ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Add Member
                </button>
                <button
                  onClick={() => setShowAddFamily(false)}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {familyMembers.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center shadow-sm">
              <Users className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">
                No family members added yet.
              </p>
              <button
                onClick={() => setShowAddFamily(true)}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add a family member
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {familyMembers.map((member) => (
                <div
                  key={member.id}
                  className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm"
                >
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-600">
                      {member.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                    </div>
                    <div>
                      <p className="font-medium text-slate-900">{member.name}</p>
                      <p className="text-xs text-slate-500 capitalize">{member.relationship}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    {member.email && (
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Mail className="h-3 w-3" />
                        {member.email}
                      </span>
                    )}
                    {member.phone && (
                      <span className="flex items-center gap-1 text-xs text-slate-500">
                        <Phone className="h-3 w-3" />
                        {member.phone}
                      </span>
                    )}
                    <button
                      onClick={() => handleRemoveFamilyMember(member.id)}
                      className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {activeTab === 'trips' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Trip Requests</h2>
            <button
              onClick={() => setShowAddTrip(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              New Trip
            </button>
          </div>

          {showAddTrip && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5">
              <h3 className="mb-4 text-sm font-semibold text-slate-900">New Trip Request</h3>
              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Trip Title *</label>
                  <input
                    type="text"
                    placeholder="e.g., Summer Hawaii Trip"
                    value={tripForm.title}
                    onChange={(e) => setTripForm((f) => ({ ...f, title: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Origin Airports *</label>
                    <input
                      type="text"
                      placeholder="JFK, EWR"
                      value={tripForm.originAirports}
                      onChange={(e) => setTripForm((f) => ({ ...f, originAirports: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Destination Airports *</label>
                    <input
                      type="text"
                      placeholder="HNL, OGG"
                      value={tripForm.destinationAirports}
                      onChange={(e) => setTripForm((f) => ({ ...f, destinationAirports: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Departure Date *</label>
                    <input
                      type="date"
                      value={tripForm.departureDate}
                      onChange={(e) => setTripForm((f) => ({ ...f, departureDate: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Return Date</label>
                    <input
                      type="date"
                      value={tripForm.returnDate}
                      onChange={(e) => setTripForm((f) => ({ ...f, returnDate: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Travelers</label>
                    <input
                      type="number"
                      min="1"
                      value={tripForm.travelerCount}
                      onChange={(e) => setTripForm((f) => ({ ...f, travelerCount: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Cabin</label>
                    <select
                      value={tripForm.cabinPreference}
                      onChange={(e) => setTripForm((f) => ({ ...f, cabinPreference: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      <option value="">Any</option>
                      <option value="economy">Economy</option>
                      <option value="premium_economy">Premium Economy</option>
                      <option value="business">Business</option>
                      <option value="first">First</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">Flexibility (days)</label>
                    <input
                      type="number"
                      min="0"
                      placeholder="3"
                      value={tripForm.flexibilityDays}
                      onChange={(e) => setTripForm((f) => ({ ...f, flexibilityDays: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
                  <textarea
                    value={tripForm.notes}
                    onChange={(e) => setTripForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    placeholder="Any special requirements..."
                    className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <button
                  onClick={handleAddTrip}
                  disabled={savingTrip || !tripForm.title.trim() || !tripForm.originAirports || !tripForm.destinationAirports || !tripForm.departureDate}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingTrip ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plane className="h-3.5 w-3.5" />}
                  Create Trip
                </button>
                <button
                  onClick={() => setShowAddTrip(false)}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {trips.length === 0 && !showAddTrip ? (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center shadow-sm">
              <Plane className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No trips for this client yet.</p>
              <button
                onClick={() => setShowAddTrip(true)}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                Create a trip request
              </button>
            </div>
          ) : trips.length > 0 && (
            <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-5 py-3 text-left font-medium text-slate-600">Title</th>
                    <th className="px-5 py-3 text-left font-medium text-slate-600">Route</th>
                    <th className="px-5 py-3 text-left font-medium text-slate-600">Dates</th>
                    <th className="px-5 py-3 text-left font-medium text-slate-600">Cabin</th>
                    <th className="px-5 py-3 text-left font-medium text-slate-600">Confidence</th>
                    <th className="px-5 py-3 text-left font-medium text-slate-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {trips.map((trip) => {
                    const statusStyles: Record<string, string> = {
                      draft: 'bg-slate-100 text-slate-600',
                      analyzing: 'bg-yellow-50 text-yellow-700',
                      complete: 'bg-green-50 text-green-700',
                      archived: 'bg-slate-100 text-slate-500',
                    };
                    return (
                      <tr key={trip.id} className="transition-colors hover:bg-slate-50">
                        <td className="px-5 py-3.5">
                          <span className="font-medium text-slate-900">{trip.title}</span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">
                          {Array.isArray(trip.originAirports) ? trip.originAirports.join(', ') : trip.originAirports}
                          {' → '}
                          {Array.isArray(trip.destinationAirports) ? trip.destinationAirports.join(', ') : trip.destinationAirports}
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">
                          {trip.departureDate
                            ? new Date(trip.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                            : '—'}
                          {trip.returnDate
                            ? ` – ${new Date(trip.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                            : ''}
                        </td>
                        <td className="px-5 py-3.5 text-slate-600 capitalize">
                          {trip.cabinPreference?.replace('_', ' ') || '—'}
                        </td>
                        <td className="px-5 py-3.5">
                          {tripConfidence[trip.id] ? (
                            <ConfidenceBadge
                              score={tripConfidence[trip.id].score}
                              level={tripConfidence[trip.id].level}
                            />
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyles[trip.status] ?? statusStyles.draft}`}>
                            {trip.status}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {activeTab === 'insights' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Learned from History</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Preferences inferred from prior trip data. Review and accept or dismiss each suggestion.
              </p>
            </div>
            <button
              onClick={handleRunInference}
              disabled={inferenceLoading}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {inferenceLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              Analyze Trips
            </button>
          </div>

          {inferences.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center shadow-sm">
              <Lightbulb className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">
                No inferred preferences yet.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                {trips.length < 2
                  ? 'At least 2 trips are needed to detect patterns.'
                  : 'Click "Analyze Trips" to detect patterns from trip history.'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {/* Pending inferences first */}
              {pendingInferences.length > 0 && (
                <div className="space-y-3">
                  {pendingInferences.map((inf) => (
                    <InferenceCard
                      key={inf.id}
                      inference={inf}
                      resolving={resolvingId === inf.id}
                      onAccept={() => handleResolveInference(inf.id, 'accepted')}
                      onReject={() => handleResolveInference(inf.id, 'rejected')}
                    />
                  ))}
                </div>
              )}

              {/* Resolved inferences */}
              {inferences.filter((i) => i.status !== 'pending').length > 0 && (
                <div>
                  <p className="mb-2 mt-4 text-xs font-medium uppercase tracking-wider text-slate-400">
                    Previously reviewed
                  </p>
                  <div className="space-y-2">
                    {inferences
                      .filter((i) => i.status !== 'pending')
                      .map((inf) => (
                        <InferenceCard
                          key={inf.id}
                          inference={inf}
                          resolving={false}
                          onAccept={() => {}}
                          onReject={() => {}}
                        />
                      ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {activeTab === 'intake' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Client Intakes</h2>
            <Link
              href={`/clients/${clientId}/intake/new`}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              New Intake
            </Link>
          </div>

          {intakes.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white py-16 text-center shadow-sm">
              <ClipboardList className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm text-slate-500">No intake questionnaires yet.</p>
              <p className="mt-1 text-xs text-slate-400">Capture travel preferences in a structured way before planning a trip.</p>
              <Link
                href={`/clients/${clientId}/intake/new`}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                Start first intake
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {intakes.map((intake) => {
                const isDraft = intake.status === 'draft';
                const tripLabel = intake.tripType
                  ? intake.tripType.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
                  : 'General';
                const destStr = (intake.destinations || []).join(', ') || 'No destinations';
                return (
                  <div
                    key={intake.id}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-slate-300"
                  >
                    <Link
                      href={`/clients/${clientId}/intake/${intake.id}`}
                      className="min-w-0 flex-1"
                    >
                      <div className="flex items-center gap-3">
                        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isDraft ? 'bg-amber-50' : 'bg-green-50'}`}>
                          <ClipboardList className={`h-5 w-5 ${isDraft ? 'text-amber-500' : 'text-green-600'}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">{tripLabel}</span>
                            <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isDraft ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                              {isDraft ? 'Draft' : 'Complete'}
                            </span>
                            {intake.isTemplate && (
                              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                                Template
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs text-slate-500">
                            {destStr} &middot; Updated {new Date(intake.updatedAt).toLocaleDateString()}
                          </p>
                        </div>
                      </div>
                    </Link>
                    <div className="ml-3 flex items-center gap-1">
                      <button
                        onClick={async () => {
                          try {
                            const dup = await duplicateClientIntake(clientId, intake.id);
                            setIntakes((prev) => [dup, ...prev]);
                          } catch { /* */ }
                        }}
                        title="Duplicate"
                        className="rounded-lg p-2 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
                      >
                        <Copy className="h-4 w-4" />
                      </button>
                      <button
                        onClick={async () => {
                          if (!confirm('Delete this intake?')) return;
                          try {
                            await deleteClientIntake(clientId, intake.id);
                            setIntakes((prev) => prev.filter((i) => i.id !== intake.id));
                          } catch { /* */ }
                        }}
                        title="Delete"
                        className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'meetings' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Meeting Copilot</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                AI-powered discovery meetings that extract and update client preferences
              </p>
            </div>
            <button
              onClick={() => setCreatingMeeting(true)}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-4 w-4" />
              New Meeting
            </button>
          </div>

          {creatingMeeting && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              <label className="mb-1 block text-xs font-medium text-slate-700">Meeting Title</label>
              <input
                type="text"
                placeholder="e.g., Initial discovery call, Pre-trip check-in"
                value={meetingTitle}
                onChange={(e) => setMeetingTitle(e.target.value)}
                className="mb-3 block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && meetingTitle.trim()) {
                    createMeetingSession(clientId, meetingTitle.trim()).then((session) => {
                      router.push(`/clients/${clientId}/meeting/${session.id}`);
                    });
                  }
                }}
              />
              <div className="flex gap-2">
                <button
                  onClick={async () => {
                    if (!meetingTitle.trim()) return;
                    const session = await createMeetingSession(clientId, meetingTitle.trim());
                    router.push(`/clients/${clientId}/meeting/${session.id}`);
                  }}
                  disabled={!meetingTitle.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  <Sparkles className="h-3.5 w-3.5" />
                  Start Meeting
                </button>
                <button
                  onClick={() => { setCreatingMeeting(false); setMeetingTitle(''); }}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {meetings.length === 0 && !creatingMeeting ? (
            <div className="rounded-xl border border-slate-200 bg-white py-16 text-center shadow-sm">
              <Sparkles className="mx-auto h-10 w-10 text-slate-300" />
              <p className="mt-3 text-sm font-medium text-slate-500">No meeting sessions yet</p>
              <p className="mt-1 text-xs text-slate-400">
                Start a discovery meeting to let AI help uncover client preferences
              </p>
              <button
                onClick={() => setCreatingMeeting(true)}
                className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                Start first meeting
              </button>
            </div>
          ) : meetings.length > 0 && (
            <div className="space-y-3">
              {meetings.map((meeting) => {
                const statusStyles: Record<string, { bg: string; text: string }> = {
                  active: { bg: 'bg-green-50', text: 'text-green-700' },
                  completed: { bg: 'bg-blue-50', text: 'text-blue-700' },
                  archived: { bg: 'bg-slate-100', text: 'text-slate-500' },
                };
                const style = statusStyles[meeting.status] ?? statusStyles.active;
                return (
                  <Link
                    key={meeting.id}
                    href={`/clients/${clientId}/meeting/${meeting.id}`}
                    className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-colors hover:border-blue-200 hover:bg-blue-50/30"
                  >
                    <div className="flex items-center gap-3">
                      <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${meeting.status === 'active' ? 'bg-blue-50' : 'bg-slate-50'}`}>
                        <Sparkles className={`h-5 w-5 ${meeting.status === 'active' ? 'text-blue-600' : 'text-slate-400'}`} />
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{meeting.title}</p>
                        <div className="mt-0.5 flex items-center gap-3 text-xs text-slate-500">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}>
                            {meeting.status}
                          </span>
                          <span>{meeting._count?.entries || 0} notes</span>
                          <span>{meeting._count?.profileSuggestions || 0} suggestions</span>
                          <span>{new Date(meeting.createdAt).toLocaleDateString()}</span>
                        </div>
                      </div>
                    </div>
                    <ChevronRight className="h-4 w-4 text-slate-400" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'follow_ups' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold text-slate-900">Suggested Follow-Up Questions</h2>
              <p className="mt-0.5 text-xs text-slate-500">
                Questions to ask the client when preferences are unclear or conflicting
              </p>
            </div>
            <button
              onClick={handleGenerateSuggestions}
              disabled={suggestionsGenerating}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
            >
              {suggestionsGenerating ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              {suggestions.length === 0 ? 'Generate' : 'Refresh'}
            </button>
          </div>

          {/* Filter pills */}
          {suggestions.length > 0 && (
            <div className="flex items-center gap-2">
              {(['all', 'pending', 'asked', 'answered', 'skipped'] as const).map((f) => {
                const count =
                  f === 'all'
                    ? suggestions.length
                    : suggestions.filter((s) => s.status === f).length;
                return (
                  <button
                    key={f}
                    onClick={() => setSuggestionsFilter(f)}
                    className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                      suggestionsFilter === f
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)} ({count})
                  </button>
                );
              })}
            </div>
          )}

          {/* Message draft modal */}
          {messageDraft && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-5">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-slate-900">Message Draft</h3>
                <button
                  onClick={() => setMessageDraft(null)}
                  className="rounded-lg p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="rounded-lg border border-slate-200 bg-white p-4">
                <p className="mb-1 text-xs font-medium text-slate-500">Subject</p>
                <p className="mb-3 text-sm font-medium text-slate-900">{messageDraft.subject}</p>
                <p className="mb-1 text-xs font-medium text-slate-500">Body</p>
                <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans">{messageDraft.body}</pre>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleCopyDraft}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
                >
                  {copiedDraft ? (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-3.5 w-3.5" />
                      Copy to clipboard
                    </>
                  )}
                </button>
                <button
                  onClick={() => setMessageDraft(null)}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                >
                  Close
                </button>
              </div>
            </div>
          )}

          {/* Suggestion list */}
          {suggestions.length === 0 ? (
            <div className="rounded-xl border border-slate-200 bg-white py-12 text-center shadow-sm">
              <HelpCircle className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">
                No follow-up suggestions yet.
              </p>
              <p className="mt-1 text-xs text-slate-400">
                Click &ldquo;Generate&rdquo; to analyze this client&apos;s profile for gaps and conflicts.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {suggestions
                .filter((s) => suggestionsFilter === 'all' || s.status === suggestionsFilter)
                .map((suggestion) => {
                  const priorityStyles: Record<string, { border: string; badge: string; badgeText: string }> = {
                    high: { border: 'border-red-200', badge: 'bg-red-50 text-red-700', badgeText: 'High' },
                    medium: { border: 'border-amber-200', badge: 'bg-amber-50 text-amber-700', badgeText: 'Medium' },
                    low: { border: 'border-slate-200', badge: 'bg-slate-100 text-slate-600', badgeText: 'Low' },
                  };
                  const statusStyles: Record<string, { badge: string; badgeText: string }> = {
                    pending: { badge: 'bg-blue-50 text-blue-700', badgeText: 'Pending' },
                    asked: { badge: 'bg-purple-50 text-purple-700', badgeText: 'Asked' },
                    answered: { badge: 'bg-green-50 text-green-700', badgeText: 'Answered' },
                    skipped: { badge: 'bg-slate-100 text-slate-500', badgeText: 'Skipped' },
                  };
                  const pStyle = priorityStyles[suggestion.priority] ?? priorityStyles.low;
                  const sStyle = statusStyles[suggestion.status] ?? statusStyles.pending;
                  const isUpdating = statusUpdating === suggestion.id;
                  const isDraftLoading = draftLoading === suggestion.id;

                  const categoryLabels: Record<string, string> = {
                    missing_intake: 'Missing Info',
                    ambiguous_preference: 'Ambiguous',
                    conflicting_constraint: 'Conflict',
                    budget_luxury_mismatch: 'Budget vs Luxury',
                    points_convenience_mismatch: 'Points vs Convenience',
                    destination_flexibility: 'Destination',
                    group_traveler_difference: 'Group Travel',
                  };

                  return (
                    <div
                      key={suggestion.id}
                      className={`rounded-xl border bg-white p-5 shadow-sm transition-colors ${
                        suggestion.status === 'answered' || suggestion.status === 'skipped'
                          ? 'border-slate-100 opacity-60'
                          : pStyle.border
                      }`}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${pStyle.badge}`}>
                            {pStyle.badgeText}
                          </span>
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${sStyle.badge}`}>
                            {sStyle.badgeText}
                          </span>
                          <span className="rounded-full bg-slate-50 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                            {categoryLabels[suggestion.category] ?? suggestion.category}
                          </span>
                        </div>
                      </div>

                      <p className="mb-2 text-sm font-medium text-slate-900">
                        {suggestion.questionText}
                      </p>
                      <p className="mb-4 text-xs text-slate-500">
                        <span className="font-medium text-slate-600">Why this matters:</span>{' '}
                        {suggestion.reason}
                      </p>

                      <div className="flex flex-wrap items-center gap-2">
                        {suggestion.status === 'pending' && (
                          <>
                            <button
                              onClick={() => handleUpdateSuggestionStatus(suggestion.id, 'asked')}
                              disabled={isUpdating}
                              className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                            >
                              <MessageSquare className="h-3 w-3" />
                              Mark Asked
                            </button>
                            <button
                              onClick={() => handleUpdateSuggestionStatus(suggestion.id, 'answered')}
                              disabled={isUpdating}
                              className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-60"
                            >
                              <Check className="h-3 w-3" />
                              Mark Answered
                            </button>
                            <button
                              onClick={() => handleUpdateSuggestionStatus(suggestion.id, 'skipped')}
                              disabled={isUpdating}
                              className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                            >
                              <SkipForward className="h-3 w-3" />
                              Skip
                            </button>
                          </>
                        )}
                        {suggestion.status === 'asked' && (
                          <button
                            onClick={() => handleUpdateSuggestionStatus(suggestion.id, 'answered')}
                            disabled={isUpdating}
                            className="inline-flex items-center gap-1 rounded-lg bg-green-50 px-3 py-1.5 text-xs font-medium text-green-700 hover:bg-green-100 disabled:opacity-60"
                          >
                            <Check className="h-3 w-3" />
                            Mark Answered
                          </button>
                        )}
                        {(suggestion.status === 'skipped' || suggestion.status === 'answered') && (
                          <button
                            onClick={() => handleUpdateSuggestionStatus(suggestion.id, 'pending')}
                            disabled={isUpdating}
                            className="inline-flex items-center gap-1 rounded-lg bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-60"
                          >
                            <RefreshCw className="h-3 w-3" />
                            Reopen
                          </button>
                        )}
                        <div className="mx-1 h-4 w-px bg-slate-200" />
                        <button
                          onClick={() => handleCreateMessageDraft(suggestion.id)}
                          disabled={isDraftLoading}
                          className="inline-flex items-center gap-1 rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-medium text-purple-700 hover:bg-purple-100 disabled:opacity-60"
                        >
                          {isDraftLoading ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <Send className="h-3 w-3" />
                          )}
                          Use in Message
                        </button>
                      </div>
                    </div>
                  );
                })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inference Card
// ---------------------------------------------------------------------------

const CONFIDENCE_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  high: { bg: 'bg-emerald-50', text: 'text-emerald-700', label: 'High confidence' },
  medium: { bg: 'bg-amber-50', text: 'text-amber-700', label: 'Medium confidence' },
  low: { bg: 'bg-slate-100', text: 'text-slate-600', label: 'Low confidence' },
};

const CATEGORY_ICONS: Record<string, string> = {
  cabin_choice: 'Seat selection',
  airline_preference: 'Airline',
  nonstop_preference: 'Routing',
  hotel_tier: 'Hotel',
  budget_behavior: 'Budget',
  payment_style: 'Payment',
  destination_pattern: 'Destination',
  trip_style: 'Style',
};

function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.7) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

function InferenceCard({
  inference,
  resolving,
  onAccept,
  onReject,
}: {
  inference: InferredPreference;
  resolving: boolean;
  onAccept: () => void;
  onReject: () => void;
}) {
  const level = getConfidenceLevel(inference.confidence);
  const style = CONFIDENCE_STYLES[level];
  const isPending = inference.status === 'pending';
  const isAccepted = inference.status === 'accepted';
  const isRejected = inference.status === 'rejected';

  return (
    <div
      className={`rounded-xl border bg-white p-4 shadow-sm transition-all ${
        isPending
          ? 'border-blue-100'
          : isAccepted
            ? 'border-emerald-100 opacity-80'
            : 'border-slate-100 opacity-60'
      }`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div
            className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
              isPending ? 'bg-blue-50 text-blue-600' : isAccepted ? 'bg-emerald-50 text-emerald-600' : 'bg-slate-100 text-slate-400'
            }`}
          >
            {isPending ? (
              <Sparkles className="h-4 w-4" />
            ) : isAccepted ? (
              <Check className="h-4 w-4" />
            ) : (
              <XCircle className="h-4 w-4" />
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-slate-900">{inference.label}</span>
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${style.bg} ${style.text}`}>
                {style.label} ({Math.round(inference.confidence * 100)}%)
              </span>
              <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-500">
                {CATEGORY_ICONS[inference.category] || inference.category}
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-500">{inference.description}</p>
            {!isPending && inference.resolvedBy && (
              <p className="mt-1 text-[10px] text-slate-400">
                {isAccepted ? 'Accepted' : 'Dismissed'} by {inference.resolvedBy.firstName} {inference.resolvedBy.lastName}
                {inference.resolvedAt && ` on ${new Date(inference.resolvedAt).toLocaleDateString()}`}
                {isAccepted && inference.appliedToProfile && ' \u00B7 Applied to profile'}
              </p>
            )}
          </div>
        </div>

        {isPending && (
          <div className="flex shrink-0 items-center gap-1.5">
            <button
              onClick={onAccept}
              disabled={resolving}
              className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
              title="Accept and apply to preference profile"
            >
              {resolving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Accept
            </button>
            <button
              onClick={onReject}
              disabled={resolving}
              className="inline-flex items-center gap-1 rounded-lg bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-60"
              title="Dismiss this inference"
            >
              <X className="h-3 w-3" />
              Dismiss
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
