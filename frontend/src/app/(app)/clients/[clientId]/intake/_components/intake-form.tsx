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
  MapPin,
  Calendar,
  DollarSign,
  Hotel,
  Heart,
  Utensils,
  Accessibility,
  Zap,
  ShieldAlert,
  StickyNote,
} from 'lucide-react';
import type { Client, ClientIntake } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TRIP_TYPES = [
  { value: 'leisure', label: 'Leisure' },
  { value: 'business_travel', label: 'Business Travel' },
  { value: 'honeymoon', label: 'Honeymoon' },
  { value: 'family_vacation', label: 'Family Vacation' },
  { value: 'adventure', label: 'Adventure' },
  { value: 'luxury_getaway', label: 'Luxury Getaway' },
  { value: 'group_trip', label: 'Group Trip' },
  { value: 'destination_wedding', label: 'Destination Wedding' },
  { value: 'solo', label: 'Solo Travel' },
  { value: 'other', label: 'Other' },
];

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

const DATE_FLEXIBILITY = [
  { value: 'exact', label: 'Exact dates' },
  { value: 'flexible_1_2_days', label: '± 1–2 days' },
  { value: 'flexible_week', label: '± 1 week' },
  { value: 'flexible_month', label: '± 1 month' },
  { value: 'fully_flexible', label: 'Fully flexible' },
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

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface IntakeFormProps {
  client: Client;
  initialData?: Partial<ClientIntake>;
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

const STEPS: StepDef[] = [
  { id: 'trip', label: 'Trip Basics', icon: Plane },
  { id: 'dates', label: 'Dates & Budget', icon: Calendar },
  { id: 'flights', label: 'Flight Preferences', icon: MapPin },
  { id: 'accommodation', label: 'Accommodation', icon: Hotel },
  { id: 'style', label: 'Travel Style', icon: Heart },
  { id: 'needs', label: 'Special Needs', icon: Accessibility },
  { id: 'experiences', label: 'Experiences', icon: Zap },
  { id: 'dealbreakers', label: 'Dealbreakers', icon: ShieldAlert },
  { id: 'notes', label: 'Additional Notes', icon: StickyNote },
];

type FormData = Record<string, unknown>;

function toFormData(intake?: Partial<ClientIntake>): FormData {
  if (!intake) return {};
  const d: FormData = {};
  const keys: (keyof ClientIntake)[] = [
    'tripType', 'tripTypeOther', 'destinations', 'departureAirports',
    'dateFlexibility', 'earliestDeparture', 'latestReturn', 'tripDurationDays',
    'budgetMin', 'budgetMax', 'budgetCurrency', 'budgetNotes',
    'cabinPreference', 'hotelStyles', 'loyaltyNotes',
    'accessibilityNeeds', 'dietaryNeeds',
    'travelPace', 'layoverTolerance', 'luxuryPreference',
    'familyFriendly', 'travelerCount', 'childrenCount', 'childrenAges',
    'desiredExperiences', 'dealbreakers', 'preferredAirlines', 'avoidedAirlines',
    'notes', 'isTemplate', 'templateName',
  ];
  for (const k of keys) {
    if (intake[k] !== undefined && intake[k] !== null) {
      if (k === 'earliestDeparture' || k === 'latestReturn') {
        const v = intake[k] as string;
        d[k] = v ? v.slice(0, 10) : '';
      } else {
        d[k] = intake[k];
      }
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

  const handleManualSave = async () => {
    await onSave(form);
    setLastSaved(new Date());
  };

  const handleComplete = async () => {
    if (onComplete) {
      await onComplete(form);
    }
  };

  const canGoNext = step < STEPS.length - 1;
  const canGoPrev = step > 0;

  const goNext = () => canGoNext && setStep((s) => s + 1);
  const goPrev = () => canGoPrev && setStep((s) => s - 1);

  const isCompleted = initialData?.status === 'complete';

  // Helper renderers
  const inputCls =
    'block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white';
  const selectCls =
    'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600';
  const labelCls = 'mb-1.5 block text-sm font-medium text-slate-700';
  const chipCls = (active: boolean) =>
    `inline-flex cursor-pointer items-center rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
      active
        ? 'border-blue-600 bg-blue-50 text-blue-700'
        : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50'
    }`;

  const renderStep = () => {
    switch (STEPS[step].id) {
      case 'trip':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Trip Type</label>
              <div className="flex flex-wrap gap-2">
                {TRIP_TYPES.map((t) => (
                  <button
                    key={t.value}
                    type="button"
                    onClick={() => set('tripType', t.value)}
                    className={chipCls(form.tripType === t.value)}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
              {form.tripType === 'other' && (
                <input
                  type="text"
                  placeholder="Describe the trip type..."
                  value={(form.tripTypeOther as string) || ''}
                  onChange={(e) => set('tripTypeOther', e.target.value)}
                  className={`mt-3 ${inputCls}`}
                />
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Number of Travelers</label>
                <input
                  type="number"
                  min="1"
                  value={(form.travelerCount as number) || ''}
                  onChange={(e) => set('travelerCount', e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="2"
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Children</label>
                <input
                  type="number"
                  min="0"
                  value={(form.childrenCount as number) ?? ''}
                  onChange={(e) => set('childrenCount', e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="0"
                  className={inputCls}
                />
              </div>
            </div>

            {(form.childrenCount as number) > 0 && (
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
              <label className={labelCls}>Destination Preferences</label>
              <input
                type="text"
                value={((form.destinations as string[]) || []).join(', ')}
                onChange={(e) =>
                  set(
                    'destinations',
                    e.target.value
                      .split(',')
                      .map((v) => v.trim())
                      .filter(Boolean),
                  )
                }
                placeholder="e.g. Hawaii, Japan, Italy"
                className={inputCls}
              />
              <p className="mt-1 text-xs text-slate-400">Separate multiple with commas</p>
            </div>

            <div>
              <label className={labelCls}>Departure Airports</label>
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
          </div>
        );

      case 'dates':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Date Flexibility</label>
              <div className="flex flex-wrap gap-2">
                {DATE_FLEXIBILITY.map((d) => (
                  <button
                    key={d.value}
                    type="button"
                    onClick={() => set('dateFlexibility', d.value)}
                    className={chipCls(form.dateFlexibility === d.value)}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelCls}>Earliest Departure</label>
                <input
                  type="date"
                  value={(form.earliestDeparture as string) || ''}
                  onChange={(e) => set('earliestDeparture', e.target.value || null)}
                  className={inputCls}
                />
              </div>
              <div>
                <label className={labelCls}>Latest Return</label>
                <input
                  type="date"
                  value={(form.latestReturn as string) || ''}
                  onChange={(e) => set('latestReturn', e.target.value || null)}
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Trip Duration (days)</label>
              <input
                type="number"
                min="1"
                value={(form.tripDurationDays as number) || ''}
                onChange={(e) => set('tripDurationDays', e.target.value ? parseInt(e.target.value) : null)}
                placeholder="e.g. 7"
                className={inputCls}
              />
            </div>

            <hr className="border-slate-100" />

            <div>
              <label className={labelCls}>
                <DollarSign className="mr-1 inline h-4 w-4 text-slate-400" />
                Budget Range (USD)
              </label>
              <div className="grid grid-cols-2 gap-4">
                <input
                  type="number"
                  min="0"
                  value={(form.budgetMin as number) ?? ''}
                  onChange={(e) => set('budgetMin', e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="Min"
                  className={inputCls}
                />
                <input
                  type="number"
                  min="0"
                  value={(form.budgetMax as number) ?? ''}
                  onChange={(e) => set('budgetMax', e.target.value ? parseInt(e.target.value) : null)}
                  placeholder="Max"
                  className={inputCls}
                />
              </div>
            </div>

            <div>
              <label className={labelCls}>Budget Notes</label>
              <textarea
                rows={2}
                value={(form.budgetNotes as string) || ''}
                onChange={(e) => set('budgetNotes', e.target.value)}
                placeholder="e.g. Willing to splurge on flights, keep hotels moderate..."
                className={`resize-none ${inputCls}`}
              />
            </div>
          </div>
        );

      case 'flights':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Cabin Class</label>
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
              <label className={labelCls}>Layover Tolerance</label>
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
              <label className={labelCls}>Preferred Airlines</label>
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
              <label className={labelCls}>Airlines to Avoid</label>
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

      case 'accommodation':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Hotel / Accommodation Style</label>
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
              <label className={labelCls}>Loyalty Programs & Points Notes</label>
              <textarea
                rows={3}
                value={(form.loyaltyNotes as string) || ''}
                onChange={(e) => set('loyaltyNotes', e.target.value)}
                placeholder="e.g. Marriott Bonvoy Platinum, 250k Hilton points, prefer Hyatt properties..."
                className={`resize-none ${inputCls}`}
              />
            </div>
          </div>
        );

      case 'style':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Pace of Travel</label>
              <div className="space-y-2">
                {PACE_OPTIONS.map((p) => (
                  <button
                    key={p.value}
                    type="button"
                    onClick={() => set('travelPace', p.value)}
                    className={`flex w-full items-center rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                      form.travelPace === p.value
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
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
              <label className={labelCls}>Luxury vs. Value</label>
              <div className="space-y-2">
                {LUXURY_OPTIONS.map((l) => (
                  <button
                    key={l.value}
                    type="button"
                    onClick={() => set('luxuryPreference', l.value)}
                    className={`flex w-full items-center rounded-lg border px-4 py-3 text-left text-sm transition-colors ${
                      form.luxuryPreference === l.value
                        ? 'border-blue-600 bg-blue-50 text-blue-700'
                        : 'border-slate-200 bg-white text-slate-700 hover:border-slate-300'
                    }`}
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
                Family-friendly trip
              </label>
              <p className="ml-6 mt-1 text-xs text-slate-400">
                Prioritize kid-friendly venues, activities, and scheduling
              </p>
            </div>
          </div>
        );

      case 'needs':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>
                <Accessibility className="mr-1 inline h-4 w-4 text-slate-400" />
                Accessibility Needs
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
                Dietary Needs
              </label>
              <textarea
                rows={3}
                value={(form.dietaryNeeds as string) || ''}
                onChange={(e) => set('dietaryNeeds', e.target.value)}
                placeholder="e.g. Gluten-free, vegetarian, nut allergy, kosher, halal..."
                className={`resize-none ${inputCls}`}
              />
            </div>
          </div>
        );

      case 'experiences':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Desired Experiences</label>
              <p className="mb-3 text-xs text-slate-400">Select all that interest the traveler, or type custom ones below</p>
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
              <label className={labelCls}>Custom Experiences</label>
              <input
                type="text"
                placeholder="Add more, comma-separated..."
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
                          ...items.filter((i) => !((f.desiredExperiences as string[]) || []).includes(i)),
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
          </div>
        );

      case 'dealbreakers':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>
                <ShieldAlert className="mr-1 inline h-4 w-4 text-red-400" />
                Dealbreakers / Do-Not-Book
              </label>
              <p className="mb-3 text-xs text-slate-400">
                Airlines, hotels, destinations, or conditions the client absolutely does not want
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
                          dealbreakers: ((f.dealbreakers as string[]) || []).filter((_, i) => i !== idx),
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
            </div>
          </div>
        );

      case 'notes':
        return (
          <div className="space-y-6">
            <div>
              <label className={labelCls}>Additional Notes</label>
              <textarea
                rows={6}
                value={(form.notes as string) || ''}
                onChange={(e) => set('notes', e.target.value)}
                placeholder="Anything else the advisor should know — special occasions, celebrations, surprise elements, specific hotel/flight requests, timing considerations..."
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
              {(form.isTemplate as boolean) ? (
                <input
                  type="text"
                  value={(form.templateName as string) || ''}
                  onChange={(e) => set('templateName', e.target.value)}
                  placeholder="Template name (e.g. 'Luxury Beach Getaway')"
                  className={`mt-3 ${inputCls}`}
                />
              ) : null}
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  const filledSteps = STEPS.map((s) => {
    switch (s.id) {
      case 'trip': return !!(form.tripType || form.destinations);
      case 'dates': return !!(form.dateFlexibility || form.earliestDeparture || form.budgetMin || form.budgetMax);
      case 'flights': return !!(form.cabinPreference || form.layoverTolerance);
      case 'accommodation': return !!((form.hotelStyles as string[])?.length);
      case 'style': return !!(form.travelPace || form.luxuryPreference);
      case 'needs': return !!(form.accessibilityNeeds || form.dietaryNeeds);
      case 'experiences': return !!((form.desiredExperiences as string[])?.length);
      case 'dealbreakers': return !!((form.dealbreakers as string[])?.length);
      case 'notes': return !!(form.notes);
      default: return false;
    }
  });

  const completedStepCount = filledSteps.filter(Boolean).length;
  const progressPct = Math.round((completedStepCount / STEPS.length) * 100);

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <Link
        href={`/clients/${client.id}?tab=intake`}
        className="mb-6 inline-flex items-center gap-1.5 text-sm text-slate-600 hover:text-slate-900"
      >
        <ArrowLeft className="h-4 w-4" />
        Back to {client.firstName} {client.lastName}
      </Link>

      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            {isNew ? 'New Client Intake' : 'Edit Intake'}
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
            {isNew ? 'Create Draft' : 'Save Draft'}
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
                  <Icon className={`h-4 w-4 ${isCurrent ? 'text-blue-600' : isFilled ? 'text-green-500' : 'text-slate-300'}`} />
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
              {(() => { const Icon = STEPS[step].icon; return <Icon className="h-5 w-5 text-blue-600" />; })()}
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
                  Complete Intake
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
