import { prisma } from "@/lib/prisma";
import { hashPassword, signToken, json, errorResponse } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { organizationName, firstName, lastName, email, password } = body;

    if (!organizationName || !firstName || !lastName || !email || !password) {
      return errorResponse("All fields are required", 400);
    }

    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      return errorResponse("Email already in use", 409);
    }

    const slug = organizationName
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "");

    const org = await prisma.organization.create({
      data: { name: organizationName, slug },
    });

    const passwordHash = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        organizationId: org.id,
        firstName,
        lastName,
        email,
        passwordHash,
        role: "admin",
      },
    });

    const token = signToken({
      userId: user.id,
      organizationId: org.id,
      role: user.role,
    });

    return json({
      token,
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        role: user.role,
        organizationId: user.organizationId,
      },
    }, 201);
  } catch (error) {
    console.error("Signup error:", error);
    return errorResponse("Internal server error", 500);
  }
}
