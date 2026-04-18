import { prisma } from "@/lib/prisma";
import { json, errorResponse } from "@/lib/auth";
import { signJoinLink } from "@/lib/livekit-signing";

function buildRoomName(clientId: string, meetingId: string): string {
  return `tripy-${clientId}-${meetingId}`.replace(/[^a-zA-Z0-9-]/g, "-");
}

// GET — resolve a meeting invitation token into join details for the client.
// Public endpoint (no auth). Marks the invitation as opened on first view.
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    const invitation = await prisma.meetingInvitation.findUnique({
      where: { token },
      include: {
        client: { select: { id: true, firstName: true, lastName: true } },
        meetingSession: {
          select: {
            id: true,
            title: true,
            status: true,
            advisor: { select: { firstName: true, lastName: true, email: true } },
          },
        },
      },
    });

    if (!invitation) return errorResponse("Invalid or expired link", 404);
    if (invitation.expiresAt < new Date()) {
      return json({ status: "expired" });
    }

    if (!invitation.openedAt) {
      await prisma.meetingInvitation
        .update({ where: { token }, data: { openedAt: new Date() } })
        .catch(() => {});
    }

    const roomName = buildRoomName(invitation.clientId, invitation.meetingSessionId);
    const signed = signJoinLink(roomName, invitation.clientId);
    const advisor = invitation.meetingSession.advisor;
    const advisorName =
      `${advisor.firstName ?? ""} ${advisor.lastName ?? ""}`.trim() || advisor.email;
    const clientName =
      invitation.recipientName ??
      `${invitation.client.firstName} ${invitation.client.lastName}`.trim();

    return json({
      status: "ready",
      meetingTitle: invitation.meetingSession.title,
      meetingStatus: invitation.meetingSession.status,
      advisorName,
      clientName,
      recipientName: invitation.recipientName,
      expiresAt: invitation.expiresAt.toISOString(),
      join: {
        roomName,
        clientId: signed.clientId,
        exp: signed.exp,
        sig: signed.sig,
      },
    });
  } catch (error) {
    console.error("Resolve meeting invitation error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// POST — mark the invitation as joined. Called by the client page once they
// accept and enter the call.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const invitation = await prisma.meetingInvitation.findUnique({
      where: { token },
      select: { id: true, expiresAt: true, joinedAt: true },
    });
    if (!invitation) return errorResponse("Invalid link", 404);
    if (invitation.expiresAt < new Date()) return errorResponse("Link expired", 410);

    if (!invitation.joinedAt) {
      await prisma.meetingInvitation.update({
        where: { id: invitation.id },
        data: { joinedAt: new Date() },
      });
    }
    return json({ ok: true });
  } catch (error) {
    console.error("Mark meeting invitation joined error:", error);
    return errorResponse("Internal server error", 500);
  }
}
