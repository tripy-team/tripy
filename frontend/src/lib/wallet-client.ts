export type WalletProviderId =
  | "manual"
  | "awardwallet_account_access"
  | "awardwallet_web_parsing"
  | "mock";

export type WalletCurrencyType = "bank_points" | "airline_miles" | "hotel_points";
export type WalletVisibility = "exact" | "range_only" | "hidden_but_usable";

export interface WalletConnectionSummary {
  id: string;
  provider: WalletProviderId;
  displayName?: string | null;
  status: string;
  lastSyncedAt?: string | null;
}

export interface WalletAccount {
  id: string;
  connectionId?: string | null;
  userId: string;
  providerAccountId?: string | null;
  programCode: string;
  programName: string;
  currencyType: WalletCurrencyType;
  accountMask?: string | null;
  balance: number;
  expirationDate?: string | null;
  eliteStatus?: string | null;
  source: "manual" | "sync" | "imported";
  visibility: WalletVisibility;
  enabledForOptimization: boolean;
  lastSyncedAt?: string | null;
  lastManualEditAt?: string | null;
  createdAt: string;
  updatedAt: string;
  connection?: WalletConnectionSummary | null;
}

export interface WalletLinkToken {
  provider: WalletProviderId;
  mode: "redirect" | "inline" | "mock";
  sessionId: string;
  linkUrl?: string;
  message?: string;
}

export interface WalletSyncResponse {
  connection: WalletConnectionSummary;
  syncRun: {
    id: string;
    status: string;
    accountsUpdated: number;
    completedAt?: string | null;
  };
  accounts: WalletAccount[];
}

function getWalletToken(): string | null {
  if (typeof window === "undefined") return null;
  return (
    sessionStorage.getItem("id_token") ||
    localStorage.getItem("id_token") ||
    sessionStorage.getItem("access_token") ||
    localStorage.getItem("access_token") ||
    localStorage.getItem("tripy_token")
  );
}

async function walletFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = getWalletToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  if (options.headers) {
    new Headers(options.headers).forEach((value, key) => {
      headers[key] = value;
    });
  }
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(`/api/wallet${path}`, {
    ...options,
    headers,
  });

  const text = await response.text();
  const data = text ? JSON.parse(text) : null;

  if (!response.ok) {
    throw new Error(data?.error || data?.message || `Wallet request failed: ${response.status}`);
  }

  return data as T;
}

export function createWalletLinkToken(provider: WalletProviderId = "mock") {
  return walletFetch<WalletLinkToken>("/link-token", {
    method: "POST",
    body: JSON.stringify({ provider }),
  });
}

export function getWalletAccounts() {
  return walletFetch<WalletAccount[]>("/accounts");
}

export function syncWallet(provider: WalletProviderId = "mock", connectionId?: string | null) {
  return walletFetch<WalletSyncResponse>("/sync", {
    method: "POST",
    body: JSON.stringify({ provider, connectionId }),
  });
}

export interface ManualWalletAccountPayload {
  programName: string;
  balance: number;
  expirationDate?: string | null;
  eliteStatus?: string | null;
  accountMask?: string | null;
  visibility?: WalletVisibility;
  enabledForOptimization?: boolean;
}

export function createManualWalletAccount(payload: ManualWalletAccountPayload) {
  return walletFetch<WalletAccount>("/accounts", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateWalletAccount(id: string, payload: Partial<ManualWalletAccountPayload>) {
  return walletFetch<WalletAccount>(`/accounts/${id}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteWalletAccount(id: string) {
  return walletFetch<{ ok: true }>(`/accounts/${id}`, {
    method: "DELETE",
  });
}

export function disconnectWalletConnection(id: string) {
  return walletFetch<{ ok: true }>(`/connections/${id}`, {
    method: "DELETE",
  });
}
