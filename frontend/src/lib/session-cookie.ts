// Client helpers that keep the server-side httpOnly session cookie in sync with
// the Cognito id_token the app already manages in localStorage.
//
// The cookie is what lets Server Components authenticate and render data on the
// server (see getServerAuthUser in lib/auth.ts). These calls are best-effort:
// if syncing fails, the app still works exactly as before via the localStorage
// token + client-side fetch — server rendering simply falls back to client fetch.

/** Mirror the given id_token into the httpOnly session cookie. */
export async function syncSessionCookie(idToken: string | null | undefined): Promise<void> {
  if (!idToken) return;
  try {
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ idToken }),
    });
  } catch {
    // Non-fatal: server rendering will just fall back to client-side fetching.
  }
}

/** Clear the httpOnly session cookie (call on logout). */
export async function clearSessionCookie(): Promise<void> {
  try {
    await fetch("/api/auth/session", { method: "DELETE" });
  } catch {
    // Non-fatal.
  }
}
