import { prisma } from "@/lib/prisma";
import { json, errorResponse } from "@/lib/auth";
import {
  runAndPersistTextExtractions,
  type TextFieldInput,
} from "@/lib/text-extraction-inference";

/**
 * POST /api/intake/profile-fill/:token/extract
 *
 * Public token-scoped mirror of /api/clients/:id/extract-text-inferences so
 * the client-facing intake form can stream chips into the same
 * InferredPreference pipeline as the advisor view.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  try {
    const { token } = await params;

    const record = await prisma.intakeFormToken.findUnique({
      where: { token },
    });
    const RICH_FORM_VARIANTS = new Set(["profile_link", "individual"]);
    if (!record) return errorResponse("Invalid link", 404);
    if (!RICH_FORM_VARIANTS.has(record.formVariant)) {
      return errorResponse("This link is not a profile-fill link", 400);
    }
    if (record.expiresAt < new Date()) return errorResponse("Link expired", 410);

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

    const result = await runAndPersistTextExtractions(record.clientId, sanitized);
    return json(result);
  } catch (error) {
    console.error("[profile-fill/extract] POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
