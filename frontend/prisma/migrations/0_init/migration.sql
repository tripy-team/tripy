npm warn Unknown env config "devdir". This will stop working in the next major version of npm.
Loaded Prisma config from prisma.config.ts.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('admin', 'advisor', 'viewer');

-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('active', 'archived');

-- CreateEnum
CREATE TYPE "ProgramCategory" AS ENUM ('airline', 'hotel', 'transferable_bank');

-- CreateEnum
CREATE TYPE "BalanceSource" AS ENUM ('manual', 'imported', 'estimated');

-- CreateEnum
CREATE TYPE "PoolingScope" AS ENUM ('none', 'household_only', 'authorized_user_like', 'book_for_others', 'unrestricted');

-- CreateEnum
CREATE TYPE "CabinPreference" AS ENUM ('economy', 'premium_economy', 'business', 'first', 'flexible');

-- CreateEnum
CREATE TYPE "RedemptionStyle" AS ENUM ('save_points', 'balanced', 'maximize_experience');

-- CreateEnum
CREATE TYPE "TripStatus" AS ENUM ('draft', 'analyzing', 'complete', 'archived');

-- CreateEnum
CREATE TYPE "TravelerType" AS ENUM ('adult', 'child', 'infant', 'senior');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'complete', 'failed');

-- CreateEnum
CREATE TYPE "StrategyType" AS ENUM ('points_only', 'cash_only', 'mixed', 'hold_and_wait');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('cash', 'points', 'mixed');

-- CreateEnum
CREATE TYPE "InsightType" AS ENUM ('overexposed_program', 'wait_for_bonus', 'preserve_currency', 'low_value_redemption', 'transfer_risk', 'expiration_risk', 'convenience_tradeoff');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('transfer_bonus', 'expiration', 'goal_watch');

-- CreateTable
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "plan_tier" TEXT NOT NULL DEFAULT 'free',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'advisor',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "clients" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "first_name" TEXT NOT NULL,
    "last_name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "date_of_birth" TIMESTAMP(3),
    "notes" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'active',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "households" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "households_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "household_members" (
    "id" TEXT NOT NULL,
    "household_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "relationship_label" TEXT,
    "can_redeem_for_household" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "household_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "loyalty_programs" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "ProgramCategory" NOT NULL,
    "issuer" TEXT,
    "supports_transfer" BOOLEAN NOT NULL DEFAULT false,
    "supports_pooling" BOOLEAN NOT NULL DEFAULT false,
    "supports_expiration" BOOLEAN NOT NULL DEFAULT false,
    "default_point_value_cents" DOUBLE PRECISION,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "loyalty_programs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_loyalty_balances" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "household_id" TEXT,
    "loyalty_program_id" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "expiration_date" TIMESTAMP(3),
    "source" "BalanceSource" NOT NULL DEFAULT 'manual',
    "last_verified_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_loyalty_balances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "balance_ledger_entries" (
    "id" TEXT NOT NULL,
    "client_loyalty_balance_id" TEXT NOT NULL,
    "previous_balance" INTEGER NOT NULL,
    "new_balance" INTEGER NOT NULL,
    "change_reason" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "balance_ledger_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_transfer_rules" (
    "id" TEXT NOT NULL,
    "from_program_id" TEXT NOT NULL,
    "to_program_id" TEXT NOT NULL,
    "ratio_numerator" INTEGER NOT NULL DEFAULT 1,
    "ratio_denominator" INTEGER NOT NULL DEFAULT 1,
    "minimum_transfer_amount" INTEGER,
    "transfer_increment" INTEGER,
    "estimated_transfer_time_hours" INTEGER,
    "is_irreversible" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_transfer_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "program_pooling_rules" (
    "id" TEXT NOT NULL,
    "loyalty_program_id" TEXT NOT NULL,
    "pooling_scope" "PoolingScope" NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "program_pooling_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transfer_bonuses" (
    "id" TEXT NOT NULL,
    "from_program_id" TEXT NOT NULL,
    "to_program_id" TEXT NOT NULL,
    "bonus_percent" INTEGER NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "source_url" TEXT,
    "source_label" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "transfer_bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client_preferences" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "preferred_cabin" "CabinPreference" NOT NULL DEFAULT 'economy',
    "prefers_nonstop" BOOLEAN NOT NULL DEFAULT false,
    "max_layover_minutes" INTEGER,
    "willing_to_reposition" BOOLEAN NOT NULL DEFAULT false,
    "redemption_style" "RedemptionStyle" NOT NULL DEFAULT 'balanced',
    "avoid_basic_economy" BOOLEAN NOT NULL DEFAULT false,
    "preferred_airlines" JSONB,
    "avoided_airlines" JSONB,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "owner_user_id" TEXT NOT NULL,
    "client_id" TEXT,
    "household_id" TEXT,
    "title" TEXT NOT NULL,
    "origin_airports" JSONB NOT NULL,
    "destination_airports" JSONB NOT NULL,
    "departure_date" TIMESTAMP(3) NOT NULL,
    "return_date" TIMESTAMP(3),
    "traveler_count" INTEGER NOT NULL DEFAULT 1,
    "cabin_preference" "CabinPreference" NOT NULL DEFAULT 'economy',
    "flexibility_days" INTEGER,
    "budget_cash" INTEGER,
    "notes" TEXT,
    "status" "TripStatus" NOT NULL DEFAULT 'draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trip_travelers" (
    "id" TEXT NOT NULL,
    "trip_request_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "traveler_type" "TravelerType" NOT NULL DEFAULT 'adult',
    "must_travel_with_client_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trip_travelers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_runs" (
    "id" TEXT NOT NULL,
    "trip_request_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "model_version" TEXT,
    "engine_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "recommendation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_options" (
    "id" TEXT NOT NULL,
    "recommendation_run_id" TEXT NOT NULL,
    "rank" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "strategy_type" "StrategyType" NOT NULL,
    "total_cash_cost" INTEGER NOT NULL,
    "total_points_used" JSONB NOT NULL,
    "estimated_total_value_cents" INTEGER,
    "weighted_score" DOUBLE PRECISION,
    "is_recommended" BOOLEAN NOT NULL DEFAULT false,
    "summary" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_traveler_allocations" (
    "id" TEXT NOT NULL,
    "recommendation_option_id" TEXT NOT NULL,
    "trip_traveler_id" TEXT NOT NULL,
    "payment_type" "PaymentType" NOT NULL,
    "loyalty_program_id" TEXT,
    "points_used" INTEGER,
    "cash_used" INTEGER,
    "taxes_and_fees" INTEGER,
    "rationale" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_traveler_allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_insights" (
    "id" TEXT NOT NULL,
    "recommendation_option_id" TEXT NOT NULL,
    "insight_type" "InsightType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "severity" "Severity" NOT NULL DEFAULT 'info',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recommendation_insights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recommendation_memos" (
    "id" TEXT NOT NULL,
    "recommendation_run_id" TEXT NOT NULL,
    "internal_summary" TEXT,
    "client_summary" TEXT,
    "email_draft" TEXT,
    "pdf_url" TEXT,
    "share_token" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "recommendation_memos_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "client_id" TEXT,
    "household_id" TEXT,
    "trip_request_id" TEXT,
    "alert_type" "AlertType" NOT NULL,
    "target_program_id" TEXT,
    "target_route" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "alert_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alert_events" (
    "id" TEXT NOT NULL,
    "alert_subscription_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "metadata" JSONB,
    "triggered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "is_read" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_organization_id_idx" ON "users"("organization_id");

-- CreateIndex
CREATE INDEX "clients_organization_id_idx" ON "clients"("organization_id");

-- CreateIndex
CREATE INDEX "clients_owner_user_id_idx" ON "clients"("owner_user_id");

-- CreateIndex
CREATE INDEX "households_organization_id_idx" ON "households"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "household_members_household_id_client_id_key" ON "household_members"("household_id", "client_id");

-- CreateIndex
CREATE UNIQUE INDEX "loyalty_programs_code_key" ON "loyalty_programs"("code");

-- CreateIndex
CREATE INDEX "client_loyalty_balances_client_id_idx" ON "client_loyalty_balances"("client_id");

-- CreateIndex
CREATE INDEX "client_loyalty_balances_loyalty_program_id_idx" ON "client_loyalty_balances"("loyalty_program_id");

-- CreateIndex
CREATE INDEX "program_transfer_rules_from_program_id_to_program_id_idx" ON "program_transfer_rules"("from_program_id", "to_program_id");

-- CreateIndex
CREATE INDEX "transfer_bonuses_from_program_id_to_program_id_ends_at_idx" ON "transfer_bonuses"("from_program_id", "to_program_id", "ends_at");

-- CreateIndex
CREATE UNIQUE INDEX "client_preferences_client_id_key" ON "client_preferences"("client_id");

-- CreateIndex
CREATE INDEX "trip_requests_organization_id_idx" ON "trip_requests"("organization_id");

-- CreateIndex
CREATE INDEX "trip_requests_client_id_idx" ON "trip_requests"("client_id");

-- CreateIndex
CREATE INDEX "trip_requests_household_id_idx" ON "trip_requests"("household_id");

-- CreateIndex
CREATE INDEX "recommendation_runs_trip_request_id_idx" ON "recommendation_runs"("trip_request_id");

-- CreateIndex
CREATE INDEX "recommendation_options_recommendation_run_id_idx" ON "recommendation_options"("recommendation_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_memos_recommendation_run_id_key" ON "recommendation_memos"("recommendation_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "recommendation_memos_share_token_key" ON "recommendation_memos"("share_token");

-- CreateIndex
CREATE INDEX "alert_subscriptions_organization_id_idx" ON "alert_subscriptions"("organization_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "clients" ADD CONSTRAINT "clients_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "households" ADD CONSTRAINT "households_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "household_members" ADD CONSTRAINT "household_members_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_loyalty_balances" ADD CONSTRAINT "client_loyalty_balances_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_loyalty_balances" ADD CONSTRAINT "client_loyalty_balances_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_loyalty_balances" ADD CONSTRAINT "client_loyalty_balances_loyalty_program_id_fkey" FOREIGN KEY ("loyalty_program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_ledger_entries" ADD CONSTRAINT "balance_ledger_entries_client_loyalty_balance_id_fkey" FOREIGN KEY ("client_loyalty_balance_id") REFERENCES "client_loyalty_balances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "balance_ledger_entries" ADD CONSTRAINT "balance_ledger_entries_changed_by_user_id_fkey" FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_transfer_rules" ADD CONSTRAINT "program_transfer_rules_from_program_id_fkey" FOREIGN KEY ("from_program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_transfer_rules" ADD CONSTRAINT "program_transfer_rules_to_program_id_fkey" FOREIGN KEY ("to_program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "program_pooling_rules" ADD CONSTRAINT "program_pooling_rules_loyalty_program_id_fkey" FOREIGN KEY ("loyalty_program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_bonuses" ADD CONSTRAINT "transfer_bonuses_from_program_id_fkey" FOREIGN KEY ("from_program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transfer_bonuses" ADD CONSTRAINT "transfer_bonuses_to_program_id_fkey" FOREIGN KEY ("to_program_id") REFERENCES "loyalty_programs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_preferences" ADD CONSTRAINT "client_preferences_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_requests" ADD CONSTRAINT "trip_requests_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_travelers" ADD CONSTRAINT "trip_travelers_trip_request_id_fkey" FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trip_travelers" ADD CONSTRAINT "trip_travelers_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_runs" ADD CONSTRAINT "recommendation_runs_trip_request_id_fkey" FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_runs" ADD CONSTRAINT "recommendation_runs_created_by_user_id_fkey" FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_options" ADD CONSTRAINT "recommendation_options_recommendation_run_id_fkey" FOREIGN KEY ("recommendation_run_id") REFERENCES "recommendation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_traveler_allocations" ADD CONSTRAINT "recommendation_traveler_allocations_recommendation_option__fkey" FOREIGN KEY ("recommendation_option_id") REFERENCES "recommendation_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_traveler_allocations" ADD CONSTRAINT "recommendation_traveler_allocations_trip_traveler_id_fkey" FOREIGN KEY ("trip_traveler_id") REFERENCES "trip_travelers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_traveler_allocations" ADD CONSTRAINT "recommendation_traveler_allocations_loyalty_program_id_fkey" FOREIGN KEY ("loyalty_program_id") REFERENCES "loyalty_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_insights" ADD CONSTRAINT "recommendation_insights_recommendation_option_id_fkey" FOREIGN KEY ("recommendation_option_id") REFERENCES "recommendation_options"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recommendation_memos" ADD CONSTRAINT "recommendation_memos_recommendation_run_id_fkey" FOREIGN KEY ("recommendation_run_id") REFERENCES "recommendation_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_household_id_fkey" FOREIGN KEY ("household_id") REFERENCES "households"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_trip_request_id_fkey" FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_subscriptions" ADD CONSTRAINT "alert_subscriptions_target_program_id_fkey" FOREIGN KEY ("target_program_id") REFERENCES "loyalty_programs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "alert_events" ADD CONSTRAINT "alert_events_alert_subscription_id_fkey" FOREIGN KEY ("alert_subscription_id") REFERENCES "alert_subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

