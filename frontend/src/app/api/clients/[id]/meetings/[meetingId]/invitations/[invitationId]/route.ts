import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { sendMeetingInvitation, buildMeetingInviteLink } from "@/lib/email";

// Resend — resets expiry, re-emails client
export async function POST(
  request: Request,
  { params }: {
    params: Promise<{ id: string; meetingId: string; invitationId: string }>;
  },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId, invitationId } = await params;

    const invitation = await prisma.meetingInvitation.findFirst({
      where: { id: invitationId, clientId, meetingSessionId: meetingId },
      include: {
        client: { select: { organizationId: true } },
        meetingSession: { select: { title: true } },
      },
    });
    if (!invitation) return errorResponse("Invitation not found", 404);
    if (invitation.client.organizationId !== user.organizationId) {
      return errorResponse("Not authorized", 403);
    }
    if (invitation.joinedAt) return errorResponse("Client has already joined", 400);

    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 14);

    const updated = await prisma.meetingInvitation.update({
      where: { id: invitationId },
      data: { expiresAt: newExpiry, sentAt: new Date() },
    });

    const advisorName = `${user.firstName} ${user.lastName}`.trim() || user.email;

    sendMeetingInvitation({
      recipientEmail: invitation.recipientEmail,
      recipientName: invitation.recipientName ?? undefined,
      advisorName,
      meetingTitle: invitation.meetingSession.title,
      meetingLink: buildMeetingInviteLink(invitation.token),
      expiresAt: newExpiry,
    }).catch((e) => console.error("[email] Meeting invite resend failed:", e));

    return json({ ...updated, status: "pending" });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Resend meeting invitation error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// Revoke
export async function DELETE(
  request: Request,
  { params }: {
    params: Promise<{ id: string; meetingId: string; invitationId: string }>;
  },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId, invitationId } = await params;

    const invitation = await prisma.meetingInvitation.findFirst({
      where: { id: invitationId, clientId, meetingSessionId: meetingId },
      include: { client: { select: { organizationId: true } } },
    });
    if (!invitation) return errorResponse("Invitation not found", 404);
    if (invitation.client.organizationId !== user.organizationId) {
      return errorResponse("Not authorized", 403);
    }

    await prisma.meetingInvitation.delete({ where: { id: invitationId } });
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Revoke meeting invitation error:", error);
    return errorResponse("Internal server error", 500);
  }
}
