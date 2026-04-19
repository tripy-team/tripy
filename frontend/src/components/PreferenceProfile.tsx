'use client';

import { useState, useCallback, useEffect } from 'react';
import {
  Loader2,
  Save,
  X,
  Edit3,
  History,
  Download,
  Plane,
  Hotel,
  DollarSign,
  Accessibility,
  UtensilsCrossed,
  Users,
  PartyPopper,
  Ban,
  Clock,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Check,
  ArrowRightLeft,
  Compass,
} from 'lucide-react';
import {
  getClientPreferences,
  updateClientPreferences,
  getPreferenceHistory,
  mergeIntakeIntoPreferences,
} from '@/lib/api-client';
import type {
  ClientPreference,
  PreferenceChangeLog,
  MergeDiffItem,
} from '@/lib/api-client';

interface PreferenceProfileProps {
  clientId: string;
}

type SectionKey =
  | 'flight'
  | 'hotel'
  | 'budget'
  | 'trip_style'
  | 'accessibility'
  | 'food'
  | 'family'
  | 'occasions'
  | 'dealbreakers';

interface SectionConfig {
  key: SectionKey;
  label: string;
  icon: React.ReactNode;
  color: string;
}

const SECTIONS: SectionConfig[] = [
  { key: 'flight', label: 'Flight Preferences', icon: <Plane className="h-4 w-4" />, color: 'blue' },
  { key: 'hotel', label: 'Hotel & Accommodation', icon: <Hotel className="h-4 w-4" />, color: 'emerald' },
  { key: 'budget', label: 'Budget & Points', icon: <DollarSign className="h-4 w-4" />, color: 'amber' },
  { key: 'trip_style', label: 'Destinations & Travel Style', icon: <Compass className="h-4 w-4" />, color: 'teal' },
  { key: 'accessibility', label: 'Accessibility Needs', icon: <Accessibility className="h-4 w-4" />, color: 'purple' },
  { key: 'food', label: 'Food & Activities', icon: <UtensilsCrossed className="h-4 w-4" />, color: 'orange' },
  { key: 'family', label: 'Family & Children', icon: <Users className="h-4 w-4" />, color: 'pink' },
  { key: 'occasions', label: 'Special Occasions', icon: <PartyPopper className="h-4 w-4" />, color: 'violet' },
  { key: 'dealbreakers', label: 'Dislikes & Dealbreakers', icon: <Ban className="h-4 w-4" />, color: 'red' },
];

const colorClasses: Record<string, { bg: string; text: string; border: string; badge: string }> = {
  blue: { bg: 'bg-blue-50', text: 'text-blue-600', border: 'border-blue-200', badge: 'bg-blue-100 text-blue-700' },
  emerald: { bg: 'bg-emerald-50', text: 'text-emerald-600', border: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-700' },
  amber: { bg: 'bg-amber-50', text: 'text-amber-600', border: 'border-amber-200', badge: 'bg-amber-100 text-amber-700' },
  purple: { bg: 'bg-purple-50', text: 'text-purple-600', border: 'border-purple-200', badge: 'bg-purple-100 text-purple-700' },
  orange: { bg: 'bg-orange-50', text: 'text-orange-600', border: 'border-orange-200', badge: 'bg-orange-100 text-orange-700' },
  pink: { bg: 'bg-pink-50', text: 'text-pink-600', border: 'border-pink-200', badge: 'bg-pink-100 text-pink-700' },
  violet: { bg: 'bg-violet-50', text: 'text-violet-600', border: 'border-violet-200', badge: 'bg-violet-100 text-violet-700' },
  red: { bg: 'bg-red-50', text: 'text-red-600', border: 'border-red-200', badge: 'bg-red-100 text-red-700' },
  teal: { bg: 'bg-teal-50', text: 'text-teal-600', border: 'border-teal-200', badge: 'bg-teal-100 text-teal-700' },
};

const FIELD_LABELS: Record<string, string> = {
  preferredCabin: 'Preferred Cabin',
  prefersNonstop: 'Prefers Nonstop',
  maxLayoverMinutes: 'Max Layover (min)',
  willingToReposition: 'Willing to Reposition',
  avoidBasicEconomy: 'Avoid Basic Economy',
  preferredAirlines: 'Preferred Airlines',
  avoidedAirlines: 'Avoided Airlines',
  preferredHotelTypes: 'Preferred Hotel Types',
  roomPreferences: 'Room Preferences',
  locationPreferences: 'Location Preferences',
  redemptionStyle: 'Redemption Style',
  budgetSensitivity: 'Budget Sensitivity',
  pointsVsCash: 'Points vs Cash',
  accessibilityNeeds: 'Accessibility Needs',
  foodPreferences: 'Food Preferences',
  activityPreferences: 'Activity Preferences',
  familyConsiderations: 'Family Considerations',
  specialOccasions: 'Special Occasions',
  dislikes: 'Dislikes',
  dealbreakers: 'Dealbreakers',
  notes: 'Notes',
  loyaltyNotes: 'Loyalty & Points',
  budgetNotes: 'Budget Notes',
  preferredDestinations: 'Preferred Destinations',
  preferredDepartureAirports: 'Preferred Departure Airports',
  dateFlexibility: 'Date Flexibility',
  travelPace: 'Travel Pace',
  pastTripFeedback: 'Past Trip Feedback',
  mergeStrategy: 'Merge Strategy',
};

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return 'Not set';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.length ? value.join(', ') : 'None';
  if (typeof value === 'string') return value.replace(/_/g, ' ') || 'Not set';
  return String(value);
}

function sourceLabel(source?: string): string {
  switch (source) {
    case 'manual': return 'Manual edit';
    case 'intake': return 'From intake';
    case 'inferred': return 'Inferred';
    default: return 'Unknown';
  }
}

function sourceBadgeClass(source?: string): string {
  switch (source) {
    case 'manual': return 'bg-blue-100 text-blue-700';
    case 'intake': return 'bg-green-100 text-green-700';
    case 'inferred': return 'bg-amber-100 text-amber-700';
    default: return 'bg-slate-100 text-slate-600';
  }
}

function TagList({ items }: { items?: string[] | null }) {
  if (!items?.length) return <span className="text-slate-400">None</span>;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((item) => (
        <span
          key={item}
          className="inline-block rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-medium text-slate-700"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

function TagInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder ?? 'Comma-separated values'}
      className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
    />
  );
}

function toCommaSeparated(val?: string[] | null): string {
  return val?.join(', ') ?? '';
}

function fromCommaSeparated(val: string): string[] {
  return val
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

type FormState = {
  preferredCabin: string;
  prefersNonstop: boolean;
  maxLayoverMinutes: string;
  willingToReposition: boolean;
  avoidBasicEconomy: boolean;
  preferredAirlines: string;
  avoidedAirlines: string;
  preferredDepartureAirports: string;
  preferredHotelTypes: string;
  roomPreferences: string;
  locationPreferences: string;
  redemptionStyle: string;
  budgetSensitivity: string;
  pointsVsCash: string;
  loyaltyNotes: string;
  budgetNotes: string;
  preferredDestinations: string;
  dateFlexibility: string;
  travelPace: string;
  pastTripFeedback: string;
  accessibilityNeeds: string;
  foodPreferences: string;
  activityPreferences: string;
  familyConsiderations: string;
  specialOccasions: string;
  dislikes: string;
  dealbreakers: string;
  notes: string;
  mergeStrategy: string;
};

function prefsToForm(p: ClientPreference | null): FormState {
  return {
    preferredCabin: p?.preferredCabin ?? '',
    prefersNonstop: p?.prefersNonstop ?? false,
    maxLayoverMinutes: p?.maxLayoverMinutes != null ? String(p.maxLayoverMinutes) : '',
    willingToReposition: p?.willingToReposition ?? false,
    avoidBasicEconomy: p?.avoidBasicEconomy ?? false,
    preferredAirlines: toCommaSeparated(p?.preferredAirlines),
    avoidedAirlines: toCommaSeparated(p?.avoidedAirlines),
    preferredDepartureAirports: toCommaSeparated(p?.preferredDepartureAirports),
    preferredHotelTypes: toCommaSeparated(p?.preferredHotelTypes),
    roomPreferences: toCommaSeparated(p?.roomPreferences),
    locationPreferences: p?.locationPreferences ?? '',
    redemptionStyle: p?.redemptionStyle ?? '',
    budgetSensitivity: p?.budgetSensitivity ?? '',
    pointsVsCash: p?.pointsVsCash ?? '',
    loyaltyNotes: p?.loyaltyNotes ?? '',
    budgetNotes: p?.budgetNotes ?? '',
    preferredDestinations: toCommaSeparated(p?.preferredDestinations),
    dateFlexibility: p?.dateFlexibility ?? '',
    travelPace: p?.travelPace ?? '',
    pastTripFeedback: p?.pastTripFeedback ?? '',
    accessibilityNeeds: toCommaSeparated(p?.accessibilityNeeds),
    foodPreferences: toCommaSeparated(p?.foodPreferences),
    activityPreferences: toCommaSeparated(p?.activityPreferences),
    familyConsiderations: p?.familyConsiderations ?? '',
    specialOccasions: toCommaSeparated(p?.specialOccasions),
    dislikes: toCommaSeparated(p?.dislikes),
    dealbreakers: toCommaSeparated(p?.dealbreakers),
    notes: p?.notes ?? '',
    mergeStrategy: p?.mergeStrategy ?? 'merge',
  };
}

function formToPayload(f: FormState): Record<string, unknown> {
  return {
    preferredCabin: f.preferredCabin || undefined,
    prefersNonstop: f.prefersNonstop,
    maxLayoverMinutes: f.maxLayoverMinutes ? parseInt(f.maxLayoverMinutes) : null,
    willingToReposition: f.willingToReposition,
    avoidBasicEconomy: f.avoidBasicEconomy,
    preferredAirlines: f.preferredAirlines ? fromCommaSeparated(f.preferredAirlines) : null,
    avoidedAirlines: f.avoidedAirlines ? fromCommaSeparated(f.avoidedAirlines) : null,
    preferredDepartureAirports: f.preferredDepartureAirports
      ? fromCommaSeparated(f.preferredDepartureAirports)
      : null,
    preferredHotelTypes: f.preferredHotelTypes ? fromCommaSeparated(f.preferredHotelTypes) : null,
    roomPreferences: f.roomPreferences ? fromCommaSeparated(f.roomPreferences) : null,
    locationPreferences: f.locationPreferences || null,
    redemptionStyle: f.redemptionStyle || undefined,
    budgetSensitivity: f.budgetSensitivity || null,
    pointsVsCash: f.pointsVsCash || null,
    loyaltyNotes: f.loyaltyNotes || null,
    budgetNotes: f.budgetNotes || null,
    preferredDestinations: f.preferredDestinations
      ? fromCommaSeparated(f.preferredDestinations)
      : null,
    dateFlexibility: f.dateFlexibility || null,
    travelPace: f.travelPace || null,
    pastTripFeedback: f.pastTripFeedback || null,
    accessibilityNeeds: f.accessibilityNeeds ? fromCommaSeparated(f.accessibilityNeeds) : null,
    foodPreferences: f.foodPreferences ? fromCommaSeparated(f.foodPreferences) : null,
    activityPreferences: f.activityPreferences ? fromCommaSeparated(f.activityPreferences) : null,
    familyConsiderations: f.familyConsiderations || null,
    specialOccasions: f.specialOccasions ? fromCommaSeparated(f.specialOccasions) : null,
    dislikes: f.dislikes ? fromCommaSeparated(f.dislikes) : null,
    dealbreakers: f.dealbreakers ? fromCommaSeparated(f.dealbreakers) : null,
    notes: f.notes || null,
    mergeStrategy: f.mergeStrategy || 'merge',
  };
}

export default function PreferenceProfile({ clientId }: PreferenceProfileProps) {
  const [preferences, setPreferences] = useState<ClientPreference | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<FormState>(prefsToForm(null));
  const [expandedSections, setExpandedSections] = useState<Set<SectionKey>>(
    new Set(SECTIONS.map((s) => s.key)),
  );

  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<PreferenceChangeLog[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const [showMerge, setShowMerge] = useState(false);
  const [mergeText, setMergeText] = useState('');
  const [mergeStrategy, setMergeStrategy] = useState<'overwrite' | 'merge' | 'suggest'>('suggest');
  const [mergeDiff, setMergeDiff] = useState<MergeDiffItem[] | null>(null);
  const [merging, setMerging] = useState(false);

  const loadPreferences = useCallback(async () => {
    try {
      const prefs = await getClientPreferences(clientId);
      setPreferences(prefs);
    } catch {
      setPreferences(null);
    } finally {
      setLoading(false);
    }
  }, [clientId]);

  useEffect(() => {
    loadPreferences();
  }, [loadPreferences]);

  const startEditing = () => {
    setForm(prefsToForm(preferences));
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      const payload = formToPayload(form);
      const updated = await updateClientPreferences(clientId, {
        ...payload,
        _source: 'manual',
      } as never);
      setPreferences(updated);
      setEditing(false);
    } catch (err) {
      console.error('Failed to save preferences:', err);
    } finally {
      setSaving(false);
    }
  };

  const loadHistory = async () => {
    setLoadingHistory(true);
    try {
      const logs = await getPreferenceHistory(clientId);
      setHistory(logs);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const handleOpenHistory = () => {
    setShowHistory(true);
    loadHistory();
  };

  const parseMergeInput = (): Record<string, unknown> | null => {
    try {
      return JSON.parse(mergeText);
    } catch {
      return null;
    }
  };

  const handlePreviewMerge = async () => {
    const data = parseMergeInput();
    if (!data) return;
    setMerging(true);
    try {
      const result = await mergeIntakeIntoPreferences(clientId, data, 'suggest');
      setMergeDiff(result.diff);
    } catch (err) {
      console.error('Merge preview failed:', err);
    } finally {
      setMerging(false);
    }
  };

  const handleApplyMerge = async () => {
    const data = parseMergeInput();
    if (!data) return;
    setMerging(true);
    try {
      const result = await mergeIntakeIntoPreferences(clientId, data, mergeStrategy === 'suggest' ? 'merge' : mergeStrategy);
      if (result.preferences) setPreferences(result.preferences);
      setMergeDiff(null);
      setShowMerge(false);
      setMergeText('');
    } catch (err) {
      console.error('Merge apply failed:', err);
    } finally {
      setMerging(false);
    }
  };

  const toggleSection = (key: SectionKey) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const updateForm = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <span className="ml-2 text-sm text-slate-500">Loading preferences...</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header Bar */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-semibold text-slate-900">Preference Profile</h2>
          {preferences?.updatedAt && (
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500">
              <Clock className="h-3 w-3" />
              Last updated {new Date(preferences.updatedAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
              })}
              {preferences.lastUpdatedSource && (
                <span className={`ml-1 inline-block rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadgeClass(preferences.lastUpdatedSource)}`}>
                  {sourceLabel(preferences.lastUpdatedSource)}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!editing && (
            <>
              <button
                onClick={handleOpenHistory}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <History className="h-3.5 w-3.5" />
                History
              </button>
              <button
                onClick={() => setShowMerge(true)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <Download className="h-3.5 w-3.5" />
                Import from Intake
              </button>
              <button
                onClick={startEditing}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
              >
                <Edit3 className="h-3.5 w-3.5" />
                Edit
              </button>
            </>
          )}
          {editing && (
            <>
              <button
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                Save Changes
              </button>
              <button
                onClick={() => setEditing(false)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                <X className="h-3.5 w-3.5" />
                Cancel
              </button>
            </>
          )}
        </div>
      </div>

      {/* Section Cards */}
      {SECTIONS.map((section) => {
        const colors = colorClasses[section.color];
        const isOpen = expandedSections.has(section.key);

        return (
          <div
            key={section.key}
            className={`overflow-hidden rounded-xl border bg-white shadow-sm ${isOpen ? colors.border : 'border-slate-200'}`}
          >
            <button
              onClick={() => toggleSection(section.key)}
              className={`flex w-full items-center justify-between px-5 py-3.5 text-left transition-colors hover:bg-slate-50`}
            >
              <div className="flex items-center gap-3">
                <div className={`flex h-8 w-8 items-center justify-center rounded-lg ${colors.bg} ${colors.text}`}>
                  {section.icon}
                </div>
                <span className="text-sm font-semibold text-slate-900">{section.label}</span>
              </div>
              {isOpen ? (
                <ChevronDown className="h-4 w-4 text-slate-400" />
              ) : (
                <ChevronRight className="h-4 w-4 text-slate-400" />
              )}
            </button>

            {isOpen && (
              <div className="border-t border-slate-100 px-5 py-4">
                {editing
                  ? renderEditSection(section.key, form, updateForm)
                  : renderViewSection(section.key, preferences)}
              </div>
            )}
          </div>
        );
      })}

      {/* Merge Strategy Setting */}
      {editing && (
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-slate-900">Intake Merge Behavior</h3>
          <p className="mb-3 text-xs text-slate-500">
            Controls how new intake data interacts with this profile.
          </p>
          <select
            value={form.mergeStrategy}
            onChange={(e) => updateForm('mergeStrategy', e.target.value)}
            className="block w-full max-w-xs rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
          >
            <option value="overwrite">Overwrite — replace fields with intake data</option>
            <option value="merge">Merge — combine lists, keep existing scalars</option>
            <option value="suggest">Suggest — preview changes before applying</option>
          </select>
        </div>
      )}

      {/* History Modal */}
      {showHistory && (
        <div className="fixed inset-0 z-50 flex items-start justify-end">
          <div className="fixed inset-0 bg-black/20" onClick={() => setShowHistory(false)} />
          <div className="relative z-10 flex h-full w-full max-w-lg flex-col bg-white shadow-xl">
            <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
              <h3 className="text-lg font-semibold text-slate-900">Change History</h3>
              <button
                onClick={() => setShowHistory(false)}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto px-6 py-4">
              {loadingHistory ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
                </div>
              ) : history.length === 0 ? (
                <p className="py-12 text-center text-sm text-slate-400">No changes recorded yet.</p>
              ) : (
                <div className="space-y-3">
                  {history.map((log) => (
                    <div
                      key={log.id}
                      className="rounded-lg border border-slate-100 bg-slate-50/50 p-3"
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-slate-900">
                          {FIELD_LABELS[log.fieldName] ?? log.fieldName}
                        </span>
                        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${sourceBadgeClass(log.source)}`}>
                          {sourceLabel(log.source)}
                        </span>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-slate-400">Before:</span>
                          <span className="ml-1 text-slate-600">{formatValue(log.oldValue)}</span>
                        </div>
                        <div>
                          <span className="text-slate-400">After:</span>
                          <span className="ml-1 font-medium text-slate-900">{formatValue(log.newValue)}</span>
                        </div>
                      </div>
                      <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                        <span>
                          {log.changedBy
                            ? `${log.changedBy.firstName} ${log.changedBy.lastName}`
                            : 'System'}
                        </span>
                        <span>&middot;</span>
                        <span>
                          {new Date(log.createdAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                            hour: 'numeric',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Merge from Intake Modal */}
      {showMerge && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="fixed inset-0 bg-black/20" onClick={() => { setShowMerge(false); setMergeDiff(null); }} />
          <div className="relative z-10 mx-4 w-full max-w-2xl rounded-2xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-semibold text-slate-900">
                <ArrowRightLeft className="mr-2 inline h-5 w-5 text-blue-600" />
                Import from Intake
              </h3>
              <button
                onClick={() => { setShowMerge(false); setMergeDiff(null); }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="mb-4">
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Paste intake data (JSON)
              </label>
              <textarea
                value={mergeText}
                onChange={(e) => setMergeText(e.target.value)}
                rows={6}
                placeholder='{"preferredCabin": "business", "preferredAirlines": ["Delta", "United"], ...}'
                className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 font-mono text-xs placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>

            <div className="mb-4 flex items-center gap-3">
              <label className="text-sm font-medium text-slate-700">Strategy:</label>
              {(['overwrite', 'merge', 'suggest'] as const).map((s) => (
                <button
                  key={s}
                  onClick={() => { setMergeStrategy(s); setMergeDiff(null); }}
                  className={`rounded-lg px-3 py-1.5 text-xs font-medium transition-colors ${
                    mergeStrategy === s
                      ? 'bg-blue-600 text-white'
                      : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                  }`}
                >
                  {s.charAt(0).toUpperCase() + s.slice(1)}
                </button>
              ))}
            </div>

            {mergeDiff && (
              <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-slate-200 bg-slate-50 p-4">
                <h4 className="mb-2 text-sm font-semibold text-slate-900">
                  {mergeDiff.length === 0 ? 'No changes detected' : `${mergeDiff.length} field(s) will change`}
                </h4>
                {mergeDiff.map((d) => (
                  <div key={d.field} className="mb-2 flex items-start gap-2 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" />
                    <div>
                      <span className="font-medium text-slate-900">{FIELD_LABELS[d.field] ?? d.field}</span>
                      <span className="ml-1 text-slate-500">{formatValue(d.oldValue)}</span>
                      <span className="mx-1 text-slate-400">&rarr;</span>
                      <span className="font-medium text-slate-900">{formatValue(d.newValue)}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setShowMerge(false); setMergeDiff(null); }}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
              {!mergeDiff && (
                <button
                  onClick={handlePreviewMerge}
                  disabled={merging || !mergeText.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-slate-800 px-4 py-2 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-60"
                >
                  {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Preview Changes
                </button>
              )}
              {mergeDiff && mergeDiff.length > 0 && (
                <button
                  onClick={handleApplyMerge}
                  disabled={merging}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {merging ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
                  Apply Changes
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function renderViewSection(
  section: SectionKey,
  prefs: ClientPreference | null,
) {
  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-start justify-between py-1.5">
      <span className="text-sm text-slate-500">{label}</span>
      <div className="text-right text-sm font-medium text-slate-900">{children}</div>
    </div>
  );

  switch (section) {
    case 'flight':
      return (
        <div className="space-y-1">
          <Row label="Preferred Cabin">{formatValue(prefs?.preferredCabin)}</Row>
          <Row label="Prefers Nonstop">{prefs?.prefersNonstop ? 'Yes' : 'No'}</Row>
          <Row label="Max Layover">{prefs?.maxLayoverMinutes ? `${prefs.maxLayoverMinutes} min` : 'No limit'}</Row>
          <Row label="Willing to Reposition">{prefs?.willingToReposition ? 'Yes' : 'No'}</Row>
          <Row label="Avoid Basic Economy">{prefs?.avoidBasicEconomy ? 'Yes' : 'No'}</Row>
          <Row label="Preferred Airlines"><TagList items={prefs?.preferredAirlines} /></Row>
          <Row label="Avoided Airlines"><TagList items={prefs?.avoidedAirlines} /></Row>
          <Row label="Departure Airports"><TagList items={prefs?.preferredDepartureAirports} /></Row>
        </div>
      );
    case 'hotel':
      return (
        <div className="space-y-1">
          <Row label="Hotel Types"><TagList items={prefs?.preferredHotelTypes} /></Row>
          <Row label="Room Preferences"><TagList items={prefs?.roomPreferences} /></Row>
          <Row label="Location Preferences">{formatValue(prefs?.locationPreferences)}</Row>
        </div>
      );
    case 'budget':
      return (
        <div className="space-y-1">
          <Row label="Redemption Style">{formatValue(prefs?.redemptionStyle)}</Row>
          <Row label="Budget Sensitivity">{formatValue(prefs?.budgetSensitivity)}</Row>
          <Row label="Points vs Cash">{formatValue(prefs?.pointsVsCash)}</Row>
          <Row label="Loyalty & Points">{formatValue(prefs?.loyaltyNotes)}</Row>
          <Row label="Budget Notes">{formatValue(prefs?.budgetNotes)}</Row>
        </div>
      );
    case 'trip_style':
      return (
        <div className="space-y-1">
          <Row label="Preferred Destinations"><TagList items={prefs?.preferredDestinations} /></Row>
          <Row label="Date Flexibility">{formatValue(prefs?.dateFlexibility)}</Row>
          <Row label="Travel Pace">{formatValue(prefs?.travelPace)}</Row>
          <Row label="Past Trip Feedback">{formatValue(prefs?.pastTripFeedback)}</Row>
        </div>
      );
    case 'accessibility':
      return (
        <div className="space-y-1">
          <Row label="Accessibility Needs"><TagList items={prefs?.accessibilityNeeds} /></Row>
        </div>
      );
    case 'food':
      return (
        <div className="space-y-1">
          <Row label="Food Preferences"><TagList items={prefs?.foodPreferences} /></Row>
          <Row label="Activity Preferences"><TagList items={prefs?.activityPreferences} /></Row>
        </div>
      );
    case 'family':
      return (
        <div className="space-y-1">
          <Row label="Family Considerations">{formatValue(prefs?.familyConsiderations)}</Row>
        </div>
      );
    case 'occasions':
      return (
        <div className="space-y-1">
          <Row label="Special Occasions"><TagList items={prefs?.specialOccasions} /></Row>
        </div>
      );
    case 'dealbreakers':
      return (
        <div className="space-y-1">
          <Row label="Dislikes"><TagList items={prefs?.dislikes} /></Row>
          <Row label="Dealbreakers"><TagList items={prefs?.dealbreakers} /></Row>
        </div>
      );
  }
}

function renderEditSection(
  section: SectionKey,
  form: FormState,
  update: <K extends keyof FormState>(key: K, value: FormState[K]) => void,
) {
  const selectClass =
    'block w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600';
  const checkClass = 'rounded border-slate-300';

  switch (section) {
    case 'flight':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Preferred Cabin</label>
              <select value={form.preferredCabin} onChange={(e) => update('preferredCabin', e.target.value)} className={selectClass}>
                <option value="">No preference</option>
                <option value="economy">Economy</option>
                <option value="premium_economy">Premium Economy</option>
                <option value="business">Business</option>
                <option value="first">First</option>
                <option value="flexible">Flexible</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Max Layover (minutes)</label>
              <input
                type="number"
                value={form.maxLayoverMinutes}
                onChange={(e) => update('maxLayoverMinutes', e.target.value)}
                placeholder="e.g., 120"
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.prefersNonstop} onChange={(e) => update('prefersNonstop', e.target.checked)} className={checkClass} />
              Prefers nonstop flights
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.willingToReposition} onChange={(e) => update('willingToReposition', e.target.checked)} className={checkClass} />
              Willing to reposition
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.avoidBasicEconomy} onChange={(e) => update('avoidBasicEconomy', e.target.checked)} className={checkClass} />
              Avoid basic economy
            </label>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Preferred Airlines</label>
            <TagInput value={form.preferredAirlines} onChange={(v) => update('preferredAirlines', v)} placeholder="e.g., United, Delta, AA" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Avoided Airlines</label>
            <TagInput value={form.avoidedAirlines} onChange={(v) => update('avoidedAirlines', v)} placeholder="e.g., Spirit, Frontier" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Preferred Departure Airports</label>
            <TagInput
              value={form.preferredDepartureAirports}
              onChange={(v) => update('preferredDepartureAirports', v)}
              placeholder="e.g., JFK, EWR, LGA"
            />
          </div>
        </div>
      );
    case 'hotel':
      return (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Preferred Hotel Types</label>
            <TagInput value={form.preferredHotelTypes} onChange={(v) => update('preferredHotelTypes', v)} placeholder="e.g., Boutique, Resort, Chain" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Room Preferences</label>
            <TagInput value={form.roomPreferences} onChange={(v) => update('roomPreferences', v)} placeholder="e.g., High floor, King bed, Ocean view" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Location Preferences</label>
            <input
              type="text"
              value={form.locationPreferences}
              onChange={(e) => update('locationPreferences', e.target.value)}
              placeholder="e.g., City center, near beach, quiet neighborhood"
              className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      );
    case 'budget':
      return (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Redemption Style</label>
              <select value={form.redemptionStyle} onChange={(e) => update('redemptionStyle', e.target.value)} className={selectClass}>
                <option value="">No preference</option>
                <option value="save_points">Save Points</option>
                <option value="balanced">Balanced</option>
                <option value="maximize_experience">Maximize Experience</option>
              </select>
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Budget Sensitivity</label>
              <select value={form.budgetSensitivity} onChange={(e) => update('budgetSensitivity', e.target.value)} className={selectClass}>
                <option value="">No preference</option>
                <option value="price_conscious">Price Conscious</option>
                <option value="moderate">Moderate</option>
                <option value="comfort_first">Comfort First</option>
                <option value="luxury">Luxury</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Points vs Cash Tendency</label>
            <input
              type="text"
              value={form.pointsVsCash}
              onChange={(e) => update('pointsVsCash', e.target.value)}
              placeholder="e.g., Prefers using points for flights, cash for hotels"
              className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Loyalty Programs & Points Balances</label>
            <textarea
              value={form.loyaltyNotes}
              onChange={(e) => update('loyaltyNotes', e.target.value)}
              rows={2}
              placeholder="e.g., Chase Sapphire Reserve ~300k UR, Amex Platinum ~500k MR, Hyatt Globalist, United 1K"
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Concrete Budget Anchors</label>
            <textarea
              value={form.budgetNotes}
              onChange={(e) => update('budgetNotes', e.target.value)}
              rows={2}
              placeholder="e.g., ~$8k/person for the honeymoon, hotels under $500/night, flights under $1500 each"
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      );
    case 'trip_style':
      return (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Preferred Destinations</label>
            <TagInput
              value={form.preferredDestinations}
              onChange={(v) => update('preferredDestinations', v)}
              placeholder="e.g., Italy, Japan, Maldives, Patagonia"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Date Flexibility</label>
              <input
                type="text"
                value={form.dateFlexibility}
                onChange={(e) => update('dateFlexibility', e.target.value)}
                placeholder="e.g., Flexible within June, or fixed dates"
                className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-xs font-medium text-slate-700">Travel Pace</label>
              <select
                value={form.travelPace}
                onChange={(e) => update('travelPace', e.target.value)}
                className={selectClass}
              >
                <option value="">No preference</option>
                <option value="relaxed">Relaxed</option>
                <option value="moderate">Moderate</option>
                <option value="active">Active</option>
                <option value="packed">Packed</option>
              </select>
            </div>
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Past Trip Feedback</label>
            <textarea
              value={form.pastTripFeedback}
              onChange={(e) => update('pastTripFeedback', e.target.value)}
              rows={3}
              placeholder="e.g., Loved the Amalfi Coast villa, hated the crowds at Positano. Santorini sunset cruise was the highlight."
              className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
          </div>
        </div>
      );
    case 'accessibility':
      return (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Accessibility Needs</label>
          <TagInput value={form.accessibilityNeeds} onChange={(v) => update('accessibilityNeeds', v)} placeholder="e.g., Wheelchair access, Ground floor, Hearing loop" />
        </div>
      );
    case 'food':
      return (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Food Preferences</label>
            <TagInput value={form.foodPreferences} onChange={(v) => update('foodPreferences', v)} placeholder="e.g., Vegetarian, Gluten-free, Seafood lover" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Activity Preferences</label>
            <TagInput value={form.activityPreferences} onChange={(v) => update('activityPreferences', v)} placeholder="e.g., Spa, Golf, Hiking, Snorkeling" />
          </div>
        </div>
      );
    case 'family':
      return (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Family & Children Considerations</label>
          <textarea
            value={form.familyConsiderations}
            onChange={(e) => update('familyConsiderations', e.target.value)}
            rows={3}
            placeholder="e.g., Travels with 2 young children (ages 3, 6). Needs kid-friendly activities. Prefers connecting rooms."
            className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
          />
        </div>
      );
    case 'occasions':
      return (
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-700">Special Occasions & Celebration Patterns</label>
          <TagInput value={form.specialOccasions} onChange={(v) => update('specialOccasions', v)} placeholder="e.g., Anniversary in June, Birthday trip tradition, Honeymoon" />
        </div>
      );
    case 'dealbreakers':
      return (
        <div className="space-y-3">
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Dislikes</label>
            <TagInput value={form.dislikes} onChange={(v) => update('dislikes', v)} placeholder="e.g., Red-eye flights, Crowded resorts, Long layovers" />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Dealbreakers</label>
            <TagInput value={form.dealbreakers} onChange={(v) => update('dealbreakers', v)} placeholder="e.g., No middle seats, No budget airlines, No shared bathrooms" />
          </div>
        </div>
      );
  }
}
