import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const clients = await prisma.client.findMany({
      where: { organizationId: user.organizationId, status: "active" },
      include: {
        _count: { select: { loyaltyBalances: true, tripRequests: true } },
        loyaltyBalances: {
          select: {
            id: true,
            balance: true,
            expirationDate: true,
            loyaltyProgram: { select: { name: true, code: true, category: true } },
          },
          orderBy: { balance: "desc" },
          take: 5,
        },
        tripRequests: {
          select: {
            id: true,
            title: true,
            destinationAirports: true,
            departureDate: true,
            returnDate: true,
            status: true,
          },
          orderBy: { departureDate: "desc" },
          take: 3,
        },
      },
      orderBy: { createdAt: "desc" },
    });

    return json(clients);
  } catch (error) {
    console.error("List clients error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { firstName, lastName, email, phone, dateOfBirth, notes, clientType, initialBalances, groupProfile, businessProfile } = body;

    if (!firstName || !lastName || !email) {
      return errorResponse("First name, last name, and email are required", 400);
    }

    const existing = await prisma.client.findFirst({
      where: { organizationId: user.organizationId, email },
      select: { id: true },
    });
    if (existing) {
      return json({ error: "A client with this email already exists.", existingClientId: existing.id }, 409);
    }

    const validTypes = ["individual", "group", "business"];
    const type = validTypes.includes(clientType) ? clientType : "individual";

    const result = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          organizationId: user.organizationId,
          ownerUserId: user.id,
          clientType: type,
          firstName,
          lastName,
          email: email,
          phone: phone || null,
          dateOfBirth: dateOfBirth ? new Date(dateOfBirth) : null,
          notes: notes || null,
        },
      });

      if (Array.isArray(initialBalances) && initialBalances.length > 0) {
        for (const bal of initialBalances) {
          if (!bal.loyaltyProgramId || bal.balance === undefined) continue;
          const loyaltyBalance = await tx.clientLoyaltyBalance.create({
            data: {
              clientId: client.id,
              loyaltyProgramId: bal.loyaltyProgramId,
              balance: Number(bal.balance),
              expirationDate: bal.expirationDate ? new Date(bal.expirationDate) : null,
              notes: bal.notes || null,
            },
          });
          await tx.balanceLedgerEntry.create({
            data: {
              clientLoyaltyBalanceId: loyaltyBalance.id,
              previousBalance: 0,
              newBalance: Number(bal.balance),
              changeReason: "Initial balance entry",
              changedByUserId: user.id,
            },
          });
        }
      }

      if (type === "group" && groupProfile) {
        await tx.groupProfile.create({
          data: {
            clientId: client.id,
            groupType: groupProfile.groupType || "leisure_friends",
            estimatedSize: groupProfile.estimatedSize ? Number(groupProfile.estimatedSize) : null,
            ageSpread: groupProfile.ageSpread || null,
            decisionStyle: groupProfile.decisionStyle || "consensus",
            roomArrangement: groupProfile.roomArrangement || null,
            sharedBilling: groupProfile.sharedBilling ?? false,
            notes: groupProfile.notes || null,
          },
        });
      }

      if (type === "business" && businessProfile) {
        await tx.businessProfile.create({
          data: {
            clientId: client.id,
            companyName: businessProfile.companyName || firstName,
            industry: businessProfile.industry || null,
            companySize: businessProfile.companySize || null,
            billingContactName: businessProfile.billingContactName || null,
            billingContactEmail: businessProfile.billingContactEmail || null,
            requiresPreApproval: businessProfile.requiresPreApproval ?? false,
            maxNightlyRateUsd: businessProfile.maxNightlyRateUsd ? Number(businessProfile.maxNightlyRateUsd) : null,
            travelPolicyNotes: businessProfile.travelPolicyNotes || null,
          },
        });
      }

      return client;
    });

    return json(result, 201);
  } catch (error) {
    console.error("Create client error:", error);
    return errorResponse("Internal server error", 500);
  }
}
