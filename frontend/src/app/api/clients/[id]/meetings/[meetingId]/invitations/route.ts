import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";
import { sendMeetingInvitation, buildMeetingInviteLink } from "@/lib/email";
import crypto from "crypto";

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function defaultExpiry(days = 14): Date {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId } = await params;

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId, client: { organizationId: user.organizationId } },
      select: { id: true },
    });
    if (!session) return errorResponse("Meeting not found", 404);

    const invitations = await prisma.meetingInvitation.findMany({
      where: { meetingSessionId: meetingId },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    const annotated = invitations.map((inv) => ({
      ...inv,
      status: inv.joinedAt
        ? "joined"
        : inv.expiresAt < now
        ? "expired"
        : inv.openedAt
        ? "opened"
        : "pending",
    }));

    return json(annotated);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("List meeting invitations error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; meetingId: string }> },
) {
  try {
    const user = await requireAuth(request);
    const { id: clientId, meetingId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const session = await prisma.discoveryMeetingSession.findFirst({
      where: { id: meetingId, clientId },
    });
    if (!session) return errorResponse("Meeting not found", 404);

    const body = await request.json().catch(() => ({}));
    const recipientEmail: string | undefined =
      typeof body.recipientEmail === "string" && body.recipientEmail.trim()
        ? body.recipientEmail.trim()
        : client.email ?? undefined;
    const recipientName: string | undefined =
      typeof body.recipientName === "string" && body.recipientName.trim()
        ? body.recipientName.trim()
        : `${client.firstName} ${client.lastName}`.trim() || undefined;
    const expiresInDays: number =
      typeof body.expiresInDays === "number" ? body.expiresInDays : 14;

    if (!recipientEmail) {
      return errorResponse("Recipient email is required (client has no email on file)", 400);
    }

    const expiresAt = defaultExpiry(expiresInDays);
    const advisorName = `${user.firstName} ${user.lastName}`.trim() || user.email;

    const invitation = await prisma.meetingInvitation.create({
      data: {
        token: generateToken(),
        clientId,
        meetingSessionId: meetingId,
        recipientEmail,
        recipientName: recipientName ?? null,
        advisorEmail: user.email,
        sentAt: new Date(),
        expiresAt,
      },
    });

    const meetingLink = buildMeetingInviteLink(invitation.token);
    sendMeetingInvitation({
      recipientEmail: invitation.recipientEmail,
      recipientName: invitation.recipientName ?? undefined,
      advisorName,
      meetingTitle: session.title,
      meetingLink,
      expiresAt,
    }).catch((e) => console.error("[email] Meeting invite send failed:", e));

    return json({ ...invitation, status: "pending" }, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Create meeting invitation error:", error);
    return errorResponse("Internal server error", 500);
  }
}
