import { prisma } from "@/lib/prisma";
import { errorResponse, getAuthUser, json } from "@/lib/auth";
import { isWalletProvider } from "@/lib/wallet/providers";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const status = url.searchParams.get("error") ? "error" : "received";

  return json({
    status,
    message:
      "Wallet provider callback received. Finish provider token exchange from an authenticated app session before balances are synced.",
  });
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json().catch(() => ({}));
    const provider = isWalletProvider(body.provider) ? body.provider : null;
    if (!provider) return errorResponse("Valid provider is required", 400);

    const connection = await prisma.walletConnection.create({
      data: {
        userId: user.id,
        provider,
        providerConnectionId: body.providerConnectionId || body.sessionId || null,
        displayName: body.displayName || "Points wallet",
        status: "active",
        consentScope: body.consentScope || {
          accounts: "read",
          balances: "read",
          optimization: "explicit_user_enabled",
        },
      },
    });

    return json(connection, 201);
  } catch (error) {
    console.error("Wallet callback error:", error);
    return errorResponse("Internal server error", 500);
  }
}
