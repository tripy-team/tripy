'use client';

import { useState, useEffect, useCallback, useMemo, useRef, Fragment } from 'react';
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
  Heart,
  Baby,
  UserCircle,
  Pencil,
  ExternalLink,
  Search,
  Coins,
  Crown,
  UserPlus,
  Hash,
  Minus,
} from 'lucide-react';
import {
  getClient,
  getClients,
  getClientBalances,
  getFamilyMembers,
  getClientTrips,
  addClientBalance,
  addFamilyMember,
  updateFamilyMember,
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
  getLoyaltyPrograms,
} from '@/lib/api-client';
import type {
  Client,
  LoyaltyBalance,
  LoyaltyProgramRecord,
  LedgerEntry,
  FamilyMember,
  FamilyMemberUpdatePayload,
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
import ProfileCompletenessScore from '@/components/ProfileCompletenessScore';
import GroupMembersPanel from './_components/GroupMembersPanel';
import BusinessProfilePanel from './_components/BusinessProfilePanel';
import FormsTab from './_components/FormsTab';
import MultiAirportAutocomplete from '@/components/ui/MultiAirportAutocomplete';
import SingleDatePicker from '@/components/ui/SingleDatePicker';
import { proposalsAPI } from '@/lib/api';

type TripType = 'roundTrip' | 'oneWay' | 'multiCity';
type TripLeg = {
  originAirports: string[];
  destinationAirports: string[];
  departureDate: string;
};

type TravelerEntry = {
  id: string;
  type: 'individual' | 'bulk';
  client: Client | null;
  quantity: number;
  flightConfig: 'sameAsLeader' | 'sameAs' | 'custom';
  sameAsId: string | null;
  customTripType: TripType;
  customLegs: TripLeg[];
};

type Tab = 'overview' | 'balances' | 'preferences' | 'group' | 'trips' | 'discovery';
type DiscoverySection = 'meetings' | 'intake' | 'insights' | 'follow_ups';

const CATEGORY_ORDER: Record<string, number> = { airline: 0, hotel: 1, transferable_bank: 2 };
const CATEGORY_LABELS: Record<string, string> = { airline: 'Airlines', hotel: 'Hotels', transferable_bank: 'Credit Cards' };
const CATEGORY_COLORS: Record<string, { label: string; border: string; dot: string }> = {
  airline: { label: 'text-sky-600', border: 'border-l-sky-400', dot: 'bg-sky-400' },
  hotel: { label: 'text-amber-600', border: 'border-l-amber-400', dot: 'bg-amber-400' },
  transferable_bank: { label: 'text-violet-600', border: 'border-l-violet-400', dot: 'bg-violet-400' },
};
const DEFAULT_CATEGORY_COLOR = { label: 'text-slate-500', border: 'border-l-slate-300', dot: 'bg-slate-300' };
const RELATIONSHIP_ORDER: Record<string, number> = { spouse: 0, partner: 1, child: 2, parent: 3, sibling: 4, friend: 5, other: 6 };
const RELATIONSHIP_LABELS: Record<string, string> = {
  spouse: 'Spouse', partner: 'Partner', child: 'Children', parent: 'Parents', sibling: 'Siblings', friend: 'Friends', other: 'Other',
};
const RELATIONSHIP_COLORS: Record<string, { label: string; border: string; dot: string }> = {
  spouse: { label: 'text-rose-600', border: 'border-l-rose-400', dot: 'bg-rose-400' },
  partner: { label: 'text-pink-600', border: 'border-l-pink-400', dot: 'bg-pink-400' },
  child: { label: 'text-amber-600', border: 'border-l-amber-400', dot: 'bg-amber-400' },
  parent: { label: 'text-blue-600', border: 'border-l-blue-400', dot: 'bg-blue-400' },
  sibling: { label: 'text-indigo-600', border: 'border-l-indigo-400', dot: 'bg-indigo-400' },
  friend: { label: 'text-emerald-600', border: 'border-l-emerald-400', dot: 'bg-emerald-400' },
  other: { label: 'text-slate-500', border: 'border-l-slate-300', dot: 'bg-slate-300' },
};
const DEFAULT_RELATIONSHIP_COLOR = { label: 'text-slate-500', border: 'border-l-slate-300', dot: 'bg-slate-300' };

export default function ClientDetailPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [balances, setBalances] = useState<LoyaltyBalance[]>([]);
  const [loyaltyPrograms, setLoyaltyPrograms] = useState<LoyaltyProgramRecord[]>([]);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [trips, setTrips] = useState<TripRequest[]>([]);
  const [groupMemberCount, setGroupMemberCount] = useState(0);
  const [intakes, setIntakes] = useState<ClientIntake[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>(() => {
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      const tab = p.get('tab');
      if (tab === 'intake' || tab === 'discovery' || tab === 'forms') return 'discovery';
      if (tab === 'preferences') return 'preferences';
      if (tab === 'balances') return 'balances';
      if (tab === 'trips') return 'trips';
      if (tab === 'group') return 'group';
    }
    return 'overview';
  });
  const [expandedDiscoverySections, setExpandedDiscoverySections] = useState<Set<DiscoverySection>>(
    new Set(['meetings', 'intake', 'insights', 'follow_ups']),
  );
  const toggleDiscoverySection = (section: DiscoverySection) => {
    setExpandedDiscoverySections((prev) => {
      const next = new Set(prev);
      if (next.has(section)) next.delete(section);
      else next.add(section);
      return next;
    });
  };

  const [showAddBalance, setShowAddBalance] = useState(false);
  const [balanceForm, setBalanceForm] = useState({ loyaltyProgramId: '', balance: '' });
  const [savingBalance, setSavingBalance] = useState(false);
  const [programSearch, setProgramSearch] = useState('');
  const [showProgramDropdown, setShowProgramDropdown] = useState(false);
  const programDropdownRef = useRef<HTMLDivElement>(null);

  const filteredPrograms = useMemo(() => {
    const alreadyAdded = new Set(balances.map((b) => b.loyaltyProgramId));
    return loyaltyPrograms.filter((p) => {
      if (alreadyAdded.has(p.id)) return false;
      if (!programSearch) return true;
      return p.name.toLowerCase().includes(programSearch.toLowerCase());
    });
  }, [programSearch, balances, loyaltyPrograms]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (programDropdownRef.current && !programDropdownRef.current.contains(e.target as Node)) {
        setShowProgramDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [showAddFamily, setShowAddFamily] = useState(false);
  const [familyForm, setFamilyForm] = useState({ firstName: '', lastName: '', relationship: '', email: '', phone: '' });
  const [savingFamily, setSavingFamily] = useState(false);
  const [relationshipOpen, setRelationshipOpen] = useState(false);
  const relationshipRef = useRef<HTMLDivElement>(null);
  const [memberBalances, setMemberBalances] = useState<{ loyaltyProgramId: string; programName: string; balance: string }[]>([]);
  const [memberProgramSearch, setMemberProgramSearch] = useState('');
  const [showMemberProgramDropdown, setShowMemberProgramDropdown] = useState(false);
  const memberProgramDropdownRef = useRef<HTMLDivElement>(null);

  const filteredMemberPrograms = useMemo(() => {
    const alreadyAdded = new Set(memberBalances.map((b) => b.loyaltyProgramId));
    return loyaltyPrograms.filter((p) => {
      if (alreadyAdded.has(p.id)) return false;
      if (!memberProgramSearch) return true;
      return p.name.toLowerCase().includes(memberProgramSearch.toLowerCase());
    });
  }, [memberProgramSearch, memberBalances, loyaltyPrograms]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (memberProgramDropdownRef.current && !memberProgramDropdownRef.current.contains(e.target as Node)) {
        setShowMemberProgramDropdown(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const [allClients, setAllClients] = useState<Client[]>([]);
  const [clientSearch, setClientSearch] = useState('');
  const [showClientDropdown, setShowClientDropdown] = useState(false);
  const [selectedExistingClient, setSelectedExistingClient] = useState<Client | null>(null);
  const clientSearchRef = useRef<HTMLDivElement>(null);
  const [editingMemberId, setEditingMemberId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ firstName: '', lastName: '', relationship: '', email: '', phone: '' });
  const [savingEdit, setSavingEdit] = useState(false);
  const [editRelationshipOpen, setEditRelationshipOpen] = useState(false);
  const editRelationshipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (relationshipRef.current && !relationshipRef.current.contains(e.target as Node)) {
        setRelationshipOpen(false);
      }
      if (editRelationshipRef.current && !editRelationshipRef.current.contains(e.target as Node)) {
        setEditRelationshipOpen(false);
      }
      if (clientSearchRef.current && !clientSearchRef.current.contains(e.target as Node)) {
        setShowClientDropdown(false);
      }
      const target = e.target as HTMLElement;
      if (!target.closest('[data-traveler-dropdown]')) {
        setActiveTravelerDropdown(null);
        setTravelerClientSearch('');
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const [expandedBalance, setExpandedBalance] = useState<string | null>(null);

  const [showAddTrip, setShowAddTrip] = useState(false);
  const [tripType, setTripType] = useState<TripType>('roundTrip');
  const [tripForm, setTripForm] = useState({
    title: '',
    originAirports: [] as string[],
    destinationAirports: [] as string[],
    departureDate: '',
    returnDate: '',
    travelerCount: '1',
    cabinPreference: '',
    flexibilityDays: '',
    budgetUsd: '',
    notes: '',
  });
  const [multiCityLegs, setMultiCityLegs] = useState<TripLeg[]>([
    { originAirports: [], destinationAirports: [], departureDate: '' },
    { originAirports: [], destinationAirports: [], departureDate: '' },
  ]);
  const [savingTrip, setSavingTrip] = useState(false);

  const [travelers, setTravelers] = useState<TravelerEntry[]>([]);
  const [activeTravelerDropdown, setActiveTravelerDropdown] = useState<string | null>(null);
  const [travelerClientSearch, setTravelerClientSearch] = useState('');
  const travelerIdRef = useRef(0);

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

  // Proposal creation state
  type ProposalRec = { label: string; whyThisOption: string; priceSummary: string; tradeoffs: string };
  const [proposalTripId, setProposalTripId] = useState<string | null>(null);
  const [proposalNote, setProposalNote] = useState('');
  const [proposalSummary, setProposalSummary] = useState('');
  const [proposalRecs, setProposalRecs] = useState<ProposalRec[]>([{ label: '', whyThisOption: '', priceSummary: '', tradeoffs: '' }]);
  const [creatingProposal, setCreatingProposal] = useState(false);
  const [proposalResult, setProposalResult] = useState<{ shareUrl: string } | null>(null);
  const [proposalCopied, setProposalCopied] = useState(false);

  const loadData = useCallback(async () => {
    try {
      const [c, b, fm, t, intk, mtgs, progs, cls] = await Promise.all([
        getClient(clientId),
        getClientBalances(clientId),
        getFamilyMembers(clientId).catch(() => []),
        getClientTrips(clientId).catch(() => []),
        getClientIntakes(clientId).catch(() => []),
        getMeetingSessions(clientId).catch(() => []),
        getLoyaltyPrograms().catch(() => []),
        getClients().catch(() => []),
      ]);
      setClient(c);
      setGroupMemberCount(c.groupProfile?.members?.length ?? 0);
      setBalances(b);
      setLoyaltyPrograms(progs);
      setFamilyMembers(fm);
      setTrips(t);
      setIntakes(intk);
      setMeetings(mtgs);
      setAllClients(cls.filter((cl) => cl.id !== clientId));

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
    if (!balanceForm.loyaltyProgramId || !balanceForm.balance) return;
    setSavingBalance(true);
    try {
      const newBalance = await addClientBalance(clientId, {
        loyaltyProgramId: balanceForm.loyaltyProgramId,
        balance: Number(balanceForm.balance),
      });
      setBalances((prev) => [...prev, newBalance]);
      setBalanceForm({ loyaltyProgramId: '', balance: '' });
      setProgramSearch('');
      setShowAddBalance(false);
    } catch (err) {
      console.error('Failed to add balance:', err);
    } finally {
      setSavingBalance(false);
    }
  };

  const filteredClientResults = useMemo(() => {
    if (!clientSearch.trim()) return [];
    const q = clientSearch.toLowerCase();
    const alreadyLinked = new Set(familyMembers.map((m) => m.linkedClientId).filter(Boolean));
    return allClients.filter((c) => {
      if (alreadyLinked.has(c.id)) return false;
      const full = `${c.firstName} ${c.lastName}`.toLowerCase();
      return full.includes(q) || (c.email && c.email.toLowerCase().includes(q));
    }).slice(0, 8);
  }, [clientSearch, allClients, familyMembers]);

  const handleSelectExistingClient = (c: Client) => {
    setSelectedExistingClient(c);
    setFamilyForm({
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email || '',
      phone: c.phone || '',
      relationship: '',
    });
    setClientSearch('');
    setShowClientDropdown(false);
  };

  const handleClearSelectedClient = () => {
    setSelectedExistingClient(null);
    setFamilyForm({ firstName: '', lastName: '', relationship: '', email: '', phone: '' });
    setClientSearch('');
    setMemberBalances([]);
    setMemberProgramSearch('');
  };

  const handleAddFamilyMember = async () => {
    if (!familyForm.relationship) return;
    if (!selectedExistingClient && (!familyForm.firstName || !familyForm.lastName || !familyForm.email)) return;
    setSavingFamily(true);
    try {
      const parsedBalances = memberBalances
        .filter((b) => b.loyaltyProgramId && b.balance)
        .map((b) => ({ loyaltyProgramId: b.loyaltyProgramId, balance: Number(b.balance) }));
      const member = await addFamilyMember(clientId, {
        existingClientId: selectedExistingClient?.id,
        firstName: familyForm.firstName,
        lastName: familyForm.lastName,
        relationship: familyForm.relationship,
        email: familyForm.email,
        phone: familyForm.phone || undefined,
        loyaltyBalances: parsedBalances.length > 0 ? parsedBalances : undefined,
      });
      setFamilyMembers((prev) => [...prev, member]);
      setFamilyForm({ firstName: '', lastName: '', relationship: '', email: '', phone: '' });
      setMemberBalances([]);
      setMemberProgramSearch('');
      setSelectedExistingClient(null);
      setClientSearch('');
      setShowAddFamily(false);
    } catch (err) {
      console.error('Failed to add group member:', err);
    } finally {
      setSavingFamily(false);
    }
  };

  const handleRemoveFamilyMember = async (memberId: string) => {
    try {
      await removeFamilyMember(clientId, memberId);
      setFamilyMembers((prev) => prev.filter((m) => m.id !== memberId));
    } catch (err) {
      console.error('Failed to remove group member:', err);
    }
  };

  const startEditMember = (member: FamilyMember) => {
    const parts = member.name.split(' ');
    setEditingMemberId(member.id);
    setEditForm({
      firstName: parts[0] || '',
      lastName: parts.slice(1).join(' ') || '',
      relationship: member.relationship,
      email: member.email || '',
      phone: member.phone || '',
    });
  };

  const handleUpdateMember = async () => {
    if (!editingMemberId || !editForm.firstName || !editForm.lastName || !editForm.relationship || !editForm.email) return;
    setSavingEdit(true);
    try {
      const updated = await updateFamilyMember(clientId, editingMemberId, {
        firstName: editForm.firstName,
        lastName: editForm.lastName,
        relationship: editForm.relationship,
        email: editForm.email || undefined,
        phone: editForm.phone || undefined,
      });
      setFamilyMembers((prev) => prev.map((m) => (m.id === updated.id ? updated : m)));
      setEditingMemberId(null);
    } catch (err) {
      console.error('Failed to update group member:', err);
    } finally {
      setSavingEdit(false);
    }
  };

  const resetTripForm = () => {
    setTripForm({ title: '', originAirports: [], destinationAirports: [], departureDate: '', returnDate: '', travelerCount: '1', cabinPreference: '', flexibilityDays: '', budgetUsd: '', notes: '' });
    setTripType('roundTrip');
    setMultiCityLegs([
      { originAirports: [], destinationAirports: [], departureDate: '' },
      { originAirports: [], destinationAirports: [], departureDate: '' },
    ]);
    setTravelers([]);
    setActiveTravelerDropdown(null);
    setTravelerClientSearch('');
  };

  const updateLeg = (index: number, field: keyof TripLeg, val: string[] | string) => {
    setMultiCityLegs((prev) => prev.map((leg, i) => (i === index ? { ...leg, [field]: val } : leg)));
  };

  const addLeg = () => {
    setMultiCityLegs((prev) => [...prev, { originAirports: [], destinationAirports: [], departureDate: '' }]);
  };

  const removeLeg = (index: number) => {
    if (multiCityLegs.length <= 2) return;
    setMultiCityLegs((prev) => prev.filter((_, i) => i !== index));
  };

  const newEmptyLegs = (): TripLeg[] => [
    { originAirports: [], destinationAirports: [], departureDate: '' },
    { originAirports: [], destinationAirports: [], departureDate: '' },
  ];

  const addTraveler = () => {
    travelerIdRef.current += 1;
    setTravelers((prev) => [
      ...prev,
      {
        id: `t-${travelerIdRef.current}`,
        type: 'individual',
        client: null,
        quantity: 1,
        flightConfig: 'sameAsLeader',
        sameAsId: null,
        customTripType: 'roundTrip',
        customLegs: newEmptyLegs(),
      },
    ]);
  };

  const addBulkGroup = () => {
    travelerIdRef.current += 1;
    setTravelers((prev) => [
      ...prev,
      {
        id: `t-${travelerIdRef.current}`,
        type: 'bulk',
        client: null,
        quantity: 10,
        flightConfig: 'sameAsLeader',
        sameAsId: null,
        customTripType: 'roundTrip',
        customLegs: newEmptyLegs(),
      },
    ]);
  };

  const removeTraveler = (id: string) => {
    setTravelers((prev) => {
      const updated = prev.filter((t) => t.id !== id);
      return updated.map((t) =>
        t.sameAsId === id
          ? { ...t, flightConfig: 'sameAsLeader' as const, sameAsId: null }
          : t,
      );
    });
  };

  const updateTraveler = (id: string, updates: Partial<TravelerEntry>) => {
    setTravelers((prev) => prev.map((t) => (t.id === id ? { ...t, ...updates } : t)));
  };

  const updateTravelerLeg = (
    travelerId: string,
    legIdx: number,
    field: keyof TripLeg,
    val: string[] | string,
  ) => {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== travelerId) return t;
        const newLegs = t.customLegs.map((leg, i) =>
          i === legIdx ? { ...leg, [field]: val } : leg,
        );
        return { ...t, customLegs: newLegs };
      }),
    );
  };

  const addTravelerLeg = (travelerId: string) => {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== travelerId) return t;
        return {
          ...t,
          customLegs: [
            ...t.customLegs,
            { originAirports: [], destinationAirports: [], departureDate: '' },
          ],
        };
      }),
    );
  };

  const removeTravelerLeg = (travelerId: string, legIdx: number) => {
    setTravelers((prev) =>
      prev.map((t) => {
        if (t.id !== travelerId || t.customLegs.length <= 2) return t;
        return { ...t, customLegs: t.customLegs.filter((_, i) => i !== legIdx) };
      }),
    );
  };

  const totalTravelerCount = useMemo(() => {
    return 1 + travelers.reduce((sum, t) => sum + t.quantity, 0);
  }, [travelers]);

  const filteredTravelerClients = useMemo(() => {
    const selectedIds = new Set<string>();
    selectedIds.add(clientId);
    for (const t of travelers) {
      if (t.client) selectedIds.add(t.client.id);
    }
    let available = allClients.filter((c) => !selectedIds.has(c.id));
    if (travelerClientSearch.trim()) {
      const q = travelerClientSearch.toLowerCase();
      available = available.filter(
        (c) =>
          `${c.firstName} ${c.lastName}`.toLowerCase().includes(q) ||
          c.email?.toLowerCase().includes(q),
      );
    }
    return available;
  }, [allClients, clientId, travelers, travelerClientSearch]);

  const isTripFormValid = useMemo(() => {
    if (!tripForm.title.trim()) return false;
    if (tripType === 'multiCity') {
      return multiCityLegs.every((leg) => leg.originAirports.length > 0 && leg.destinationAirports.length > 0 && leg.departureDate);
    }
    return tripForm.originAirports.length > 0 && tripForm.destinationAirports.length > 0 && !!tripForm.departureDate;
  }, [tripForm, tripType, multiCityLegs]);

  const handleAddTrip = async () => {
    if (!isTripFormValid) return;
    setSavingTrip(true);
    try {
      let originAirports: string[];
      let destinationAirports: string[];
      let departureDate: string;
      let returnDate: string | undefined;
      let notes = tripForm.notes.trim() || undefined;

      if (tripType === 'multiCity') {
        originAirports = multiCityLegs[0].originAirports;
        destinationAirports = multiCityLegs[multiCityLegs.length - 1].destinationAirports;
        departureDate = multiCityLegs[0].departureDate;
        returnDate = multiCityLegs[multiCityLegs.length - 1].departureDate;

        const legsJson = JSON.stringify(multiCityLegs.map((leg, i) => ({
          leg: i + 1,
          from: leg.originAirports,
          to: leg.destinationAirports,
          date: leg.departureDate,
        })));
        notes = notes ? `[MULTI_CITY:${legsJson}]\n${notes}` : `[MULTI_CITY:${legsJson}]`;
      } else {
        originAirports = tripForm.originAirports;
        destinationAirports = tripForm.destinationAirports;
        departureDate = tripForm.departureDate;
        returnDate = tripType === 'roundTrip' && tripForm.returnDate ? tripForm.returnDate : undefined;
      }

      if (travelers.length > 0) {
        const travelerData = travelers.map((t) => ({
          id: t.id,
          type: t.type,
          clientId: t.client?.id || null,
          clientName: t.client
            ? `${t.client.firstName} ${t.client.lastName}`
            : null,
          quantity: t.quantity,
          flightConfig: t.flightConfig,
          sameAsId: t.flightConfig === 'sameAs' ? t.sameAsId : null,
          customTripType:
            t.flightConfig === 'custom' ? t.customTripType : null,
          customLegs:
            t.flightConfig === 'custom'
              ? t.customLegs.map((leg, i) => ({
                  leg: i + 1,
                  from: leg.originAirports,
                  to: leg.destinationAirports,
                  date: leg.departureDate,
                }))
              : null,
        }));
        const travelerJson = JSON.stringify(travelerData);
        notes = notes
          ? `${notes}\n[TRAVELER_FLIGHTS:${travelerJson}]`
          : `[TRAVELER_FLIGHTS:${travelerJson}]`;
      }

      const trip = await createClientTrip(clientId, {
        title: tripForm.title.trim(),
        originAirports,
        destinationAirports,
        departureDate,
        returnDate,
        travelerCount: totalTravelerCount,
        cabinPreference: tripForm.cabinPreference || undefined,
        flexibilityDays: tripForm.flexibilityDays ? parseInt(tripForm.flexibilityDays) : undefined,
        budgetCash: tripForm.budgetUsd ? parseFloat(tripForm.budgetUsd) : undefined,
        notes,
      });
      setTrips((prev) => [trip, ...prev]);
      resetTripForm();
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

  const groupedBalances = useMemo(() => {
    const groups = new Map<string, LoyaltyBalance[]>();
    for (const bal of balances) {
      const cat = bal.loyaltyProgram?.category ?? 'other';
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat)!.push(bal);
    }
    for (const list of groups.values()) {
      list.sort((a, b) =>
        (a.loyaltyProgram?.name ?? a.programName).localeCompare(b.loyaltyProgram?.name ?? b.programName),
      );
    }
    return [...groups.entries()].sort(
      ([a], [b]) => (CATEGORY_ORDER[a] ?? 99) - (CATEGORY_ORDER[b] ?? 99),
    );
  }, [balances]);

  const groupedFamily = useMemo(() => {
    const groups = new Map<string, FamilyMember[]>();
    for (const member of familyMembers) {
      const rel = member.relationship ?? 'other';
      if (!groups.has(rel)) groups.set(rel, []);
      groups.get(rel)!.push(member);
    }
    for (const list of groups.values()) {
      list.sort((a, b) => a.name.localeCompare(b.name));
    }
    return [...groups.entries()].sort(
      ([a], [b]) => (RELATIONSHIP_ORDER[a] ?? 99) - (RELATIONSHIP_ORDER[b] ?? 99),
    );
  }, [familyMembers]);

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
  const isGroupClient = client.clientType === 'group';
  const isBusinessClient = client.clientType === 'business';

  const pendingInferences = inferences.filter((i) => i.status === 'pending');
  const pendingSuggestions = suggestions.filter((s) => s.status === 'pending');

  const tabs: { key: Tab; label: string; show: boolean }[] = [
    { key: 'overview', label: 'Overview', show: true },
    { key: 'balances', label: 'Balances', show: true },
    { key: 'preferences', label: 'Preference Profile', show: true },
    {
      key: 'group',
      label: isGroupClient ? `Members (${groupMemberCount})` : isBusinessClient ? 'Travelers & Policy' : `Group (${familyMembers.length})`,
      show: isIndividual || isGroupClient || isBusinessClient,
    },
    { key: 'trips', label: `Trips (${trips.length})`, show: true },
    { key: 'discovery', label: `Forms${intakes.length > 0 ? ` (${intakes.length})` : ''}`, show: true },
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
            isIndividual ? 'bg-blue-50 text-blue-600' : isGroupClient ? 'bg-emerald-50 text-emerald-600' : 'bg-purple-50 text-purple-600'
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
                isIndividual ? 'bg-blue-50 text-blue-700' : isGroupClient ? 'bg-emerald-50 text-emerald-700' : 'bg-purple-50 text-purple-700'
              }`}>
                {isIndividual ? 'Individual' : isGroupClient ? 'Group' : 'Business'}
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
                  {b.loyaltyProgram?.name ?? b.programName}: {b.balance.toLocaleString()} pts &middot; expires in {daysLeft} day{daysLeft !== 1 ? 's' : ''}
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
          <div className="grid grid-cols-2 gap-4">
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-medium text-slate-500">Loyalty Points</p>
              {balances.length === 0 ? (
                <p className="text-sm text-slate-400">No programs yet</p>
              ) : (
                <div className="space-y-3">
                  {groupedBalances.map(([category, items]) => {
                    const colors = CATEGORY_COLORS[category] ?? DEFAULT_CATEGORY_COLOR;
                    return (
                      <div key={category} className={`border-l-2 pl-3 ${colors.border}`}>
                        <div className="mb-1 flex items-center gap-1.5">
                          <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                          <p className={`text-xs font-medium uppercase tracking-wider ${colors.label}`}>
                            {CATEGORY_LABELS[category] ?? category}
                          </p>
                        </div>
                        <div className="space-y-1">
                          {items.map((bal) => (
                            <div key={bal.id} className="flex items-baseline justify-between">
                              <span className="text-sm text-slate-600">{bal.loyaltyProgram?.name ?? bal.programName}</span>
                              <span className="text-sm font-semibold text-slate-900 tabular-nums">
                                {bal.balance.toLocaleString()}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                  {balances.length > 1 && (
                    <div className="flex items-baseline justify-between border-t border-slate-100 pt-2">
                      <span className="text-sm font-medium text-slate-500">Total</span>
                      <span className="text-sm font-bold text-slate-900 tabular-nums">
                        {balances.reduce((sum, b) => sum + b.balance, 0).toLocaleString()}
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <p className="mb-3 text-sm font-medium text-slate-500">
                {isIndividual ? 'Group Members' : 'Client Type'}
              </p>
              {isIndividual ? (
                familyMembers.length === 0 ? (
                  <p className="text-sm text-slate-400">No members yet</p>
                ) : (
                  <div className="space-y-3">
                    {groupedFamily.map(([relationship, members]) => {
                      const colors = RELATIONSHIP_COLORS[relationship] ?? DEFAULT_RELATIONSHIP_COLOR;
                      return (
                        <div key={relationship} className={`border-l-2 pl-3 ${colors.border}`}>
                          <div className="mb-1 flex items-center gap-1.5">
                            <span className={`h-1.5 w-1.5 rounded-full ${colors.dot}`} />
                            <p className={`text-xs font-medium uppercase tracking-wider ${colors.label}`}>
                              {RELATIONSHIP_LABELS[relationship] ?? relationship}
                            </p>
                          </div>
                          <div className="space-y-1">
                            {members.map((member) => (
                              <div key={member.id} className="flex items-baseline gap-2">
                                <span className="text-sm text-slate-600">{member.name}</span>
                                {member.email && (
                                  <span className="truncate text-xs text-slate-400">{member.email}</span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )
              ) : (
                <p className="mt-1 text-2xl font-bold text-slate-900">Business</p>
              )}
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

          <ProfileCompletenessScore
            clientId={clientId}
            balances={balances}
            familyMembers={familyMembers}
            onTabChange={(tab) => setActiveTab(tab)}
          />

          {pendingSuggestions.length > 0 && (
            <button
              onClick={() => setActiveTab('discovery')}
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
              <div className="grid grid-cols-2 gap-3">
                <div className="relative" ref={programDropdownRef}>
                  <input
                    type="text"
                    placeholder="Search programs..."
                    value={programSearch}
                    onChange={(e) => {
                      setProgramSearch(e.target.value);
                      setShowProgramDropdown(true);
                      if (e.target.value !== (loyaltyPrograms.find((p) => p.id === balanceForm.loyaltyProgramId)?.name ?? '')) {
                        setBalanceForm((f) => ({ ...f, loyaltyProgramId: '' }));
                      }
                    }}
                    onFocus={() => setShowProgramDropdown(true)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-2 pr-8 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <ChevronDown className="pointer-events-none absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  {showProgramDropdown && filteredPrograms.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-48 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      {filteredPrograms.map((p) => (
                        <li
                          key={p.id}
                          onClick={() => {
                            setBalanceForm((f) => ({ ...f, loyaltyProgramId: p.id }));
                            setProgramSearch(p.name);
                            setShowProgramDropdown(false);
                          }}
                          className="cursor-pointer px-3 py-2 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <span>{p.name}</span>
                          <span className="ml-2 text-xs text-slate-400 capitalize">{p.category}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                <input
                  type="number"
                  placeholder="Balance"
                  value={balanceForm.balance}
                  onChange={(e) => setBalanceForm((f) => ({ ...f, balance: e.target.value }))}
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
                              <span className="font-medium text-slate-900">{bal.loyaltyProgram?.name ?? bal.programName}</span>
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
                            {new Date(bal.updatedAt).toLocaleDateString()}
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

      {activeTab === 'group' && isGroupClient && (
        <GroupMembersPanel clientId={clientId} client={client} onMembersChange={setGroupMemberCount} />
      )}

      {activeTab === 'group' && isBusinessClient && (
        <BusinessProfilePanel clientId={clientId} client={client} />
      )}

      {activeTab === 'group' && isIndividual && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-slate-900">Group Members</h2>
            <button
              onClick={() => setShowAddFamily(true)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Group Member
            </button>
          </div>

          {showAddFamily && (
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-4">
              {/* Existing client search */}
              <div ref={clientSearchRef} className="relative mb-3">
                {selectedExistingClient ? (
                  <div className="flex items-center justify-between rounded-lg border border-green-200 bg-green-50 px-3 py-2">
                    <div className="flex items-center gap-2">
                      <div className="flex h-7 w-7 items-center justify-center rounded-full bg-green-100 text-xs font-medium text-green-700">
                        {selectedExistingClient.firstName[0]}{selectedExistingClient.lastName?.[0] || ''}
                      </div>
                      <div>
                        <span className="text-sm font-medium text-slate-900">
                          {selectedExistingClient.firstName} {selectedExistingClient.lastName}
                        </span>
                        {selectedExistingClient.email && (
                          <span className="ml-2 text-xs text-slate-500">{selectedExistingClient.email}</span>
                        )}
                      </div>
                    </div>
                    <button
                      onClick={handleClearSelectedClient}
                      className="rounded p-1 text-slate-400 hover:bg-white hover:text-slate-600"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ) : (
                  <>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                      <input
                        type="text"
                        placeholder="Search existing clients or enter new member below..."
                        value={clientSearch}
                        onChange={(e) => { setClientSearch(e.target.value); setShowClientDropdown(true); }}
                        onFocus={() => { if (clientSearch.trim()) setShowClientDropdown(true); }}
                        className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                    {showClientDropdown && filteredClientResults.length > 0 && (
                      <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                        {filteredClientResults.map((c) => (
                          <button
                            key={c.id}
                            type="button"
                            onClick={() => handleSelectExistingClient(c)}
                            className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-sm transition-colors hover:bg-slate-50"
                          >
                            <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-100 text-xs font-medium text-slate-600">
                              {c.firstName[0]}{c.lastName?.[0] || ''}
                            </div>
                            <div className="min-w-0">
                              <p className="truncate font-medium text-slate-900">{c.firstName} {c.lastName}</p>
                              {c.email && <p className="truncate text-xs text-slate-500">{c.email}</p>}
                            </div>
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <input
                  type="text"
                  placeholder="First name *"
                  value={familyForm.firstName}
                  onChange={(e) => setFamilyForm((f) => ({ ...f, firstName: e.target.value }))}
                  disabled={!!selectedExistingClient}
                  className={`rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 ${selectedExistingClient ? 'bg-slate-100 text-slate-500' : ''}`}
                />
                <input
                  type="text"
                  placeholder="Last name *"
                  value={familyForm.lastName}
                  onChange={(e) => setFamilyForm((f) => ({ ...f, lastName: e.target.value }))}
                  disabled={!!selectedExistingClient}
                  className={`rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 ${selectedExistingClient ? 'bg-slate-100 text-slate-500' : ''}`}
                />
                <div ref={relationshipRef} className="relative">
                  <button
                    type="button"
                    onClick={() => setRelationshipOpen((o) => !o)}
                    className={`flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm transition-colors ${
                      familyForm.relationship
                        ? 'border-slate-200 text-slate-900'
                        : 'border-slate-200 text-slate-400'
                    } hover:border-slate-300 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600`}
                  >
                    <span className="flex items-center gap-2">
                      {familyForm.relationship ? (
                        <>
                          {
                            {
                              spouse: <Heart className="h-3.5 w-3.5 text-rose-500" />,
                              partner: <Heart className="h-3.5 w-3.5 text-pink-400" />,
                              child: <Baby className="h-3.5 w-3.5 text-amber-500" />,
                              parent: <UserCircle className="h-3.5 w-3.5 text-blue-500" />,
                              sibling: <Users className="h-3.5 w-3.5 text-indigo-500" />,
                              friend: <User className="h-3.5 w-3.5 text-emerald-500" />,
                              other: <User className="h-3.5 w-3.5 text-slate-400" />,
                            }[familyForm.relationship]
                          }
                          <span className="capitalize">{familyForm.relationship}</span>
                        </>
                      ) : (
                        'Relationship *'
                      )}
                    </span>
                    <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${relationshipOpen ? 'rotate-180' : ''}`} />
                  </button>
                  {relationshipOpen && (
                    <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      {[
                        { value: 'spouse', label: 'Spouse', icon: <Heart className="h-4 w-4 text-rose-500" /> },
                        { value: 'partner', label: 'Partner', icon: <Heart className="h-4 w-4 text-pink-400" /> },
                        { value: 'child', label: 'Child', icon: <Baby className="h-4 w-4 text-amber-500" /> },
                        { value: 'parent', label: 'Parent', icon: <UserCircle className="h-4 w-4 text-blue-500" /> },
                        { value: 'sibling', label: 'Sibling', icon: <Users className="h-4 w-4 text-indigo-500" /> },
                        { value: 'friend', label: 'Friend', icon: <User className="h-4 w-4 text-emerald-500" /> },
                        { value: 'other', label: 'Other', icon: <User className="h-4 w-4 text-slate-400" /> },
                      ].map((opt) => (
                        <button
                          key={opt.value}
                          type="button"
                          onClick={() => {
                            setFamilyForm((f) => ({ ...f, relationship: opt.value }));
                            setRelationshipOpen(false);
                          }}
                          className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-slate-50 ${
                            familyForm.relationship === opt.value
                              ? 'bg-blue-50 font-medium text-blue-700'
                              : 'text-slate-700'
                          }`}
                        >
                          {opt.icon}
                          {opt.label}
                          {familyForm.relationship === opt.value && (
                            <Check className="ml-auto h-3.5 w-3.5 text-blue-600" />
                          )}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <input
                  type="email"
                  placeholder="Email *"
                  value={familyForm.email}
                  onChange={(e) => setFamilyForm((f) => ({ ...f, email: e.target.value }))}
                  disabled={!!selectedExistingClient}
                  className={`rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 ${selectedExistingClient ? 'bg-slate-100 text-slate-500' : ''}`}
                />
                <input
                  type="tel"
                  placeholder="Phone (optional)"
                  value={familyForm.phone}
                  onChange={(e) => setFamilyForm((f) => ({ ...f, phone: e.target.value }))}
                  disabled={!!selectedExistingClient}
                  className={`rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 ${selectedExistingClient ? 'bg-slate-100 text-slate-500' : ''}`}
                />
              </div>

              {/* Loyalty Balances */}
              <div className="mt-3 rounded-lg border border-blue-100 bg-white/60 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <span className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
                    <Coins className="h-3.5 w-3.5" />
                    Loyalty Balances
                  </span>
                </div>
                {memberBalances.length > 0 && (
                  <div className="mb-2 space-y-1.5">
                    {memberBalances.map((entry, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <span className="flex-1 truncate text-sm text-slate-700">{entry.programName}</span>
                        <input
                          type="number"
                          placeholder="Balance"
                          autoFocus={!entry.balance}
                          value={entry.balance}
                          onChange={(e) =>
                            setMemberBalances((prev) =>
                              prev.map((b, i) => (i === idx ? { ...b, balance: e.target.value } : b)),
                            )
                          }
                          className="w-32 rounded-lg border border-slate-200 px-2.5 py-1.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <button
                          type="button"
                          onClick={() => setMemberBalances((prev) => prev.filter((_, i) => i !== idx))}
                          className="shrink-0 rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-600"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <div className="relative" ref={memberProgramDropdownRef}>
                  <input
                    type="text"
                    placeholder="Search loyalty program..."
                    value={memberProgramSearch}
                    onChange={(e) => {
                      setMemberProgramSearch(e.target.value);
                      setShowMemberProgramDropdown(true);
                    }}
                    onFocus={() => setShowMemberProgramDropdown(true)}
                    className="w-full rounded-lg border border-slate-200 px-3 py-1.5 pr-7 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                  {showMemberProgramDropdown && filteredMemberPrograms.length > 0 && (
                    <ul className="absolute z-20 mt-1 max-h-40 w-full overflow-auto rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                      {filteredMemberPrograms.map((p) => (
                        <li
                          key={p.id}
                          onClick={() => {
                            setMemberBalances((prev) => [...prev, { loyaltyProgramId: p.id, programName: p.name, balance: '' }]);
                            setMemberProgramSearch('');
                            setShowMemberProgramDropdown(false);
                          }}
                          className="cursor-pointer px-3 py-1.5 text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700"
                        >
                          <span>{p.name}</span>
                          <span className="ml-2 text-xs text-slate-400 capitalize">{p.category}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>

              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddFamilyMember}
                  disabled={savingFamily || !familyForm.relationship || (!selectedExistingClient && (!familyForm.firstName || !familyForm.lastName || !familyForm.email))}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingFamily ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Add Member
                </button>
                <button
                  onClick={() => { setShowAddFamily(false); handleClearSelectedClient(); }}
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
                No group members added yet.
              </p>
              <button
                onClick={() => setShowAddFamily(true)}
                className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
              >
                <Plus className="h-4 w-4" />
                Add a group member
              </button>
            </div>
          ) : (
            <div className="space-y-3">
              {familyMembers.map((member) => (
                <div key={member.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
                  <div
                    className="flex cursor-pointer items-center justify-between p-4 transition-colors hover:bg-slate-50"
                    onClick={() => editingMemberId === member.id ? setEditingMemberId(null) : startEditMember(member)}
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-100 text-sm font-medium text-slate-600">
                        {member.name.split(' ').map((n) => n[0]).join('').slice(0, 2)}
                      </div>
                      <div>
                        <p className="font-medium text-slate-900">{member.name}</p>
                        <div className="flex items-center gap-2 text-xs text-slate-500">
                          <span className="capitalize">{member.relationship}</span>
                          {member.email && (
                            <>
                              <span className="text-slate-300">&middot;</span>
                              <span className="flex items-center gap-1">
                                <Mail className="h-3 w-3" />
                                {member.email}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      {member.phone && (
                        <span className="flex items-center gap-1 text-xs text-slate-500">
                          <Phone className="h-3 w-3" />
                          {member.phone}
                        </span>
                      )}
                      {member.linkedClientId && (
                        <Link
                          href={`/clients/${member.linkedClientId}`}
                          onClick={(e) => e.stopPropagation()}
                          className="rounded-lg p-1.5 text-blue-500 hover:bg-blue-50 hover:text-blue-700"
                          title="View client profile"
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Link>
                      )}
                      <button
                        onClick={(e) => { e.stopPropagation(); if (editingMemberId === member.id) { setEditingMemberId(null); } else { startEditMember(member); } }}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleRemoveFamilyMember(member.id); }}
                        className="rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>

                  {member.linkedClient?.loyaltyBalances && member.linkedClient.loyaltyBalances.length > 0 && editingMemberId !== member.id && (
                    <div className="border-t border-slate-100 px-4 py-3">
                      <div className="flex items-center gap-1.5 mb-2">
                        <Coins className="h-3.5 w-3.5 text-amber-500" />
                        <span className="text-xs font-medium text-slate-500">Loyalty Balances</span>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {member.linkedClient.loyaltyBalances.map((bal) => (
                          <div
                            key={bal.id}
                            className="inline-flex items-center gap-1.5 rounded-full bg-slate-50 px-2.5 py-1 text-xs"
                          >
                            <span className="font-medium text-slate-700">
                              {bal.loyaltyProgram?.name ?? bal.programName}
                            </span>
                            <span className="font-semibold text-slate-900">
                              {bal.balance.toLocaleString()}
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {editingMemberId === member.id && (
                    <div className="border-t border-slate-100 bg-slate-50/50 p-4">
                      <div className="grid grid-cols-2 gap-3">
                        <input
                          type="text"
                          placeholder="First name *"
                          value={editForm.firstName}
                          onChange={(e) => setEditForm((f) => ({ ...f, firstName: e.target.value }))}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <input
                          type="text"
                          placeholder="Last name *"
                          value={editForm.lastName}
                          onChange={(e) => setEditForm((f) => ({ ...f, lastName: e.target.value }))}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <div ref={editRelationshipRef} className="relative">
                          <button
                            type="button"
                            onClick={() => setEditRelationshipOpen((o) => !o)}
                            className={`flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2 text-sm transition-colors ${
                              editForm.relationship
                                ? 'border-slate-200 text-slate-900'
                                : 'border-slate-200 text-slate-400'
                            } hover:border-slate-300 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600`}
                          >
                            <span className="flex items-center gap-2">
                              {editForm.relationship ? (
                                <>
                                  {
                                    {
                                      spouse: <Heart className="h-3.5 w-3.5 text-rose-500" />,
                                      partner: <Heart className="h-3.5 w-3.5 text-pink-400" />,
                                      child: <Baby className="h-3.5 w-3.5 text-amber-500" />,
                                      parent: <UserCircle className="h-3.5 w-3.5 text-blue-500" />,
                                      sibling: <Users className="h-3.5 w-3.5 text-indigo-500" />,
                                      friend: <User className="h-3.5 w-3.5 text-emerald-500" />,
                                      other: <User className="h-3.5 w-3.5 text-slate-400" />,
                                    }[editForm.relationship]
                                  }
                                  <span className="capitalize">{editForm.relationship}</span>
                                </>
                              ) : (
                                'Relationship *'
                              )}
                            </span>
                            <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${editRelationshipOpen ? 'rotate-180' : ''}`} />
                          </button>
                          {editRelationshipOpen && (
                            <div className="absolute left-0 right-0 top-full z-20 mt-1 overflow-hidden rounded-lg border border-slate-200 bg-white py-1 shadow-lg">
                              {[
                                { value: 'spouse', label: 'Spouse', icon: <Heart className="h-4 w-4 text-rose-500" /> },
                                { value: 'partner', label: 'Partner', icon: <Heart className="h-4 w-4 text-pink-400" /> },
                                { value: 'child', label: 'Child', icon: <Baby className="h-4 w-4 text-amber-500" /> },
                                { value: 'parent', label: 'Parent', icon: <UserCircle className="h-4 w-4 text-blue-500" /> },
                                { value: 'sibling', label: 'Sibling', icon: <Users className="h-4 w-4 text-indigo-500" /> },
                                { value: 'friend', label: 'Friend', icon: <User className="h-4 w-4 text-emerald-500" /> },
                                { value: 'other', label: 'Other', icon: <User className="h-4 w-4 text-slate-400" /> },
                              ].map((opt) => (
                                <button
                                  key={opt.value}
                                  type="button"
                                  onClick={() => {
                                    setEditForm((f) => ({ ...f, relationship: opt.value }));
                                    setEditRelationshipOpen(false);
                                  }}
                                  className={`flex w-full items-center gap-2.5 px-3 py-2 text-sm transition-colors hover:bg-slate-50 ${
                                    editForm.relationship === opt.value
                                      ? 'bg-blue-50 font-medium text-blue-700'
                                      : 'text-slate-700'
                                  }`}
                                >
                                  {opt.icon}
                                  {opt.label}
                                  {editForm.relationship === opt.value && (
                                    <Check className="ml-auto h-3.5 w-3.5 text-blue-600" />
                                  )}
                                </button>
                              ))}
                            </div>
                          )}
                        </div>
                        <input
                          type="email"
                          placeholder="Email *"
                          value={editForm.email}
                          onChange={(e) => setEditForm((f) => ({ ...f, email: e.target.value }))}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                        <input
                          type="tel"
                          placeholder="Phone (optional)"
                          value={editForm.phone}
                          onChange={(e) => setEditForm((f) => ({ ...f, phone: e.target.value }))}
                          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                        />
                      </div>
                      <div className="mt-3 flex gap-2">
                        <button
                          onClick={handleUpdateMember}
                          disabled={savingEdit || !editForm.firstName || !editForm.lastName || !editForm.relationship || !editForm.email}
                          className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                        >
                          {savingEdit ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                          Save Changes
                        </button>
                        <button
                          onClick={() => setEditingMemberId(null)}
                          className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
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
            <div className="rounded-xl border border-blue-200 bg-blue-50/50 p-6">
              <div className="mb-5 flex items-center justify-between">
                <h3 className="text-base font-semibold text-slate-900">New Trip Request</h3>
                <button
                  onClick={() => { setShowAddTrip(false); resetTripForm(); }}
                  className="rounded-lg p-1.5 text-slate-400 hover:bg-white hover:text-slate-600"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-4">
                {/* Group Leader (pre-filled) */}
                {client && (
                  <div>
                    <label className="mb-1.5 flex items-center gap-1.5 text-xs font-medium text-slate-700">
                      <Crown className="h-3.5 w-3.5 text-amber-500" />
                      Group Leader (Client)
                    </label>
                    <div className="flex items-center gap-3 rounded-lg border border-blue-200 bg-white p-3">
                      <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                        {client.firstName?.[0]}{client.lastName?.[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">
                          {client.firstName} {client.lastName}
                        </p>
                        <div className="flex items-center gap-3 mt-0.5">
                          {client.email && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                              <Mail className="h-3 w-3" /> {client.email}
                            </span>
                          )}
                          {client.phone && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-slate-500">
                              <Phone className="h-3 w-3" /> {client.phone}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Trip Title */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Trip Title *</label>
                  <input
                    type="text"
                    placeholder="e.g., Summer Hawaii Trip"
                    value={tripForm.title}
                    onChange={(e) => setTripForm((f) => ({ ...f, title: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                {/* Trip Type Selector */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Trip Type</label>
                  <div className="inline-flex rounded-lg border border-slate-200 bg-white p-0.5">
                    {([['roundTrip', 'Round Trip'], ['oneWay', 'One Way'], ['multiCity', 'Multi-City']] as const).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setTripType(key)}
                        className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                          tripType === key
                            ? 'bg-blue-600 text-white shadow-sm'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Simple trip (round-trip or one-way) */}
                {tripType !== 'multiCity' && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700">Origin Airports *</label>
                        <MultiAirportAutocomplete
                          value={tripForm.originAirports}
                          onChange={(airports) => setTripForm((f) => ({ ...f, originAirports: airports }))}
                          placeholder="Search origin airports..."
                          maxSelections={5}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700">Destination Airports *</label>
                        <MultiAirportAutocomplete
                          value={tripForm.destinationAirports}
                          onChange={(airports) => setTripForm((f) => ({ ...f, destinationAirports: airports }))}
                          placeholder="Search destination airports..."
                          maxSelections={5}
                        />
                      </div>
                    </div>
                    <div className={`grid gap-3 ${tripType === 'roundTrip' ? 'grid-cols-2' : 'grid-cols-1'}`}>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-700">Departure Date *</label>
                        <SingleDatePicker
                          compact
                          value={tripForm.departureDate}
                          onChange={(v) => setTripForm((f) => ({ ...f, departureDate: v }))}
                        />
                      </div>
                      {tripType === 'roundTrip' && (
                        <div>
                          <label className="mb-1 block text-xs font-medium text-slate-700">Return Date</label>
                          <SingleDatePicker
                            compact
                            value={tripForm.returnDate}
                            onChange={(v) => setTripForm((f) => ({ ...f, returnDate: v }))}
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Multi-City Legs */}
                {tripType === 'multiCity' && (
                  <div className="space-y-3">
                    <label className="block text-xs font-medium text-slate-700">Flight Legs</label>
                    {multiCityLegs.map((leg, idx) => (
                      <div key={idx} className="relative rounded-lg border border-slate-200 bg-white p-3">
                        <div className="mb-2 flex items-center justify-between">
                          <span className="text-xs font-semibold text-slate-500">Leg {idx + 1}</span>
                          {multiCityLegs.length > 2 && (
                            <button
                              type="button"
                              onClick={() => removeLeg(idx)}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                            >
                              <X className="h-3.5 w-3.5" />
                            </button>
                          )}
                        </div>
                        <div className="grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-slate-500">From *</label>
                            <MultiAirportAutocomplete
                              value={leg.originAirports}
                              onChange={(airports) => updateLeg(idx, 'originAirports', airports)}
                              placeholder="Origin..."
                              maxSelections={5}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-slate-500">To *</label>
                            <MultiAirportAutocomplete
                              value={leg.destinationAirports}
                              onChange={(airports) => updateLeg(idx, 'destinationAirports', airports)}
                              placeholder="Destination..."
                              maxSelections={5}
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-slate-500">Date *</label>
                            <SingleDatePicker
                              compact
                              value={leg.departureDate}
                              onChange={(v) => updateLeg(idx, 'departureDate', v)}
                              className="min-w-[140px]"
                            />
                          </div>
                        </div>
                      </div>
                    ))}
                    <button
                      type="button"
                      onClick={addLeg}
                      className="inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add another leg
                    </button>
                  </div>
                )}

                {/* Travelers Section */}
                <div className="rounded-lg border border-slate-200 bg-white p-4">
                  <div className="mb-3 flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-medium text-slate-700">
                      <Users className="h-3.5 w-3.5 text-blue-500" />
                      Travelers
                      <span className="ml-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-semibold text-blue-700">
                        {totalTravelerCount} total
                      </span>
                    </label>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={addTraveler}
                        className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-2.5 py-1.5 text-[11px] font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                      >
                        <UserPlus className="h-3 w-3" />
                        Add Traveler
                      </button>
                      <button
                        type="button"
                        onClick={addBulkGroup}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-50 px-2.5 py-1.5 text-[11px] font-medium text-amber-700 hover:bg-amber-100 transition-colors"
                      >
                        <Hash className="h-3 w-3" />
                        Bulk Group
                      </button>
                    </div>
                  </div>

                  {/* Group Leader row */}
                  {client && (
                    <div className="mb-2 flex items-center gap-3 rounded-lg border border-blue-100 bg-blue-50/50 px-3 py-2.5">
                      <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-blue-100 text-xs font-semibold text-blue-700">
                        {client.firstName?.[0]}{client.lastName?.[0]}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium text-slate-900">
                          {client.firstName} {client.lastName}
                        </p>
                        <p className="text-[10px] text-slate-500">Group Leader &middot; Default flights above</p>
                      </div>
                      <span className="inline-flex items-center gap-1 rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700">
                        <Crown className="h-2.5 w-2.5" />
                        Leader
                      </span>
                    </div>
                  )}

                  {/* Additional Travelers */}
                  {travelers.map((traveler, idx) => (
                    <div key={traveler.id} className="mb-2 rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                          {traveler.type === 'bulk' ? 'Bulk Group' : `Traveler ${idx + 2}`}
                        </span>
                        <button
                          type="button"
                          onClick={() => removeTraveler(traveler.id)}
                          className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>

                      {traveler.type === 'individual' ? (
                        <div className="space-y-2">
                          {traveler.client ? (
                            <div className="flex items-center gap-3">
                              <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-slate-100 text-xs font-semibold text-slate-600">
                                {traveler.client.firstName?.[0]}{traveler.client.lastName?.[0]}
                              </div>
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium text-slate-800">
                                  {traveler.client.firstName} {traveler.client.lastName}
                                </p>
                                {traveler.client.email && (
                                  <p className="text-[11px] text-slate-500">{traveler.client.email}</p>
                                )}
                              </div>
                              <button
                                type="button"
                                onClick={() => updateTraveler(traveler.id, { client: null })}
                                className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          ) : (
                            <div className="relative" data-traveler-dropdown>
                              <div className="relative">
                                <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                                <input
                                  type="text"
                                  placeholder="Search for a client..."
                                  value={activeTravelerDropdown === traveler.id ? travelerClientSearch : ''}
                                  onChange={(e) => {
                                    setTravelerClientSearch(e.target.value);
                                    setActiveTravelerDropdown(traveler.id);
                                  }}
                                  onFocus={() => setActiveTravelerDropdown(traveler.id)}
                                  className="w-full rounded-lg border border-slate-200 bg-white py-2 pl-9 pr-3 text-xs placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                                />
                              </div>
                              {activeTravelerDropdown === traveler.id && (
                                <div className="absolute z-20 mt-1 max-h-48 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
                                  {filteredTravelerClients.length === 0 ? (
                                    <div className="px-4 py-2 text-center text-xs text-slate-400">
                                      No clients found
                                    </div>
                                  ) : (
                                    filteredTravelerClients.map((c) => (
                                      <button
                                        key={c.id}
                                        type="button"
                                        onClick={() => {
                                          updateTraveler(traveler.id, { client: c });
                                          setActiveTravelerDropdown(null);
                                          setTravelerClientSearch('');
                                        }}
                                        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-blue-50"
                                      >
                                        <div className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded bg-slate-100 text-[10px] font-semibold text-slate-600">
                                          {c.firstName?.[0]}{c.lastName?.[0]}
                                        </div>
                                        <span className="truncate font-medium text-slate-700">
                                          {c.firstName} {c.lastName}
                                        </span>
                                      </button>
                                    ))
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <label className="text-xs font-medium text-slate-600">Quantity:</label>
                          <div className="inline-flex items-center rounded-lg border border-slate-200 bg-white">
                            <button
                              type="button"
                              onClick={() =>
                                updateTraveler(traveler.id, {
                                  quantity: Math.max(1, traveler.quantity - 1),
                                })
                              }
                              className="rounded-l-lg px-2.5 py-1.5 text-slate-500 hover:bg-slate-50 transition-colors"
                            >
                              <Minus className="h-3.5 w-3.5" />
                            </button>
                            <input
                              type="number"
                              min="1"
                              value={traveler.quantity}
                              onChange={(e) =>
                                updateTraveler(traveler.id, {
                                  quantity: Math.max(1, parseInt(e.target.value) || 1),
                                })
                              }
                              className="w-20 border-x border-slate-200 py-1.5 text-center text-sm font-medium text-slate-800 focus:outline-none"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                updateTraveler(traveler.id, {
                                  quantity: traveler.quantity + 1,
                                })
                              }
                              className="rounded-r-lg px-2.5 py-1.5 text-slate-500 hover:bg-slate-50 transition-colors"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>
                          <span className="text-[11px] text-slate-500">travelers</span>
                        </div>
                      )}

                      {/* Flight Configuration */}
                      <div className="mt-2.5 flex items-center gap-2">
                        <Copy className="h-3 w-3 flex-shrink-0 text-slate-400" />
                        <select
                          value={
                            traveler.flightConfig === 'sameAs'
                              ? `sameAs:${traveler.sameAsId}`
                              : traveler.flightConfig
                          }
                          onChange={(e) => {
                            const val = e.target.value;
                            if (val === 'sameAsLeader') {
                              updateTraveler(traveler.id, {
                                flightConfig: 'sameAsLeader',
                                sameAsId: null,
                              });
                            } else if (val === 'custom') {
                              updateTraveler(traveler.id, {
                                flightConfig: 'custom',
                                sameAsId: null,
                              });
                            } else if (val.startsWith('sameAs:')) {
                              updateTraveler(traveler.id, {
                                flightConfig: 'sameAs',
                                sameAsId: val.replace('sameAs:', ''),
                              });
                            }
                          }}
                          className="rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                        >
                          <option value="sameAsLeader">
                            Same as {client ? `${client.firstName} ${client.lastName}` : 'Group Leader'}
                          </option>
                          {travelers
                            .filter(
                              (t) =>
                                t.id !== traveler.id &&
                                t.flightConfig === 'custom' &&
                                t.type === 'individual' &&
                                t.client,
                            )
                            .map((t) => (
                              <option key={t.id} value={`sameAs:${t.id}`}>
                                Same as {t.client!.firstName} {t.client!.lastName}
                              </option>
                            ))}
                          {traveler.type === 'individual' && (
                            <option value="custom">Custom flights</option>
                          )}
                        </select>
                      </div>

                      {/* Custom Flight Legs */}
                      {traveler.flightConfig === 'custom' && (
                        <div className="mt-3 space-y-2 rounded-lg border border-dashed border-slate-300 bg-white p-3">
                          <div className="mb-2">
                            <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5">
                              {(
                                [
                                  ['roundTrip', 'Round Trip'],
                                  ['oneWay', 'One Way'],
                                  ['multiCity', 'Multi-City'],
                                ] as const
                              ).map(([key, label]) => (
                                <button
                                  key={key}
                                  type="button"
                                  onClick={() =>
                                    updateTraveler(traveler.id, { customTripType: key })
                                  }
                                  className={`rounded px-2 py-1 text-[10px] font-medium transition-colors ${
                                    traveler.customTripType === key
                                      ? 'bg-blue-600 text-white shadow-sm'
                                      : 'text-slate-600 hover:text-slate-900'
                                  }`}
                                >
                                  {label}
                                </button>
                              ))}
                            </div>
                          </div>

                          {traveler.customTripType !== 'multiCity' ? (
                            <>
                              <div className="grid grid-cols-2 gap-2">
                                <div>
                                  <label className="mb-1 block text-[10px] font-medium text-slate-500">From *</label>
                                  <MultiAirportAutocomplete
                                    value={traveler.customLegs[0]?.originAirports ?? []}
                                    onChange={(airports) =>
                                      updateTravelerLeg(traveler.id, 0, 'originAirports', airports)
                                    }
                                    placeholder="Origin..."
                                    maxSelections={5}
                                  />
                                </div>
                                <div>
                                  <label className="mb-1 block text-[10px] font-medium text-slate-500">To *</label>
                                  <MultiAirportAutocomplete
                                    value={traveler.customLegs[0]?.destinationAirports ?? []}
                                    onChange={(airports) =>
                                      updateTravelerLeg(traveler.id, 0, 'destinationAirports', airports)
                                    }
                                    placeholder="Destination..."
                                    maxSelections={5}
                                  />
                                </div>
                              </div>
                              <div
                                className={`grid gap-2 ${traveler.customTripType === 'roundTrip' ? 'grid-cols-2' : 'grid-cols-1'}`}
                              >
                                <div>
                                  <label className="mb-1 block text-[10px] font-medium text-slate-500">Departure *</label>
                                  <SingleDatePicker
                                    compact
                                    value={traveler.customLegs[0]?.departureDate ?? ''}
                                    onChange={(v) =>
                                      updateTravelerLeg(traveler.id, 0, 'departureDate', v)
                                    }
                                  />
                                </div>
                                {traveler.customTripType === 'roundTrip' && (
                                  <div>
                                    <label className="mb-1 block text-[10px] font-medium text-slate-500">Return</label>
                                    <SingleDatePicker
                                      compact
                                      value={traveler.customLegs[1]?.departureDate ?? ''}
                                      onChange={(v) =>
                                        updateTravelerLeg(traveler.id, 1, 'departureDate', v)
                                      }
                                    />
                                  </div>
                                )}
                              </div>
                            </>
                          ) : (
                            <div className="space-y-2">
                              {traveler.customLegs.map((cLeg, cIdx) => (
                                <div
                                  key={cIdx}
                                  className="rounded-md border border-slate-100 bg-slate-50/50 p-2"
                                >
                                  <div className="mb-1.5 flex items-center justify-between">
                                    <span className="text-[10px] font-semibold text-slate-400">Leg {cIdx + 1}</span>
                                    {traveler.customLegs.length > 2 && (
                                      <button
                                        type="button"
                                        onClick={() => removeTravelerLeg(traveler.id, cIdx)}
                                        className="rounded p-0.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    )}
                                  </div>
                                  <div className="grid grid-cols-[1fr_1fr_auto] items-end gap-1.5">
                                    <div>
                                      <label className="mb-0.5 block text-[9px] font-medium text-slate-400">From</label>
                                      <MultiAirportAutocomplete
                                        value={cLeg.originAirports}
                                        onChange={(airports) =>
                                          updateTravelerLeg(traveler.id, cIdx, 'originAirports', airports)
                                        }
                                        placeholder="Origin..."
                                        maxSelections={5}
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-0.5 block text-[9px] font-medium text-slate-400">To</label>
                                      <MultiAirportAutocomplete
                                        value={cLeg.destinationAirports}
                                        onChange={(airports) =>
                                          updateTravelerLeg(traveler.id, cIdx, 'destinationAirports', airports)
                                        }
                                        placeholder="Dest..."
                                        maxSelections={5}
                                      />
                                    </div>
                                    <div>
                                      <label className="mb-0.5 block text-[9px] font-medium text-slate-400">Date</label>
                                      <SingleDatePicker
                                        compact
                                        value={cLeg.departureDate}
                                        onChange={(v) =>
                                          updateTravelerLeg(traveler.id, cIdx, 'departureDate', v)
                                        }
                                        className="min-w-[120px]"
                                      />
                                    </div>
                                  </div>
                                </div>
                              ))}
                              <button
                                type="button"
                                onClick={() => addTravelerLeg(traveler.id)}
                                className="inline-flex items-center gap-1 text-[10px] font-medium text-blue-600 hover:text-blue-700"
                              >
                                <Plus className="h-3 w-3" />
                                Add leg
                              </button>
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  ))}

                  {travelers.length === 0 && (
                    <p className="mt-1 text-[11px] text-slate-400">
                      Add individual travelers or a bulk group to book for multiple people.
                    </p>
                  )}
                </div>

                {/* Extra options */}
                <div className="grid grid-cols-2 gap-3">
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
                      className="block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-700">Notes</label>
                  <textarea
                    value={tripForm.notes}
                    onChange={(e) => setTripForm((f) => ({ ...f, notes: e.target.value }))}
                    rows={2}
                    placeholder="Any special requirements..."
                    className="block w-full resize-none rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              {/* Actions */}
              <div className="mt-5 flex items-center gap-3">
                <button
                  onClick={handleAddTrip}
                  disabled={savingTrip || !isTripFormValid}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 transition-colors"
                >
                  {savingTrip ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plane className="h-3.5 w-3.5" />}
                  Create Trip
                </button>
                <button
                  onClick={() => { setShowAddTrip(false); resetTripForm(); }}
                  className="rounded-lg bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50 border border-slate-200"
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
                    <th className="px-5 py-3 text-left font-medium text-slate-600">Actions</th>
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
                      <tr key={trip.id} onClick={() => router.push(`/trips/${trip.id}`)} className="cursor-pointer transition-colors hover:bg-slate-50">
                        <td className="px-5 py-3.5">
                          <span className="font-medium text-blue-600 group-hover:text-blue-700">{trip.title}</span>
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">
                          {(() => {
                            const multiCityMatch = trip.notes?.match(/\[MULTI_CITY:(\[.*?\])\]/);
                            if (multiCityMatch) {
                              try {
                                const legs = JSON.parse(multiCityMatch[1]) as { leg: number; from: string[]; to: string[]; date: string }[];
                                return (
                                  <div className="flex flex-col gap-0.5">
                                    <span className="mb-0.5 inline-block rounded bg-purple-50 px-1.5 py-0.5 text-[10px] font-medium text-purple-700 w-fit">Multi-City</span>
                                    {legs.map((l) => (
                                      <span key={l.leg} className="text-xs">
                                        {l.from.join('/')}{' → '}{l.to.join('/')}
                                      </span>
                                    ))}
                                  </div>
                                );
                              } catch { /* fall through */ }
                            }
                            const origins = Array.isArray(trip.originAirports) ? trip.originAirports.join(', ') : trip.originAirports;
                            const dests = Array.isArray(trip.destinationAirports) ? trip.destinationAirports.join(', ') : trip.destinationAirports;
                            return <>{origins}{' → '}{dests}</>;
                          })()}
                        </td>
                        <td className="px-5 py-3.5 text-slate-600">
                          {(() => {
                            const multiCityMatch = trip.notes?.match(/\[MULTI_CITY:(\[.*?\])\]/);
                            if (multiCityMatch) {
                              try {
                                const legs = JSON.parse(multiCityMatch[1]) as { leg: number; from: string[]; to: string[]; date: string }[];
                                const fmt = (d: string) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                return (
                                  <div className="flex flex-col gap-0.5">
                                    {legs.map((l) => (
                                      <span key={l.leg} className="text-xs">{fmt(l.date)}</span>
                                    ))}
                                  </div>
                                );
                              } catch { /* fall through */ }
                            }
                            return (
                              <>
                                {trip.departureDate
                                  ? new Date(trip.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                                  : '—'}
                                {trip.returnDate
                                  ? ` – ${new Date(trip.returnDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
                                  : ''}
                              </>
                            );
                          })()}
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
                        <td className="px-5 py-3.5" onClick={(e) => e.stopPropagation()}>
                          <button
                            onClick={() => {
                              setProposalTripId(trip.id);
                              setProposalNote('');
                              setProposalSummary('');
                              setProposalRecs([{ label: '', whyThisOption: '', priceSummary: '', tradeoffs: '' }]);
                              setProposalResult(null);
                            }}
                            className="inline-flex items-center gap-1 rounded-lg border border-blue-200 bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100 transition-colors"
                          >
                            <Send className="h-3 w-3" />
                            Propose
                          </button>
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

      {activeTab === 'discovery' && (
        <FormsTab
          client={client}
          clientId={clientId}
          intakes={intakes}
          setIntakes={setIntakes}
        />
      )}

      {/* ── Proposal Creation Modal ── */}
      {proposalTripId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="relative w-full max-w-xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
            {/* Header */}
            <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-6 py-4">
              <div>
                <h2 className="font-semibold text-slate-900">Create Proposal</h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {trips.find((t) => t.id === proposalTripId)?.title ?? 'Trip'}
                </p>
              </div>
              <button
                onClick={() => { setProposalTripId(null); setProposalResult(null); }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="px-6 py-5 space-y-5">
              {proposalResult ? (
                /* Success state */
                <div className="space-y-4">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-5 text-center">
                    <Check className="mx-auto h-8 w-8 text-emerald-600 mb-2" />
                    <p className="font-semibold text-emerald-800">Proposal created!</p>
                    <p className="mt-1 text-sm text-emerald-700">Share this link with your client</p>
                  </div>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
                    <span className="flex-1 truncate text-sm text-slate-700">
                      {`${window.location.origin}${proposalResult.shareUrl}`}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(`${window.location.origin}${proposalResult.shareUrl}`);
                        setProposalCopied(true);
                        setTimeout(() => setProposalCopied(false), 2000);
                      }}
                      className="shrink-0 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                    >
                      {proposalCopied ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>
                  <a
                    href={proposalResult.shareUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-1.5 text-sm text-blue-600 hover:text-blue-700"
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    Preview proposal
                  </a>
                </div>
              ) : (
                /* Creation form */
                <>
                  {/* Advisor note */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      Advisor Note <span className="text-slate-400">(shown to client)</span>
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Hi! Based on your preferences, here are my top recommendations for your trip..."
                      value={proposalNote}
                      onChange={(e) => setProposalNote(e.target.value)}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                    />
                  </div>

                  {/* Trip summary */}
                  <div>
                    <label className="mb-1 block text-xs font-medium text-slate-700">
                      Trip Summary <span className="text-slate-400">(optional)</span>
                    </label>
                    <input
                      type="text"
                      placeholder="e.g., 7-night Paris trip, May 10–17, Business class"
                      value={proposalSummary}
                      onChange={(e) => setProposalSummary(e.target.value)}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>

                  {/* Recommendations */}
                  <div>
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-xs font-medium text-slate-700">
                        Recommendations <span className="text-slate-400">(at least one required)</span>
                      </label>
                      {proposalRecs.length < 3 && (
                        <button
                          onClick={() => setProposalRecs((prev) => [...prev, { label: '', whyThisOption: '', priceSummary: '', tradeoffs: '' }])}
                          className="text-xs font-medium text-blue-600 hover:text-blue-700"
                        >
                          + Add option
                        </button>
                      )}
                    </div>
                    <div className="space-y-3">
                      {proposalRecs.map((rec, idx) => (
                        <div key={idx} className="rounded-lg border border-slate-200 bg-slate-50 p-4 space-y-3">
                          <div className="flex items-center justify-between">
                            <span className="text-xs font-semibold text-slate-500">
                              Option {idx + 1}
                            </span>
                            {proposalRecs.length > 1 && (
                              <button
                                onClick={() => setProposalRecs((prev) => prev.filter((_, i) => i !== idx))}
                                className="text-slate-400 hover:text-red-500"
                              >
                                <X className="h-3.5 w-3.5" />
                              </button>
                            )}
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <div>
                              <label className="mb-1 block text-[10px] font-medium text-slate-600">Label *</label>
                              <input
                                type="text"
                                placeholder="e.g., Best Value"
                                value={rec.label}
                                onChange={(e) => setProposalRecs((prev) => prev.map((r, i) => i === idx ? { ...r, label: e.target.value } : r))}
                                className="block w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                              />
                            </div>
                            <div>
                              <label className="mb-1 block text-[10px] font-medium text-slate-600">Price / Cost</label>
                              <input
                                type="text"
                                placeholder="e.g., ~75,000 pts + $56 taxes"
                                value={rec.priceSummary}
                                onChange={(e) => setProposalRecs((prev) => prev.map((r, i) => i === idx ? { ...r, priceSummary: e.target.value } : r))}
                                className="block w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                              />
                            </div>
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-slate-600">Why this option *</label>
                            <textarea
                              rows={2}
                              placeholder="This uses your AA miles at 1.8¢ each and books the Flagship Business cabin..."
                              value={rec.whyThisOption}
                              onChange={(e) => setProposalRecs((prev) => prev.map((r, i) => i === idx ? { ...r, whyThisOption: e.target.value } : r))}
                              className="block w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                            />
                          </div>
                          <div>
                            <label className="mb-1 block text-[10px] font-medium text-slate-600">
                              Tradeoffs <span className="font-normal text-slate-400">(one per line, optional)</span>
                            </label>
                            <textarea
                              rows={2}
                              placeholder={"Requires connecting in Dallas\nLimited award space — book soon"}
                              value={rec.tradeoffs}
                              onChange={(e) => setProposalRecs((prev) => prev.map((r, i) => i === idx ? { ...r, tradeoffs: e.target.value } : r))}
                              className="block w-full rounded-md border border-slate-200 bg-white px-2.5 py-1.5 text-xs placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Submit */}
                  <div className="flex gap-2 pt-1">
                    <button
                      onClick={async () => {
                        const trip = trips.find((t) => t.id === proposalTripId);
                        if (!trip || !client) return;
                        const validRecs = proposalRecs.filter((r) => r.label.trim() && r.whyThisOption.trim());
                        if (validRecs.length === 0) return;
                        setCreatingProposal(true);
                        try {
                          const origins = Array.isArray(trip.originAirports) ? trip.originAirports.join('/') : trip.originAirports;
                          const dests = Array.isArray(trip.destinationAirports) ? trip.destinationAirports.join('/') : trip.destinationAirports;
                          const result = await proposalsAPI.create({
                            tripId: trip.id,
                            clientId: client.id,
                            clientName: `${client.firstName} ${client.lastName}`,
                            advisorNote: proposalNote,
                            tripSummary: proposalSummary,
                            recommendations: validRecs.map((r, i) => ({
                              category: i === 0 ? 'recommended' : 'alternative',
                              label: r.label,
                              route_summary: `${origins} → ${dests}`,
                              price_summary: r.priceSummary,
                              why_this_option: r.whyThisOption,
                              tradeoffs: r.tradeoffs.split('\n').map((s) => s.trim()).filter(Boolean),
                              risks: [],
                              flights: [],
                            })),
                          });
                          const shareUrl = (result as Record<string, unknown>).share_url as string | undefined;
                          if (shareUrl) {
                            setProposalResult({ shareUrl });
                          }
                        } catch (err) {
                          console.error('Failed to create proposal:', err);
                        } finally {
                          setCreatingProposal(false);
                        }
                      }}
                      disabled={creatingProposal || proposalRecs.every((r) => !r.label.trim() || !r.whyThisOption.trim())}
                      className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {creatingProposal ? (
                        <>
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Creating...
                        </>
                      ) : (
                        <>
                          <Send className="h-4 w-4" />
                          Create Proposal
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => { setProposalTripId(null); setProposalResult(null); }}
                      className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                    >
                      Cancel
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>
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
