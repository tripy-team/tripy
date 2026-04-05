import { requireAuth, json, errorResponse } from "@/lib/auth";
import { getOperationsDashboard } from "@/lib/vendor-operations";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId") ?? undefined;
    const data = await getOperationsDashboard(user.organizationId, clientId);
    return json(data);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Operations dashboard error:", error);
    return errorResponse("Internal server error", 500);
  }
}
