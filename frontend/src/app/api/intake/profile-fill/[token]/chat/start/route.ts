import { prisma } from "@/lib/prisma";
import { json, errorResponse } from "@/lib/auth";
import {
  generateInitialDiscoveryQuestions,
  type IntakeData,
} from "@/lib/intake-chat-ai";
import { randomUUID } from "crypto";

/**
 * POST /api/intake/profile-fill/:token/chat/start
 *
 * Public token-scoped mirror of the advisor discovery chat bootstrap.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;
    const record = await prisma.intakeFormToken.findUnique({
      where: { token },
      include: { client: true },
    });
    const RICH_FORM_VARIANTS = new Set(["profile_link", "individual"]);
    if (!record) return errorResponse("Invalid link", 404);
    if (!RICH_FORM_VARIANTS.has(record.formVariant)) {
      return errorResponse("This link is not a profile-fill link", 400);
    }
    if (record.expiresAt < new Date()) return errorResponse("Link expired", 410);

    const body = await request.json().catch(() => ({}));
    const intakeData = (body.intakeData ?? {}) as IntakeData;

    const clientName = `${record.client.firstName} ${record.client.lastName}`;
    const message = await generateInitialDiscoveryQuestions(clientName, intakeData);

    return json({ sessionId: randomUUID(), messages: [message] });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[profile-fill/chat/start] POST failed:", error);
    return errorResponse("Failed to generate discovery questions", 500);
  }
}
