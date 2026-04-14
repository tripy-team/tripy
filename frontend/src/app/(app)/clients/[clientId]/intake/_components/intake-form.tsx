'use client';

import { useState, useCallback, useEffect, useRef } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Save,
  Plane,
  Hotel,
  Heart,
  Utensils,
  Accessibility,
  ShieldAlert,
  Users,
  Sparkles,
  Send,
  Bot,
  Plus,
  X,
  ChevronDown,
} from 'lucide-react';
import type { Client, ClientIntake } from '@/lib/api-client';
import {
  TextInputWithExtraction,
  type ConfirmedToken,
} from '@/components/TextInputWithExtraction';

const EXTRACTABLE_FIELDS = [
  'diningPreferences',
  'accessibilityNeeds',
  'dietaryNeeds',
  'notes',
] as const;
type ExtractableField = (typeof EXTRACTABLE_FIELDS)[number];

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CABIN_OPTIONS = [
  { value: 'economy', label: 'Economy' },
  { value: 'premium_economy', label: 'Premium Economy' },
  { value: 'business', label: 'Business' },
  { value: 'first', label: 'First' },
  { value: 'flexible', label: 'Flexible' },
];

const HOTEL_STYLES = [
  'Boutique',
  'Resort',
  'Major Chain',
  'All-Inclusive',
  'Vacation Rental / Airbnb',
  'Villa / Private',
  'Eco-Lodge',
  'Hostel / Budget',
  'Luxury / 5-Star',
  'Bed & Breakfast',
];

const PACE_OPTIONS = [
  { value: 'relaxed', label: 'Relaxed — Plenty of downtime' },
  { value: 'moderate', label: 'Moderate — Mix of activities and rest' },
  { value: 'active', label: 'Active — Packed mornings, relaxed evenings' },
  { value: 'packed', label: 'Packed — Go-go-go, see everything' },
];

const LAYOVER_OPTIONS = [
  { value: 'nonstop_only', label: 'Nonstop only' },
  { value: 'prefer_nonstop', label: 'Prefer nonstop' },
  { value: 'no_preference', label: 'No preference' },
  { value: 'layovers_ok', label: 'Layovers fine if cheaper' },
];

const LUXURY_OPTIONS = [
  { value: 'luxury', label: 'Luxury — No expense spared' },
  { value: 'upscale', label: 'Upscale — Treat ourselves' },
  { value: 'balanced', label: 'Balanced — Smart splurges' },
  { value: 'value', label: 'Value — Best bang for buck' },
  { value: 'budget', label: 'Budget — Keep costs minimal' },
];

const EXPERIENCE_SUGGESTIONS = [
  'Beach & Relaxation',
  'Fine Dining',
  'Cultural / Historical Sites',
  'Wildlife / Safari',
  'Skiing / Snow Sports',
  'Scuba Diving / Snorkeling',
  'Spa & Wellness',
  'Nightlife',
  'Hiking / Nature',
  'City Exploration',
  'Wine / Food Tours',
  'Shopping',
  'Water Sports',
  'Photography',
  'Family Activities',
  'Art & Museums',
  'Festivals / Events',
  'Road Trips',
];

const PARTY_TYPE_OPTIONS = [
  { value: 'solo', label: 'Solo' },
  { value: 'couple', label: 'Couple' },
  { value: 'family', label: 'Family with Kids' },
  { value: 'extended_family', label: 'Extended Family' },
  { value: 'group', label: 'Group of Friends' },
  { value: 'mixed', label: 'Varies by Trip' },
];

const REPOSITION_OPTIONS = [
  { value: 'yes', label: 'Yes — happy to reposition for better value' },
  { value: 'maybe', label: 'Maybe — open if savings are significant' },
  { value: 'no', label: 'No — prefer departing from home airport' },
];

const ACTIVITY_OPTIONS = [
  { value: 'low', label: 'Low — mostly relaxation, minimal walking' },
  { value: 'medium', label: 'Medium — mix of activities and downtime' },
  { value: 'high', label: 'High — active days, physical activities welcome' },
];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntakeFormProps {
  client: Client;
  initialData?: Partial<ClientIntake>;
  intakeId?: string;
  isNew?: boolean;
  saving: boolean;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onComplete?: (data: Record<string, unknown>) => Promise<void>;
  onAnalyzed?: () => void;
  onCancel: () => void;
}

interface StepDef {
  id: string;
  label: string;
  icon: React.ElementType;
}

interface LoyaltyEntry {
  program: string;
  points: string;
}

const LOYALTY_PROGRAM_OPTIONS: { group: string; options: string[] }[] = [
  {
    group: 'Credit Card Rewards',
    options: [
      'Chase Ultimate Rewards',
      'Amex Membership Rewards',
      'Citi ThankYou Points',
      'Capital One Miles',
      'Bilt Rewards',
      'Bank of America Points',
      'Wells Fargo Points',
      'Discover Miles',
      'US Bank Rewards',
    ],
  },
  {
    group: 'Airlines',
    options: [
      'United MileagePlus',
      'American AAdvantage',
      'Delta SkyMiles',
      'Southwest Rapid Rewards',
      'JetBlue TrueBlue',
      'Alaska Mileage Plan',
      'British Airways Avios',
      'Virgin Atlantic Flying Club',
      'Air France-KLM Flying Blue',
      'Singapore KrisFlyer',
      'ANA Mileage Club',
      'Aeroplan',
      'Avianca LifeMiles',
      'Emirates Skywards',
    ],
  },
  {
    group: 'Hotels',
    options: [
      'Marriott Bonvoy',
      'Hilton Honors',
      'World of Hyatt',
      'IHG One Rewards',
    ],
  },
];

function LoyaltyProgramCombobox({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = LOYALTY_PROGRAM_OPTIONS.map((g) => ({
    group: g.group,
    options: q ? g.options.filter((o) => o.toLowerCase().includes(q)) : g.options,
  })).filter((g) => g.options.length > 0);

  return (
    <div ref={rootRef} className="relative flex-1">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={`flex w-full items-center justify-between rounded-lg border bg-white px-3 py-2.5 text-left text-sm shadow-sm transition-colors ${
          open
            ? 'border-transparent ring-2 ring-blue-600'
            : 'border-slate-200 hover:border-slate-300'
        } ${value ? 'text-slate-900' : 'text-slate-400'}`}
      >
        <span className="truncate">{value || 'Select a program…'}</span>
        <ChevronDown
          className={`ml-2 h-4 w-4 shrink-0 text-slate-400 transition-transform ${
            open ? 'rotate-180' : ''
          }`}
        />
      </button>

      {open && (
        <div className="absolute left-0 right-0 top-full z-20 mt-1.5 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg">
          <div className="border-b border-slate-100 p-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search programs…"
              className="block w-full rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 ? (
              <p className="px-3 py-4 text-center text-xs text-slate-400">
                No programs found
              </p>
            ) : (
              filtered.map((g) => (
                <div key={g.group}>
                  <p className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
                    {g.group}
                  </p>
                  {g.options.map((opt) => {
                    const selected = opt === value;
                    return (
                      <button
                        key={opt}
                        type="button"
                        onClick={() => {
                          onChange(opt);
                          setOpen(false);
                          setQuery('');
                        }}
                        className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors ${
                          selected
                            ? 'bg-blue-50 text-blue-700'
                            : 'text-slate-700 hover:bg-slate-50'
                        }`}
                      >
                        <span>{opt}</span>
                        {selected && <Check className="h-4 w-4 text-blue-600" />}
                      </button>
                    );
                  })}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export interface ChatMessage {
  role: 'assistant' | 'advisor';
  content: string;
  timestamp: string;
}

const STEPS: StepDef[] = [
  { id: 'traveler', label: 'About the Traveler', icon: Users },
  { id: 'flights', label: 'Flight Preferences', icon: Plane },
  { id: 'accommodation', label: 'Accommodation', icon: Hotel },
  { id: 'experiences', label: 'Experiences & Interests', icon: Heart },
  { id: 'needs', label: 'Accessibility', icon: Accessibility },
  { id: 'dealbreakers', label: 'Dealbreakers', icon: ShieldAlert },
  { id: 'chat', label: 'AI Discovery', icon: Sparkles },
];

type FormData = Record<string, unknown>;

function toFormData(intake?: Partial<ClientIntake>): FormData {
  if (!intake) return {};
  const d: FormData = {};
  const keys: (keyof ClientIntake)[] = [
    'cabinPreference', 'hotelStyles', 'loyaltyNotes',
    'accessibilityNeeds', 'dietaryNeeds',
    'travelPace', 'layoverTolerance', 'luxuryPreference',
    'familyFriendly', 'travelerCount', 'childrenCount', 'childrenAges',
    'desiredExperiences', 'dealbreakers', 'preferredAirlines', 'avoidedAirlines',
    'departureAirports',
    'notes', 'isTemplate', 'templateName',
  ];
  for (const k of keys) {
    if (intake[k] !== undefined && intake[k] !== null) {
      d[k] = intake[k];
    }
  }
  return d;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function IntakeForm({
  client,
  initialData,
  intakeId,
  isNew,
  saving,
  onSave,
  onComplete,
  onAnalyzed,
  onCancel,
}: IntakeFormProps) {
  const [analyzing, setAnalyzing] = useState(false);
  const [analyzeError, setAnalyzeError] = useState<string | null>(null);
  const [step, setStep] = useState(0);
  const [visitedNeeds, setVisitedNeeds] = useState(false);
  useEffect(() => {
    if (STEPS[step]?.id === 'needs') setVisitedNeeds(true);
  }, [step]);
  const topRef = useRef<HTMLDivElement>(null);
  const [form, setForm] = useState<FormData>(() => toFormData(initialData));
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [autoSaveTimer, setAutoSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  const [confirmedTokens, setConfirmedTokens] = useState<
    Record<ExtractableField, ConfirmedToken[]>
  >({
    diningPreferences: [],
    accessibilityNeeds: [],
    dietaryNeeds: [],
    notes: [],
  });
  const [dirtyExtractFields, setDirtyExtractFields] = useState<Set<ExtractableField>>(
    new Set(),
  );
  const lastExtractedText = useRef<Record<ExtractableField, string>>({
    diningPreferences: '',
    accessibilityNeeds: '',
    dietaryNeeds: '',
    notes: '',
  });
  const [extractingFields, setExtractingFields] = useState<Set<ExtractableField>>(
    new Set(),
  );

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const set = useCallback((key: string, value: unknown) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

  const setExtractableField = useCallback(
    (key: ExtractableField, value: string) => {
      set(key, value);
      setDirtyExtractFields((prev) => {
        if (value === lastExtractedText.current[key]) {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        }
        if (prev.has(key)) return prev;
        const next = new Set(prev);
        next.add(key);
        return next;
      });
    },
    [set],
  );

  const toggleArrayItem = useCallback((key: string, item: string) => {
    setForm((f) => {
      const arr = (f[key] as string[]) || [];
      return {
        ...f,
        [key]: arr.includes(item) ? arr.filter((v) => v !== item) : [...arr, item],
      };
    });
  }, []);

  // Loyalty entries state — parsed from loyaltyNotes on init, serialized back on change
  const [loyaltyEntries, setLoyaltyEntries] = useState<LoyaltyEntry[]>(() => {
    try {
      const parsed = JSON.parse((initialData?.loyaltyNotes as string) || '');
      if (parsed?.entries && Array.isArray(parsed.entries)) return parsed.entries;
    } catch {}
    return [];
  });
  const [loyaltyFreeText, setLoyaltyFreeText] = useState<string>(() => {
    try {
      const parsed = JSON.parse((initialData?.loyaltyNotes as string) || '');
      if (parsed?.entries) return parsed.freeText || '';
    } catch {}
    return (initialData?.loyaltyNotes as string) || '';
  });

  const syncLoyaltyToForm = useCallback((entries: LoyaltyEntry[], freeText: string) => {
    const value = (entries.length > 0 || freeText)
      ? JSON.stringify({ entries, freeText })
      : '';
    set('loyaltyNotes', value);
  }, [set]);

  // Autosave (debounced 3s after edits, only for existing intakes)
  useEffect(() => {
    if (isNew || !onSave) return;
    if (autoSaveTimer) clearTimeout(autoSaveTimer);
    const timer = setTimeout(async () => {
      try {
        await onSave(formRef.current);
        setLastSaved(new Date());
      } catch { /* silent */ }
    }, 3000);
    setAutoSaveTimer(timer);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, isNew]);

  // Scroll chat to bottom when new messages arrive
  useEffect(() => {
    chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatMessages]);

  const handleManualSave = async () => {
    await onSave(form);
    setLastSaved(new Date());
  };

  const handleComplete = async () => {
    if (onComplete) {
      await onComplete(form);
    }
  };

  const handleAnalyze = async () => {
    if (!intakeId || analyzing) return;
    setAnalyzing(true);
    setAnalyzeError(null);
    try {
      if (onSave) {
        try { await onSave(form); } catch { /* autosave will retry */ }
      }
      const res = await fetch(`/api/clients/${client.id}/intakes/${intakeId}/analyze`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ intakeData: form, chatTranscript: chatMessages }),
      });
      if (!res.ok) throw new Error('Failed to analyze intake');
      if (onAnalyzed) onAnalyzed();
      else if (onComplete) await onComplete(form);
    } catch (err) {
      console.error('[IntakeForm] analyze failed', err);
      setAnalyzeError('Unable to analyze right now. Please try again.');
    } finally {
      setAnalyzing(false);
    }
  };

  // ---------------------------------------------------------------------------
  // Chat handlers
  // ---------------------------------------------------------------------------

  const getAuthHeaders = (): Record<string, string> => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('tripy_token') : null;
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (token) headers['Authorization'] = `Bearer ${token}`;
    return headers;
  };

  const startChat = async () => {
    if (!intakeId) return;
    setChatLoading(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/intakes/${intakeId}/chat/start`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({ intakeData: form }),
      });
      if (!res.ok) throw new Error('Failed to start chat');
      const data = await res.json();
      setChatMessages(data.messages ?? []);
      setChatStarted(true);
    } catch {
      setChatMessages([{
        role: 'assistant',
        content: 'Unable to connect to the AI discovery assistant. Please save the profile and try again.',
        timestamp: new Date().toISOString(),
      }]);
      setChatStarted(true);
    } finally {
      setChatLoading(false);
    }
  };

  const sendChatMessage = async () => {
    const text = chatInput.trim();
    if (!text || chatLoading || !intakeId) return;

    const advisorMsg: ChatMessage = {
      role: 'advisor',
      content: text,
      timestamp: new Date().toISOString(),
    };
    setChatMessages((prev) => [...prev, advisorMsg]);
    setChatInput('');
    setChatLoading(true);

    try {
      const res = await fetch(`/api/clients/${client.id}/intakes/${intakeId}/chat/message`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          advisorMessage: text,
          messageHistory: [...chatMessages, advisorMsg],
          intakeData: form,
        }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      const data = await res.json();
      setChatMessages((prev) => [...prev, data.message]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Something went wrong. Please try again.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const generateMoreQuestions = async () => {
    if (chatLoading || !intakeId) return;
    setChatLoading(true);
    try {
      const res = await fetch(`/api/clients/${client.id}/intakes/${intakeId}/chat/message`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          advisorMessage: '',
          messageHistory: chatMessages,
          intakeData: form,
          generateOnly: true,
        }),
      });
      if (!res.ok) throw new Error('Failed to generate questions');
      const data = await res.json();
      setChatMessages((prev) => [...prev, data.message]);
    } catch {
      setChatMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: 'Unable to generate more questions right now. Please try again.',
          timestamp: new Date().toISOString(),
        },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  const runExtraction = useCallback(async () => {
    const fieldsToSend: ExtractableField[] = Array.from(dirtyExtractFields).filter(
      (k) => ((formRef.current[k] as string) || '').trim().length > 0,
    );
    if (fieldsToSend.length === 0) {
      if (dirtyExtractFields.size > 0) setDirtyExtractFields(new Set());
      return;
    }

    setExtractingFields(new Set(fieldsToSend));
    try {
      const res = await fetch(
        `/api/clients/${client.id}/extract-text-inferences`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({
            fields: fieldsToSend.map((k) => ({
              fieldName: k,
              text: (formRef.current[k] as string) || '',
            })),
          }),
        },
      );
      if (!res.ok) throw new Error('extract failed');
      const data = (await res.json()) as {
        tokensByField: Record<string, { token: string; category: string }[]>;
      };

      setConfirmedTokens((prev) => {
        const next = { ...prev };
        for (const k of fieldsToSend) {
          const incoming = data.tokensByField?.[k] ?? [];
          const merged = new Map<string, string>();
          for (const t of prev[k]) merged.set(t.token, t.category);
          for (const t of incoming) merged.set(t.token, t.category);
          next[k] = Array.from(merged, ([token, category]) => ({
            token,
            category,
          }));
        }
        return next;
      });
      for (const k of fieldsToSend) {
        lastExtractedText.current[k] = (formRef.current[k] as string) || '';
      }
      setDirtyExtractFields((prev) => {
        const next = new Set(prev);
        for (const k of fieldsToSend) next.delete(k);
        return next;
      });
    } catch {
      // Silent — chips stay pending; editing again will retry.
    } finally {
      setExtractingFields(new Set());
    }
  }, [dirtyExtractFields, client.id]);

  const canGoNext = step < STEPS.length - 1;
  const canGoPrev = step > 0;

  const goNext = () => {
    if (!canGoNext) return;
    void runExtraction();
    setStep((s) => s + 1);
  };
  const goPrev = () => canGoPrev && setStep((s) => s - 1);

  useEffect(() => {
    topRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [step]);

  const isCompleted = initialData?.status === 'complete';
  const hasFamilyMembers =
    (form.partyType as string) === 'family' || (form.partyType as string) === 'extended_family';

  // Helper class shorthands
  const inputCls =
    'block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white';
  const labelCls = 'mb-1.5 block text-sm font-medium text-slate-700';
  const chipCls = (active: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'border-blue-600 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
    }`;
  const radioRowCls = (active: boolean) =>
    `flex w-full items-center rounded-lg border px-4 py-3 text-left text-sm transition-colors cursor-pointer ${
      active
        ? 'border-blue-600 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
    }`;

  // ---------------------------------------------------------------------------
  // Step renderers
  // ---------------------------------------------------------------------------

  const renderStep = () => {
    switch (STEPS[step].id) {

      // ── Step 1: About the Traveler ─────────────────────────────────────────
      case 'traveler':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Who typically travels with this client?</label>
              <div className="flex flex-wrap gap-2">
                {PARTY_TYPE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => set('partyType', opt.value)}
                    className={chipCls(form.partyType === opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            {hasFamilyMembers && (
              <div>
                <label className={labelCls}>Children&apos;s Ages (comma-separated)</label>
                <input
                  type="text"
                  value={((form.childrenAges as number[]) || []).join(', ')}
                  onChange={(e) =>
                    set(
                      'childrenAges',
                      e.target.value
                        .split(',')
                        .map((v) => parseInt(v.trim()))
                        .filter((v) => !isNaN(v)),
                    )
                  }
                  placeholder="e.g. 4, 7, 12"
                  className={inputCls}
                />
              </div>
            )}

            <div>
              <label className={labelCls}>Typical pace of travel</label>
              <div className="space-y-2">
                {PACE_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => set('travelPace', p.value)}
                    className={radioRowCls(form.travelPace === p.value)}
                  >
                    {form.travelPace === p.value && (
                      <Check className="mr-2 h-4 w-4 text-blue-600" />
                    )}
                    {p.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Luxury vs. Value orientation</label>
              <div className="space-y-2">
                {LUXURY_OPTIONS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => set('luxuryPreference', l.value)}
                    className={radioRowCls(form.luxuryPreference === l.value)}
                  >
                    {form.luxuryPreference === l.value && (
                      <Check className="mr-2 h-4 w-4 text-blue-600" />
                    )}
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={(form.familyFriendly as boolean) || false}
                  onChange={(e) => set('familyFriendly', e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                Prioritize family-friendly options
              </label>
              <p className="ml-6 mt-1 text-xs text-slate-400">
                Kid-friendly venues, activities, and scheduling
              </p>
            </div>
          </div>
        );

      // ── Step 2: Flight Preferences ─────────────────────────────────────────
      case 'flights':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Preferred cabin class</label>
              <div className="flex flex-wrap gap-2">
                {CABIN_OPTIONS.map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    onClick={() => set('cabinPreference', c.value)}
                    className={chipCls(form.cabinPreference === c.value)}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Layover preference</label>
              <div className="flex flex-wrap gap-2">
                {LAYOVER_OPTIONS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => set('layoverTolerance', l.value)}
                    className={chipCls(form.layoverTolerance === l.value)}
                  >
                    {l.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Home / preferred departure airports</label>
              <input
                type="text"
                value={((form.departureAirports as string[]) || []).join(', ')}
                onChange={(e) =>
                  set(
                    'departureAirports',
                    e.target.value
                      .split(',')
                      .map((v) => v.trim().toUpperCase())
                      .filter(Boolean),
                  )
                }
                placeholder="e.g. JFK, EWR, LGA"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-400">IATA codes, separated by commas</p>
            </div>

            <div>
              <label className={labelCls}>Willing to reposition for a better deal?</label>
              <div className="space-y-2">
                {REPOSITION_OPTIONS.map((r) => (
                  <button
                    key={r.value}
                    type="button"
                    onClick={() => set('willingToReposition', r.value)}
                    className={radioRowCls(form.willingToReposition === r.value)}
                  >
                    {form.willingToReposition === r.value && (
                      <Check className="mr-2 h-4 w-4 text-blue-600" />
                    )}
                    {r.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Preferred airlines</label>
              <input
                type="text"
                value={((form.preferredAirlines as string[]) || []).join(', ')}
                onChange={(e) =>
                  set(
                    'preferredAirlines',
                    e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="e.g. United, Delta, Singapore"
                className={inputCls}
              />
            </div>

            <div>
              <label className={labelCls}>Airlines to avoid</label>
              <input
                type="text"
                value={((form.avoidedAirlines as string[]) || []).join(', ')}
                onChange={(e) =>
                  set(
                    'avoidedAirlines',
                    e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="e.g. Spirit, Frontier"
                className={inputCls}
              />
            </div>
          </div>
        );

      // ── Step 3: Accommodation ──────────────────────────────────────────────
      case 'accommodation':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Hotel / accommodation style</label>
              <p className="mb-3 text-xs text-slate-400">Select all that apply</p>
              <div className="flex flex-wrap gap-2">
                {HOTEL_STYLES.map((style) => (
                  <button
                    key={style}
                    type="button"
                    onClick={() => toggleArrayItem('hotelStyles', style)}
                    className={chipCls(((form.hotelStyles as string[]) || []).includes(style))}
                  >
                    {style}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Loyalty Programs &amp; Point Balances</label>
              <p className="mb-3 text-xs text-slate-400">
                Enter each loyalty program membership and current point balance
              </p>

              {loyaltyEntries.length > 0 && (
                <div className="mb-3 space-y-2">
                  {loyaltyEntries.map((entry, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <LoyaltyProgramCombobox
                        value={entry.program}
                        onChange={(v) => {
                          const updated = loyaltyEntries.map((r, i) =>
                            i === idx ? { ...r, program: v } : r,
                          );
                          setLoyaltyEntries(updated);
                          syncLoyaltyToForm(updated, loyaltyFreeText);
                        }}
                      />
                      <input
                        type="number"
                        value={entry.points}
                        onChange={(e) => {
                          const updated = loyaltyEntries.map((r, i) =>
                            i === idx ? { ...r, points: e.target.value } : r,
                          );
                          setLoyaltyEntries(updated);
                          syncLoyaltyToForm(updated, loyaltyFreeText);
                        }}
                        placeholder="Points"
                        min="0"
                        className="w-36 rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-right text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const updated = loyaltyEntries.filter((_, i) => i !== idx);
                          setLoyaltyEntries(updated);
                          syncLoyaltyToForm(updated, loyaltyFreeText);
                        }}
                        className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                      >
                        <X className="h-4 w-4" />
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <button
                type="button"
                onClick={() => {
                  const updated = [...loyaltyEntries, { program: '', points: '' }];
                  setLoyaltyEntries(updated);
                  syncLoyaltyToForm(updated, loyaltyFreeText);
                }}
                className="inline-flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Add loyalty program
              </button>

              <div className="mt-4">
                <label className={labelCls}>Additional loyalty notes</label>
                <textarea
                  rows={2}
                  value={loyaltyFreeText}
                  onChange={(e) => {
                    setLoyaltyFreeText(e.target.value);
                    syncLoyaltyToForm(loyaltyEntries, e.target.value);
                  }}
                  placeholder="e.g. Prefers Hyatt properties, willing to transfer Chase points, Marriott Bonvoy Platinum status..."
                  className={`resize-none ${inputCls}`}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Accommodation brands / chains to avoid</label>
              <div className="space-y-2">
                {((form.accommodationDealbreakers as string[]) || []).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="flex-1 rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-sm text-amber-700">
                      {item}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          accommodationDealbreakers: (
                            (f.accommodationDealbreakers as string[]) || []
                          ).filter((_, i) => i !== idx),
                        }))
                      }
                      className="rounded p-1 text-amber-400 hover:bg-amber-50 hover:text-amber-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <input
                type="text"
                placeholder="Type a brand to avoid and press Enter..."
                className={`mt-2 ${inputCls}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      setForm((f) => ({
                        ...f,
                        accommodationDealbreakers: [
                          ...((f.accommodationDealbreakers as string[]) || []),
                          val,
                        ],
                      }));
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }}
              />
              <p className="mt-1 text-xs text-slate-400">Press Enter to add</p>
            </div>
          </div>
        );

      // ── Step 4: Experiences & Interests ───────────────────────────────────
      case 'experiences':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>What do they enjoy on trips?</label>
              <p className="mb-3 text-xs text-slate-400">Select all that interest the traveler, or add custom ones below</p>
              <div className="flex flex-wrap gap-2">
                {EXPERIENCE_SUGGESTIONS.map((exp) => (
                  <button
                    key={exp}
                    type="button"
                    onClick={() => toggleArrayItem('desiredExperiences', exp)}
                    className={chipCls(((form.desiredExperiences as string[]) || []).includes(exp))}
                  >
                    {exp}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className={labelCls}>Custom interests</label>
              <input
                type="text"
                placeholder="Add more, comma-separated, then press Enter..."
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      const items = val.split(',').map((v) => v.trim()).filter(Boolean);
                      setForm((f) => ({
                        ...f,
                        desiredExperiences: [
                          ...((f.desiredExperiences as string[]) || []),
                          ...items.filter(
                            (i) => !((f.desiredExperiences as string[]) || []).includes(i),
                          ),
                        ],
                      }));
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }}
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-400">Press Enter to add</p>
            </div>

            <div>
              <label className={labelCls}>
                <Utensils className="mr-1 inline h-4 w-4 text-slate-400" />
                Dining preferences
              </label>
              <TextInputWithExtraction
                multiline
                rows={2}
                fieldName="diningPreferences"
                value={(form.diningPreferences as string) || ''}
                onChange={(v) => setExtractableField('diningPreferences', v)}
                placeholder="e.g. Loves local street food, always wants a Michelin-starred meal, avoids chains..."
                confirmedTokens={confirmedTokens.diningPreferences}
                extracting={extractingFields.has('diningPreferences')}
                inputClassName={`resize-none ${inputCls}`}
                labelClassName={labelCls}
              />
            </div>

            <div>
              <label className={labelCls}>Physical activity level</label>
              <div className="space-y-2">
                {ACTIVITY_OPTIONS.map((a) => (
                  <button
                    key={a.value}
                    type="button"
                    onClick={() => set('activityLevel', a.value)}
                    className={radioRowCls(form.activityLevel === a.value)}
                  >
                    {form.activityLevel === a.value && (
                      <Check className="mr-2 h-4 w-4 text-blue-600" />
                    )}
                    {a.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );

      // ── Step 5: Special Needs & Constraints ───────────────────────────────
      case 'needs':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>
                <Accessibility className="mr-1 inline h-4 w-4 text-slate-400" />
                Accessibility needs
              </label>
              <TextInputWithExtraction
                multiline
                rows={3}
                fieldName="accessibilityNeeds"
                value={(form.accessibilityNeeds as string) || ''}
                onChange={(v) => setExtractableField('accessibilityNeeds', v)}
                placeholder="e.g. Wheelchair accessible rooms, ground-floor only, elevator access required..."
                confirmedTokens={confirmedTokens.accessibilityNeeds}
                extracting={extractingFields.has('accessibilityNeeds')}
                inputClassName={`resize-none ${inputCls}`}
                labelClassName={labelCls}
              />
            </div>

            <div>
              <label className={labelCls}>
                <Utensils className="mr-1 inline h-4 w-4 text-slate-400" />
                Dietary restrictions
              </label>
              <TextInputWithExtraction
                multiline
                rows={2}
                fieldName="dietaryNeeds"
                value={(form.dietaryNeeds as string) || ''}
                onChange={(v) => setExtractableField('dietaryNeeds', v)}
                placeholder="e.g. Gluten-free, vegetarian, nut allergy, kosher, halal..."
                confirmedTokens={confirmedTokens.dietaryNeeds}
                extracting={extractingFields.has('dietaryNeeds')}
                inputClassName={`resize-none ${inputCls}`}
                labelClassName={labelCls}
              />
            </div>

            <div>
              <label className={labelCls}>Hard constraints</label>
              <p className="mb-2 text-xs text-slate-400">
                Non-negotiable travel conditions (e.g. &quot;no red-eyes&quot;, &quot;max 14-hour travel day&quot;)
              </p>
              <div className="space-y-2">
                {((form.hardConstraints as string[]) || []).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                      {item}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          hardConstraints: (
                            (f.hardConstraints as string[]) || []
                          ).filter((_, i) => i !== idx),
                        }))
                      }
                      className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <input
                type="text"
                placeholder="Type a constraint and press Enter..."
                className={`mt-2 ${inputCls}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      setForm((f) => ({
                        ...f,
                        hardConstraints: [...((f.hardConstraints as string[]) || []), val],
                      }));
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }}
              />
              <p className="mt-1 text-xs text-slate-400">Press Enter to add</p>
            </div>

            <div>
              <label className={labelCls}>Advisor notes</label>
              <TextInputWithExtraction
                multiline
                rows={3}
                fieldName="notes"
                value={(form.notes as string) || ''}
                onChange={(v) => setExtractableField('notes', v)}
                placeholder="Anything else worth remembering — special occasions they celebrate, surprise preferences, past feedback..."
                confirmedTokens={confirmedTokens.notes}
                extracting={extractingFields.has('notes')}
                inputClassName={`resize-none ${inputCls}`}
                labelClassName={labelCls}
              />
            </div>

          </div>
        );

      // ── Step 6: Dealbreakers ───────────────────────────────────────────────
      case 'dealbreakers':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>
                <ShieldAlert className="mr-1 inline h-4 w-4 text-red-400" />
                Dealbreakers / Do-Not-Book
              </label>
              <p className="mb-3 text-xs text-slate-400">
                Airlines, hotels, destinations, or conditions this client absolutely does not want —
                these apply across all future trips
              </p>
              <div className="space-y-2">
                {((form.dealbreakers as string[]) || []).map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2">
                    <span className="flex-1 rounded-lg border border-red-100 bg-red-50 px-3 py-2 text-sm text-red-700">
                      {item}
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          dealbreakers: (
                            (f.dealbreakers as string[]) || []
                          ).filter((_, i) => i !== idx),
                        }))
                      }
                      className="rounded p-1 text-red-400 hover:bg-red-50 hover:text-red-600"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
              <input
                type="text"
                placeholder="Type a dealbreaker and press Enter..."
                className={`mt-2 ${inputCls}`}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (e.target as HTMLInputElement).value.trim();
                    if (val) {
                      setForm((f) => ({
                        ...f,
                        dealbreakers: [...((f.dealbreakers as string[]) || []), val],
                      }));
                      (e.target as HTMLInputElement).value = '';
                    }
                  }
                }}
              />
              <p className="mt-1 text-xs text-slate-400">Press Enter to add</p>
            </div>
          </div>
        );

      // ── Step 7: AI Discovery Chat ──────────────────────────────────────────
      case 'chat':
        return (
          <div className="space-y-5">
            <div className="rounded-xl border border-blue-100 bg-blue-50 p-4">
              <p className="text-sm text-blue-800">
                <Bot className="mr-1.5 inline h-4 w-4" />
                <strong>AI Discovery Assistant</strong> — Based on the profile you&apos;ve built,
                the AI will generate follow-up questions for you to ask your client. Type their
                answers and the AI will refine its questions in real time.
              </p>
            </div>

            {!chatStarted ? (
              <div className="flex flex-col items-center gap-4 py-10">
                <Sparkles className="h-10 w-10 text-blue-300" />
                <p className="text-center text-sm text-slate-500">
                  Ready to generate personalized discovery questions
                  <br />
                  based on {client.firstName}&apos;s profile so far.
                </p>
                {!intakeId ? (
                  <p className="text-xs text-amber-600">
                    Save the profile draft first to enable AI discovery.
                  </p>
                ) : (
                  <button
                    type="button"
                    onClick={startChat}
                    disabled={chatLoading}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {chatLoading ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Sparkles className="h-4 w-4" />
                    )}
                    Generate Discovery Questions
                  </button>
                )}
              </div>
            ) : (
              <div className="flex flex-col gap-4">
                {/* Message thread */}
                <div className="h-80 overflow-y-auto rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-4">
                  {chatMessages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex gap-3 ${msg.role === 'advisor' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100">
                          <Bot className="h-4 w-4 text-blue-600" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap ${
                          msg.role === 'advisor'
                            ? 'rounded-tr-sm bg-blue-600 text-white'
                            : 'rounded-tl-sm bg-white border border-slate-200 text-slate-800'
                        }`}
                      >
                        {msg.content}
                      </div>
                    </div>
                  ))}
                  {chatLoading && (
                    <div className="flex gap-3">
                      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-100">
                        <Bot className="h-4 w-4 text-blue-600" />
                      </div>
                      <div className="rounded-2xl rounded-tl-sm border border-slate-200 bg-white px-4 py-2.5">
                        <Loader2 className="h-4 w-4 animate-spin text-slate-400" />
                      </div>
                    </div>
                  )}
                  <div ref={chatBottomRef} />
                </div>

                {/* Input */}
                <div className="flex gap-2">
                  <textarea
                    rows={2}
                    value={chatInput}
                    onChange={(e) => setChatInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && !e.shiftKey) {
                        e.preventDefault();
                        sendChatMessage();
                      }
                    }}
                    placeholder="Type the client's response here… (Enter to send, Shift+Enter for new line)"
                    className={`flex-1 resize-none ${inputCls}`}
                    disabled={chatLoading}
                  />
                  <button
                    type="button"
                    onClick={sendChatMessage}
                    disabled={chatLoading || !chatInput.trim()}
                    className="self-end rounded-lg bg-blue-600 p-2.5 text-white hover:bg-blue-700 disabled:opacity-40"
                  >
                    <Send className="h-4 w-4" />
                  </button>
                </div>

                <div className="flex items-center justify-between">
                  <p className="text-xs text-slate-400">
                    {chatMessages.filter((m) => m.role === 'advisor').length} response
                    {chatMessages.filter((m) => m.role === 'advisor').length !== 1 ? 's' : ''} recorded
                  </p>
                  <button
                    type="button"
                    onClick={generateMoreQuestions}
                    disabled={chatLoading || chatMessages.filter((m) => m.role === 'advisor').length === 0}
                    title="Generate fresh follow-up questions based on the answers so far"
                    className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-50"
                  >
                    {chatLoading ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="h-3.5 w-3.5" />
                    )}
                    Generate follow-up questions
                  </button>
                </div>
              </div>
            )}
          </div>
        );

      default:
        return null;
    }
  };

  // ---------------------------------------------------------------------------
  // Progress tracking
  // ---------------------------------------------------------------------------

  const filledSteps = STEPS.map((s) => {
    switch (s.id) {
      case 'traveler':
        return !!(form.partyType || form.travelPace || form.luxuryPreference);
      case 'flights':
        return !!(form.cabinPreference || form.layoverTolerance || form.departureAirports);
      case 'accommodation':
        return !!((form.hotelStyles as string[])?.length || form.loyaltyNotes);
      case 'experiences':
        return !!((form.desiredExperiences as string[])?.length);
      case 'needs':
        return (
          visitedNeeds ||
          !!(form.accessibilityNeeds || form.dietaryNeeds || form.notes)
        );
      case 'dealbreakers':
        return !!((form.dealbreakers as string[])?.length);
      case 'chat':
        return chatMessages.filter((m) => m.role === 'advisor').length > 0;
      default:
        return false;
    }
  });

  const completedStepCount = filledSteps.filter(Boolean).length;
  const progressPct = Math.round((completedStepCount / STEPS.length) * 100);

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div ref={topRef} className="max-w-4xl">
      {/* Header */}
      <Link
        href={`/clients/${client.id}?tab=discovery`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {client.firstName} {client.lastName}
      </Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isNew ? 'Build Client Profile' : 'Edit Client Profile'}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {client.firstName} {client.lastName}
            {isCompleted && (
              <span className="ml-2 inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-xs font-medium text-green-700">
                <Check className="mr-1 h-3 w-3" /> Completed
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {lastSaved && (
            <span className="text-xs text-slate-400">
              Saved {lastSaved.toLocaleTimeString()}
            </span>
          )}
          <button
            onClick={handleManualSave}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {isNew ? 'Save Draft' : 'Save'}
          </button>
        </div>
      </div>

      {/* Progress Bar */}
      <div className="mb-6">
        <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
          <span>{completedStepCount} of {STEPS.length} sections filled</span>
          <span>{progressPct}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
          <div
            className="h-full rounded-full bg-blue-600 transition-all duration-500"
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      <div className="flex gap-6">
        {/* Step Sidebar */}
        <nav className="hidden w-56 shrink-0 md:block">
          <div className="space-y-1">
            {STEPS.map((s, i) => {
              const Icon = s.icon;
              const isCurrent = i === step;
              const isFilled = filledSteps[i];
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => setStep(i)}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                    isCurrent
                      ? 'bg-blue-50 text-blue-700'
                      : isFilled
                        ? 'text-slate-700 hover:bg-slate-50'
                        : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                  }`}
                >
                  <Icon
                    className={`h-4 w-4 ${
                      isCurrent ? 'text-blue-600' : isFilled ? 'text-green-500' : 'text-slate-300'
                    }`}
                  />
                  {s.label}
                  {isFilled && !isCurrent && (
                    <Check className="ml-auto h-3.5 w-3.5 text-green-500" />
                  )}
                </button>
              );
            })}
          </div>
        </nav>

        {/* Form Content */}
        <div className="min-w-0 flex-1">
          {/* Mobile step indicator */}
          <div className="mb-4 flex items-center gap-2 md:hidden">
            <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
              {step + 1}/{STEPS.length}
            </span>
            <span className="text-sm font-medium text-slate-700">{STEPS[step].label}</span>
          </div>

          <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
              {(() => {
                const Icon = STEPS[step].icon;
                return <Icon className="h-5 w-5 text-blue-600" />;
              })()}
              {STEPS[step].label}
            </h2>

            {renderStep()}
          </div>

          {/* Navigation */}
          <div className="mt-6 flex items-center justify-between">
            <button
              type="button"
              onClick={goPrev}
              disabled={!canGoPrev}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ArrowLeft className="h-4 w-4" />
              Previous
            </button>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onCancel}
                className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
              >
                Cancel
              </button>

              {step === STEPS.length - 1 && !isCompleted ? (
                <div className="flex flex-col items-end gap-1">
                  <button
                    type="button"
                    onClick={intakeId ? handleAnalyze : handleManualSave}
                    disabled={saving || analyzing}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-60"
                  >
                    {analyzing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    {analyzing ? 'Analyzing…' : 'Analyze'}
                  </button>
                  {analyzeError && <span className="text-xs text-red-600">{analyzeError}</span>}
                </div>
              ) : (
                <button
                  type="button"
                  onClick={goNext}
                  disabled={!canGoNext}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
