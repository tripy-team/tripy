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
  _request: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  try {
    const user = await getAuthUser(_request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, intakeId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const intake = await prisma.clientIntake.findFirst({
      where: { id: intakeId, clientId: id },
    });
    if (!intake) return errorResponse("Intake not found", 404);

    return json(intake);
  } catch (error) {
    console.error("Get client intake error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, intakeId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const existing = await prisma.clientIntake.findFirst({
      where: { id: intakeId, clientId: id },
    });
    if (!existing) return errorResponse("Intake not found", 404);

    const body = await request.json();
    const data = pickIntakeData(body);

    if (body.status === "complete" && existing.status !== "complete") {
      (data as Record<string, unknown>).status = "complete";
      (data as Record<string, unknown>).completedAt = new Date();
    } else if (body.status === "draft") {
      (data as Record<string, unknown>).status = "draft";
      (data as Record<string, unknown>).completedAt = null;
    }

    const intake = await prisma.clientIntake.update({
      where: { id: intakeId },
      data,
    });

    return json(intake);
  } catch (error) {
    console.error("Update client intake error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, intakeId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const existing = await prisma.clientIntake.findFirst({
      where: { id: intakeId, clientId: id },
    });
    if (!existing) return errorResponse("Intake not found", 404);

    await prisma.clientIntake.delete({ where: { id: intakeId } });

    return json({ success: true });
  } catch (error) {
    console.error("Delete client intake error:", error);
    return errorResponse("Internal server error", 500);
  }
}
