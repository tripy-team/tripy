import { prisma } from "@/lib/prisma";
import { verifyPassword, signToken, json, errorResponse } from "@/lib/auth";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { email, password } = body;

    if (!email || !password) {
      return errorResponse("Email and password are required", 400);
    }

    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      return errorResponse("Invalid credentials", 401);
    }

    const valid = await verifyPassword(password, user.passwordHash);
    if (!valid) {
      return errorResponse("Invalid credentials", 401);
    }

    const token = signToken({
      userId: user.id,
      organizationId: user.organizationId,
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
    });
  } catch (error) {
    console.error("Login error:", error);
    return errorResponse("Internal server error", 500);
  }
}
