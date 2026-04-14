import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  continueDiscoveryChat,
  type IntakeChatMessage,
  type IntakeData,
} from "@/lib/intake-chat-ai";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string; intakeId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id: clientId, intakeId } = await params;

    const client = await prisma.client.findFirst({
      where: { id: clientId, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const intake = await prisma.clientIntake.findFirst({
      where: { id: intakeId, clientId },
    });
    if (!intake) return errorResponse("Intake not found", 404);

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

    const clientName = `${client.firstName} ${client.lastName}`;
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
    console.error("[IntakeChat/message] POST failed:", error);
    return errorResponse("Failed to process chat message", 500);
  }
}
