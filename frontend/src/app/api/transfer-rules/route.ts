import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const rules = await prisma.programTransferRule.findMany({
      where: { isActive: true },
      include: {
        fromProgram: true,
        toProgram: true,
      },
      orderBy: { createdAt: "desc" },
    });

    return json(rules);
  } catch (error) {
    console.error("List transfer rules error:", error);
    return errorResponse("Internal server error", 500);
  }
}
