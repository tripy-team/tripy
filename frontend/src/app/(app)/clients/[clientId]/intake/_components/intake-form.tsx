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
} from 'lucide-react';
import type { Client, ClientIntake } from '@/lib/api-client';

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
  { id: 'needs', label: 'Special Needs', icon: Accessibility },
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
  onCancel,
}: IntakeFormProps) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<FormData>(() => toFormData(initialData));
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [autoSaveTimer, setAutoSaveTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const formRef = useRef(form);
  formRef.current = form;

  // Chat state
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [chatStarted, setChatStarted] = useState(false);
  const chatBottomRef = useRef<HTMLDivElement>(null);

  const set = useCallback((key: string, value: unknown) => {
    setForm((f) => ({ ...f, [key]: value }));
  }, []);

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

  const canGoNext = step < STEPS.length - 1;
  const canGoPrev = step > 0;

  const goNext = () => canGoNext && setStep((s) => s + 1);
  const goPrev = () => canGoPrev && setStep((s) => s - 1);

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
                      <input
                        type="text"
                        value={entry.program}
                        onChange={(e) => {
                          const updated = loyaltyEntries.map((r, i) =>
                            i === idx ? { ...r, program: e.target.value } : r,
                          );
                          setLoyaltyEntries(updated);
                          syncLoyaltyToForm(updated, loyaltyFreeText);
                        }}
                        placeholder="Program name (e.g. United MileagePlus)"
                        className={`flex-1 ${inputCls}`}
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
              <textarea
                rows={2}
                value={(form.diningPreferences as string) || ''}
                onChange={(e) => set('diningPreferences', e.target.value)}
                placeholder="e.g. Loves local street food, always wants a Michelin-starred meal, avoids chains..."
                className={`resize-none ${inputCls}`}
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
              <textarea
                rows={3}
                value={(form.accessibilityNeeds as string) || ''}
                onChange={(e) => set('accessibilityNeeds', e.target.value)}
                placeholder="e.g. Wheelchair accessible rooms, ground-floor only, elevator access required..."
                className={`resize-none ${inputCls}`}
              />
            </div>

            <div>
              <label className={labelCls}>
                <Utensils className="mr-1 inline h-4 w-4 text-slate-400" />
                Dietary restrictions
              </label>
              <textarea
                rows={2}
                value={(form.dietaryNeeds as string) || ''}
                onChange={(e) => set('dietaryNeeds', e.target.value)}
                placeholder="e.g. Gluten-free, vegetarian, nut allergy, kosher, halal..."
                className={`resize-none ${inputCls}`}
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
              <textarea
                rows={3}
                value={(form.notes as string) || ''}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Anything else worth remembering — special occasions they celebrate, surprise preferences, past feedback..."
                className={`resize-none ${inputCls}`}
              />
            </div>

            <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
              <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={(form.isTemplate as boolean) || false}
                  onChange={(e) => set('isTemplate', e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-600"
                />
                Save as reusable template
              </label>
              {(form.isTemplate as boolean) && (
                <input
                  type="text"
                  value={(form.templateName as string) || ''}
                  onChange={(e) => set('templateName', e.target.value)}
                  placeholder="Template name (e.g. 'Luxury Family Traveler')"
                  className={`mt-3 ${inputCls}`}
                />
              )}
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

                <p className="text-xs text-slate-400">
                  {chatMessages.filter((m) => m.role === 'advisor').length} response
                  {chatMessages.filter((m) => m.role === 'advisor').length !== 1 ? 's' : ''} recorded
                </p>
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
        return !!(form.accessibilityNeeds || form.dietaryNeeds || form.notes);
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
    <div className="max-w-4xl">
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

              {step === STEPS.length - 1 && onComplete && !isCompleted ? (
                <button
                  type="button"
                  onClick={handleComplete}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-green-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-green-700 disabled:opacity-60"
                >
                  {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-4 w-4" />}
                  Complete Profile
                </button>
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
