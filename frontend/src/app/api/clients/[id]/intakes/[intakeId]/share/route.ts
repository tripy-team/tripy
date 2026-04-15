import crypto from "crypto";
import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { sendFormInvitation } from "@/lib/email";

const FRONTEND_URL =
  process.env.NEXT_PUBLIC_FRONTEND_URL ||
  process.env.NEXT_PUBLIC_APP_URL ||
  "https://tripy.app";

/**
 * POST /api/clients/:id/intakes/:intakeId/share
 *
 * Body: { recipientEmail?: string }
 *
 * Creates a tokenized IntakeFormToken bound to the intake and emails the
 * client a public link at /intake-fill/[token]. When the client submits the
 * form, the same ClientIntake row is updated and the advisor sees the result
 * on their next page load. Not realtime — on-submit only.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, intakeId } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
      include: { owner: true },
    });
    if (!client) return errorResponse("Client not found", 404);

    const intake = await prisma.clientIntake.findFirst({
      where: { id: intakeId, clientId: id },
    });
    if (!intake) return errorResponse("Intake not found", 404);

    const body = (await request.json().catch(() => ({}))) as {
      recipientEmail?: string;
    };

    const to = (body.recipientEmail || client.email || "").trim();
    if (!to) {
      return errorResponse(
        "No recipient email — add an email to the client or provide one in the request body",
        400,
      );
    }

    const advisor = client.owner;
    const advisorName =
      [advisor?.firstName, advisor?.lastName].filter(Boolean).join(" ") ||
      advisor?.email ||
      "Your travel advisor";
    const advisorEmail = advisor?.email ?? null;

    // Reuse an existing unfinished profile_link token for this intake so the
    // same link can be re-sent without filling up the table.
    const existing = await prisma.intakeFormToken.findFirst({
      where: {
        intakeId,
        formVariant: "profile_link",
        completedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    const token = existing?.token ?? crypto.randomBytes(24).toString("base64url");
    const expiresAt =
      existing?.expiresAt ?? new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    if (existing) {
      await prisma.intakeFormToken.update({
        where: { id: existing.id },
        data: {
          recipientEmail: to,
          recipientName: `${client.firstName} ${client.lastName}`.trim(),
          advisorEmail,
          sentAt: new Date(),
        },
      });
    } else {
      await prisma.intakeFormToken.create({
        data: {
          token,
          clientId: id,
          intakeId,
          recipientEmail: to,
          recipientName: `${client.firstName} ${client.lastName}`.trim(),
          formVariant: "profile_link",
          advisorEmail,
          expiresAt,
          sentAt: new Date(),
        },
      });
    }

    const formLink = `${FRONTEND_URL}/intake-fill/${token}`;

    await sendFormInvitation({
      recipientEmail: to,
      recipientName: `${client.firstName} ${client.lastName}`.trim(),
      clientName: `${client.firstName} ${client.lastName}`.trim(),
      advisorName,
      formTitle: "Your Travel Profile",
      formLink,
      expiresAt,
    });

    return json({ ok: true, sentTo: to, token });
  } catch (error) {
    console.error("Share intake error:", error);
    return errorResponse("Internal server error", 500);
  }
}
