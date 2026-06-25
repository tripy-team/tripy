// ---------------------------------------------------------------------------
// Local-dev auth bypass (client side)
// ---------------------------------------------------------------------------
// When NEXT_PUBLIC_DEV_AUTH_BYPASS=true (set in .env.local for `next dev`), we
// seed placeholder credentials into storage so every CLIENT-side auth gate
// treats us as already signed in — the marketing nav, the (app) layout, etc.
//
// The token value is a sentinel; the SERVER ignores it because DEV_AUTH_BYPASS
// in lib/auth.ts resolves a real database user without checking the token. So
// no real Cognito sign-in is needed to browse the app locally.
//
// Guarded on the public flag only — but that flag is only ever set in .env.local,
// and the server half is additionally guarded on NODE_ENV === 'development', so
// this can never grant access in a real deployment.

export const DEV_AUTH_BYPASS = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true';

const SENTINEL_TOKEN = 'dev-bypass-token';
const DEV_USER = { name: 'Dev User', email: 'dev@localhost', userId: 'dev-bypass' };

/**
 * Ensure a fake local session exists. Idempotent. Returns true when the dev
 * bypass is active (so callers can branch, e.g. the login page short-circuits).
 */
export function ensureDevSession(): boolean {
  if (!DEV_AUTH_BYPASS || typeof window === 'undefined') return false;

  if (!localStorage.getItem('tripy_token')) {
    // Only seed the token the Next.js API client / (app) layout reads. The server
    // ignores its value (DEV_AUTH_BYPASS resolves a real local-DB user).
    localStorage.setItem('tripy_token', SENTINEL_TOKEN);
    localStorage.setItem('tripy_user', JSON.stringify(DEV_USER));
    // Deliberately DO NOT seed access_token/id_token/refresh_token: the B2C
    // trip-planning pages use api.ts against the real backend, which would try to
    // refresh a bogus Cognito token and spam 401s. With no token, api.ts falls back
    // to an anonymous session (X-Anon-Session-Id) — exactly the B2C guest flow.
    window.dispatchEvent(new Event('tripy_auth_change'));
  }

  return true;
}
