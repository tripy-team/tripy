import Anthropic from "@anthropic-ai/sdk";
import { prisma } from "./prisma";
import type { Prisma } from "@/generated/prisma/client";
import type { InferenceCategory } from "@/generated/prisma/client";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY || "",
});

export interface TextFieldInput {
  fieldName: string;
  text: string;
}

export interface ExtractedToken {
  token: string;
  category: InferenceCategory;
  sourceField: string;
}

interface ExtractedInference {
  category: InferenceCategory;
  label: string;
  description: string;
  confidence: number;
  tokens: string[];
  sourceField: string;
}

const EXTRACTABLE_CATEGORIES: InferenceCategory[] = [
  "dining_preference",
  "dietary_restriction",
  "experience_interest",
  "accessibility_need",
  "airline_preference",
  "nonstop_preference",
  "trip_style",
  "hotel_tier",
  "budget_behavior",
  "destination_pattern",
  "accommodation_preference",
];

// ---------------------------------------------------------------------------
// Client-safe preprocess: split free text into normalized tokens
// ---------------------------------------------------------------------------

export function preprocessTokens(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/\band\b/g, ",")
    .replace(/[;/\n]/g, ",");
  const parts = cleaned.split(",");
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const t = raw.trim().replace(/[.!?]+$/, "");
    if (!t) continue;
    if (t.length < 2 || t.length > 40) continue;
    if (seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
  }
  return tokens;
}

// ---------------------------------------------------------------------------
// LLM extraction
// ---------------------------------------------------------------------------

const SYSTEM_PROMPT = `You extract structured client travel-profile signals from free-text fields a travel advisor typed.

You will receive one or more (fieldName, text) pairs. For each, identify concrete signals and classify them into these InferenceCategory values:
- dining_preference (cuisines, food styles: "italian", "street food", "fine dining")
- dietary_restriction ("vegetarian", "gluten-free", "halal", "no shellfish")
- experience_interest (activities/interests: "hiking", "museums", "scuba diving")
- accessibility_need ("wheelchair", "mobility issues", "limited walking")
- airline_preference (specific airline brand names: "united", "singapore airlines", "delta")
- nonstop_preference (mentions of nonstop/direct/no-layover)
- trip_style ("luxury", "budget", "family-oriented", "romantic", "adventurous")
- hotel_tier (accommodation tier/category words: "luxury", "boutique", "budget", "5-star", "all-inclusive")
- accommodation_preference (specific hotel/chain/brand names OR category phrases tied to a brand experience: "hyatt", "four seasons", "aman resorts", "marriott", "motels", "casino resorts", "budget hotels")
- budget_behavior (explicit budget posture: "price-conscious", "splurge for experiences", "avoids luxury markup")
- destination_pattern (recurring destination or region preferences: "asia", "caribbean winters")

Known fieldName signals — use these to bias interpretation:
- preferredAccommodationBrands: POSITIVE accommodation_preference signals. Emit one accommodation_preference inference per distinct brand or category (e.g. "hyatt", "budget hotels", "four seasons"). If the token is clearly a tier phrase rather than a brand ("5-star"), use hotel_tier instead.
- accommodationDealbreakers: NEGATIVE accommodation_preference signals — still emit accommodation_preference inferences but phrase the description as avoidance ("Client avoids motels") and prefix the label with "Avoids:". Confidence should reflect the negation.
- preferredAirlines / avoidedAirlines: airline_preference (use description to note preference vs avoidance).
- diningPreferences: dining_preference + occasionally dietary_restriction.
- accessibilityNeeds: accessibility_need.
- dietaryNeeds: dietary_restriction.
- desiredExperiences: experience_interest + occasionally trip_style.
- notes: any category that clearly fits.

Handle GENERAL category statements (e.g. "budget hotels", "boutique hotels", "luxury resorts") as first-class tokens — do not require a specific brand name. These still become hotel_tier inferences with the category phrase as the token.

Output strict JSON matching this shape exactly:
{"inferences": [{"category": "<enum>", "label": "<short human label>", "description": "<one sentence explaining what was detected>", "confidence": <0.0-1.0>, "tokens": ["<normalized token>", ...], "sourceField": "<fieldName from input>"}]}

Rules:
- Only output inferences you are reasonably confident about (>= 0.5).
- Group related tokens into one inference per category+field (e.g. all cuisines from a dining field → one dining_preference inference with multiple tokens).
- Normalize tokens: lowercase, no trailing punctuation, canonical form ("veggie" → "vegetarian", "four seasons hotels" → "four seasons").
- If no signals found, return {"inferences": []}.
- Do not invent tokens not grounded in the text.
- Do not output prose, markdown, or anything outside the JSON object.`;

async function callClaudeForExtraction(
  fields: TextFieldInput[],
): Promise<ExtractedInference[]> {
  const nonEmpty = fields.filter((f) => f.text && f.text.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  const userContent = nonEmpty
    .map((f) => `Field: ${f.fieldName}\nText: ${f.text.trim()}`)
    .join("\n\n");

  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 900,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
  });

  const raw =
    response.content[0].type === "text" ? response.content[0].text : "";

  const jsonStart = raw.indexOf("{");
  const jsonEnd = raw.lastIndexOf("}");
  if (jsonStart === -1 || jsonEnd === -1) return [];
  const jsonText = raw.slice(jsonStart, jsonEnd + 1);

  try {
    const parsed = JSON.parse(jsonText) as {
      inferences?: ExtractedInference[];
    };
    const list = parsed.inferences ?? [];
    return list.filter(
      (i) =>
        i &&
        typeof i.category === "string" &&
        EXTRACTABLE_CATEGORIES.includes(i.category as InferenceCategory) &&
        Array.isArray(i.tokens) &&
        i.tokens.length > 0 &&
        typeof i.confidence === "number" &&
        i.confidence >= 0.5,
    );
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export interface TextExtractionResult {
  created: number;
  inferences: Awaited<
    ReturnType<typeof prisma.inferredPreference.findMany>
  >;
  tokensByField: Record<string, ExtractedToken[]>;
}

export async function runAndPersistTextExtractions(
  clientId: string,
  fields: TextFieldInput[],
): Promise<TextExtractionResult> {
  const candidates = await callClaudeForExtraction(fields);

  const tokensByField: Record<string, ExtractedToken[]> = {};
  for (const f of fields) tokensByField[f.fieldName] = [];

  if (candidates.length === 0) {
    return { created: 0, inferences: [], tokensByField };
  }

  for (const c of candidates) {
    const bucket = tokensByField[c.sourceField] ?? [];
    for (const tok of c.tokens) {
      bucket.push({
        token: tok,
        category: c.category,
        sourceField: c.sourceField,
      });
    }
    tokensByField[c.sourceField] = bucket;
  }

  const created = await prisma.inferredPreference.createMany({
    data: candidates.map((c) => ({
      clientId,
      category: c.category,
      label: c.label,
      description: c.description,
      confidence: c.confidence,
      evidence: {
        tokens: c.tokens,
        sourceField: c.sourceField,
      } as Prisma.InputJsonValue,
      source: "text_extraction",
      sourceField: c.sourceField,
    })),
  });

  const inferences = await prisma.inferredPreference.findMany({
    where: {
      clientId,
      source: "text_extraction",
      status: "pending",
    },
    orderBy: { createdAt: "desc" },
    take: created.count,
  });

  return { created: created.count, inferences, tokensByField };
}
