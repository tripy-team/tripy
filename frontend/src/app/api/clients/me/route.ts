/**
 * GET /api/clients/me
 *
 * Resolves the caller's own traveler profile (their "self" client), creating it
 * on first access. This enforces the consumer (B2C) invariant: every user has
 * exactly one self-client representing themselves — there is no roster of other
 * people's clients in the consumer product.
 */
import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    // 1. Already flagged self client?
    let client = await prisma.client.findFirst({
      where: { ownerUserId: user.id, isSelfClient: true },
    });

    // 2. Adopt an existing owned client that matches the user's email.
    if (!client) {
      const existing = await prisma.client.findFirst({
        where: { organizationId: user.organizationId, email: user.email },
      });
      if (existing) {
        client = await prisma.client.update({
          where: { id: existing.id },
          data: { isSelfClient: true, ownerUserId: user.id },
        });
      }
    }

    // 3. Otherwise create the self client from the user's account.
    if (!client) {
      client = await prisma.client.create({
        data: {
          organizationId: user.organizationId,
          ownerUserId: user.id,
          isSelfClient: true,
          clientType: "individual",
          firstName: user.firstName || user.email.split("@")[0],
          lastName: user.lastName || "",
          email: user.email,
        },
      });
    }

    return json(client);
  } catch (error) {
    console.error("Get my client error:", error);
    return errorResponse("Internal server error", 500);
  }
}
