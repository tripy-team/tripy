import { getProgramCategory } from "@/lib/loyalty-programs";

export type WalletCurrencyType = "bank_points" | "airline_miles" | "hotel_points";

export function programCodeForName(programName: string): string {
  return programName
    .trim()
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

export function currencyTypeForProgram(programName: string): WalletCurrencyType {
  const category = getProgramCategory(programName);

  if (category === "hotel") return "hotel_points";
  if (category === "airline") return "airline_miles";
  return "bank_points";
}

export function normalizedProgramName(programName: string): string {
  return programName.trim().replace(/\s+/g, " ");
}

export function balanceVisibilityLabel(balance: number, visibility: string): string {
  if (visibility === "hidden_but_usable") return "Hidden";
  if (visibility !== "range_only") return balance.toLocaleString();

  if (balance < 10000) return "<10k";
  if (balance < 25000) return "10k-25k";
  if (balance < 50000) return "25k-50k";
  if (balance < 100000) return "50k-100k";
  if (balance < 250000) return "100k-250k";
  return "250k+";
}
