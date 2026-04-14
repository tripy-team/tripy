import { prisma } from "@/lib/prisma";
import { getAuthUser, json, errorResponse } from "@/lib/auth";
import {
  runAndPersistTextExtractions,
  type TextFieldInput,
} from "@/lib/text-extraction-inference";

/**
 * POST /api/clients/:id/extract-text-inferences
 *
 * Body: { fields: [{ fieldName: string, text: string }, ...] }
 *
 * Sends free-text from profile inputs to the extraction LLM and persists
 * resulting inferences into InferredPreference with source="text_extraction".
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;

    const client = await prisma.client.findFirst({
      where: { id, organizationId: user.organizationId },
    });
    if (!client) return errorResponse("Client not found", 404);

    const body = await request.json();
    const fields = (body?.fields ?? []) as TextFieldInput[];

    if (!Array.isArray(fields) || fields.length === 0) {
      return errorResponse("fields array required", 400);
    }

    const sanitized = fields
      .filter(
        (f) =>
          f &&
          typeof f.fieldName === "string" &&
          typeof f.text === "string" &&
          f.text.trim().length > 0,
      )
      .slice(0, 20);

    if (sanitized.length === 0) {
      return json({ created: 0, inferences: [], tokensByField: {} });
    }

    const result = await runAndPersistTextExtractions(id, sanitized);
    return json(result);
  } catch (error) {
    console.error("Extract text inferences error:", error);
    return errorResponse("Internal server error", 500);
  }
}
