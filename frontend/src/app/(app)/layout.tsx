import { getServerAuthUser } from '@/lib/auth';
import type { User as UserType } from '@/lib/api-client';
import AppShell from './AppShell';

// Reads the session cookie, so it must render per request.
export const dynamic = 'force-dynamic';

/**
 * Authenticated app layout (Server Component).
 *
 * Resolves the signed-in user from the httpOnly session cookie on the server, so
 * the app chrome — and any server-rendered page beneath it — no longer waits on a
 * client-side getMe() round trip before showing anything.
 *
 * On failure (no/expired cookie) we pass `initialUser = null` and let AppShell
 * run the original client-side gate, so existing sessions keep working and only
 * upgrade to the fast path once their cookie is backfilled. We deliberately do
 * NOT redirect here: a valid localStorage session whose cookie isn't set yet must
 * not be bounced to /login.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  let initialUser: UserType | null = null;

  try {
    const u = await getServerAuthUser();
    if (u) {
      initialUser = {
        userId: u.id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName ?? '',
        role: String(u.role),
        orgId: u.organizationId,
      };
    }
  } catch (error) {
    console.error('[app layout] server auth failed, falling back to client gate:', error);
  }

  return <AppShell initialUser={initialUser}>{children}</AppShell>;
}
