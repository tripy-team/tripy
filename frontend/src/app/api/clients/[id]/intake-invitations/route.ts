import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import crypto from "crypto";

function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

function defaultExpiry(): Date {
  const d = new Date();
  d.setDate(d.getDate() + 14);
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

    // Annotate with computed status
    const now = new Date();
    const annotated = tokens.map((t) => ({
      ...t,
      status: t.completedAt ? "completed" : t.expiresAt < now ? "expired" : t.openedAt ? "opened" : "pending",
    }));

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

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresInDays);

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
            sentAt: new Date(),
            expiresAt,
          },
        }),
      ),
    );

    return json(created, 201);
  } catch (error) {
    console.error("Create intake invitations error:", error);
    return errorResponse("Internal server error", 500);
  }
}
