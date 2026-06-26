# AwardWallet Loyalty Aggregation — Implementation Plan

> Goal: auto-aggregate a user's loyalty balances across **many programs — each under its own
> login/email** (Amex on one email, Chase on another, United on a third), plus the rarer case of
> multiple accounts within one program — via AwardWallet, so users never type in their points.
> Plus a clear frontend note that **American Airlines is not supported**.
>
> **Product model: B2C.** There is exactly one user type — the traveler. There are **no
> advisors, no client portfolios, no planning-on-behalf-of-someone-else**. Every
> `WalletConnection` / `WalletAccount` belongs directly to the signed-in traveler (`User`).
> The legacy `Client` / `ClientLoyaltyBalance` / advisor-facing models are **out of scope**
> for this feature and must not be wired into the wallet flow. (See `context.md`.)

## 0. Current state (what already exists)

The wallet feature is **scaffolded, not wired**. Existing assets:

- **Prisma models** (`frontend/prisma/schema.prisma`): `WalletConnection`, `WalletAccount`,
  `WalletSyncRun`, `WalletSyncEvent`, `ClientLoyaltyBalance`, `BalanceLedgerEntry`,
  `LoyaltyProgram` (+ `supportsPooling`, `ProgramPoolingRule`). Migration `20260624_wallet_sync` applied.
- **Provider layer** (`frontend/src/lib/wallet/providers.ts`): `WalletProviderId` includes
  `awardwallet_account_access` (OAuth) and `awardwallet_web_parsing` (credential). `mock` + `manual` work today.
- **API routes** (`frontend/src/app/api/wallet/`): `sync`, `accounts`, `connections/[id]`,
  `link-token`, `callback`.
- **Upsert/read** (`frontend/src/lib/wallet/db.ts`): `upsertWalletAccounts`, `listWalletAccounts`.
- Config already reserves `AWARDWALLET_API_KEY`, `AWARDTOOL_API_KEY` and OAuth env vars.

### Two gaps that block this task specifically

1. **Multi-account collision bug** — `db.ts` `upsertWalletAccounts` matches existing rows with an
   `OR` that includes `{ connectionId, programCode }` (db.ts:61-66) and, for manual,
   `{ programCode, source }` (db.ts:67-72). So a second United account under the same connection
   **overwrites the first**. This directly breaks "a person uses multiple accounts." Must fix.
2. **AwardWallet sync is a static stub** — `syncWalletProvider` → `fetchConfiguredProviderAccounts`
   (providers.ts:199-219) hits a single `AWARDWALLET_ACCOUNTS_ENDPOINT` with a static
   `AWARDWALLET_API_KEY` bearer, **ignoring the per-user OAuth token / connection** captured in
   `/callback`. It would return the same accounts for every user. Must be made per-connection.

---

## 1. Provider choice & sequencing

| Phase | Provider | Why |
|---|---|---|
| MVP / demo | `mock` (exists) | Already returns 4 sample programs incl. multi-currency. Zero cost, instant demo. |
| Pre-prod | `awardwallet_account_access` (OAuth2) | **Free**, no credential storage, returns the user's already-aggregated accounts incl. multiple per program. Lowest legal/security risk. |
| Production long-tail | `awardwallet_web_parsing` (credential) | Paid, AwardWallet holds credentials (we never store loyalty passwords). Add only if OAuth coverage is insufficient. |

**Decision: build the OAuth Account Access path properly first.** It satisfies the whole
requirement (multi-account, multi-program, no password storage) and is free.

---

## 2. Multi-account data model (the core of this task)

The **primary** "multiple" case is **different programs under different email logins**: a traveler's
Amex is under one email, their Chase under another, United under a third. This is *not* multiple
accounts inside one program — it's many programs, each with its own separate login/email. A rarer
secondary case is two accounts within the same program (personal + business United). Both reduce to
the same requirement: **many distinct `WalletAccount` rows, one per real loyalty account**, all
hanging off the one traveler `User` (never an advisor or separately-owned client).

**Key point about the email-per-program case:** with AwardWallet OAuth this is fully abstracted. The
traveler has **one** AwardWallet account in which they've already added Amex (email A), Chase
(email B), United (email C), etc. One OAuth `WalletConnection` returns **all** of those as separate
`WalletAccount` rows — the per-program email is AwardWallet's concern, never ours. So the email
distinction needs **no special handling** on the OAuth path; the account-identity fix below is what
keeps Amex and Chase as distinct rows.

Do **not** infer program ownership from the traveler's signup email. They sign up with one email but
hold programs under several personal emails; ownership comes only from the connected source(s).

The email-per-program detail only forces a data-model change on the **direct email-parsing** path
(not MVP): there, Amex-email and Chase-email are *separate mailboxes*, so a traveler needs
**multiple `WalletConnection`s** (one per connected mailbox). The schema already allows many
connections per `User`, but the sync route's one-connection-per-provider lookup
(`findFirst({ where: { userId, provider } })`) would need a per-source discriminator before that works.

The schema already supports multiple accounts — the fixes are the **account identity key** and the
**aggregation semantics**.

### 2a. Account identity (fix db.ts)

Identity must be **`(connectionId, providerAccountId)`** and nothing else when a
`providerAccountId` exists. Remove the `programCode`-based OR clauses.

```ts
// providers.ts — make providerAccountId STABLE, never index-based fallback.
// AwardWallet returns a stable per-account id; require it for synced accounts.
// For manual accounts, mint a stable id once: `manual_${crypto.randomUUID()}`.

// db.ts — replace matchClauses with a single deterministic key:
const existing = await tx.walletAccount.findFirst({
  where: account.providerAccountId
    ? { userId, connectionId, providerAccountId: account.providerAccountId }
    : { id: account.localId },          // manual rows carry their own id
});
```

Also add a Prisma **unique constraint** to enforce it at the DB level:

```prisma
model WalletAccount {
  // ...
  @@unique([connectionId, providerAccountId], name: "conn_provider_account")
}
```

> ⚠️ The index-based fallback `${programCode}_${index}` (providers.ts:64) must go — if AwardWallet
> reorders accounts between syncs, index ids would reassign balances to the wrong account. Require
> a real provider id; skip + log any account without one.

### 2b. Disambiguation in UI

Two United accounts must be visually distinct. Surface `accountMask` (last 4), `eliteStatus`,
and owner/display name. Add an `ownerLabel` to `NormalizedWalletAccount` populated from
AwardWallet's account owner field so the UI can show "United ••1234 (John)" vs "United ••5678 (Jane)".

### 2c. Aggregation / pooling semantics (don't lie to the optimizer)

Points in **separate accounts of the same program generally cannot be combined.** Each account
is its own redemption pool. Rules:

- Default: treat every `WalletAccount` as an independent pool. Never sum two accounts of the same
  program for redemption.
- Only sum when `LoyaltyProgram.supportsPooling` is true **and** a `ProgramPoolingRule` permits it
  (e.g., British Airways Household Account, JetBlue Points Pooling) — and only across the traveler's
  own / travel-party accounts that they've added themselves.
- The "total points" headline number is a **display** aggregate only; the optimizer consumes
  per-account balances with a `poolable: boolean` flag.

---

## 3. AwardWallet Account Access (OAuth) wiring

### 3a. OAuth handshake (fix `/api/wallet/callback`)
- `link-token` already builds the authorize URL (providers.ts:124-146). Verify `state` is persisted
  and CSRF-checked on return.
- In `/callback`: exchange `code` → access token at AwardWallet's token endpoint using
  `AWARDWALLET_OAUTH_CLIENT_ID` / `_SECRET`. Store the resulting **per-user access token /
  connected-user id** on `WalletConnection.providerConnectionId` (+ encrypted token; see §7).

### 3b. Per-connection fetch (fix providers.ts)
Replace the static `fetchConfiguredProviderAccounts` with a call scoped to the connection:

```ts
// Account Access API: list the connected user's accounts using OUR API key
// (X-Authentication header) targeting THIS user's connection id.
GET {AWARDWALLET_API_BASE}/connectedUsers/{providerConnectionId}
// → iterate accounts[]: balance, kind/owner, expirationDate, level (elite), accountNumber→mask
```

Normalize each into `NormalizedWalletAccount` with a **real `providerAccountId`** from AwardWallet.

### 3c. Coverage note
OAuth returns whatever the user has aggregated in AwardWallet. Banks (Amex, Chase, Cap One, Citi)
and hotels (Marriott, Hilton, Hyatt, IHG) are well covered. **American Airlines is not trackable at
all** (see §6). United/Delta/Southwest may require the user's email-parsing setup inside AwardWallet.

---

## 4. Sync pipeline

Keep the existing flow in `app/api/wallet/sync/route.ts`, with the §2 fix:

1. Auth user → find/create `WalletConnection` for provider.
2. Create `WalletSyncRun{status:running}`.
3. `syncWalletProvider(provider, {connectionId})` → normalized accounts (per-connection).
4. `upsertWalletAccounts` with **fixed identity key** → write `WalletSyncEvent` deltas
   (already hashes via `rawProviderPayloadHash` for dedup).
5. Update connection `lastSyncedAt` / `status`; complete `WalletSyncRun` with `accountsUpdated`.

All balances live on the traveler's own `WalletAccount` rows. **Do not** write to
`ClientLoyaltyBalance` / `BalanceLedgerEntry` — those belong to the legacy advisor/client model,
which is out of scope for this B2C feature. The per-account history travelers see comes from
`WalletSyncEvent` (already written in step 4).

Failure handling: `WalletConnection.status = needs_reauth | error`, store `lastError`, surface a
retry/reconnect button. Respect `Retry-After` with exponential backoff.

---

## 5. Background refresh
- On-demand "Sync now" (exists).
- Scheduled: EventBridge cron → new `backend/src/workers/wallet_sync_worker.py` (mirror
  `itinerary_worker.py`) → daily per active connection. AwardWallet balances only refresh ~daily;
  do **not** poll more often. Stagger to avoid thundering herd.

---

## 6. American Airlines "not supported" note (required)

AA fully blocks AwardWallet (no API, no scrape, no email parse). Implement at three layers:

1. **Connect screen banner** — reusable component, always visible on the wallet/connect UI:
   ```tsx
   // frontend/src/components/wallet/UnsupportedProgramsNotice.tsx
   <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm" role="note">
     <p className="font-semibold text-amber-900">American Airlines isn't supported</p>
     <p className="text-amber-800 mt-1">
       AAdvantage blocks third-party balance tracking, so we can't sync it automatically.
       You can still add American miles manually, and they'll be included in recommendations.
     </p>
   </div>
   ```
   Render in the wallet manager (`components/wallet/WalletManager.tsx`) and on the profile loyalty
   section (`app/(app)/profile/page.tsx`).
2. **Guard rail** — central `UNSUPPORTED_PROGRAMS = ["american_aadvantage"]` in
   `lib/wallet/programs.ts`. If a synced account resolves to an unsupported code, drop it from sync
   results and log. If a user picks AA in manual entry, show inline copy "auto-sync unavailable —
   manual only."
3. **Intake/preferences** — keep AA selectable as a *preferred/avoid* airline (per existing
   `ClientPreference.preferredAirlines`); the note is specifically about *balance sync*, not flying.

---

## 7. Security & secrets
- Per-user OAuth tokens are sensitive → encrypt at rest (don't store plaintext in `providerConnectionId`).
  Use AWS Secrets Manager / KMS-encrypted column, consistent with `utils/secrets_manager.py`.
- We **never** store loyalty passwords — Web Parsing runs inside AwardWallet. State this in UI (already
  drafted in providers.ts:153).
- Add `AWARDWALLET_API_BASE`, `_OAUTH_TOKEN_URL`, `_OAUTH_CLIENT_SECRET` to env + secrets manager.

---

## 8. Phased task checklist

> ⏳ **ACTION REQUIRED — wire the live AwardWallet API (contacted AwardWallet 2026-06-26).**
> AwardWallet has been contacted for API access; awaiting their response. Once we receive
> credentials + docs, **add the AwardWallet API** by completing Phase 2 below. Specifically we need
> from them: API key, OAuth authorize + **token** endpoint URLs, client id/secret, the
> connected-user **accounts response shape** (field names for balance/owner/elite/expiration/account id),
> per-account id stability guarantee, pagination/rate-limit rules, and pricing. Then:
>   1. Fill env vars: `AWARDWALLET_API_KEY`, `AWARDWALLET_ACCOUNTS_ENDPOINT`,
>      `AWARDWALLET_OAUTH_AUTHORIZE_URL`, `_OAUTH_TOKEN_URL`, `_OAUTH_CLIENT_ID`, `_OAUTH_CLIENT_SECRET`,
>      `NEXT_PUBLIC_APP_URL`.
>   2. Implement the OAuth token exchange in `/api/wallet/callback` (currently stores only a session id).
>   3. Verify the field mapping in `normalizeProviderAccount` (providers.ts) against a real payload.
>   This is the remaining blocker between "mock works" and "real balances flow."

**Phase 1 — Multi-account correctness — ✅ DONE (2026-06-26)**
- [x] Fix `upsertWalletAccounts` identity key → `(connectionId, providerAccountId)`; drop programCode OR.
- [x] Require stable `providerAccountId`; remove index fallback (drop+log accounts with no id).
- [x] Add `@@unique([connectionId, providerAccountId])` + migration (`20260626_wallet_multi_account`, applied).
- [x] Add `ownerLabel` column; surfaced via `listWalletAccounts`.
- [ ] Unit tests: two United accounts under one connection persist as two rows across re-syncs.

**Phase 2 — Real OAuth Account Access — ⏳ BLOCKED on AwardWallet API access (see note above)**
- [x] Per-connection fetch scaffolding: `fetchConfiguredProviderAccounts` scopes by `providerConnectionId`.
- [ ] **Add the AwardWallet API**: implement token exchange + encrypted storage in `/api/wallet/callback`.
- [ ] Confirm/adjust AwardWallet field mapping → `NormalizedWalletAccount`; handle pagination/rate limits.

**Phase 3 — Frontend**
- [ ] `UnsupportedProgramsNotice` (AA) on connect + profile.
- [ ] `WalletManager` / `AccountList` / `SyncButton`; show per-account, "last synced", reconnect.
- [ ] Pooling-aware "total" display (per §2c).

**Phase 4 — Optimizer + refresh**
- [ ] Feed per-account `{balance, poolable}` into optimization; honor `enabledForOptimization`.
- [ ] `wallet_sync_worker.py` + EventBridge daily cron; expiration alerts via `AlertSubscription`.

**Phase 5 — Hardening**
- [ ] Mock AwardWallet in integration tests (OAuth → fetch → upsert → UI).
- [ ] Backoff/retry, `needs_reauth` UX, dedup via payload hash.

---

## 9. Open questions
- AwardWallet Account Access exact endpoint shape, account-owner field, and per-account id stability
  → confirm against their API docs / sales contact (pricing for Web Parsing still quote-only).
- Which programs beyond AA need a manual-only flag at launch (Delta/United/Southwest behavior via OAuth)?
- Travel-party accounts: confirm we model a partner's loyalty account as just another
  `WalletAccount` under the same traveler `User` (with an `ownerLabel`), since there is no separate
  client/person entity in the B2C model.
