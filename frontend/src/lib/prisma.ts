import { PrismaClient } from "@/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const connectionString = process.env.DATABASE_URL!;

const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };

function isAwsEndpoint(url: string): boolean {
  return url.includes(".rds.amazonaws.com") || url.includes(".cluster-");
}

function stripSslMode(url: string): string {
  return url.replace(/[?&]sslmode=[^&]*/g, "").replace(/\?&/, "?").replace(/\?$/, "");
}

function createPrismaClient() {
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

export const prisma = globalForPrisma.prisma || createPrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
