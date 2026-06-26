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
      // Account identity is strictly (connection, providerAccountId). A single
      // traveler holds many programs — each under its own login/email (Amex on
      // one, Chase on another) — plus, rarely, two accounts in the same program.
      // Each is a distinct redemption pool, so they must be distinct rows.
      // NEVER match on programCode alone: that collapses Amex+Chase-style or
      // same-program-multi-account entries onto one row and overwrites balances.
      const existing = account.providerAccountId
        ? await tx.walletAccount.findFirst({
            where: { userId, connectionId, providerAccountId: account.providerAccountId },
          })
        : await tx.walletAccount.findFirst({
            // Fallback only for accounts that genuinely lack a provider id.
            where: { userId, connectionId, programCode: account.programCode, source },
          });

      const accountData = {
        connectionId,
        userId,
        providerAccountId: account.providerAccountId,
        programCode: account.programCode,
        programName: account.programName,
        ownerLabel: account.ownerLabel || null,
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
