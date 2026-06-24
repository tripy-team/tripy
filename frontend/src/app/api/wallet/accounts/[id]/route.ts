import { errorResponse, getAuthUser, json } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { currencyTypeForProgram, normalizedProgramName, programCodeForName } from "@/lib/wallet/programs";

const VISIBILITY_VALUES = new Set(["exact", "range_only", "hidden_but_usable"]);

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const account = await prisma.walletAccount.findFirst({ where: { id, userId: user.id } });
    if (!account) return errorResponse("Wallet account not found", 404);

    const body = await request.json();
    const data: Record<string, unknown> = {};

    if (body.programName !== undefined) {
      const programName = normalizedProgramName(String(body.programName));
      if (!programName) return errorResponse("programName cannot be empty", 400);
      data.programName = programName;
      data.programCode = programCodeForName(programName);
      data.currencyType = currencyTypeForProgram(programName);
    }

    if (body.balance !== undefined) {
      const balance = Number(body.balance);
      if (!Number.isFinite(balance) || balance < 0) {
        return errorResponse("balance must be a non-negative number", 400);
      }
      data.balance = Math.round(balance);
      data.lastManualEditAt = new Date();
    }

    if (body.expirationDate !== undefined) {
      data.expirationDate = body.expirationDate ? new Date(body.expirationDate) : null;
    }
    if (body.eliteStatus !== undefined) data.eliteStatus = body.eliteStatus || null;
    if (body.accountMask !== undefined) data.accountMask = body.accountMask || null;
    if (body.enabledForOptimization !== undefined) {
      data.enabledForOptimization = Boolean(body.enabledForOptimization);
    }
    if (body.visibility !== undefined) {
      if (!VISIBILITY_VALUES.has(String(body.visibility))) {
        return errorResponse("Invalid visibility", 400);
      }
      data.visibility = body.visibility;
    }

    const updated = await prisma.walletAccount.update({
      where: { id },
      data,
    });

    if (body.balance !== undefined && account.balance !== updated.balance) {
      await prisma.walletSyncEvent.create({
        data: {
          walletAccountId: updated.id,
          previousBalance: account.balance,
          newBalance: updated.balance,
          delta: updated.balance - account.balance,
          reason: "Manual wallet edit",
        },
      });
    }

    return json(updated);
  } catch (error) {
    console.error("Update wallet account error:", error);
    return errorResponse("Internal server error", 500);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await getAuthUser(request);
    if (!user) return errorResponse("Unauthorized", 401);

    const { id } = await params;
    const account = await prisma.walletAccount.findFirst({ where: { id, userId: user.id } });
    if (!account) return errorResponse("Wallet account not found", 404);

    await prisma.walletAccount.delete({ where: { id } });
    return json({ ok: true });
  } catch (error) {
    console.error("Delete wallet account error:", error);
    return errorResponse("Internal server error", 500);
  }
}
