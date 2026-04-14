import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  generateInitialDiscoveryQuestions,
  type IntakeData,
} from "@/lib/intake-chat-ai";
import { randomUUID } from "crypto";

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
    const intakeData = (body.intakeData ?? {}) as IntakeData;

    const clientName = `${client.firstName} ${client.lastName}`;
    const message = await generateInitialDiscoveryQuestions(
      clientName,
      intakeData,
    );

    return json({
      sessionId: randomUUID(),
      messages: [message],
    });
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("[IntakeChat/start] POST failed:", error);
    return errorResponse("Failed to generate discovery questions", 500);
  }
}
