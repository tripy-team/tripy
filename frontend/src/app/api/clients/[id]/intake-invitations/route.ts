import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { sendFormInvitation, buildFormLink } from "@/lib/email";
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
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { id } = await params;

    const client = await prisma.client.findFirst({ where: { id, organizationId: user.organizationId } });
    if (!client) return errorResponse("Client not found", 404);

    const tokens = await prisma.intakeFormToken.findMany({
      where: { clientId: id },
      orderBy: { createdAt: "desc" },
    });

    const now = new Date();
    const annotated = tokens.map((t) => {
      // Extract sections from customQuestions JSON for sectioned custom forms
      const raw = t.customQuestions as
        | Array<{ id: string; label: string }>
        | { sections: Array<{ id: string; title: string; questions: Array<{ id: string; label: string }> }> }
        | null;
      const customSections =
        raw && !Array.isArray(raw) && Array.isArray((raw as { sections?: unknown }).sections)
          ? (raw as { sections: Array<{ id: string; title: string; questions: Array<{ id: string; label: string }> }> }).sections
          : undefined;
      const customQuestions =
        raw && Array.isArray(raw) ? raw : undefined;
      return {
        ...t,
        customQuestions,
        customSections,
        status: t.completedAt ? "completed" : t.expiresAt < now ? "expired" : t.openedAt ? "opened" : "pending",
      };
    });

    return json(annotated);
  } catch (error) {
    console.error("List intake invitations error:", error);
    return errorResponse("Internal server error", 500);
  }
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

    const body = await request.json();
    const { recipients, expiresInDays = 14 } = body as {
      recipients: Array<{ email: string; name?: string; formVariant: string; groupSize?: number }>;
      expiresInDays?: number;
    };

    if (!Array.isArray(recipients) || recipients.length === 0) {
      return errorResponse("recipients array is required", 400);
    }

    const expiresAt = defaultExpiry(expiresInDays);
    const advisorName = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const clientName = `${client.firstName} ${client.lastName}`.trim();

    const created = await prisma.$transaction(
      recipients.map((r) =>
        prisma.intakeFormToken.create({
          data: {
            token: generateToken(),
            clientId: id,
            recipientEmail: r.email,
            recipientName: r.name || null,
            formVariant: r.formVariant as never,
            groupSize: r.groupSize ? Number(r.groupSize) : null,
            advisorEmail: user.email,
            sentAt: new Date(),
            expiresAt,
          },
        }),
      ),
    );

    // Send emails to each recipient (fire and forget)
    for (const tokenRecord of created) {
      const recipient = recipients.find((r) => r.email === tokenRecord.recipientEmail);
      const formLink = buildFormLink(tokenRecord.token);
      const VARIANT_TITLES: Record<string, string> = {
        individual: "Travel Preferences Form",
        group_member: "Group Trip Preferences",
        group_organizer: "Group Trip Details",
        business_policy: "Company Travel Policy",
        business_traveler: "Business Travel Preferences",
        custom_form: "Travel Form",
      };
      const formTitle = VARIANT_TITLES[tokenRecord.formVariant] ?? "Travel Form";
      sendFormInvitation({
        recipientEmail: tokenRecord.recipientEmail,
        recipientName: tokenRecord.recipientName ?? undefined,
        clientName,
        advisorName,
        formTitle,
        formLink,
        expiresAt,
      }).catch((e) => console.error("[email] Invitation send failed:", e));
      void recipient; // suppress unused warning
    }

    return json(created, 201);
  } catch (error) {
    console.error("Create intake invitations error:", error);
    return errorResponse("Internal server error", 500);
  }
}
