import { prisma } from "./prisma";
import type { VendorRequestStatus } from "@/generated/prisma/client";

// ---------------------------------------------------------------------------
// Workflow state machine
// ---------------------------------------------------------------------------

const VALID_TRANSITIONS: Record<string, VendorRequestStatus[]> = {
  draft: ["needs_advisor_review", "approved_to_send", "cancelled"],
  needs_advisor_review: [
    "needs_client_approval",
    "approved_to_send",
    "draft",
    "cancelled",
  ],
  needs_client_approval: ["approved_to_send", "draft", "cancelled"],
  approved_to_send: ["sent_to_vendor", "draft", "cancelled"],
  sent_to_vendor: ["awaiting_vendor_response", "cancelled"],
  awaiting_vendor_response: [
    "follow_up_needed",
    "confirmed",
    "declined",
    "complete",
    "cancelled",
  ],
  follow_up_needed: [
    "awaiting_vendor_response",
    "confirmed",
    "declined",
    "complete",
    "cancelled",
  ],
  confirmed: ["complete", "cancelled"],
  declined: ["draft", "cancelled"],
  complete: [],
  cancelled: ["draft"],
};

const TERMINAL_STATUSES: VendorRequestStatus[] = [
  "confirmed",
  "declined",
  "cancelled",
  "complete",
];

export function canTransition(
  from: VendorRequestStatus,
  to: VendorRequestStatus,
): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

export async function transitionWorkflow(
  vendorRequestId: string,
  toStatus: VendorRequestStatus,
  userId: string,
  notes?: string,
) {
  const request = await prisma.vendorRequest.findUniqueOrThrow({
    where: { id: vendorRequestId },
  });

  if (!canTransition(request.status, toStatus)) {
    throw new Error(
      `Invalid transition from "${request.status}" to "${toStatus}"`,
    );
  }

  const now = new Date();
  const updates: Record<string, unknown> = { status: toStatus };

  if (toStatus === "sent_to_vendor" && !request.dateSent) {
    updates.dateSent = now;
  }
  if (
    toStatus === "awaiting_vendor_response" &&
    !request.firstResponseAt
  ) {
    updates.firstResponseAt = now;
  }
  if (TERMINAL_STATUSES.includes(toStatus) && !request.resolvedAt) {
    updates.resolvedAt = now;
  }

  const [updated] = await prisma.$transaction([
    prisma.vendorRequest.update({
      where: { id: vendorRequestId },
      data: updates,
    }),
    prisma.vendorRequestApproval.create({
      data: {
        vendorRequestId,
        fromStatus: request.status,
        toStatus,
        approvedByUserId: userId,
        notes,
      },
    }),
    prisma.vendorRequestTimeline.create({
      data: {
        vendorRequestId,
        eventType: "status_change",
        description: `Status changed from ${request.status} to ${toStatus}`,
        metadata: { fromStatus: request.status, toStatus, userId, notes },
      },
    }),
  ]);

  if (TERMINAL_STATUSES.includes(toStatus)) {
    await autoResolveReminders(vendorRequestId);
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Reminder engine
// ---------------------------------------------------------------------------

const DEFAULT_REMINDER_HOURS = [24, 48, 72];

export async function generateReminders(
  vendorRequestId: string,
  customHours?: number[],
) {
  const request = await prisma.vendorRequest.findUniqueOrThrow({
    where: { id: vendorRequestId },
  });

  if (TERMINAL_STATUSES.includes(request.status)) return [];

  const baseTime = request.dateSent ?? request.createdAt;
  const hours = customHours?.length ? customHours : DEFAULT_REMINDER_HOURS;

  const reminders = hours.map((h) => ({
    vendorRequestId,
    remindAt: new Date(baseTime.getTime() + h * 3600_000),
    label: `Follow up after ${h}h`,
  }));

  return prisma.vendorRequestReminder.createMany({ data: reminders });
}

export async function autoResolveReminders(vendorRequestId: string) {
  return prisma.vendorRequestReminder.updateMany({
    where: { vendorRequestId, status: "pending" },
    data: { status: "auto_resolved", completedAt: new Date() },
  });
}

export async function syncReminders(vendorRequestId: string) {
  const request = await prisma.vendorRequest.findUniqueOrThrow({
    where: { id: vendorRequestId },
    include: { reminders: true },
  });

  if (TERMINAL_STATUSES.includes(request.status)) {
    await autoResolveReminders(vendorRequestId);
    return [];
  }

  const pendingCount = request.reminders.filter(
    (r) => r.status === "pending",
  ).length;

  if (pendingCount === 0) {
    await generateReminders(vendorRequestId);
    return prisma.vendorRequestReminder.findMany({
      where: { vendorRequestId },
      orderBy: { remindAt: "asc" },
    });
  }

  return request.reminders;
}

// ---------------------------------------------------------------------------
// Vendor responsiveness scoring
// ---------------------------------------------------------------------------

export interface VendorStats {
  vendorName: string;
  totalRequests: number;
  confirmedCount: number;
  declinedCount: number;
  avgResponseHours: number | null;
  avgResolutionHours: number | null;
  avgFollowUps: number | null;
  overdueCount: number;
  confirmationRate: number | null;
  declineRate: number | null;
  overdueRate: number | null;
  score: number | null;
  confidence: string;
}

export async function calculateVendorStats(
  organizationId: string,
  vendorName: string,
): Promise<VendorStats> {
  const requests = await prisma.vendorRequest.findMany({
    where: { organizationId, vendorName },
  });

  const total = requests.length;
  if (total === 0) {
    return {
      vendorName,
      totalRequests: 0,
      confirmedCount: 0,
      declinedCount: 0,
      avgResponseHours: null,
      avgResolutionHours: null,
      avgFollowUps: null,
      overdueCount: 0,
      confirmationRate: null,
      declineRate: null,
      overdueRate: null,
      score: null,
      confidence: "no_data",
    };
  }

  const confirmed = requests.filter((r) => r.status === "confirmed" || r.status === "complete").length;
  const declined = requests.filter((r) => r.status === "declined").length;
  const now = new Date();
  const overdue = requests.filter(
    (r) => r.dueDate && r.dueDate < now && !TERMINAL_STATUSES.includes(r.status),
  ).length;

  const responseTimes = requests
    .filter((r) => r.firstResponseAt && r.dateSent)
    .map((r) => (r.firstResponseAt!.getTime() - r.dateSent!.getTime()) / 3600_000);

  const resolutionTimes = requests
    .filter((r) => r.resolvedAt && r.createdAt)
    .map((r) => (r.resolvedAt!.getTime() - r.createdAt.getTime()) / 3600_000);

  const avgResponseHours = responseTimes.length
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : null;

  const avgResolutionHours = resolutionTimes.length
    ? resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length
    : null;

  const avgFollowUps = total
    ? requests.reduce((sum, r) => sum + r.followUpCount, 0) / total
    : null;

  const confirmationRate = total ? confirmed / total : null;
  const declineRate = total ? declined / total : null;
  const overdueRate = total ? overdue / total : null;

  const confidence =
    total >= 10 ? "high" : total >= 5 ? "medium" : "low";

  // Score: 0–100, weighted formula:
  // 40% confirmation rate, 20% response speed, 20% resolution speed, 20% follow-up efficiency
  let score: number | null = null;
  if (total >= 3) {
    const confScore = (confirmationRate ?? 0) * 100;
    const responseScore = avgResponseHours !== null
      ? Math.max(0, 100 - avgResponseHours * 2)
      : 50;
    const resolutionScore = avgResolutionHours !== null
      ? Math.max(0, 100 - avgResolutionHours * 0.5)
      : 50;
    const followUpScore = avgFollowUps !== null
      ? Math.max(0, 100 - avgFollowUps * 20)
      : 50;

    score = Math.round(
      confScore * 0.4 +
        responseScore * 0.2 +
        resolutionScore * 0.2 +
        followUpScore * 0.2,
    );
    score = Math.max(0, Math.min(100, score));
  }

  await prisma.vendorScoreSummary.upsert({
    where: {
      organizationId_vendorName: { organizationId, vendorName },
    },
    create: {
      organizationId,
      vendorName,
      totalRequests: total,
      confirmedCount: confirmed,
      declinedCount: declined,
      avgResponseHours,
      avgResolutionHours,
      avgFollowUps,
      overdueCount: overdue,
      score,
      confidence,
      lastCalculatedAt: now,
    },
    update: {
      totalRequests: total,
      confirmedCount: confirmed,
      declinedCount: declined,
      avgResponseHours,
      avgResolutionHours,
      avgFollowUps,
      overdueCount: overdue,
      score,
      confidence,
      lastCalculatedAt: now,
    },
  });

  return {
    vendorName,
    totalRequests: total,
    confirmedCount: confirmed,
    declinedCount: declined,
    avgResponseHours,
    avgResolutionHours,
    avgFollowUps,
    overdueCount: overdue,
    confirmationRate,
    declineRate,
    overdueRate,
    score,
    confidence,
  };
}

export async function getOrgVendorRankings(organizationId: string) {
  const summaries = await prisma.vendorScoreSummary.findMany({
    where: { organizationId },
    orderBy: { score: "desc" },
  });
  return summaries;
}

// ---------------------------------------------------------------------------
// Operations dashboard aggregation
// ---------------------------------------------------------------------------

export interface OperationsDashboardData {
  totalOpenRequests: number;
  overdueRequests: number;
  pendingReminders: number;
  awaitingApproval: number;
  recentActivity: Array<{
    id: string;
    eventType: string;
    description: string;
    vendorRequestId: string;
    vendorName?: string;
    createdAt: string;
  }>;
  tripSummaries: Array<{
    tripRequestId: string;
    tripTitle: string;
    clientName: string | null;
    openRequests: number;
    overdueRequests: number;
    pendingReminders: number;
    awaitingApproval: number;
    atRisk: boolean;
    departureDate: string;
  }>;
  topVendors: Array<{
    vendorName: string;
    score: number | null;
    confidence: string | null;
    totalRequests: number;
  }>;
  requestsByStatus: Record<string, number>;
}

export async function getOperationsDashboard(
  organizationId: string,
): Promise<OperationsDashboardData> {
  const now = new Date();

  const [
    openRequests,
    overdueRequests,
    pendingReminders,
    awaitingApproval,
    recentTimeline,
    tripData,
    vendorSummaries,
    statusCounts,
  ] = await Promise.all([
    prisma.vendorRequest.count({
      where: {
        organizationId,
        status: { notIn: TERMINAL_STATUSES },
      },
    }),
    prisma.vendorRequest.count({
      where: {
        organizationId,
        status: { notIn: TERMINAL_STATUSES },
        dueDate: { lt: now },
      },
    }),
    prisma.vendorRequestReminder.count({
      where: {
        status: "pending",
        remindAt: { lte: now },
        vendorRequest: { organizationId },
      },
    }),
    prisma.vendorRequest.count({
      where: {
        organizationId,
        status: { in: ["needs_advisor_review", "needs_client_approval"] },
      },
    }),
    prisma.vendorRequestTimeline.findMany({
      where: { vendorRequest: { organizationId } },
      include: { vendorRequest: { select: { vendorName: true } } },
      orderBy: { createdAt: "desc" },
      take: 20,
    }),
    prisma.tripRequest.findMany({
      where: {
        organizationId,
        status: { in: ["draft", "analyzing", "complete"] },
        vendorRequests: { some: {} },
      },
      include: {
        client: { select: { firstName: true, lastName: true } },
        vendorRequests: {
          include: {
            reminders: { where: { status: "pending", remindAt: { lte: now } } },
          },
        },
      },
      orderBy: { departureDate: "asc" },
    }),
    prisma.vendorScoreSummary.findMany({
      where: { organizationId },
      orderBy: { score: "desc" },
      take: 10,
    }),
    prisma.vendorRequest.groupBy({
      by: ["status"],
      where: { organizationId },
      _count: true,
    }),
  ]);

  const tripSummaries = tripData.map((trip) => {
    const vrs = trip.vendorRequests;
    const open = vrs.filter((r) => !TERMINAL_STATUSES.includes(r.status)).length;
    const overdue = vrs.filter(
      (r) => r.dueDate && r.dueDate < now && !TERMINAL_STATUSES.includes(r.status),
    ).length;
    const pendingRem = vrs.reduce((sum, r) => sum + r.reminders.length, 0);
    const approval = vrs.filter(
      (r) => r.status === "needs_advisor_review" || r.status === "needs_client_approval",
    ).length;
    const atRisk = overdue > 0 || pendingRem > 2;

    return {
      tripRequestId: trip.id,
      tripTitle: trip.title,
      clientName: trip.client
        ? `${trip.client.firstName} ${trip.client.lastName}`
        : null,
      openRequests: open,
      overdueRequests: overdue,
      pendingReminders: pendingRem,
      awaitingApproval: approval,
      atRisk,
      departureDate: trip.departureDate.toISOString(),
    };
  });

  const requestsByStatus: Record<string, number> = {};
  for (const row of statusCounts) {
    requestsByStatus[row.status] = row._count;
  }

  return {
    totalOpenRequests: openRequests,
    overdueRequests,
    pendingReminders,
    awaitingApproval,
    recentActivity: recentTimeline.map((t) => ({
      id: t.id,
      eventType: t.eventType,
      description: t.description,
      vendorRequestId: t.vendorRequestId,
      vendorName: t.vendorRequest.vendorName,
      createdAt: t.createdAt.toISOString(),
    })),
    tripSummaries,
    topVendors: vendorSummaries.map((v) => ({
      vendorName: v.vendorName,
      score: v.score,
      confidence: v.confidence,
      totalRequests: v.totalRequests,
    })),
    requestsByStatus,
  };
}

// ---------------------------------------------------------------------------
// Template interpolation
// ---------------------------------------------------------------------------

export function interpolateTemplate(
  body: string,
  vars: Record<string, string>,
): string {
  let result = body;
  for (const [key, value] of Object.entries(vars)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}
