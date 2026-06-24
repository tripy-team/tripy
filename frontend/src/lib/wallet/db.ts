import { prisma } from "@/lib/prisma";
import type { NormalizedWalletAccount } from "@/lib/wallet/providers";

type WalletAccountSource = "manual" | "sync" | "imported";

interface UpsertWalletAccountsInput {
  userId: string;
  connectionId?: string | null;
  accounts: NormalizedWalletAccount[];
  source?: WalletAccountSource;
  syncRunId?: string | null;
  reason?: string;
}

function parseDate(value?: string | null): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export async function listWalletAccounts(userId: string) {
  return prisma.walletAccount.findMany({
    where: { userId },
    include: {
      connection: {
        select: {
          id: true,
          provider: true,
          displayName: true,
          status: true,
          lastSyncedAt: true,
        },
      },
    },
    orderBy: [{ enabledForOptimization: "desc" }, { programName: "asc" }],
  });
}

export async function upsertWalletAccounts({
  userId,
  connectionId = null,
  accounts,
  source = "sync",
  syncRunId = null,
  reason = "Provider sync",
}: UpsertWalletAccountsInput) {
  if (accounts.length === 0) return { accounts: [], accountsUpdated: 0 };

  return prisma.$transaction(async (tx) => {
    const savedAccounts = [];
    let accountsUpdated = 0;

    for (const account of accounts) {
      const matchClauses = [
        account.providerAccountId
          ? {
              connectionId,
              providerAccountId: account.providerAccountId,
            }
          : null,
        connectionId
          ? {
              connectionId,
              programCode: account.programCode,
            }
          : null,
        !connectionId
          ? {
              programCode: account.programCode,
              source,
            }
          : null,
      ].filter(Boolean) as Array<Record<string, unknown>>;

      const existing = await tx.walletAccount.findFirst({
        where: {
          userId,
          OR: matchClauses.length ? matchClauses : [{ programCode: account.programCode }],
        },
      });

      const accountData = {
        connectionId,
        userId,
        providerAccountId: account.providerAccountId,
        programCode: account.programCode,
        programName: account.programName,
        currencyType: account.currencyType,
        accountMask: account.accountMask || null,
        balance: account.balance,
        expirationDate: parseDate(account.expirationDate),
        eliteStatus: account.eliteStatus || null,
        source,
        lastSyncedAt: source === "sync" ? new Date() : null,
        lastManualEditAt: source === "manual" ? new Date() : null,
      };

      const saved = existing
        ? await tx.walletAccount.update({
            where: { id: existing.id },
            data: accountData,
          })
        : await tx.walletAccount.create({
            data: accountData,
          });

      if (!existing || existing.balance !== account.balance) {
        accountsUpdated += 1;
        await tx.walletSyncEvent.create({
          data: {
            walletAccountId: saved.id,
            syncRunId,
            previousBalance: existing?.balance ?? null,
            newBalance: account.balance,
            delta: account.balance - (existing?.balance ?? 0),
            reason,
          },
        });
      }

      savedAccounts.push(saved);
    }

    return { accounts: savedAccounts, accountsUpdated };
  });
}
