import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  generateSuggestions,
  type ClientSnapshot,
  type IntakeSnapshot,
} from "@/lib/suggestion-engine";

// GET — list current suggestions for a client
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const url = new URL(request.url);
    const statusFilter = url.searchParams.get("status");

    const where: Record<string, unknown> = { clientId };
    if (statusFilter) {
      where.status = statusFilter;
    }

    const suggestions = await prisma.followUpSuggestion.findMany({
      where,
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    });

    return json(suggestions);
  } catch (error) {
    console.error("List follow-up suggestions error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// POST — regenerate suggestions from current intake/profile state
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
      include: {
        preferences: true,
        loyaltyBalances: { include: { loyaltyProgram: true } },
        familyMembers: true,
        intakes: { orderBy: { createdAt: "desc" }, take: 1 },
        tripRequests: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!client) return errorResponse("Client not found", 404);

    const latestIntake = client.intakes[0] ?? null;

    const snapshot: ClientSnapshot = {
      client: {
        id: client.id,
        firstName: client.firstName,
        lastName: client.lastName,
        clientType: client.clientType,
      },
      intake: latestIntake
        ? ({
            id: latestIntake.id,
            status: latestIntake.status,
            tripType: latestIntake.tripType,
            destinations: latestIntake.destinations,
            departureAirports: latestIntake.departureAirports,
            dateFlexibility: latestIntake.dateFlexibility,
            earliestDeparture: latestIntake.earliestDeparture?.toISOString() ?? null,
            latestReturn: latestIntake.latestReturn?.toISOString() ?? null,
            tripDurationDays: latestIntake.tripDurationDays,
            budgetMin: latestIntake.budgetMin,
            budgetMax: latestIntake.budgetMax,
            budgetNotes: latestIntake.budgetNotes,
            cabinPreference: latestIntake.cabinPreference,
            hotelStyles: latestIntake.hotelStyles,
            luxuryPreference: latestIntake.luxuryPreference,
            travelPace: latestIntake.travelPace,
            layoverTolerance: latestIntake.layoverTolerance,
            travelerCount: latestIntake.travelerCount,
            childrenCount: latestIntake.childrenCount,
            childrenAges: latestIntake.childrenAges,
            familyFriendly: latestIntake.familyFriendly,
            desiredExperiences: latestIntake.desiredExperiences,
            dealbreakers: latestIntake.dealbreakers,
            preferredAirlines: latestIntake.preferredAirlines,
            avoidedAirlines: latestIntake.avoidedAirlines,
            accessibilityNeeds: latestIntake.accessibilityNeeds,
            dietaryNeeds: latestIntake.dietaryNeeds,
            notes: latestIntake.notes,
          } satisfies IntakeSnapshot)
        : null,
      preferences: client.preferences
        ? {
            preferredCabin: client.preferences.preferredCabin,
            prefersNonstop: client.preferences.prefersNonstop,
            redemptionStyle: client.preferences.redemptionStyle,
            budgetSensitivity: client.preferences.budgetSensitivity,
            pointsVsCash: client.preferences.pointsVsCash,
            preferredAirlines: client.preferences.preferredAirlines,
            avoidedAirlines: client.preferences.avoidedAirlines,
            dealbreakers: client.preferences.dealbreakers,
          }
        : null,
      balances: client.loyaltyBalances.map((b) => ({
        programName: b.loyaltyProgram?.name ?? "Unknown",
        balance: b.balance,
        expirationDate: b.expirationDate?.toISOString() ?? null,
      })),
      familyMembers: client.familyMembers.map((m) => ({
        name: m.name,
        relationship: m.relationship,
        dateOfBirth: m.dateOfBirth?.toISOString() ?? null,
      })),
      trips: client.tripRequests.map((t) => ({
        travelerCount: t.travelerCount,
        cabinPreference: t.cabinPreference,
        budgetCash: t.budgetCash,
      })),
    };

    const rawSuggestions = generateSuggestions(snapshot);

    // Fetch existing suggestions so we preserve status for questions already
    // acted on (asked/answered/skipped).
    const existing = await prisma.followUpSuggestion.findMany({
      where: { clientId },
    });
    const existingByKey = new Map(existing.map((s) => [s.ruleKey, s]));

    // Upsert: keep status for existing rule keys, insert new ones,
    // soft-delete stale ones that the engine no longer produces.
    const activeKeys = new Set(rawSuggestions.map((s) => s.ruleKey));

    const upserts = rawSuggestions.map((s) => {
      const prev = existingByKey.get(s.ruleKey);
      if (prev) {
        return prisma.followUpSuggestion.update({
          where: { id: prev.id },
          data: {
            questionText: s.questionText,
            reason: s.reason,
            priority: s.priority,
            category: s.category,
            intakeId: latestIntake?.id ?? null,
          },
        });
      }
      return prisma.followUpSuggestion.create({
        data: {
          clientId,
          intakeId: latestIntake?.id ?? null,
          category: s.category,
          priority: s.priority,
          questionText: s.questionText,
          reason: s.reason,
          ruleKey: s.ruleKey,
        },
      });
    });

    // Remove stale suggestions that are still pending
    const deletes = existing
      .filter((s) => !activeKeys.has(s.ruleKey) && s.status === "pending")
      .map((s) => prisma.followUpSuggestion.delete({ where: { id: s.id } }));

    await prisma.$transaction([...upserts, ...deletes]);

    const suggestions = await prisma.followUpSuggestion.findMany({
      where: { clientId },
      orderBy: [{ priority: "asc" }, { createdAt: "desc" }],
    });

    return json(suggestions, 200);
  } catch (error) {
    console.error("Generate follow-up suggestions error:", error);
    return errorResponse("Internal server error", 500);
  }
}
