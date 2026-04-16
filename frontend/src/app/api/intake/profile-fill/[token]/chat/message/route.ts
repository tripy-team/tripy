import { prisma } from "@/lib/prisma";
import { json, errorResponse } from "@/lib/auth";
import {
  continueDiscoveryChat,
  type IntakeChatMessage,
  type IntakeData,
} from "@/lib/intake-chat-ai";

/**
 * POST /api/intake/profile-fill/:token/chat
 *
 * Public token-scoped mirror of the advisor chat endpoint so the client-facing
 * intake can use the AI discovery chat step. Scoped to the token so the
 * advisor's main chat endpoint stays authenticated-only.
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
    const {
      advisorMessage,
      messageHistory = [],
      intakeData = {},
      generateOnly = false,
    } = body as {
      advisorMessage: string;
      messageHistory: IntakeChatMessage[];
      intakeData: IntakeData;
      generateOnly?: boolean;
    };

    if (!generateOnly && !advisorMessage?.trim()) {
      return errorResponse("advisorMessage is required", 400);
    }

    const clientName = `${record.client.firstName} ${record.client.lastName}`;
    const message = await continueDiscoveryChat(
      clientName,
      intakeData,
      messageHistory,
      advisorMessage ?? "",
      generateOnly,
    );

    return json({ message });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[profile-fill/chat] POST failed:", error);
    return errorResponse("Failed to process chat message", 500);
  }
}
