import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import { sendFormInvitation, buildFormLink } from "@/lib/email";

// Resend — resets expiry, marks reminder sent, re-emails client
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

    // Re-send the invitation email
    const advisorName = `${user.firstName} ${user.lastName}`.trim() || user.email;
    const clientName = `${token.client.firstName} ${token.client.lastName}`.trim();
    const VARIANT_TITLES: Record<string, string> = {
      individual: "Travel Preferences Form",
      group_member: "Group Trip Preferences",
      group_organizer: "Group Trip Details",
      business_policy: "Company Travel Policy",
      business_traveler: "Business Travel Preferences",
      custom_form: "Travel Form",
    };
    const formTitle = VARIANT_TITLES[token.formVariant] ?? "Travel Form";

    sendFormInvitation({
      recipientEmail: token.recipientEmail,
      recipientName: token.recipientName ?? undefined,
      clientName,
      advisorName,
      formTitle,
      formLink: buildFormLink(token.token),
      expiresAt: newExpiry,
    }).catch((e) => console.error("[email] Resend failed:", e));

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
