-- CreateEnum
CREATE TYPE "GroupType" AS ENUM ('leisure_friends', 'destination_wedding', 'family_reunion', 'corporate_offsite', 'multi_generational', 'other');

-- CreateEnum
CREATE TYPE "GroupDecisionStyle" AS ENUM ('organizer_decides', 'consensus', 'advisor_recommends');

-- CreateEnum
CREATE TYPE "IntakeFormVariant" AS ENUM ('individual', 'group_member', 'group_organizer', 'business_policy', 'business_traveler');

-- CreateEnum
CREATE TYPE "IntakeFormStatus" AS ENUM ('pending', 'opened', 'completed', 'expired');

-- AlterEnum
ALTER TYPE "ClientType" ADD VALUE 'group';

-- CreateTable
CREATE TABLE "group_profiles" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "group_type" "GroupType" NOT NULL DEFAULT 'leisure_friends',
    "estimated_size" INTEGER,
    "age_spread" TEXT,
    "decision_style" "GroupDecisionStyle" NOT NULL DEFAULT 'consensus',
    "room_arrangement" TEXT,
    "shared_billing" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "group_members" (
    "id" TEXT NOT NULL,
    "group_profile_id" TEXT NOT NULL,
    "linked_client_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "departure_city" TEXT,
    "is_organizer" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "group_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_profiles" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "industry" TEXT,
    "company_size" TEXT,
    "billing_contact_name" TEXT,
    "billing_contact_email" TEXT,
    "requires_pre_approval" BOOLEAN NOT NULL DEFAULT false,
    "max_nightly_rate_usd" INTEGER,
    "travel_policy_notes" TEXT,
    "corporate_account_ids" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_travelers" (
    "id" TEXT NOT NULL,
    "business_profile_id" TEXT NOT NULL,
    "linked_client_id" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "role" TEXT,
    "seniority_tier" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_travelers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "intake_form_tokens" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "intake_id" TEXT,
    "recipient_email" TEXT NOT NULL,
    "recipient_name" TEXT,
    "form_variant" "IntakeFormVariant" NOT NULL,
    "group_size" INTEGER,
    "sent_at" TIMESTAMP(3),
    "opened_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "intake_form_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "group_profiles_client_id_key" ON "group_profiles"("client_id");

-- CreateIndex
CREATE INDEX "group_members_group_profile_id_idx" ON "group_members"("group_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "business_profiles_client_id_key" ON "business_profiles"("client_id");

-- CreateIndex
CREATE INDEX "business_travelers_business_profile_id_idx" ON "business_travelers"("business_profile_id");

-- CreateIndex
CREATE UNIQUE INDEX "intake_form_tokens_token_key" ON "intake_form_tokens"("token");

-- CreateIndex
CREATE INDEX "intake_form_tokens_client_id_idx" ON "intake_form_tokens"("client_id");

-- CreateIndex
CREATE INDEX "intake_form_tokens_token_idx" ON "intake_form_tokens"("token");

-- AddForeignKey
ALTER TABLE "group_profiles" ADD CONSTRAINT "group_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_group_profile_id_fkey" FOREIGN KEY ("group_profile_id") REFERENCES "group_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_members" ADD CONSTRAINT "group_members_linked_client_id_fkey" FOREIGN KEY ("linked_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_profiles" ADD CONSTRAINT "business_profiles_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_travelers" ADD CONSTRAINT "business_travelers_business_profile_id_fkey" FOREIGN KEY ("business_profile_id") REFERENCES "business_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_travelers" ADD CONSTRAINT "business_travelers_linked_client_id_fkey" FOREIGN KEY ("linked_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_form_tokens" ADD CONSTRAINT "intake_form_tokens_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "intake_form_tokens" ADD CONSTRAINT "intake_form_tokens_intake_id_fkey" FOREIGN KEY ("intake_id") REFERENCES "client_intakes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
