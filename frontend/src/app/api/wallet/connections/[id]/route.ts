import { errorResponse, getAuthUser, json } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const connection = await prisma.walletConnection.findFirst({
      where: { id, userId: user.id },
    });
    if (!connection) return errorResponse("Wallet connection not found", 404);

    await prisma.$transaction([
      prisma.walletConnection.update({
        where: { id },
        data: {
          status: "disconnected",
          lastError: null,
        },
      }),
      prisma.walletAccount.updateMany({
        where: { connectionId: id, userId: user.id },
        data: {
          enabledForOptimization: false,
        },
      }),
    ]);

    return json({ ok: true });
  } catch (error) {
    console.error("Disconnect wallet error:", error);
    return errorResponse("Internal server error", 500);
  }
}
