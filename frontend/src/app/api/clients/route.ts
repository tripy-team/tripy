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
    const { firstName, lastName, email, phone, dateOfBirth, notes, clientType, initialBalances } = body;

    if (!firstName || !lastName) {
      return errorResponse("First name and last name are required", 400);
    }

    const validTypes = ["individual", "business"];
    const type = validTypes.includes(clientType) ? clientType : "individual";

    const result = await prisma.$transaction(async (tx) => {
      const client = await tx.client.create({
        data: {
          organizationId: user.organizationId,
          ownerUserId: user.id,
          clientType: type,
          firstName,
          lastName,
          email: email || null,
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

      return client;
    });

    return json(result, 201);
  } catch (error) {
    console.error("Create client error:", error);
    return errorResponse("Internal server error", 500);
  }
}
