import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { sendFormInvitation, buildFormLink } from "@/lib/email";
import crypto from "crypto";

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { id } = await params;

    const client = await prisma.client.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!client) return errorResponse("Client not found", 404);
    if (client.clientType !== "group") return errorResponse("Client is not a group type", 400);

    const body = await request.json();
    const {
      organizerEmail,
      organizerName,
      members,
      groupSize,
      expiresInDays = 14,
    } = body as {
      organizerEmail: string;
      organizerName?: string;
      members: Array<{ email: string; name?: string }>;
      groupSize: number;
      expiresInDays?: number;
    };

    if (!organizerEmail) return errorResponse("organizerEmail is required", 400);

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const tokensToCreate = [
      {
        token: crypto.randomBytes(32).toString("hex"),
        clientId: id,
        recipientEmail: organizerEmail,
        recipientName: organizerName || null,
        formVariant: "group_organizer" as never,
        groupSize: Number(groupSize),
        sentAt: new Date(),
        expiresAt,
      },
      ...(Array.isArray(members) ? members : []).map((m) => ({
        token: crypto.randomBytes(32).toString("hex"),
        clientId: id,
        recipientEmail: m.email,
        recipientName: m.name || null,
        formVariant: "group_member" as never,
        groupSize: Number(groupSize),
        sentAt: new Date(),
        expiresAt,
      })),
    ];

    const created = await prisma.$transaction(
      tokensToCreate.map((data) => prisma.intakeFormToken.create({ data })),
    );

    // Send invitation emails to each recipient
    const advisorName = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const clientName = `${client.firstName} ${client.lastName}`.trim();
    const VARIANT_TITLES: Record<string, string> = {
      group_organizer: "Group Trip Details",
      group_member: "Group Trip Preferences",
    };
    for (const tokenRecord of created) {
      const formTitle = VARIANT_TITLES[tokenRecord.formVariant] ?? "Group Travel Form";
      sendFormInvitation({
        recipientEmail: tokenRecord.recipientEmail,
        recipientName: tokenRecord.recipientName ?? undefined,
        clientName,
        advisorName,
        formTitle,
        formLink: buildFormLink(tokenRecord.token),
        expiresAt,
      }).catch((e) => console.error("[email] Group batch invitation send failed:", e));
    }

    return json(created, 201);
  } catch (error) {
    console.error("Group batch invitation error:", error);
    return errorResponse("Internal server error", 500);
  }
}
