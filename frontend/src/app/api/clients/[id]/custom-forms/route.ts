/**
 * POST /api/clients/[id]/custom-forms
 * Creates a custom form token with advisor-defined questions, then sends email.
 *
 * Body: {
 *   title: string;
 *   recipientEmail: string;
 *   recipientName?: string;
 *   questions: Array<{ id: string; label: string; type: 'text'|'textarea'|'select'; options?: string[] }>;
 *   expiresInDays?: number;
 * }
 */

import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { sendFormInvitation, buildFormLink } from "@/lib/email";
import crypto from "crypto";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const body = await request.json();
    const {
      title,
      recipientEmail,
      recipientName,
      questions,
      expiresInDays = 14,
    } = body as {
      title: string;
      recipientEmail: string;
      recipientName?: string;
      questions: Array<{
        id: string;
        label: string;
        type: "text" | "textarea" | "select";
        options?: string[];
      }>;
      expiresInDays?: number;
    };

    if (!title?.trim()) return errorResponse("title is required", 400);
    if (!recipientEmail?.trim()) return errorResponse("recipientEmail is required", 400);
    if (!Array.isArray(questions) || questions.length === 0) {
      return errorResponse("questions array is required", 400);
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

    const token = crypto.randomBytes(32).toString("hex");
    const tokenRecord = await prisma.intakeFormToken.create({
      data: {
        token,
        clientId: id,
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName?.trim() || null,
        formVariant: "custom_form",
        customQuestions: questions as never,
        advisorEmail: user.email,
        sentAt: new Date(),
        expiresAt,
      },
    });

    const advisorName = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const clientName = `${client.firstName} ${client.lastName}`.trim();

    // Send email to recipient
    sendFormInvitation({
      recipientEmail: recipientEmail.trim(),
      recipientName: recipientName?.trim(),
      clientName,
      advisorName,
      formTitle: title.trim(),
      formLink: buildFormLink(token),
      expiresAt,
    }).catch((e) => console.error("[email] Custom form invitation failed:", e));

    return json(
      {
        ...tokenRecord,
        status: "pending",
        formTitle: title.trim(),
      },
      201,
    );
  } catch (error) {
    console.error("Create custom form error:", error);
    return errorResponse("Internal server error", 500);
  }
}
