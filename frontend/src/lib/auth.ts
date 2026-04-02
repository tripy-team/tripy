import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import { prisma } from "./prisma";
import type { UserRole } from "@/generated/prisma";

const JWT_SECRET = process.env.JWT_SECRET || "tripy-dev-secret-change-me";
const TOKEN_EXPIRY = "7d";

export interface TokenPayload {
  userId: string;
  organizationId: string;
  role: UserRole;
}

export function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(
  password: string,
  hash: string,
): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

export function signToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn: TOKEN_EXPIRY });
}

export function verifyToken(token: string): TokenPayload {
  return jwt.verify(token, JWT_SECRET) as TokenPayload;
}

export async function getAuthUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  try {
    const payload = verifyToken(authHeader.slice(7));
    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      include: { organization: true },
    });
    return user;
  } catch {
    return null;
  }
}

export function requireAuth(request: Request) {
  return getAuthUser(request).then((user) => {
    if (!user) {
      throw new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    return user;
  });
}

export function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(message: string, status = 400) {
  return json({ error: message }, status);
}
