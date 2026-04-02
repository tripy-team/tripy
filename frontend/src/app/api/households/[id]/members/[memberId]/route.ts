import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string; memberId: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id, memberId } = await params;

    const household = await prisma.household.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!household) return errorResponse("Household not found", 404);

    const member = await prisma.householdMember.findFirst({
      where: { id: memberId, householdId: id },
    });
    if (!member) return errorResponse("Member not found", 404);

    await prisma.householdMember.delete({ where: { id: memberId } });

    return json({ success: true });
  } catch (error) {
    console.error("Remove household member error:", error);
    return errorResponse("Internal server error", 500);
  }
}
