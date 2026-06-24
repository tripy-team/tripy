CREATE TYPE "WalletProvider" AS ENUM ('manual', 'awardwallet_account_access', 'awardwallet_web_parsing', 'mock');
CREATE TYPE "WalletConnectionStatus" AS ENUM ('active', 'sync_required', 'needs_reauth', 'error', 'disconnected');
CREATE TYPE "WalletSyncStatus" AS ENUM ('running', 'success', 'failed', 'partial');
CREATE TYPE "WalletCurrencyType" AS ENUM ('bank_points', 'airline_miles', 'hotel_points');
CREATE TYPE "WalletVisibility" AS ENUM ('exact', 'range_only', 'hidden_but_usable');
CREATE TYPE "WalletAccountSource" AS ENUM ('manual', 'sync', 'imported');

CREATE TABLE "wallet_connections" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" "WalletProvider" NOT NULL,
  "provider_connection_id" TEXT,
  "display_name" TEXT,
  "status" "WalletConnectionStatus" NOT NULL DEFAULT 'active',
  "consent_scope" JSONB,
  "last_synced_at" TIMESTAMP(3),
  "last_error" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wallet_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_accounts" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT,
  "user_id" TEXT NOT NULL,
  "provider_account_id" TEXT,
  "program_code" TEXT NOT NULL,
  "program_name" TEXT NOT NULL,
  "currency_type" "WalletCurrencyType" NOT NULL,
  "account_mask" TEXT,
  "balance" INTEGER NOT NULL DEFAULT 0,
  "expiration_date" TIMESTAMP(3),
  "elite_status" TEXT,
  "source" "WalletAccountSource" NOT NULL DEFAULT 'sync',
  "visibility" "WalletVisibility" NOT NULL DEFAULT 'exact',
  "enabled_for_optimization" BOOLEAN NOT NULL DEFAULT true,
  "last_synced_at" TIMESTAMP(3),
  "last_manual_edit_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "wallet_accounts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_sync_runs" (
  "id" TEXT NOT NULL,
  "connection_id" TEXT,
  "user_id" TEXT NOT NULL,
  "provider" "WalletProvider" NOT NULL,
  "status" "WalletSyncStatus" NOT NULL DEFAULT 'running',
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "accounts_updated" INTEGER NOT NULL DEFAULT 0,
  "error_code" TEXT,
  "error_message" TEXT,

  CONSTRAINT "wallet_sync_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "wallet_sync_events" (
  "id" TEXT NOT NULL,
  "wallet_account_id" TEXT NOT NULL,
  "sync_run_id" TEXT,
  "previous_balance" INTEGER,
  "new_balance" INTEGER NOT NULL,
  "delta" INTEGER NOT NULL DEFAULT 0,
  "reason" TEXT NOT NULL,
  "raw_provider_payload_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "wallet_sync_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "wallet_connections_user_id_idx" ON "wallet_connections"("user_id");
CREATE INDEX "wallet_connections_provider_provider_connection_id_idx" ON "wallet_connections"("provider", "provider_connection_id");
CREATE INDEX "wallet_accounts_user_id_idx" ON "wallet_accounts"("user_id");
CREATE INDEX "wallet_accounts_connection_id_idx" ON "wallet_accounts"("connection_id");
CREATE INDEX "wallet_accounts_program_code_idx" ON "wallet_accounts"("program_code");
CREATE INDEX "wallet_sync_runs_user_id_idx" ON "wallet_sync_runs"("user_id");
CREATE INDEX "wallet_sync_runs_connection_id_idx" ON "wallet_sync_runs"("connection_id");
CREATE INDEX "wallet_sync_events_wallet_account_id_idx" ON "wallet_sync_events"("wallet_account_id");
CREATE INDEX "wallet_sync_events_sync_run_id_idx" ON "wallet_sync_events"("sync_run_id");

ALTER TABLE "wallet_connections"
  ADD CONSTRAINT "wallet_connections_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_accounts"
  ADD CONSTRAINT "wallet_accounts_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "wallet_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wallet_accounts"
  ADD CONSTRAINT "wallet_accounts_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_sync_runs"
  ADD CONSTRAINT "wallet_sync_runs_connection_id_fkey"
  FOREIGN KEY ("connection_id") REFERENCES "wallet_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "wallet_sync_runs"
  ADD CONSTRAINT "wallet_sync_runs_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_sync_events"
  ADD CONSTRAINT "wallet_sync_events_wallet_account_id_fkey"
  FOREIGN KEY ("wallet_account_id") REFERENCES "wallet_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "wallet_sync_events"
  ADD CONSTRAINT "wallet_sync_events_sync_run_id_fkey"
  FOREIGN KEY ("sync_run_id") REFERENCES "wallet_sync_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
