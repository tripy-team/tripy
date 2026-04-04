import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || "pending";
    const dueBefore = searchParams.get("dueBefore");

    const where: Record<string, unknown> = {
      vendorRequest: { organizationId: user.organizationId },
      status,
    };

    if (dueBefore) {
      where.remindAt = { lte: new Date(dueBefore) };
    }

    const reminders = await prisma.vendorRequestReminder.findMany({
      where,
      include: {
        vendorRequest: {
          select: {
            id: true,
            vendorName: true,
            requestType: true,
            urgency: true,
            status: true,
            dueDate: true,
            tripRequest: { select: { id: true, title: true } },
            client: { select: { firstName: true, lastName: true } },
          },
        },
      },
      orderBy: { remindAt: "asc" },
      take: 100,
    });

    return json(reminders);
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Internal server error", 500);
  }
}
