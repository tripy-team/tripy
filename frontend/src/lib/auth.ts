import jwt from "jsonwebtoken";
import { createPublicKey, type JsonWebKey } from "crypto";
import { prisma } from "./prisma";
import type { UserRole } from "@/generated/prisma/client";

const COGNITO_REGION = process.env.COGNITO_REGION || "us-east-1";
const COGNITO_USER_POOL_ID = process.env.COGNITO_USER_POOL_ID || "";
const JWKS_URL = COGNITO_USER_POOL_ID
  ? `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/${COGNITO_USER_POOL_ID}/.well-known/jwks.json`
  : "";

// Cache JWKS keys for 1 hour (kid → PEM string)
let jwksCache: Record<string, string> = {};
let jwksCacheTime = 0;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getPublicKeyPem(kid: string): Promise<string | null> {
  const now = Date.now();
  if (Object.keys(jwksCache).length === 0 || now - jwksCacheTime > JWKS_TTL_MS) {
    if (!JWKS_URL) return null;
    try {
      const res = await fetch(JWKS_URL);
      if (!res.ok) return null;
      const body = (await res.json()) as { keys: Array<JsonWebKey & { kid?: string }> };
      jwksCache = {};
      for (const jwk of body.keys) {
        const pubKey = createPublicKey({ key: jwk, format: "jwk" });
        jwksCache[jwk.kid ?? ""] = pubKey.export({ type: "spki", format: "pem" }) as string;
      }
      jwksCacheTime = now;
    } catch {
      return null;
    }
  }
  return jwksCache[kid] ?? null;
}

interface CognitoTokenData {
  sub: string;
  email: string;
  firstName: string;
  lastName: string;
}

async function verifyCognitoToken(token: string): Promise<CognitoTokenData | null> {
  const decoded = jwt.decode(token, { complete: true });
  if (!decoded || typeof decoded === "string") return null;

  const kid = decoded.header.kid;
  if (!kid) return null;

  const pem = await getPublicKeyPem(kid);
  if (!pem) return null;

  try {
    jwt.verify(token, pem, { algorithms: ["RS256"] });
  } catch {
    return null;
  }

  const payload = decoded.payload as Record<string, string>;

  // Access tokens use 'username'; ID tokens use 'email'
  const email = payload.email || payload.username || payload["cognito:username"];
  if (!email || !payload.sub) return null;

  return {
    sub: payload.sub,
    email,
    firstName: payload.given_name || "",
    lastName: payload.family_name || "",
  };
}

async function findOrCreatePrismaUser(data: CognitoTokenData) {
  // Look up by email first (handles users who registered via the old Prisma signup)
  const existing = await prisma.user.findUnique({
    where: { email: data.email },
    include: { organization: true },
  });
  if (existing) return existing;

  // Fallback: look up by Cognito sub — catches users whose email was previously stored
  // as a UUID (because an access token was used instead of an ID token)
  const existingById = await prisma.user.findUnique({
    where: { id: data.sub },
    include: { organization: true },
  });
  if (existingById) {
    // Repair firstName/lastName if they were set to the UUID, and fix the email
    const needsRepair =
      !existingById.email.includes("@") ||
      existingById.firstName === existingById.email.split("@")[0];
    if (needsRepair && data.email.includes("@")) {
      const updated = await prisma.user.update({
        where: { id: data.sub },
        data: {
          email: data.email,
          firstName: data.firstName || data.email.split("@")[0],
          lastName: data.lastName || existingById.lastName,
        },
        include: { organization: true },
      });
      return updated;
    }
    return existingById;
  }

  // Auto-provision a Prisma record for a new Cognito user
  const baseSlug = data.email.split("@")[0].toLowerCase().replace(/[^a-z0-9]+/g, "-");
  const org = await prisma.organization.create({
    data: {
      name: `${data.firstName || data.email}'s Workspace`,
      slug: `${baseSlug}-${Date.now()}`,
    },
  });

  return prisma.user.create({
    data: {
      id: data.sub, // use Cognito sub so it's stable across logins
      organizationId: org.id,
      firstName: data.firstName || data.email.split("@")[0],
      lastName: data.lastName || "",
      email: data.email,
      passwordHash: "COGNITO_AUTH", // not used — auth is via Cognito
      role: "admin" as UserRole,
    },
    include: { organization: true },
  });
}

export async function getAuthUser(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) return null;

  const token = authHeader.slice(7);

  const cognitoData = await verifyCognitoToken(token);
  if (!cognitoData) return null;

  try {
    return await findOrCreatePrismaUser(cognitoData);
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
