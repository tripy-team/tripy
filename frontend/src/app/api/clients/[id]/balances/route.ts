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

    const balances = await prisma.clientLoyaltyBalance.findMany({
      where: { clientId: id },
      include: { loyaltyProgram: true },
      orderBy: { createdAt: "desc" },
    });

    return json(balances);
  } catch (error) {
    console.error("List balances error:", error);
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
    const { loyaltyProgramId, balance, expirationDate, notes } = body;

    if (!loyaltyProgramId || balance === undefined) {
      return errorResponse("loyaltyProgramId and balance are required", 400);
    }

    const loyaltyBalance = await prisma.clientLoyaltyBalance.create({
      data: {
        clientId: id,
        loyaltyProgramId,
        balance,
        expirationDate: expirationDate ? new Date(expirationDate) : null,
        notes: notes || null,
      },
      include: { loyaltyProgram: true },
    });

    await prisma.balanceLedgerEntry.create({
      data: {
        clientLoyaltyBalanceId: loyaltyBalance.id,
        previousBalance: 0,
        newBalance: balance,
        changeReason: "Initial balance entry",
        changedByUserId: user.id,
      },
    });

    return json(loyaltyBalance, 201);
  } catch (error) {
    console.error("Create balance error:", error);
    return errorResponse("Internal server error", 500);
  }
}
