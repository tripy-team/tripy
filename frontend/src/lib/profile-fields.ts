// Profile Field Registry
// Defines the high-signal client preference fields that the meeting copilot
// tracks for trip-planning readiness.

export type FieldType = "enum" | "boolean" | "string" | "string[]" | "json";
export type FieldCategory = "flights" | "hotels" | "budget" | "experience" | "logistics" | "dealbreakers";
export type FieldPriority = "critical" | "high" | "medium" | "low";

export interface ProfileFieldDefinition {
  key: string;
  label: string;
  category: FieldCategory;
  priority: FieldPriority;
  type: FieldType;
  tripBlocking: boolean;
  description: string;
}

const PROFILE_FIELDS: ProfileFieldDefinition[] = [
  {
    key: "preferredCabin",
    label: "Preferred Cabin",
    category: "flights",
    priority: "critical",
    type: "enum",
    tripBlocking: true,
    description: "Cabin class preference (economy, premium_economy, business, first, flexible)",
  },
  {
    key: "budgetSensitivity",
    label: "Budget Sensitivity",
    category: "budget",
    priority: "critical",
    type: "enum",
    tripBlocking: true,
    description: "How price-sensitive the client is (price_conscious, moderate, comfort_first, luxury)",
  },
  {
    key: "prefersNonstop",
    label: "Prefers Nonstop",
    category: "flights",
    priority: "high",
    type: "boolean",
    tripBlocking: false,
    description: "Whether the client strongly prefers nonstop flights",
  },
  {
    key: "preferredAirlines",
    label: "Preferred Airlines",
    category: "flights",
    priority: "medium",
    type: "string[]",
    tripBlocking: false,
    description: "Airlines the client prefers or has loyalty with",
  },
  {
    key: "avoidedAirlines",
    label: "Avoided Airlines",
    category: "flights",
    priority: "medium",
    type: "string[]",
    tripBlocking: false,
    description: "Airlines the client wants to avoid",
  },
  {
    key: "avoidBasicEconomy",
    label: "Basic Economy Stance",
    category: "flights",
    priority: "medium",
    type: "boolean",
    tripBlocking: false,
    description: "Whether the client wants to avoid basic economy fares",
  },
  {
    key: "preferredHotelTypes",
    label: "Hotel Types",
    category: "hotels",
    priority: "high",
    type: "string[]",
    tripBlocking: false,
    description: "Types of hotels preferred (boutique, resort, chain, luxury, etc.)",
  },
  {
    key: "dealbreakers",
    label: "Dealbreakers",
    category: "dealbreakers",
    priority: "critical",
    type: "string[]",
    tripBlocking: true,
    description: "Absolute dealbreakers that would ruin a trip",
  },
  {
    key: "redemptionStyle",
    label: "Redemption Style",
    category: "budget",
    priority: "high",
    type: "enum",
    tripBlocking: false,
    description: "Points usage approach (save_points, balanced, maximize_experience)",
  },
  {
    key: "pointsVsCash",
    label: "Points vs. Cash Preference",
    category: "budget",
    priority: "high",
    type: "enum",
    tripBlocking: false,
    description: "How the client prefers to balance points vs. cash when booking",
  },
  {
    key: "loyaltyPrograms",
    label: "Loyalty Programs on File",
    category: "budget",
    priority: "high",
    type: "json",
    tripBlocking: false,
    description: "Loyalty program balances on file for the client (tracked outside ClientPreference)",
  },
  {
    key: "foodPreferences",
    label: "Food Preferences",
    category: "experience",
    priority: "medium",
    type: "string[]",
    tripBlocking: false,
    description: "Dietary and cuisine preferences",
  },
  {
    key: "activityPreferences",
    label: "Activity Preferences",
    category: "experience",
    priority: "high",
    type: "string[]",
    tripBlocking: false,
    description: "Preferred travel activities (adventure, cultural, relaxation, etc.)",
  },
  {
    key: "familyConsiderations",
    label: "Family Considerations",
    category: "logistics",
    priority: "medium",
    type: "string",
    tripBlocking: false,
    description: "Family or group travel considerations (traveling with kids, elderly, etc.)",
  },
];

const fieldsByKey = new Map(PROFILE_FIELDS.map((f) => [f.key, f]));

export function getAllProfileFields(): ProfileFieldDefinition[] {
  return PROFILE_FIELDS;
}

export function getProfileField(key: string): ProfileFieldDefinition | undefined {
  return fieldsByKey.get(key);
}

export function getCriticalFields(): ProfileFieldDefinition[] {
  return PROFILE_FIELDS.filter((f) => f.tripBlocking);
}

export function getFieldsByCategory(): Record<FieldCategory, ProfileFieldDefinition[]> {
  const grouped: Record<string, ProfileFieldDefinition[]> = {};
  for (const f of PROFILE_FIELDS) {
    if (!grouped[f.category]) grouped[f.category] = [];
    grouped[f.category].push(f);
  }
  return grouped as Record<FieldCategory, ProfileFieldDefinition[]>;
}

export function getFieldLabel(key: string): string {
  return fieldsByKey.get(key)?.label ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (s) => s.toUpperCase());
}
