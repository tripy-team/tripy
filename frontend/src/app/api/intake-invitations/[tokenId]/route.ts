import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

// Resend — resets expiry, marks reminder sent
export async function POST(
  request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { tokenId } = await params;

    const token = await prisma.intakeFormToken.findFirst({
      where: { id: tokenId },
      include: { client: true },
    });
    if (!token) return errorResponse("Token not found", 404);
    if (token.client.organizationId !== user.organizationId) return errorResponse("Not authorized", 403);
    if (token.completedAt) return errorResponse("Form already completed", 400);

    const newExpiry = new Date();
    newExpiry.setDate(newExpiry.getDate() + 14);

    const updated = await prisma.intakeFormToken.update({
      where: { id: tokenId },
      data: { expiresAt: newExpiry, reminderSentAt: new Date(), sentAt: new Date() },
    });

    return json(updated);
  } catch (error) {
    console.error("Resend invitation error:", error);
    return errorResponse("Internal server error", 500);
  }
}

// Revoke
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ tokenId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);
    const { tokenId } = await params;

    const token = await prisma.intakeFormToken.findFirst({
      where: { id: tokenId },
      include: { client: true },
    });
    if (!token) return errorResponse("Token not found", 404);
    if (token.client.organizationId !== user.organizationId) return errorResponse("Not authorized", 403);

    await prisma.intakeFormToken.delete({ where: { id: tokenId } });
    return new Response(null, { status: 204 });
  } catch (error) {
    console.error("Revoke invitation error:", error);
    return errorResponse("Internal server error", 500);
  }
}
