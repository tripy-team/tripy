import { errorResponse, getAuthUser, json } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { listWalletAccounts, upsertWalletAccounts } from "@/lib/wallet/db";
import { currencyTypeForProgram, normalizedProgramName, programCodeForName } from "@/lib/wallet/programs";
import type { NormalizedWalletAccount } from "@/lib/wallet/providers";

const VISIBILITY_VALUES = new Set(["exact", "range_only", "hidden_but_usable"]);

export async function GET(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    return json(await listWalletAccounts(user.id));
  } catch (error) {
    console.error("List wallet accounts error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function POST(request: Request) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const body = await request.json();
    const programName = normalizedProgramName(String(body.programName || body.program || ""));
    const balance = Number(body.balance);

    if (!programName || !Number.isFinite(balance) || balance < 0) {
      return errorResponse("programName and a non-negative balance are required", 400);
    }

    const normalizedAccount: NormalizedWalletAccount = {
      providerAccountId: `manual_${programCodeForName(programName)}`,
      programCode: programCodeForName(programName),
      programName,
      currencyType: currencyTypeForProgram(programName),
      balance: Math.round(balance),
      accountMask: body.accountMask || null,
      expirationDate: body.expirationDate || null,
      eliteStatus: body.eliteStatus || null,
    };

    const result = await upsertWalletAccounts({
      userId: user.id,
      accounts: [normalizedAccount],
      source: "manual",
      reason: "Manual wallet entry",
    });

    let account = result.accounts[0];
    if (body.visibility !== undefined || body.enabledForOptimization !== undefined) {
      if (body.visibility !== undefined && !VISIBILITY_VALUES.has(String(body.visibility))) {
        return errorResponse("Invalid visibility", 400);
      }

      account = await prisma.walletAccount.update({
        where: { id: account.id },
        data: {
          visibility: body.visibility || account.visibility,
          enabledForOptimization: body.enabledForOptimization !== false,
        },
      });
    }

    return json(account, 201);
  } catch (error) {
    console.error("Create wallet account error:", error);
    return errorResponse("Internal server error", 500);
  }
}
