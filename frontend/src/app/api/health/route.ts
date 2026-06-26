import { prisma } from "@/lib/prisma";

// Always run on the server, never cache — the whole point is to exercise the
// live data path on every hit so it stays warm.
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Unauthenticated health + warm-up endpoint.
 *
 * A scheduled pinger (see infra/lib/warmerStack.ts) hits this every few minutes.
 * The `SELECT 1` deliberately runs through Prisma so a single request warms the
 * entire first-load data path that real pages depend on: the Amplify SSR Lambda,
 * the Prisma client + pg pool, and the (cold-to-connect) Aurora connection.
 *
 * It returns 200 even when the DB check fails so the pinger keeps the Lambda warm
 * during a transient DB blip; the `db` field reports the real status for alerting.
 */
export async function GET() {
  const startedAt = Date.now();
  let db: "up" | "down" = "down";

  try {
    await prisma.$queryRaw`SELECT 1`;
    db = "up";
  } catch (error) {
    console.error("[health] DB check failed:", error);
  }

  return Response.json({
    status: "ok",
    db,
    latencyMs: Date.now() - startedAt,
  });
}
