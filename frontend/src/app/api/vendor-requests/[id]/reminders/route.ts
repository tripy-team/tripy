import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { syncReminders } from "@/lib/vendor-operations";
import type { ReminderStatus } from "@/generated/prisma/client";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;

    const vr = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!vr) return errorResponse("Vendor request not found", 404);

    const reminders = await prisma.vendorRequestReminder.findMany({
      where: { vendorRequestId: id },
      orderBy: { remindAt: "asc" },
    });

    return json(reminders);
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id } = await params;
    const body = await request.json();

    const vr = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!vr) return errorResponse("Vendor request not found", 404);

    const { action, reminderId, snoozedUntil } = body;

    if (action === "sync") {
      const synced = await syncReminders(id);
      return json(synced);
    }

    if (!reminderId) return errorResponse("reminderId is required");

    const reminder = await prisma.vendorRequestReminder.findFirst({
      where: { id: reminderId, vendorRequestId: id },
    });
    if (!reminder) return errorResponse("Reminder not found", 404);

    let status: ReminderStatus = reminder.status;
    const updates: Record<string, unknown> = {};

    switch (action) {
      case "complete":
        status = "completed";
        updates.completedAt = new Date();
        break;
      case "snooze":
        if (!snoozedUntil) return errorResponse("snoozedUntil is required for snooze");
        status = "snoozed";
        updates.snoozedUntil = new Date(snoozedUntil);
        updates.remindAt = new Date(snoozedUntil);
        break;
      case "dismiss":
        status = "completed";
        updates.completedAt = new Date();
        break;
      default:
        return errorResponse("Invalid action. Use: complete, snooze, dismiss, sync");
    }

    const updated = await prisma.vendorRequestReminder.update({
      where: { id: reminderId },
      data: { status, ...updates },
    });

    return json(updated);
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Internal server error", 500);
  }
}
