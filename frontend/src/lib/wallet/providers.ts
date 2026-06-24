import {
  currencyTypeForProgram,
  normalizedProgramName,
  programCodeForName,
  type WalletCurrencyType,
} from "@/lib/wallet/programs";

export type WalletProviderId =
  | "manual"
  | "awardwallet_account_access"
  | "awardwallet_web_parsing"
  | "mock";

export interface NormalizedWalletAccount {
  providerAccountId: string;
  programCode: string;
  programName: string;
  currencyType: WalletCurrencyType;
  balance: number;
  accountMask?: string | null;
  expirationDate?: string | null;
  eliteStatus?: string | null;
}

export interface WalletLinkToken {
  provider: WalletProviderId;
  mode: "redirect" | "inline" | "mock";
  sessionId: string;
  linkUrl?: string;
  message?: string;
}

export interface WalletSyncResult {
  providerConnectionId?: string | null;
  displayName?: string | null;
  accounts: NormalizedWalletAccount[];
}

interface SyncInput {
  userId: string;
  connectionId?: string | null;
  manualAccounts?: NormalizedWalletAccount[];
}

function buildSessionId(provider: WalletProviderId, userId: string): string {
  const suffix =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(16).slice(2)}`;

  return `${provider}_${userId}_${suffix}`;
}

function normalizeProviderAccount(raw: Record<string, unknown>, index: number): NormalizedWalletAccount {
  const programName = normalizedProgramName(
    String(raw.programName || raw.program_name || raw.program || raw.name || "Unknown Program"),
  );
  const balance = Number(raw.balance || raw.points || raw.miles || raw.amount || 0);
  const providerAccountId = String(
    raw.providerAccountId ||
      raw.provider_account_id ||
      raw.accountId ||
      raw.account_id ||
      `${programCodeForName(programName)}_${index}`,
  );

  return {
    providerAccountId,
    programCode: String(raw.programCode || raw.program_code || programCodeForName(programName)),
    programName,
    currencyType:
      (raw.currencyType as WalletCurrencyType | undefined) ||
      (raw.currency_type as WalletCurrencyType | undefined) ||
      currencyTypeForProgram(programName),
    balance: Number.isFinite(balance) ? Math.max(0, Math.round(balance)) : 0,
    accountMask: raw.accountMask ? String(raw.accountMask) : raw.account_mask ? String(raw.account_mask) : null,
    expirationDate: raw.expirationDate
      ? String(raw.expirationDate)
      : raw.expiration_date
        ? String(raw.expiration_date)
        : null,
    eliteStatus: raw.eliteStatus ? String(raw.eliteStatus) : raw.elite_status ? String(raw.elite_status) : null,
  };
}

function normalizeProviderAccounts(payload: unknown): NormalizedWalletAccount[] {
  const candidate =
    payload && typeof payload === "object" && "accounts" in payload
      ? (payload as { accounts?: unknown }).accounts
      : payload && typeof payload === "object" && "data" in payload
        ? (payload as { data?: { accounts?: unknown } }).data?.accounts
        : payload;

  if (!Array.isArray(candidate)) return [];
  return candidate
    .filter((item): item is Record<string, unknown> => item !== null && typeof item === "object")
    .map(normalizeProviderAccount);
}

export async function createWalletLinkToken(
  provider: WalletProviderId,
  userId: string,
): Promise<WalletLinkToken> {
  const sessionId = buildSessionId(provider, userId);

  if (provider === "mock") {
    return {
      provider,
      mode: "mock",
      sessionId,
      message: "Demo sync is ready. It will create a sample points wallet for testing.",
    };
  }

  if (provider === "manual") {
    return {
      provider,
      mode: "inline",
      sessionId,
      message: "Manual wallet entry is available without a provider connection.",
    };
  }

  if (provider === "awardwallet_account_access") {
    const authorizeUrl = process.env.AWARDWALLET_OAUTH_AUTHORIZE_URL;
    const clientId = process.env.AWARDWALLET_OAUTH_CLIENT_ID;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;

    if (!authorizeUrl || !clientId || !appUrl) {
      return {
        provider,
        mode: "inline",
        sessionId,
        message:
          "AwardWallet OAuth is not configured yet. Add AWARDWALLET_OAUTH_AUTHORIZE_URL, AWARDWALLET_OAUTH_CLIENT_ID, and NEXT_PUBLIC_APP_URL to enable provider linking.",
      };
    }

    const state = encodeURIComponent(JSON.stringify({ sessionId, userId, provider }));
    const redirectUri = encodeURIComponent(`${appUrl.replace(/\/$/, "")}/api/wallet/callback`);
    const linkUrl = `${authorizeUrl}?response_type=code&client_id=${encodeURIComponent(
      clientId,
    )}&redirect_uri=${redirectUri}&scope=accounts:read&state=${state}`;

    return { provider, mode: "redirect", sessionId, linkUrl };
  }

  return {
    provider,
    mode: "inline",
    sessionId,
    message:
      "AwardWallet Web Parsing must be run through a provider-controlled flow. Tripy does not collect or store loyalty program passwords.",
  };
}

function mockAccountsForUser(userId: string): NormalizedWalletAccount[] {
  const seed = userId
    .split("")
    .reduce((total, char) => total + char.charCodeAt(0), 0);
  const bump = (amount: number) => amount + (seed % 17) * 250;

  return [
    {
      providerAccountId: "mock_chase_ultimate_rewards",
      programCode: "chase_ultimate_rewards",
      programName: "Chase Ultimate Rewards",
      currencyType: "bank_points",
      balance: bump(128400),
      accountMask: "4291",
    },
    {
      providerAccountId: "mock_amex_membership_rewards",
      programCode: "amex_membership_rewards",
      programName: "Amex Membership Rewards",
      currencyType: "bank_points",
      balance: bump(84250),
      accountMask: "1008",
    },
    {
      providerAccountId: "mock_united_mileageplus",
      programCode: "united_mileageplus",
      programName: "United MileagePlus",
      currencyType: "airline_miles",
      balance: bump(31700),
      eliteStatus: "Silver",
    },
    {
      providerAccountId: "mock_hyatt_world_of_hyatt",
      programCode: "hyatt_world_of_hyatt",
      programName: "Hyatt World of Hyatt",
      currencyType: "hotel_points",
      balance: bump(56000),
      eliteStatus: "Explorist",
    },
  ];
}

async function fetchConfiguredProviderAccounts(endpointEnvKey: string): Promise<NormalizedWalletAccount[]> {
  const endpoint = process.env[endpointEnvKey];
  const apiKey = process.env.AWARDWALLET_API_KEY;

  if (!endpoint || !apiKey) {
    throw new Error(`${endpointEnvKey} and AWARDWALLET_API_KEY are required for provider sync`);
  }

  const response = await fetch(endpoint, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Provider sync failed with ${response.status}`);
  }

  return normalizeProviderAccounts(await response.json());
}

export async function syncWalletProvider(
  provider: WalletProviderId,
  input: SyncInput,
): Promise<WalletSyncResult> {
  if (provider === "mock") {
    return {
      providerConnectionId: `mock-${input.userId}`,
      displayName: "Demo points wallet",
      accounts: mockAccountsForUser(input.userId),
    };
  }

  if (provider === "manual") {
    return {
      providerConnectionId: null,
      displayName: "Manual wallet",
      accounts: input.manualAccounts || [],
    };
  }

  if (provider === "awardwallet_account_access") {
    return {
      providerConnectionId: input.connectionId || null,
      displayName: "AwardWallet",
      accounts: await fetchConfiguredProviderAccounts("AWARDWALLET_ACCOUNTS_ENDPOINT"),
    };
  }

  return {
    providerConnectionId: input.connectionId || null,
    displayName: "AwardWallet Web Parsing",
    accounts: await fetchConfiguredProviderAccounts("AWARDWALLET_WEB_PARSING_ENDPOINT"),
  };
}

export function isWalletProvider(value: unknown): value is WalletProviderId {
  return (
    value === "manual" ||
    value === "awardwallet_account_access" ||
    value === "awardwallet_web_parsing" ||
    value === "mock"
  );
}
