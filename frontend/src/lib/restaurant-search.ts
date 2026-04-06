import OpenAI from "openai";

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

const SERPAPI_KEY = process.env.SERPAPI_KEY || "";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface RestaurantSuggestion {
  name: string;
  cuisine: string;
  mealType: "breakfast" | "lunch" | "dinner" | "brunch" | "any";
  priceLevel: "$" | "$$" | "$$$" | "$$$$";
  whyRecommended: string;
  matchedPreferences: string[];
}

export interface RestaurantDetails {
  name: string;
  address?: string;
  phone?: string;
  website?: string;
  reservationUrl?: string;
  rating?: number;
  reviewCount?: number;
  priceLevel?: string;
  cuisine?: string;
  hours?: string[];
  thumbnailUrl?: string;
  mapsUrl?: string;
  placeId?: string;
}

export interface RestaurantRecommendation {
  name: string;
  cuisine: string;
  mealType: string;
  priceLevel: string;
  whyRecommended: string;
  matchedPreferences: string[];
  day?: number;
  date?: string;
  location?: string;

  address?: string;
  phone?: string;
  website?: string;
  reservationUrl?: string;
  rating?: number;
  reviewCount?: number;
  hours?: string[];
  thumbnailUrl?: string;
  mapsUrl?: string;
}

export interface RestaurantSearchInput {
  destination: string;
  departureDate: string;
  returnDate?: string;
  travelerCount: number;
  clientName?: string;
  preferences?: {
    foodPreferences?: string[];
    activityPreferences?: string[];
    budgetSensitivity?: string;
    dislikes?: string[];
    dealbreakers?: string[];
    familyConsiderations?: string;
    specialOccasions?: string[];
    notes?: string;
  };
  dailyItinerary?: {
    day: number;
    date: string;
    location: string;
    theme: string;
  }[];
}

// ---------------------------------------------------------------------------
// AI: Generate restaurant suggestions based on user profile
// ---------------------------------------------------------------------------

function aiCall(prompt: string, maxTokens: number): Promise<string> {
  return openai.chat.completions
    .create({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "Respond with valid JSON only." },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: maxTokens,
    })
    .then((r) => {
      const raw = r.choices[0]?.message?.content || "{}";
      if (r.choices[0]?.finish_reason === "length") {
        console.warn(
          "OpenAI response truncated (max_tokens hit), attempting repair",
        );
        return repairJson(raw);
      }
      return raw;
    });
}

function repairJson(raw: string): string {
  let s = raw.trim();
  if (!s) return "{}";

  const openBraces = (s.match(/{/g) || []).length;
  const closeBraces = (s.match(/}/g) || []).length;
  const openBrackets = (s.match(/\[/g) || []).length;
  const closeBrackets = (s.match(/]/g) || []).length;

  if ((s.match(/"/g) || []).length % 2 !== 0) {
    s += '"';
  }

  const tail = s.slice(-1);
  if (tail === ":" || tail === ",") {
    s += '""';
  }

  for (let i = 0; i < openBrackets - closeBrackets; i++) s += "]";
  for (let i = 0; i < openBraces - closeBraces; i++) s += "}";

  return s;
}

function buildPreferencesBlock(
  prefs: NonNullable<RestaurantSearchInput["preferences"]>,
): string {
  const lines: string[] = [];
  if (prefs.foodPreferences?.length)
    lines.push(`Food Preferences: ${prefs.foodPreferences.join(", ")}`);
  if (prefs.budgetSensitivity)
    lines.push(`Budget Sensitivity: ${prefs.budgetSensitivity}`);
  if (prefs.dislikes?.length)
    lines.push(`Dislikes: ${prefs.dislikes.join(", ")}`);
  if (prefs.dealbreakers?.length)
    lines.push(`Dealbreakers: ${prefs.dealbreakers.join(", ")}`);
  if (prefs.familyConsiderations)
    lines.push(`Family Considerations: ${prefs.familyConsiderations}`);
  if (prefs.specialOccasions?.length)
    lines.push(`Special Occasions: ${prefs.specialOccasions.join(", ")}`);
  if (prefs.activityPreferences?.length)
    lines.push(`Activity Style: ${prefs.activityPreferences.join(", ")}`);
  if (prefs.notes) lines.push(`Notes: ${prefs.notes}`);
  return lines.length > 0 ? lines.join("\n") : "No food preferences on file.";
}

export async function generateRestaurantSuggestions(
  input: RestaurantSearchInput,
): Promise<RestaurantSuggestion[]> {
  const prefsBlock = input.preferences
    ? buildPreferencesBlock(input.preferences)
    : "No preferences on file.";

  const tripDays = input.returnDate
    ? Math.ceil(
        (new Date(input.returnDate).getTime() -
          new Date(input.departureDate).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : 3;

  const dailyContext = input.dailyItinerary?.length
    ? `\nDAILY PLAN CONTEXT:\n${input.dailyItinerary.map((d) => `Day ${d.day} (${d.date}): ${d.location} — ${d.theme}`).join("\n")}`
    : "";

  const prompt = `You are a luxury travel dining advisor. Recommend REAL, existing restaurants for this trip.

TRIP:
Destination: ${input.destination}
Dates: ${input.departureDate}${input.returnDate ? ` to ${input.returnDate}` : ""} (${tripDays} days)
Travelers: ${input.travelerCount}${input.clientName ? `\nClient: ${input.clientName}` : ""}
${dailyContext}

CLIENT PREFERENCES:
${prefsBlock}

INSTRUCTIONS:
- Suggest ${Math.min(tripDays * 3, 15)} restaurants — enough for breakfast, lunch, and dinner across the trip
- Use REAL restaurant names that actually exist in ${input.destination}
- Cover a mix of meal types (breakfast, lunch, dinner, brunch)
- Match suggestions to client food preferences, dietary restrictions, and budget
- Include a variety of cuisines and price ranges appropriate to the destination
- For special occasions, include upscale options
- If family considerations exist, ensure family-friendly options
- Avoid anything matching the client's dislikes or dealbreakers

Return {"restaurants":[...]} where each has:
- name: exact restaurant name (real, existing place)
- cuisine: type of cuisine (e.g. "Japanese", "Italian", "Farm-to-Table American")
- mealType: "breakfast" | "lunch" | "dinner" | "brunch"
- priceLevel: "$" | "$$" | "$$$" | "$$$$"
- whyRecommended: 1 sentence explaining the match to this client
- matchedPreferences: array of which client preferences this satisfies`;

  try {
    const raw = await aiCall(prompt, 3072);
    const parsed = JSON.parse(raw);
    return (parsed.restaurants || []).map(normalizeRestaurantSuggestion);
  } catch (err) {
    console.error("AI restaurant suggestion failed:", err);
    return [];
  }
}

function normalizeRestaurantSuggestion(
  r: Record<string, unknown>,
): RestaurantSuggestion {
  return {
    name: (r.name as string) || "",
    cuisine: (r.cuisine as string) || "",
    mealType:
      (r.mealType as RestaurantSuggestion["mealType"]) ||
      (r.meal_type as RestaurantSuggestion["mealType"]) ||
      "any",
    priceLevel:
      (r.priceLevel as RestaurantSuggestion["priceLevel"]) ||
      (r.price_level as RestaurantSuggestion["priceLevel"]) ||
      "$$",
    whyRecommended:
      (r.whyRecommended as string) ||
      (r.why_recommended as string) ||
      "",
    matchedPreferences:
      (r.matchedPreferences as string[]) ||
      (r.matched_preferences as string[]) ||
      [],
  };
}

// ---------------------------------------------------------------------------
// SerpAPI: Scrape Google for restaurant details
// ---------------------------------------------------------------------------

async function serpApiLocalSearch(
  query: string,
  location: string,
): Promise<Record<string, unknown> | null> {
  if (!SERPAPI_KEY) {
    console.warn("SERPAPI_KEY not configured — skipping restaurant detail search");
    return null;
  }

  const params = new URLSearchParams({
    engine: "google_local",
    q: query,
    location,
    hl: "en",
    gl: "us",
    api_key: SERPAPI_KEY,
  });

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);

    const res = await fetch(`https://serpapi.com/search.json?${params}`, {
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      console.warn(`SerpAPI local search failed (${res.status}): ${query}`);
      return null;
    }

    return (await res.json()) as Record<string, unknown>;
  } catch (err) {
    console.warn(`SerpAPI local search error for "${query}":`, err);
    return null;
  }
}

export async function searchRestaurantDetails(
  restaurantName: string,
  destination: string,
): Promise<RestaurantDetails | null> {
  const query = `${restaurantName} restaurant ${destination}`;
  const data = await serpApiLocalSearch(query, destination);
  if (!data) return null;

  const results = (data.local_results as Record<string, unknown>[]) || [];
  if (results.length === 0) return null;

  const best = results[0];
  const serviceOptions = best.service_options as Record<string, boolean> | undefined;

  let reservationUrl: string | undefined;
  if (serviceOptions?.dine_in || serviceOptions?.reservations) {
    reservationUrl = (best.order_online_link as string) || (best.website as string) || undefined;
  }
  const extensions = (best.extensions as string[]) || [];
  const bookingLinks = (best.booking as Record<string, string>[]) || [];
  if (!reservationUrl && bookingLinks.length > 0) {
    reservationUrl = bookingLinks[0]?.link;
  }

  return {
    name: (best.title as string) || restaurantName,
    address: (best.address as string) || undefined,
    phone: (best.phone as string) || undefined,
    website: (best.website as string) || undefined,
    reservationUrl,
    rating: (best.rating as number) || undefined,
    reviewCount: (best.reviews as number) || undefined,
    priceLevel: (best.price as string) || undefined,
    cuisine: (best.type as string) || extensions[0] || undefined,
    hours: (best.hours as string[]) ||
      (best.operating_hours as Record<string, string>
        ? Object.entries(best.operating_hours as Record<string, string>).map(
            ([day, hrs]) => `${day}: ${hrs}`,
          )
        : undefined),
    thumbnailUrl: (best.thumbnail as string) || undefined,
    mapsUrl:
      (best.place_id_search as string) ||
      (best.gps_coordinates
        ? `https://www.google.com/maps/search/?api=1&query=${(best.gps_coordinates as Record<string, number>).latitude},${(best.gps_coordinates as Record<string, number>).longitude}`
        : undefined),
    placeId: (best.place_id as string) || undefined,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator: AI suggestions + SerpAPI enrichment
// ---------------------------------------------------------------------------

export async function searchRestaurantsForTrip(
  input: RestaurantSearchInput,
): Promise<RestaurantRecommendation[]> {
  const suggestions = await generateRestaurantSuggestions(input);
  if (suggestions.length === 0) return [];

  const enrichmentResults = await Promise.allSettled(
    suggestions.map((s) => searchRestaurantDetails(s.name, input.destination)),
  );

  const tripDays = input.returnDate
    ? Math.ceil(
        (new Date(input.returnDate).getTime() -
          new Date(input.departureDate).getTime()) /
          (1000 * 60 * 60 * 24),
      )
    : 3;

  const mealSlots = distributeMealsAcrossDays(
    suggestions,
    tripDays,
    input.departureDate,
    input.dailyItinerary,
  );

  return suggestions.map((suggestion, i): RestaurantRecommendation => {
    const details =
      enrichmentResults[i].status === "fulfilled"
        ? enrichmentResults[i].value
        : null;
    const slot = mealSlots[i];

    return {
      name: details?.name || suggestion.name,
      cuisine: details?.cuisine || suggestion.cuisine,
      mealType: suggestion.mealType,
      priceLevel: details?.priceLevel || suggestion.priceLevel,
      whyRecommended: suggestion.whyRecommended,
      matchedPreferences: suggestion.matchedPreferences,
      day: slot?.day,
      date: slot?.date,
      location: slot?.location || input.destination,
      address: details?.address,
      phone: details?.phone,
      website: details?.website,
      reservationUrl: details?.reservationUrl,
      rating: details?.rating,
      reviewCount: details?.reviewCount,
      hours: details?.hours,
      thumbnailUrl: details?.thumbnailUrl,
      mapsUrl: details?.mapsUrl,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface MealSlot {
  day: number;
  date: string;
  location: string;
}

function distributeMealsAcrossDays(
  suggestions: RestaurantSuggestion[],
  tripDays: number,
  departureDate: string,
  dailyItinerary?: { day: number; date: string; location: string; theme: string }[],
): (MealSlot | undefined)[] {
  const mealOrder = ["breakfast", "brunch", "lunch", "dinner"];
  const sorted = [...suggestions].map((s, idx) => ({ s, idx }));
  sorted.sort(
    (a, b) =>
      mealOrder.indexOf(a.s.mealType) - mealOrder.indexOf(b.s.mealType),
  );

  const slots: (MealSlot | undefined)[] = new Array(suggestions.length).fill(
    undefined,
  );
  let currentDay = 1;
  let mealsForCurrentDay = 0;
  const mealsPerDay = Math.max(1, Math.ceil(suggestions.length / tripDays));

  for (const { idx } of sorted) {
    if (mealsForCurrentDay >= mealsPerDay && currentDay < tripDays) {
      currentDay++;
      mealsForCurrentDay = 0;
    }

    const dayInfo = dailyItinerary?.find((d) => d.day === currentDay);
    const date = dayInfo?.date || addDays(departureDate, currentDay - 1);
    const location = dayInfo?.location || "";

    slots[idx] = { day: currentDay, date, location };
    mealsForCurrentDay++;
  }

  return slots;
}

function addDays(dateStr: string, days: number): string {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().split("T")[0];
}
