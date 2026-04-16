import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

const INTAKE_FIELDS = [
  "tripType",
  "tripTypeOther",
  "destinations",
  "departureAirports",
  "dateFlexibility",
  "earliestDeparture",
  "latestReturn",
  "tripDurationDays",
  "budgetMin",
  "budgetMax",
  "budgetCurrency",
  "budgetNotes",
  "preferredFlightRouting",
  "cabinPreference",
  "hotelStyles",
  "loyaltyNotes",
  "accessibilityNeeds",
  "dietaryNeeds",
  "travelPace",
  "layoverTolerance",
  "luxuryPreference",
  "familyFriendly",
  "travelerCount",
  "childrenCount",
  "childrenAges",
  "desiredExperiences",
  "dealbreakers",
  "preferredAirlines",
  "avoidedAirlines",
  "preferredAccommodationBrands",
  "accommodationDealbreakers",
  "notes",
  "isTemplate",
  "templateName",
] as const;

function pickIntakeData(body: Record<string, unknown>) {
  const data: Record<string, unknown> = {};
  for (const key of INTAKE_FIELDS) {
    if (key in body) {
      if (
        (key === "earliestDeparture" || key === "latestReturn") &&
        body[key]
      ) {
        data[key] = new Date(body[key] as string);
      } else {
        data[key] = body[key];
      }
    }
  }
  return data;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const intakes = await prisma.clientIntake.findMany({
      where: { clientId: id },
      orderBy: { updatedAt: "desc" },
    });

    return json(intakes);
  } catch (error) {
    console.error("List client intakes error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const body = await request.json();
    const data = pickIntakeData(body);

    if (body.status === "complete") {
      (data as Record<string, unknown>).status = "complete";
      (data as Record<string, unknown>).completedAt = new Date();
    }

    const intake = await prisma.clientIntake.create({
      data: {
        clientId: id,
        createdByUserId: user.id,
        ...data,
      },
    });

    return json(intake, 201);
  } catch (error) {
    console.error("Create client intake error:", error);
    return errorResponse("Internal server error", 500);
  }
}
