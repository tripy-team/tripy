import { requireAuth, json, errorResponse } from "@/lib/auth";
import {
  calculateVendorStats,
  getOrgVendorRankings,
} from "@/lib/vendor-operations";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);
    const { searchParams } = new URL(request.url);
    const vendorName = searchParams.get("vendorName");

    if (vendorName) {
      const stats = await calculateVendorStats(user.organizationId, vendorName);
      return json(stats);
    }

    const rankings = await getOrgVendorRankings(user.organizationId);
    return json(rankings);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Vendor stats error:", error);
    return errorResponse("Internal server error", 500);
  }
}
