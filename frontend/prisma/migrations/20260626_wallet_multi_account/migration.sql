-- Multi-account support: an owner label to disambiguate multiple accounts
-- (e.g. two of the same program, or per-program owners) in the UI.
ALTER TABLE "wallet_accounts" ADD COLUMN "owner_label" TEXT;

-- Enforce account identity = (connection, providerAccountId) so a traveler's
-- many programs (Amex on one login/email, Chase on another) and any
-- same-program multi-accounts persist as DISTINCT rows instead of overwriting.
-- Note: Postgres treats NULLs as distinct, so manual accounts (connection_id
-- NULL) are deduped in application code rather than by this index.
CREATE UNIQUE INDEX "wallet_accounts_connection_provider_account_key"
  ON "wallet_accounts"("connection_id", "provider_account_id");
