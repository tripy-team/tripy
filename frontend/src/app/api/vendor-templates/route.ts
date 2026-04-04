import { prisma } from "@/lib/prisma";
import { requireAuth, json, errorResponse } from "@/lib/auth";

export async function GET(request: Request) {
  try {
    const user = await requireAuth(request);

    const templates = await prisma.vendorRequestTemplate.findMany({
      where: {
        OR: [
          { scope: "system" },
          { scope: "organization", organizationId: user.organizationId },
        ],
        isActive: true,
      },
      orderBy: [{ scope: "asc" }, { title: "asc" }],
    });

    return json(templates);
  } catch (error) {
    if (error instanceof Response) return error;
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth(request);
    const body = await request.json();

    const { title, requestType, defaultBody, placeholders, defaultUrgency, defaultReminders } = body;

    if (!title || !requestType || !defaultBody) {
      return errorResponse("title, requestType, and defaultBody are required");
    }

    const template = await prisma.vendorRequestTemplate.create({
      data: {
        organizationId: user.organizationId,
        scope: "organization",
        title,
        requestType,
        defaultBody,
        placeholders,
        defaultUrgency: defaultUrgency || "medium",
        defaultReminders,
      },
    });

    return json(template, 201);
  } catch (error) {
    if (error instanceof Response) return error;
    console.error("Template POST error:", error);
    return errorResponse("Internal server error", 500);
  }
}
