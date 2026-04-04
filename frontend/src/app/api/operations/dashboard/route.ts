import { requireAuth, json, errorResponse } from "@/lib/auth";
import { getOperationsDashboard } from "@/lib/vendor-operations";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const data = await getOperationsDashboard(user.organizationId);
    return json(data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Operations dashboard error:", error);
    return errorResponse("Internal server error", 500);
  }
}
