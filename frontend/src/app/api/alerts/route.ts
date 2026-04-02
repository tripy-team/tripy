import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const url = new URL(request.url);
    const unreadOnly = url.searchParams.get("unread") === "true";

    const subscriptionIds = await prisma.alertSubscription.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });

    const events = await prisma.alertEvent.findMany({
      where: {
        alertSubscriptionId: { in: subscriptionIds.map((s) => s.id) },
        ...(unreadOnly && { isRead: false }),
      },
      include: {
        alertSubscription: true,
      },
      orderBy: { triggeredAt: "desc" },
    });

    return json(events);
  } catch (error) {
    console.error("List alerts error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const { ids, isRead } = body;

    if (!Array.isArray(ids) || typeof isRead !== "boolean") {
      return errorResponse("ids (array) and isRead (boolean) are required", 400);
    }

    const orgSubscriptionIds = await prisma.alertSubscription.findMany({
      where: { organizationId: user.organizationId },
      select: { id: true },
    });
    const orgSubIdSet = new Set(orgSubscriptionIds.map((s) => s.id));

    const validEvents = await prisma.alertEvent.findMany({
      where: { id: { in: ids } },
      select: { id: true, alertSubscriptionId: true },
    });

    const authorizedIds = validEvents
      .filter((e) => orgSubIdSet.has(e.alertSubscriptionId))
      .map((e) => e.id);

    await prisma.alertEvent.updateMany({
      where: { id: { in: authorizedIds } },
      data: { isRead },
    });

    return json({ updated: authorizedIds.length });
  } catch (error) {
    console.error("Update alerts error:", error);
    return errorResponse("Internal server error", 500);
  }
}
