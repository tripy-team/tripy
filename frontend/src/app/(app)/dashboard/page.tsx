import { getServerAuthUser } from '@/lib/auth';
import { getDashboardData } from '@/lib/dashboard-data';
import type { DashboardData } from '@/lib/api-client';
import DashboardClient from './DashboardClient';

// Reads the session cookie, so it must render dynamically per request.
export const dynamic = 'force-dynamic';

/**
 * Dashboard (Server Component).
 *
 * When the httpOnly session cookie is present, we authenticate and run the
 * dashboard queries on the server, so the HTML ships with the data already in
 * it — eliminating the hydrate → fetch → cold-Lambda round trip on first load.
 *
 * Everything is wrapped so that any failure (no cookie, expired token, DB blip)
 * degrades to `initialData = null`, and DashboardClient fetches on the client
 * exactly as it did before. This path is never worse than the old behavior.
 */
export default async function DashboardPage() {
  let initialData: DashboardData | null = null;

  try {
    const user = await getServerAuthUser();
    if (user) {
      // JSON round-trip so the props handed to the client component are plain,
      // wire-identical values (no Prisma Date/Decimal instances crossing the
      // server→client boundary).
      initialData = JSON.parse(JSON.stringify(await getDashboardData(user)));
    }
  } catch (error) {
    console.error('[dashboard] server render fell back to client fetch:', error);
    initialData = null;
  }

  return <DashboardClient initialData={initialData} />;
}
