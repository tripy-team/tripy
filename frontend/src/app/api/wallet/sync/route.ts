import { errorResponse, getAuthUser, json } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { upsertWalletAccounts } from "@/lib/wallet/db";
import { isWalletProvider, syncWalletProvider } from "@/lib/wallet/providers";

export async function POST(request: Request) {
  const user = await getAuthUser(request);
  if (!user) return errorResponse("Unauthorized", 401);

  const body = await request.json().catch(() => ({}));
  const provider = isWalletProvider(body.provider) ? body.provider : "mock";

  try {
    let connection = body.connectionId
      ? await prisma.walletConnection.findFirst({
          where: {
            id: String(body.connectionId),
            userId: user.id,
            status: { not: "disconnected" },
          },
        })
      : await prisma.walletConnection.findFirst({
          where: {
            userId: user.id,
            provider,
            status: { not: "disconnected" },
          },
          orderBy: { createdAt: "desc" },
        });

    if (!connection) {
      connection = await prisma.walletConnection.create({
        data: {
          userId: user.id,
          provider,
          displayName: provider === "mock" ? "Demo points wallet" : "Points wallet",
          status: "active",
          consentScope: {
            accounts: "read",
            balances: "read",
            optimization: "explicit_user_enabled",
          },
        },
      });
    }

    const syncRun = await prisma.walletSyncRun.create({
      data: {
        userId: user.id,
        connectionId: connection.id,
        provider,
        status: "running",
      },
    });

    try {
      const providerResult = await syncWalletProvider(provider, {
        userId: user.id,
        connectionId: connection.id,
        providerConnectionId: connection.providerConnectionId,
        manualAccounts: body.accounts,
      });

      const upsertResult = await upsertWalletAccounts({
        userId: user.id,
        connectionId: connection.id,
        accounts: providerResult.accounts,
        source: provider === "manual" ? "manual" : "sync",
        syncRunId: syncRun.id,
        reason: provider === "manual" ? "Manual wallet sync" : "Provider sync",
      });

      const updatedConnection = await prisma.walletConnection.update({
        where: { id: connection.id },
        data: {
          providerConnectionId: providerResult.providerConnectionId || connection.providerConnectionId,
          displayName: providerResult.displayName || connection.displayName,
          status: "active",
          lastSyncedAt: new Date(),
          lastError: null,
        },
      });

      const completedRun = await prisma.walletSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "success",
          completedAt: new Date(),
          accountsUpdated: upsertResult.accountsUpdated,
        },
      });

      return json({
        connection: updatedConnection,
        syncRun: completedRun,
        accounts: upsertResult.accounts,
      });
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "Wallet sync failed";

      await prisma.walletConnection.update({
        where: { id: connection.id },
        data: { status: "error", lastError: message },
      });
      await prisma.walletSyncRun.update({
        where: { id: syncRun.id },
        data: {
          status: "failed",
          completedAt: new Date(),
          errorCode: "PROVIDER_SYNC_FAILED",
          errorMessage: message,
        },
      });

      return errorResponse(message, 502);
    }
  } catch (error) {
    console.error("Wallet sync error:", error);
    return errorResponse("Internal server error", 500);
  }
}
