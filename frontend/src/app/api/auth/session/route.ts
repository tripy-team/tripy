import jwt from "jsonwebtoken";
import { NextResponse } from "next/server";
import { SESSION_COOKIE } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_AGE_CAP_SECONDS = 24 * 60 * 60; // never persist a cookie longer than a day

/**
 * Server-set session cookie.
 *
 * The client obtains a Cognito id_token (in localStorage today) and POSTs it here
 * right after login / token refresh. We mirror it into an httpOnly cookie so
 * Server Components can authenticate via getServerAuthUser() and render data on
 * the server. The cookie is httpOnly (JS can't read it), so it's safe from XSS
 * exfiltration; it is only ever verified server-side, so a forged value is
 * rejected by the signature check in lib/auth.ts.
 */
export async function POST(request: Request) {
  let idToken: string | undefined;
  try {
    ({ idToken } = await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  if (!idToken || typeof idToken !== "string") {
    return NextResponse.json({ error: "idToken is required" }, { status: 400 });
  }

  // Match the cookie lifetime to the token's own expiry so a stale cookie can't
  // outlive the token it carries. Read path re-verifies the signature regardless.
  let maxAge = 60 * 60; // sensible default if the token has no/!readable exp
  const decoded = jwt.decode(idToken) as { exp?: number } | null;
  if (decoded?.exp) {
    maxAge = Math.max(0, Math.min(decoded.exp - Math.floor(Date.now() / 1000), MAX_AGE_CAP_SECONDS));
  }

  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, idToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge,
  });
  return res;
}

/** Clear the session cookie on logout. */
export async function DELETE() {
  const res = NextResponse.json({ ok: true });
  res.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return res;
}
