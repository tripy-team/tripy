import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const programs = await prisma.loyaltyProgram.findMany({
      orderBy: { name: "asc" },
    });

    return json(programs);
  } catch (error) {
    console.error("List loyalty programs error:", error);
    return errorResponse("Internal server error", 500);
  }
}
