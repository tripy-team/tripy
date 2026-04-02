import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function isAwsEndpoint(url: string): boolean {
  return url.includes(".rds.amazonaws.com") || url.includes(".cluster-");
}

function stripSslMode(url: string): string {
  return url
    .replace(/[?&]sslmode=[^&]*/g, "")
    .replace(/\?&/, "?")
    .replace(/\?$/, "");
}

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Configure it in Amplify Console > Environment Variables.",
    );
  }

  const isAws = isAwsEndpoint(connectionString);
  const poolConfig: pg.PoolConfig = {
    connectionString: isAws ? stripSslMode(connectionString) : connectionString,
  };

  if (isAws) {
    poolConfig.ssl = { rejectUnauthorized: false };
  }

  const pool = new pg.Pool(poolConfig);
  const adapter = new PrismaPg(pool);
  return new PrismaClient({ adapter });
}

/**
 * Lazy singleton — the PrismaClient (and its pg Pool) is only created on first
 * property access, so importing this module during `next build` won't crash
 * when DATABASE_URL is absent.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop: string | symbol) {
    if (!globalForPrisma.prisma) {
      globalForPrisma.prisma = createPrismaClient();
    }
    return Reflect.get(globalForPrisma.prisma, prop);
  },
});
