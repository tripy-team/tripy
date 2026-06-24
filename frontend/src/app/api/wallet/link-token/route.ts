import { errorResponse, getAuthUser, json } from "@/lib/auth";
import { createWalletLinkToken, isWalletProvider } from "@/lib/wallet/providers";

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json().catch(() => ({}));
    const provider = isWalletProvider(body.provider) ? body.provider : "mock";
    const linkToken = await createWalletLinkToken(provider, user.id);

    return json(linkToken);
  } catch (error) {
    console.error("Create wallet link token error:", error);
    return errorResponse("Internal server error", 500);
  }
}
