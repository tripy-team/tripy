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

    const balanceIds = await prisma.clientLoyaltyBalance.findMany({
      where: { clientId: id },
      select: { id: true },
    });

    const entries = await prisma.balanceLedgerEntry.findMany({
      where: {
        clientLoyaltyBalanceId: { in: balanceIds.map((b) => b.id) },
      },
      include: {
        balance: { include: { loyaltyProgram: true } },
        changedBy: { select: { id: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: "desc" },
    });

    return json(entries);
  } catch (error) {
    console.error("List balance ledger error:", error);
    return errorResponse("Internal server error", 500);
  }
}
