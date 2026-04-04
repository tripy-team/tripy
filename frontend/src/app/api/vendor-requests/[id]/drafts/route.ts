import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { generateFollowUpDraft } from "@/lib/vendor-ai";
import type { DraftTone } from "@/generated/prisma/client";

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

    const drafts = await prisma.vendorRequestDraft.findMany({
      where: { vendorRequestId: id },
      orderBy: { createdAt: "desc" },
    });

    return json(drafts);
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

    const tone: DraftTone = body.tone || "gentle_nudge";

    const vr = await prisma.vendorRequest.findFirst({
      where: { id, organizationId: user.organizationId },
      include: {
        tripRequest: { select: { title: true } },
        client: { select: { firstName: true, lastName: true } },
      },
    });
    if (!vr) return errorResponse("Vendor request not found", 404);

    const generatedBody = await generateFollowUpDraft({
      vendorName: vr.vendorName,
      vendorContact: vr.vendorContact,
      requestType: vr.requestType,
      requestDetails: vr.requestDetails,
      clientName: vr.client ? `${vr.client.firstName} ${vr.client.lastName}` : null,
      tripTitle: vr.tripRequest?.title ?? null,
      dueDate: vr.dueDate?.toISOString().split("T")[0] ?? null,
      followUpCount: vr.followUpCount,
      urgency: vr.urgency,
      currentStatus: vr.status,
      tone,
    });

    const draft = await prisma.vendorRequestDraft.create({
      data: {
        vendorRequestId: id,
        tone,
        generatedBody,
        metadata: {
          followUpCount: vr.followUpCount,
          urgency: vr.urgency,
          status: vr.status,
          generatedAt: new Date().toISOString(),
        },
      },
    });

    await prisma.vendorRequestTimeline.create({
      data: {
        vendorRequestId: id,
        eventType: "draft_generated",
        description: `Follow-up draft generated (tone: ${tone.replace(/_/g, " ")})`,
        metadata: { draftId: draft.id, tone, userId: user.id },
      },
    });

    return json(draft, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Draft generation error:", error);
    return errorResponse("Internal server error", 500);
  }
}
