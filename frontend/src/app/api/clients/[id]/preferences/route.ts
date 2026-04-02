import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

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

    const preferences = await prisma.clientPreference.findUnique({
      where: { clientId: id },
    });

    return json(preferences);
  } catch (error) {
    console.error("Get preferences error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PUT(
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
    const {
      preferredCabin,
      prefersNonstop,
      maxLayoverMinutes,
      willingToReposition,
      redemptionStyle,
      avoidBasicEconomy,
      preferredAirlines,
      avoidedAirlines,
      notes,
    } = body;

    const preferences = await prisma.clientPreference.upsert({
      where: { clientId: id },
      create: {
        clientId: id,
        preferredCabin: preferredCabin ?? "economy",
        prefersNonstop: prefersNonstop ?? false,
        maxLayoverMinutes: maxLayoverMinutes ?? null,
        willingToReposition: willingToReposition ?? false,
        redemptionStyle: redemptionStyle ?? "balanced",
        avoidBasicEconomy: avoidBasicEconomy ?? false,
        preferredAirlines: preferredAirlines ?? null,
        avoidedAirlines: avoidedAirlines ?? null,
        notes: notes ?? null,
      },
      update: {
        ...(preferredCabin !== undefined && { preferredCabin }),
        ...(prefersNonstop !== undefined && { prefersNonstop }),
        ...(maxLayoverMinutes !== undefined && { maxLayoverMinutes }),
        ...(willingToReposition !== undefined && { willingToReposition }),
        ...(redemptionStyle !== undefined && { redemptionStyle }),
        ...(avoidBasicEconomy !== undefined && { avoidBasicEconomy }),
        ...(preferredAirlines !== undefined && { preferredAirlines }),
        ...(avoidedAirlines !== undefined && { avoidedAirlines }),
        ...(notes !== undefined && { notes }),
      },
    });

    return json(preferences);
  } catch (error) {
    console.error("Upsert preferences error:", error);
    return errorResponse("Internal server error", 500);
  }
}
