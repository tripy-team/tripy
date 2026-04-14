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

    const profile = await prisma.businessProfile.findUnique({
      where: { clientId: id },
      include: {
        travelers: {
          include: {
            linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    return json(profile);
  } catch (error) {
    console.error("Get business profile error:", error);
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
    if (client.clientType !== "business") return errorResponse("Client is not a business type", 400);

    const body = await request.json();
    const {
      companyName, industry, companySize, billingContactName, billingContactEmail,
      requiresPreApproval, maxNightlyRateUsd, travelPolicyNotes, corporateAccountIds,
    } = body;

    if (!companyName) return errorResponse("companyName is required", 400);

    const profile = await prisma.businessProfile.upsert({
      where: { clientId: id },
      create: {
        clientId: id,
        companyName,
        industry: industry || null,
        companySize: companySize || null,
        billingContactName: billingContactName || null,
        billingContactEmail: billingContactEmail || null,
        requiresPreApproval: requiresPreApproval ?? false,
        maxNightlyRateUsd: maxNightlyRateUsd ? Number(maxNightlyRateUsd) : null,
        travelPolicyNotes: travelPolicyNotes || null,
        corporateAccountIds: corporateAccountIds || null,
      },
      update: {
        ...(companyName !== undefined && { companyName }),
        ...(industry !== undefined && { industry }),
        ...(companySize !== undefined && { companySize }),
        ...(billingContactName !== undefined && { billingContactName }),
        ...(billingContactEmail !== undefined && { billingContactEmail }),
        ...(requiresPreApproval !== undefined && { requiresPreApproval }),
        ...(maxNightlyRateUsd !== undefined && { maxNightlyRateUsd: maxNightlyRateUsd ? Number(maxNightlyRateUsd) : null }),
        ...(travelPolicyNotes !== undefined && { travelPolicyNotes }),
        ...(corporateAccountIds !== undefined && { corporateAccountIds }),
      },
      include: {
        travelers: {
          include: {
            linkedClient: { select: { id: true, firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    return json(profile);
  } catch (error) {
    console.error("Upsert business profile error:", error);
    return errorResponse("Internal server error", 500);
  }
}
