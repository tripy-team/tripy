import { getAuthUser, errorResponse, json } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard-data";

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    return json(await getDashboardData(user));
  } catch (error) {
    console.error("Dashboard error:", error);
    return errorResponse("Internal server error", 500);
  }
}
