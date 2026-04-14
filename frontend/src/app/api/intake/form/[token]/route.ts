import { prisma } from "@/lib/prisma";
import { json, errorResponse } from "@/lib/auth";
import { sendFormCompletionNotification, sendFormSubmissionConfirmation, buildClientUrl } from "@/lib/email";

// ---------------------------------------------------------------------------
// Question banks
// ---------------------------------------------------------------------------

interface Question {
  id: string;
  label: string;
  type: "text" | "textarea" | "select";
  options?: string[];
}

function getQuestions(variant: string, groupSize: number | null): Question[] {
  const size = groupSize ?? 1;

  const universal: Question[] = [
    { id: "departure_city", label: "What city will you be departing from?", type: "text" },
    { id: "cabin_preference", label: "What is your preferred cabin class?", type: "select", options: ["Economy", "Premium Economy", "Business", "First", "Flexible"] },
    { id: "hotel_preference", label: "What type of accommodation do you prefer?", type: "select", options: ["Budget", "Standard", "Upscale", "Luxury"] },
    { id: "dietary_needs", label: "Any dietary restrictions or preferences?", type: "text" },
    { id: "accessibility_needs", label: "Any accessibility requirements?", type: "text" },
  ];

  if (variant === "individual") {
    return [
      ...universal,
      { id: "preferred_airlines", label: "Do you have preferred airlines?", type: "text" },
      { id: "layover_tolerance", label: "Nonstop preference?", type: "select", options: ["Nonstop only", "Prefer nonstop", "No preference", "Layovers fine if cheaper"] },
      { id: "travel_pace", label: "How do you like to travel?", type: "select", options: ["Relaxed", "Moderate", "Active", "Packed"] },
      { id: "loyalty_programs", label: "What loyalty programs do you participate in? (and approximate balances)", type: "textarea" },
      { id: "special_occasions", label: "Any upcoming celebrations or special occasions?", type: "text" },
      { id: "hard_constraints", label: "Any hard requirements for your trip?", type: "textarea" },
    ];
  }

  if (variant === "group_organizer") {
    const base: Question[] = [
      { id: "destination_flexibility", label: "How flexible is the group on destination?", type: "select", options: ["Fixed destination", "Open to suggestions", "Flexible"] },
      { id: "budget_per_person", label: "Approximate budget per person (USD)?", type: "text" },
      { id: "decision_timeline", label: "When do you need to finalize the trip?", type: "text" },
    ];
    if (size >= 7) base.push(
      { id: "room_block_needs", label: "Does the group need a room block?", type: "select", options: ["Yes", "No", "Not sure"] },
      { id: "group_dinners", label: "Group dinners every night or individual evenings?", type: "select", options: ["Group dinners", "Individual", "Mix"] },
      { id: "backup_contact", label: "If you're unavailable, who should the advisor contact?", type: "text" },
    );
    if (size >= 21) base.push(
      { id: "master_billing", label: "Master billing or individual folios?", type: "select", options: ["Master billing", "Individual folios", "Mix"] },
      { id: "group_transfers", label: "Will the group need group airport transfers?", type: "select", options: ["Yes", "No", "Not sure"] },
    );
    return base;
  }

  if (variant === "group_member") {
    const base: Question[] = [
      ...universal,
      { id: "budget_comfort", label: "What is your personal budget comfort level for this trip?", type: "select", options: ["Budget", "Moderate", "Comfortable", "Luxury"] },
      { id: "activity_preferences", label: "What activities are you most interested in?", type: "textarea" },
      { id: "room_sharing", label: "Are you open to sharing a room to reduce costs?", type: "select", options: ["Yes", "No", "Depends on who"] },
    ];
    if (size >= 7) base.push(
      { id: "arrival_flexibility", label: "How flexible are you on arrival/departure timing?", type: "select", options: ["Flexible", "Prefer to travel with the group", "Fixed dates"] },
    );
    if (size >= 21) base.push(
      { id: "accessible_room", label: "Do you need an accessible room?", type: "select", options: ["Yes", "No"] },
    );
    return base;
  }

  if (variant === "business_policy") {
    const base: Question[] = [
      { id: "preferred_cabin_domestic", label: "Permitted cabin class for domestic flights?", type: "select", options: ["Economy", "Economy Plus", "Business", "No restriction"] },
      { id: "preferred_cabin_international", label: "Permitted cabin class for international flights?", type: "select", options: ["Economy", "Premium Economy", "Business", "First", "By seniority"] },
      { id: "max_nightly_rate", label: "Maximum nightly hotel rate (USD)?", type: "text" },
      { id: "who_approves", label: "Who approves travel bookings?", type: "text" },
    ];
    if (size >= 16) base.push(
      { id: "approval_threshold", label: "What spend threshold requires additional approval?", type: "text" },
      { id: "dept_tracking", label: "Do you track travel spend by department?", type: "select", options: ["Yes", "No"] },
      { id: "preferred_vendors", label: "Any preferred airlines or hotel chains?", type: "textarea" },
    );
    if (size >= 100) base.push(
      { id: "approval_chain", label: "Describe your approval chain (traveler → manager → finance)?", type: "textarea" },
      { id: "corporate_rates", label: "Do you have negotiated corporate rates with any vendors?", type: "textarea" },
      { id: "tmc_relationship", label: "Do you use a Travel Management Company (TMC)?", type: "select", options: ["Yes", "No"] },
      { id: "reporting_cadence", label: "How often do you need travel spend reports?", type: "select", options: ["Per trip", "Monthly", "Quarterly", "Annually"] },
    );
    return base;
  }

  if (variant === "business_traveler") {
    return [
      ...universal,
      { id: "seat_preference", label: "Preferred seat on flights?", type: "select", options: ["Window", "Aisle", "No preference"] },
      { id: "loyalty_programs", label: "Your loyalty programs and approximate balances?", type: "textarea" },
      { id: "special_needs", label: "Any special requirements for business travel?", type: "text" },
    ];
  }

  return universal;
}

// ---------------------------------------------------------------------------
// Preference mapping helpers
// ---------------------------------------------------------------------------

function mapAnswersToPreferenceData(answers: Record<string, string>): Record<string, unknown> {
  const prefs: Record<string, unknown> = {};

  if (answers.cabin_preference) {
    const cabinMap: Record<string, string> = {
      "Economy": "economy",
      "Premium Economy": "premium_economy",
      "Business": "business",
      "First": "first",
      "Flexible": "flexible",
    };
    prefs.preferredCabin = (cabinMap[answers.cabin_preference] ?? "economy") as never;
  }

  if (answers.layover_tolerance) {
    const layoverMap: Record<string, boolean> = {
      "Nonstop only": true,
      "Prefer nonstop": true,
      "No preference": false,
      "Layovers fine if cheaper": false,
    };
    prefs.prefersNonstop = layoverMap[answers.layover_tolerance] ?? false;
  }

  if (answers.hotel_preference) {
    const hotelMap: Record<string, string[]> = {
      "Budget": ["budget"],
      "Standard": ["standard"],
      "Upscale": ["upscale", "boutique"],
      "Luxury": ["luxury", "ultra_luxury"],
    };
    prefs.preferredHotelTypes = hotelMap[answers.hotel_preference] ?? [];
  }

  if (answers.dietary_needs && answers.dietary_needs.trim()) {
    prefs.foodPreferences = [answers.dietary_needs.trim()];
  }

  if (answers.accessibility_needs && answers.accessibility_needs.trim()) {
    prefs.accessibilityNeeds = [answers.accessibility_needs.trim()];
  }

  if (answers.preferred_airlines && answers.preferred_airlines.trim()) {
    prefs.preferredAirlines = answers.preferred_airlines
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (answers.activity_preferences && answers.activity_preferences.trim()) {
    prefs.activityPreferences = answers.activity_preferences
      .split(/[,;\n]+/)
      .map((s) => s.trim())
      .filter(Boolean);
  }

  if (answers.special_occasions && answers.special_occasions.trim()) {
    prefs.specialOccasions = [answers.special_occasions.trim()];
  }

  if (answers.hard_constraints && answers.hard_constraints.trim()) {
    prefs.dealbreakers = [answers.hard_constraints.trim()];
  }

  if (answers.budget_comfort) {
    const budgetMap: Record<string, string> = {
      "Budget": "budget",
      "Moderate": "moderate",
      "Comfortable": "comfortable",
      "Luxury": "luxury",
    };
    prefs.budgetSensitivity = (budgetMap[answers.budget_comfort] ?? "moderate") as never;
  }

  return prefs;
}

// ---------------------------------------------------------------------------
// GET — serve form metadata + questions
// ---------------------------------------------------------------------------

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    const record = await prisma.intakeFormToken.findUnique({
      where: { token },
      include: { client: { select: { firstName: true, lastName: true } } },
    });

    if (!record) return errorResponse("Invalid or expired link", 404);
    if (record.completedAt) {
      return json({
        status: "completed",
        formAnswers: record.formAnswers ?? null,
      });
    }
    if (record.expiresAt < new Date()) return json({ status: "expired" });

    // Mark opened on first view
    if (!record.openedAt) {
      await prisma.intakeFormToken.update({ where: { token }, data: { openedAt: new Date() } });
    }

    // For custom forms, serve the stored custom questions
    const questions =
      record.formVariant === "custom_form"
        ? (record.customQuestions as Question[] | null) ?? []
        : getQuestions(record.formVariant, record.groupSize);

    return json({
      status: "pending",
      recipientName: record.recipientName,
      formVariant: record.formVariant,
      groupSize: record.groupSize,
      questions,
    });
  } catch (error) {
    console.error("Get form error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// POST — submit answers
// ---------------------------------------------------------------------------

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    const record = await prisma.intakeFormToken.findUnique({
      where: { token },
      include: { client: { include: { owner: true } } },
    });
    if (!record) return errorResponse("Invalid or expired link", 404);
    if (record.completedAt) return errorResponse("Form already submitted", 400);
    if (record.expiresAt < new Date()) return errorResponse("Link has expired", 410);

    const body = await request.json();
    const { answers } = body as { answers: Record<string, string> };
    if (!answers || typeof answers !== "object") return errorResponse("answers object is required", 400);

    const client = record.client;
    const clientName = `${client.firstName} ${client.lastName}`;
    const advisor = client.owner;

    // Determine intake creation based on variant
    let intakeId = record.intakeId;

    if (record.formVariant !== "custom_form") {
      // Profile intake: create/update a structured ClientIntake
      if (!intakeId) {
        const intake = await prisma.clientIntake.create({
          data: {
            clientId: record.clientId,
            createdByUserId: advisor.id,
            status: "complete",
            notes: `Submitted via intake form by ${record.recipientName || record.recipientEmail}.\nAnswers: ${JSON.stringify(answers, null, 2)}`,
            completedAt: new Date(),
            ...(answers.cabin_preference && { cabinPreference: mapCabin(answers.cabin_preference) }),
            ...(answers.travel_pace && { travelPace: mapPace(answers.travel_pace) }),
            ...(answers.layover_tolerance && { layoverTolerance: mapLayover(answers.layover_tolerance) }),
            ...(answers.dietary_needs && { dietaryNeeds: answers.dietary_needs }),
            ...(answers.accessibility_needs && { accessibilityNeeds: answers.accessibility_needs }),
            ...(answers.preferred_airlines && { preferredAirlines: answers.preferred_airlines }),
          },
        });
        intakeId = intake.id;
      }
    }

    // Store raw answers on the token (works for both profile and custom)
    await prisma.intakeFormToken.update({
      where: { token },
      data: {
        completedAt: new Date(),
        intakeId: intakeId ?? undefined,
        formAnswers: answers as never,
      },
    });

    // Auto-merge preference data into client profile
    const prefData = mapAnswersToPreferenceData(answers);
    if (Object.keys(prefData).length > 0) {
      await mergeIntoPreferences(record.clientId, prefData, advisor.id);
    }

    // Send completion email to advisor
    const advisorEmail = record.advisorEmail || advisor.email;
    const advisorName = `${advisor.firstName} ${advisor.lastName}`.trim() || advisor.email;
    const formTitle =
      record.formVariant === "custom_form"
        ? "Custom Form"
        : VARIANT_TITLES[record.formVariant] ?? "Travel Form";

    if (advisorEmail) {
      await sendFormCompletionNotification({
        advisorEmail,
        advisorName,
        clientName,
        formTitle,
        clientUrl: buildClientUrl(record.clientId),
        formVariant: record.formVariant,
      }).catch((e) => console.error("[email] Completion notification failed:", e));
    }

    // Send submission confirmation to the recipient
    if (record.recipientEmail) {
      const questions =
        record.formVariant === "custom_form"
          ? ((record.customQuestions as { id: string; label: string }[] | null) ?? [])
          : getQuestions(record.formVariant, record.groupSize);
      const labeledAnswers = questions
        .filter((q) => answers[q.id] !== undefined && answers[q.id] !== "")
        .map((q) => ({ label: q.label, value: answers[q.id] }));
      await sendFormSubmissionConfirmation({
        recipientEmail: record.recipientEmail,
        recipientName: record.recipientName ?? undefined,
        advisorName,
        formTitle,
        answers: labeledAnswers,
      }).catch((e) => console.error("[email] Submission confirmation failed:", e));
    }

    return json({ status: "completed" });
  } catch (error) {
    console.error("Submit form error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// ---------------------------------------------------------------------------
// Preference merge helper
// ---------------------------------------------------------------------------

async function mergeIntoPreferences(
  clientId: string,
  prefData: Record<string, unknown>,
  changedByUserId: string,
): Promise<void> {
  try {
    const existing = await prisma.clientPreference.findUnique({ where: { clientId } });

    const ARRAY_FIELDS = new Set([
      "preferredAirlines", "avoidedAirlines", "preferredHotelTypes",
      "roomPreferences", "accessibilityNeeds", "foodPreferences",
      "activityPreferences", "specialOccasions", "dislikes", "dealbreakers",
    ]);

    const merged: Record<string, unknown> = {};
    const existingRecord = existing as Record<string, unknown> | null;

    for (const [field, incoming] of Object.entries(prefData)) {
      const existing_val = existingRecord?.[field] ?? null;
      if (ARRAY_FIELDS.has(field)) {
        const existingArr = Array.isArray(existing_val) ? existing_val : [];
        const incomingArr = Array.isArray(incoming) ? incoming : [incoming].filter(Boolean);
        merged[field] = [...new Set([...existingArr, ...incomingArr])];
      } else {
        // Keep existing scalar if already set
        merged[field] = existing_val ?? incoming;
      }
    }

    merged.lastUpdatedSource = "intake";

    const pref = await prisma.clientPreference.upsert({
      where: { clientId },
      create: {
        clientId,
        ...merged,
        preferredCabin: (merged.preferredCabin as never) ?? "economy",
        prefersNonstop: (merged.prefersNonstop as boolean) ?? false,
        willingToReposition: false,
        avoidBasicEconomy: false,
        redemptionStyle: "balanced",
        lastUpdatedSource: "intake",
      },
      update: merged,
    });

    // Log changes
    if (pref && existing) {
      const diffs = Object.entries(merged)
        .filter(([k]) => k !== "lastUpdatedSource")
        .map(([field, newVal]) => ({
          preferenceId: pref.id,
          changedByUserId,
          source: "intake" as const,
          fieldName: field,
          oldValue: (existingRecord?.[field] ?? null) as never,
          newValue: newVal as never,
        }));
      if (diffs.length > 0) {
        await prisma.preferenceChangeLog.createMany({ data: diffs }).catch(() => {});
      }
    }
  } catch (err) {
    console.error("[pref-merge] Failed to merge preferences:", err);
  }
}

// ---------------------------------------------------------------------------
// Value mappers
// ---------------------------------------------------------------------------

const VARIANT_TITLES: Record<string, string> = {
  individual: "Travel Preferences Form",
  group_member: "Group Trip Preferences",
  group_organizer: "Group Trip Details",
  business_policy: "Company Travel Policy",
  business_traveler: "Business Travel Preferences",
  custom_form: "Custom Form",
};

function mapCabin(v: string) {
  const m: Record<string, string> = {
    "Economy": "economy",
    "Premium Economy": "premium_economy",
    "Business": "business",
    "First": "first",
    "Flexible": "flexible",
  };
  return (m[v] as never) ?? "economy";
}

function mapPace(v: string) {
  const m: Record<string, string> = {
    "Relaxed": "relaxed",
    "Moderate": "moderate",
    "Active": "active",
    "Packed": "packed",
  };
  return (m[v] as never) ?? undefined;
}

function mapLayover(v: string) {
  const m: Record<string, string> = {
    "Nonstop only": "nonstop_only",
    "Prefer nonstop": "prefer_nonstop",
    "No preference": "no_preference",
    "Layovers fine if cheaper": "layovers_ok",
  };
  return (m[v] as never) ?? undefined;
}
