import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string; balanceId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, balanceId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const existing = await prisma.clientLoyaltyBalance.findFirst({
      where: { id: balanceId, clientId: id },
    });
    if (!existing) return errorResponse("Balance not found", 404);

    const body = await request.json();
    const { balance, expirationDate, notes } = body;

    const updated = await prisma.clientLoyaltyBalance.update({
      where: { id: balanceId },
      data: {
        ...(balance !== undefined && { balance }),
        ...(expirationDate !== undefined && {
          expirationDate: expirationDate ? new Date(expirationDate) : null,
        }),
        ...(notes !== undefined && { notes }),
      },
      include: { loyaltyProgram: true },
    });

    if (balance !== undefined && balance !== existing.balance) {
      await prisma.balanceLedgerEntry.create({
        data: {
          clientLoyaltyBalanceId: balanceId,
          previousBalance: existing.balance,
          newBalance: balance,
          changeReason: "Balance updated",
          changedByUserId: user.id,
        },
      });
    }

    return json(updated);
  } catch (error) {
    console.error("Update balance error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; balanceId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, balanceId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const existing = await prisma.clientLoyaltyBalance.findFirst({
      where: { id: balanceId, clientId: id },
    });
    if (!existing) return errorResponse("Balance not found", 404);

    await prisma.clientLoyaltyBalance.delete({ where: { id: balanceId } });

    return json({ success: true });
  } catch (error) {
    console.error("Delete balance error:", error);
    return errorResponse("Internal server error", 500);
  }
}
