import { requireAuth, json, errorResponse } from "@/lib/auth";
import { translateClientRequest } from "@/lib/vendor-ai";

export async function POST(request: Request) {
  try {
    await requireAuth(request);
    const body = await request.json();

    const { vagueRequest, clientName, tripType, tripDestination } = body;
    if (!vagueRequest) {
      return errorResponse("vagueRequest is required");
    }

    const result = await translateClientRequest({
      vagueRequest,
      clientName,
      tripType,
      tripDestination,
    });

    return json(result);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Translate error:", error);
    return errorResponse("Internal server error", 500);
  }
}
