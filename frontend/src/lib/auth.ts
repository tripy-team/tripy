import jwt from "jsonwebtoken";
import { createPublicKey, type JsonWebKey } from "crypto";
import { prisma } from "./prisma";
import type { UserRole } from "@/generated/prisma/client";

const COGNITO_REGION = process.env.NEXT_PUBLIC_COGNITO_REGION || process.env.COGNITO_REGION || "us-east-1";
const COGNITO_USER_POOL_ID = process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID || process.env.COGNITO_USER_POOL_ID || "";
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
  if (!decoded || typeof decoded === "string") {
    console.error("[auth] Failed to decode token");
    return null;
  }

  const kid = decoded.header.kid;
  if (!kid) {
    console.error("[auth] Token missing kid header");
    return null;
  }

  const pem = await getPublicKeyPem(kid);
  if (!pem) {
    console.error(`[auth] Could not get public key for kid=${kid}. COGNITO_USER_POOL_ID="${COGNITO_USER_POOL_ID}", JWKS_URL="${JWKS_URL}"`);
    return null;
  }

  try {
    jwt.verify(token, pem, { algorithms: ["RS256"] });
  } catch (err) {
    console.error("[auth] Token signature verification failed:", err);
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

// ---------------------------------------------------------------------------
// Local-dev auth bypass
// ---------------------------------------------------------------------------
// When DEV_AUTH_BYPASS=true in a `next dev` run, API routes act as a real user
// from the database without any Cognito token, so the whole app is browsable
// without logging in. Double-guarded on NODE_ENV so it can NEVER activate in a
// production build (Next sets NODE_ENV="production" there, making this dead code).
const DEV_AUTH_BYPASS =
  process.env.NODE_ENV === "development" && process.env.DEV_AUTH_BYPASS === "true";

async function getDevBypassUser() {
  const email = process.env.DEV_AUTH_BYPASS_EMAIL;
  try {
    const user = email
      ? await prisma.user.findUnique({ where: { email }, include: { organization: true } })
      : await prisma.user.findFirst({ include: { organization: true }, orderBy: { createdAt: "asc" } });
    if (!user) {
      console.warn(
        `[auth] DEV_AUTH_BYPASS is on but no matching user was found${email ? ` for "${email}"` : " (database has no users)"}.`,
      );
    }
    return user;
  } catch (err) {
    console.error("[auth] DEV_AUTH_BYPASS user lookup failed (is PostgreSQL running and migrated?):", err);
    return null;
  }
}

/**
 * Name of the httpOnly session cookie that mirrors the Cognito id_token.
 * Set server-side via POST /api/auth/session so Server Components and Route
 * Handlers can authenticate without access to the browser's localStorage.
 */
export const SESSION_COOKIE = "tripy_session";

/** Pull a single cookie value out of a raw `Cookie:` header. */
function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return null;
}

/** Verify a Cognito id_token and resolve (or provision) the Prisma user it maps to. */
export async function resolveUserFromToken(token: string) {
  const cognitoData = await verifyCognitoToken(token);
  if (!cognitoData) return null;

  try {
    return await findOrCreatePrismaUser(cognitoData);
  } catch (err) {
    console.error("[auth] findOrCreatePrismaUser failed (is PostgreSQL running and migrated?):", err);
    return null;
  }
}

export async function getAuthUser(request: Request) {
  if (DEV_AUTH_BYPASS) return getDevBypassUser();

  // Prefer the Authorization header (browser fetches still send it), but fall
  // back to the session cookie so the same routes authenticate when called
  // server-side (SSR / server components) where no header is attached.
  const authHeader = request.headers.get("authorization");
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : readCookie(request.headers.get("cookie"), SESSION_COOKIE);

  if (!token) return null;

  return resolveUserFromToken(token);
}

/**
 * Authenticate a user from the session cookie inside a Server Component.
 *
 * This is what lets hot pages render their data on the server: the page calls
 * this, and on success runs its Prisma queries directly — shipping HTML with the
 * data already in it, instead of a shell that fetches after hydration. Returns
 * null when the cookie is missing/expired so the caller can degrade gracefully
 * (render the client component, which fetches + refreshes the token as before).
 */
export async function getServerAuthUser() {
  if (DEV_AUTH_BYPASS) return getDevBypassUser();

  // Imported lazily so this server-only API never leaks into a client bundle
  // that happens to import other helpers from this module.
  const { cookies } = await import("next/headers");
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;

  return resolveUserFromToken(token);
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
