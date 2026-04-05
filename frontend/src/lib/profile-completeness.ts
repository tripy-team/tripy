// Profile Completeness Engine
// Computes how complete a client's travel preference profile is by combining
// committed ClientPreference data with in-session MeetingProfileSuggestion data.

import {
  getAllProfileFields,
  getCriticalFields,
  getFieldsByCategory,
  type ProfileFieldDefinition,
  type FieldCategory,
} from "./profile-fields";

export interface ProfileCompletenessResult {
  overallPercent: number;
  readyForTripPlanning: boolean;
  filledFields: string[];
  emptyFields: string[];
  emptyCriticalFields: string[];
  categoryBreakdown: Record<FieldCategory, { filled: number; total: number; percent: number }>;
}

export interface ProfileSnapshot {
  completeness: ProfileCompletenessResult;
  knownPreferences: Record<string, unknown>;
  sessionInsights: Array<{ targetField: string; suggestedValue: unknown; confidence: number }>;
}

function isFieldFilled(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string" && value.trim() === "") return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Compute profile completeness from committed preferences and session suggestions.
 * Session suggestions with status "pending" or "approved" count as provisional fills.
 */
export function computeProfileCompleteness(
  committedPreferences: Record<string, unknown> | null | undefined,
  sessionSuggestions: Array<{ targetField: string; suggestedValue: unknown; status: string }> = [],
): ProfileCompletenessResult {
  const allFields = getAllProfileFields();
  const criticalFields = getCriticalFields();
  const categorized = getFieldsByCategory();
  const prefs = committedPreferences ?? {};

  // Build a merged view: committed + provisional session values
  const provisionalValues = new Map<string, unknown>();
  for (const s of sessionSuggestions) {
    if (s.status === "pending" || s.status === "approved") {
      if (!provisionalValues.has(s.targetField) || isFieldFilled(s.suggestedValue)) {
        provisionalValues.set(s.targetField, s.suggestedValue);
      }
    }
  }

  const filledFields: string[] = [];
  const emptyFields: string[] = [];

  for (const field of allFields) {
    const committedValue = prefs[field.key];
    const sessionValue = provisionalValues.get(field.key);
    const filled = isFieldFilled(committedValue) || isFieldFilled(sessionValue);
    if (filled) {
      filledFields.push(field.key);
    } else {
      emptyFields.push(field.key);
    }
  }

  const emptyCriticalFields = criticalFields
    .filter((f) => emptyFields.includes(f.key))
    .map((f) => f.key);

  // Weighted completeness: critical fields count 3x, high 2x, medium/low 1x
  const weightMap: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 1 };
  let totalWeight = 0;
  let filledWeight = 0;
  for (const field of allFields) {
    const w = weightMap[field.priority] ?? 1;
    totalWeight += w;
    if (filledFields.includes(field.key)) {
      filledWeight += w;
    }
  }
  const overallPercent = totalWeight > 0 ? Math.round((filledWeight / totalWeight) * 100) : 0;

  const readyForTripPlanning = emptyCriticalFields.length === 0;

  // Category breakdown
  const categoryBreakdown = {} as Record<FieldCategory, { filled: number; total: number; percent: number }>;
  for (const [cat, fields] of Object.entries(categorized)) {
    const total = fields.length;
    const filled = fields.filter((f: ProfileFieldDefinition) => filledFields.includes(f.key)).length;
    categoryBreakdown[cat as FieldCategory] = {
      filled,
      total,
      percent: total > 0 ? Math.round((filled / total) * 100) : 0,
    };
  }

  return {
    overallPercent,
    readyForTripPlanning,
    filledFields,
    emptyFields,
    emptyCriticalFields,
    categoryBreakdown,
  };
}

/**
 * Build a ProfileSnapshot from committed preferences and session data.
 */
export function buildProfileSnapshot(
  committedPreferences: Record<string, unknown> | null | undefined,
  sessionSuggestions: Array<{ targetField: string; suggestedValue: unknown; confidence: number; status: string }> = [],
): ProfileSnapshot {
  const completeness = computeProfileCompleteness(committedPreferences, sessionSuggestions);

  const knownPreferences: Record<string, unknown> = {};
  if (committedPreferences) {
    for (const [k, v] of Object.entries(committedPreferences)) {
      if (isFieldFilled(v)) knownPreferences[k] = v;
    }
  }

  const sessionInsights = sessionSuggestions
    .filter((s) => s.status === "pending" || s.status === "approved")
    .map((s) => ({
      targetField: s.targetField,
      suggestedValue: s.suggestedValue,
      confidence: s.confidence,
    }));

  return { completeness, knownPreferences, sessionInsights };
}
