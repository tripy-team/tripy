import { prisma } from "@/lib/prisma";
import { json, errorResponse } from "@/lib/auth";

function getQuestions(variant: string, groupSize: number | null) {
  const size = groupSize ?? 1;

  const universal = [
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
    const base = [
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
    const base = [
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
    const base = [
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
    if (record.completedAt) return json({ status: "completed" });
    if (record.expiresAt < new Date()) return json({ status: "expired" });

    // Mark opened on first view
    if (!record.openedAt) {
      await prisma.intakeFormToken.update({ where: { token }, data: { openedAt: new Date() } });
    }

    const questions = getQuestions(record.formVariant, record.groupSize);

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

export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    const record = await prisma.intakeFormToken.findUnique({ where: { token } });
    if (!record) return errorResponse("Invalid or expired link", 404);
    if (record.completedAt) return errorResponse("Form already submitted", 400);
    if (record.expiresAt < new Date()) return errorResponse("Link has expired", 410);

    const body = await request.json();
    const { answers } = body as { answers: Record<string, string> };
    if (!answers || typeof answers !== "object") return errorResponse("answers object is required", 400);

    // Find or create the associated intake record
    let intakeId = record.intakeId;
    if (!intakeId) {
      // Get the org's system user to act as creator (we don't have auth here)
      const clientRecord = await prisma.client.findUnique({
        where: { id: record.clientId },
        include: { owner: true },
      });
      if (!clientRecord) return errorResponse("Client not found", 404);

      const intake = await prisma.clientIntake.create({
        data: {
          clientId: record.clientId,
          createdByUserId: clientRecord.ownerUserId,
          status: "complete",
          notes: `Submitted via intake form by ${record.recipientName || record.recipientEmail}. Answers: ${JSON.stringify(answers)}`,
          completedAt: new Date(),
          // Map known answer keys to structured fields
          ...(answers.cabin_preference && {
            cabinPreference: mapCabin(answers.cabin_preference),
          }),
          ...(answers.travel_pace && {
            travelPace: mapPace(answers.travel_pace),
          }),
          ...(answers.layover_tolerance && {
            layoverTolerance: mapLayover(answers.layover_tolerance),
          }),
          ...(answers.dietary_needs && { dietaryNeeds: answers.dietary_needs }),
          ...(answers.accessibility_needs && { accessibilityNeeds: answers.accessibility_needs }),
        },
      });
      intakeId = intake.id;
    }

    await prisma.intakeFormToken.update({
      where: { token },
      data: { completedAt: new Date(), intakeId },
    });

    return json({ status: "completed" });
  } catch (error) {
    console.error("Submit form error:", error);
    return errorResponse("Internal server error", 500);
  }
}

function mapCabin(v: string) {
  const m: Record<string, string> = { "Economy": "economy", "Premium Economy": "premium_economy", "Business": "business", "First": "first", "Flexible": "flexible" };
  return (m[v] as never) ?? "economy";
}

function mapPace(v: string) {
  const m: Record<string, string> = { "Relaxed": "relaxed", "Moderate": "moderate", "Active": "active", "Packed": "packed" };
  return (m[v] as never) ?? undefined;
}

function mapLayover(v: string) {
  const m: Record<string, string> = { "Nonstop only": "nonstop_only", "Prefer nonstop": "prefer_nonstop", "No preference": "no_preference", "Layovers fine if cheaper": "layovers_ok" };
  return (m[v] as never) ?? undefined;
}
