-- ============================================================
-- Bridge migration: creates all objects present in schema.prisma
-- but missing from the database after 0_init + meeting_copilot
-- + vendor_operations.
-- Every statement is idempotent so partial re-runs are safe.
-- ============================================================

-- ─── Missing Enums ──────────────────────────────────────────

DO $$ BEGIN
    CREATE TYPE "ClientType" AS ENUM ('individual', 'business');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "InferenceStatus" AS ENUM ('pending', 'accepted', 'rejected');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "SuggestionStatus" AS ENUM ('pending', 'asked', 'answered', 'skipped');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "SuggestionPriority" AS ENUM ('high', 'medium', 'low');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "SuggestionCategory" AS ENUM ('missing_intake', 'ambiguous_preference', 'conflicting_constraint', 'budget_luxury_mismatch', 'points_convenience_mismatch', 'destination_flexibility', 'group_traveler_difference');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "InferenceCategory" AS ENUM ('cabin_choice', 'airline_preference', 'nonstop_preference', 'hotel_tier', 'budget_behavior', 'payment_style', 'destination_pattern', 'trip_style');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "BudgetSensitivity" AS ENUM ('price_conscious', 'moderate', 'comfort_first', 'luxury');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "PreferenceSource" AS ENUM ('manual', 'intake', 'inferred');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "MergeStrategy" AS ENUM ('overwrite', 'merge', 'suggest');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "IntakeStatus" AS ENUM ('draft', 'complete');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TripType" AS ENUM ('leisure', 'business_travel', 'honeymoon', 'family_vacation', 'adventure', 'luxury_getaway', 'group_trip', 'destination_wedding', 'solo', 'other');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "DateFlexibility" AS ENUM ('exact', 'flexible_1_2_days', 'flexible_week', 'flexible_month', 'fully_flexible');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "TravelPace" AS ENUM ('relaxed', 'moderate', 'active', 'packed');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "LayoverTolerance" AS ENUM ('nonstop_only', 'prefer_nonstop', 'no_preference', 'layovers_ok');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "LuxuryPreference" AS ENUM ('luxury', 'upscale', 'balanced', 'value', 'budget');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- ─── Missing columns on existing tables ─────────────────────

-- clients.client_type
ALTER TABLE "clients" ADD COLUMN IF NOT EXISTS "client_type" "ClientType" NOT NULL DEFAULT 'individual';

-- client_preferences: new profile fields
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "preferred_hotel_types" JSONB;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "room_preferences" JSONB;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "location_preferences" TEXT;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "budget_sensitivity" "BudgetSensitivity";
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "points_vs_cash" TEXT;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "accessibility_needs" JSONB;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "food_preferences" JSONB;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "activity_preferences" JSONB;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "family_considerations" TEXT;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "special_occasions" JSONB;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "dislikes" JSONB;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "dealbreakers" JSONB;
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "last_updated_source" "PreferenceSource" NOT NULL DEFAULT 'manual';
ALTER TABLE "client_preferences" ADD COLUMN IF NOT EXISTS "merge_strategy" "MergeStrategy" NOT NULL DEFAULT 'merge';

-- ─── Missing tables ─────────────────────────────────────────

-- family_members
CREATE TABLE IF NOT EXISTS "family_members" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "date_of_birth" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "family_members_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "family_members_client_id_idx" ON "family_members"("client_id");

DO $$ BEGIN
    ALTER TABLE "family_members"
        ADD CONSTRAINT "family_members_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- preference_change_logs
CREATE TABLE IF NOT EXISTS "preference_change_logs" (
    "id" TEXT NOT NULL,
    "preference_id" TEXT NOT NULL,
    "changed_by_user_id" TEXT NOT NULL,
    "source" "PreferenceSource" NOT NULL,
    "field_name" TEXT NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "preference_change_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "preference_change_logs_preference_id_idx" ON "preference_change_logs"("preference_id");

DO $$ BEGIN
    ALTER TABLE "preference_change_logs"
        ADD CONSTRAINT "preference_change_logs_preference_id_fkey"
        FOREIGN KEY ("preference_id") REFERENCES "client_preferences"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "preference_change_logs"
        ADD CONSTRAINT "preference_change_logs_changed_by_user_id_fkey"
        FOREIGN KEY ("changed_by_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- client_intakes
CREATE TABLE IF NOT EXISTS "client_intakes" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "status" "IntakeStatus" NOT NULL DEFAULT 'draft',
    "is_template" BOOLEAN NOT NULL DEFAULT false,
    "template_name" TEXT,
    "duplicated_from_id" TEXT,
    "trip_type" "TripType",
    "trip_type_other" TEXT,
    "destinations" JSONB,
    "departure_airports" JSONB,
    "date_flexibility" "DateFlexibility",
    "earliest_departure" TIMESTAMP(3),
    "latest_return" TIMESTAMP(3),
    "trip_duration_days" INTEGER,
    "budget_min" INTEGER,
    "budget_max" INTEGER,
    "budget_currency" TEXT NOT NULL DEFAULT 'USD',
    "budget_notes" TEXT,
    "cabin_preference" "CabinPreference",
    "hotel_styles" JSONB,
    "loyalty_notes" TEXT,
    "accessibility_needs" TEXT,
    "dietary_needs" TEXT,
    "travel_pace" "TravelPace",
    "layover_tolerance" "LayoverTolerance",
    "luxury_preference" "LuxuryPreference",
    "family_friendly" BOOLEAN,
    "traveler_count" INTEGER,
    "children_count" INTEGER,
    "children_ages" JSONB,
    "desired_experiences" JSONB,
    "dealbreakers" JSONB,
    "preferred_airlines" JSONB,
    "avoided_airlines" JSONB,
    "notes" TEXT,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "client_intakes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "client_intakes_client_id_idx" ON "client_intakes"("client_id");
CREATE INDEX IF NOT EXISTS "client_intakes_created_by_user_id_idx" ON "client_intakes"("created_by_user_id");

DO $$ BEGIN
    ALTER TABLE "client_intakes"
        ADD CONSTRAINT "client_intakes_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "client_intakes"
        ADD CONSTRAINT "client_intakes_duplicated_from_id_fkey"
        FOREIGN KEY ("duplicated_from_id") REFERENCES "client_intakes"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- trip_tradeoff_rankings
CREATE TABLE IF NOT EXISTS "trip_tradeoff_rankings" (
    "id" TEXT NOT NULL,
    "trip_request_id" TEXT NOT NULL,
    "cash_cost" INTEGER NOT NULL DEFAULT 50,
    "points_usage" INTEGER NOT NULL DEFAULT 50,
    "redemption_value" INTEGER NOT NULL DEFAULT 50,
    "travel_time" INTEGER NOT NULL DEFAULT 50,
    "fewest_layovers" INTEGER NOT NULL DEFAULT 50,
    "premium_experience" INTEGER NOT NULL DEFAULT 50,
    "flexibility" INTEGER NOT NULL DEFAULT 50,
    "family_convenience" INTEGER NOT NULL DEFAULT 50,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_tradeoff_rankings_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "trip_tradeoff_rankings_trip_request_id_key" ON "trip_tradeoff_rankings"("trip_request_id");

DO $$ BEGIN
    ALTER TABLE "trip_tradeoff_rankings"
        ADD CONSTRAINT "trip_tradeoff_rankings_trip_request_id_fkey"
        FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- trip_briefs
CREATE TABLE IF NOT EXISTS "trip_briefs" (
    "id" TEXT NOT NULL,
    "trip_request_id" TEXT,
    "client_id" TEXT NOT NULL,
    "intake_id" TEXT,
    "generated_by_user_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "executive_summary" TEXT,
    "hard_constraints" TEXT,
    "soft_preferences" TEXT,
    "points_cash_posture" TEXT,
    "acceptable_tradeoffs" TEXT,
    "do_not_recommend" TEXT,
    "operational_notes" TEXT,
    "is_edited" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "trip_briefs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "trip_briefs_trip_request_id_idx" ON "trip_briefs"("trip_request_id");
CREATE INDEX IF NOT EXISTS "trip_briefs_client_id_idx" ON "trip_briefs"("client_id");

DO $$ BEGIN
    ALTER TABLE "trip_briefs"
        ADD CONSTRAINT "trip_briefs_trip_request_id_fkey"
        FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "trip_briefs"
        ADD CONSTRAINT "trip_briefs_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "trip_briefs"
        ADD CONSTRAINT "trip_briefs_intake_id_fkey"
        FOREIGN KEY ("intake_id") REFERENCES "client_intakes"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "trip_briefs"
        ADD CONSTRAINT "trip_briefs_generated_by_user_id_fkey"
        FOREIGN KEY ("generated_by_user_id") REFERENCES "users"("id")
        ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- inferred_preferences
CREATE TABLE IF NOT EXISTS "inferred_preferences" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "category" "InferenceCategory" NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "InferenceStatus" NOT NULL DEFAULT 'pending',
    "resolved_at" TIMESTAMP(3),
    "resolved_by_user_id" TEXT,
    "applied_to_profile" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "inferred_preferences_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "inferred_preferences_client_id_idx" ON "inferred_preferences"("client_id");

DO $$ BEGIN
    ALTER TABLE "inferred_preferences"
        ADD CONSTRAINT "inferred_preferences_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "inferred_preferences"
        ADD CONSTRAINT "inferred_preferences_resolved_by_user_id_fkey"
        FOREIGN KEY ("resolved_by_user_id") REFERENCES "users"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- follow_up_suggestions
CREATE TABLE IF NOT EXISTS "follow_up_suggestions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "intake_id" TEXT,
    "category" "SuggestionCategory" NOT NULL,
    "priority" "SuggestionPriority" NOT NULL,
    "question_text" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "rule_key" TEXT NOT NULL,
    "status" "SuggestionStatus" NOT NULL DEFAULT 'pending',
    "status_changed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "follow_up_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "follow_up_suggestions_client_id_idx" ON "follow_up_suggestions"("client_id");
CREATE INDEX IF NOT EXISTS "follow_up_suggestions_client_id_status_idx" ON "follow_up_suggestions"("client_id", "status");

DO $$ BEGIN
    ALTER TABLE "follow_up_suggestions"
        ADD CONSTRAINT "follow_up_suggestions_client_id_fkey"
        FOREIGN KEY ("client_id") REFERENCES "clients"("id")
        ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "follow_up_suggestions"
        ADD CONSTRAINT "follow_up_suggestions_intake_id_fkey"
        FOREIGN KEY ("intake_id") REFERENCES "client_intakes"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
