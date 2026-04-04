-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('pending', 'completed', 'snoozed', 'auto_resolved');
CREATE TYPE "DraftTone" AS ENUM ('gentle_nudge', 'firm_reminder', 'escalation', 'urgent_deadline');
CREATE TYPE "TemplateScope" AS ENUM ('system', 'organization');

-- AlterEnum: extend VendorRequestStatus with new workflow states
ALTER TYPE "VendorRequestStatus" ADD VALUE IF NOT EXISTS 'needs_advisor_review';
ALTER TYPE "VendorRequestStatus" ADD VALUE IF NOT EXISTS 'needs_client_approval';
ALTER TYPE "VendorRequestStatus" ADD VALUE IF NOT EXISTS 'approved_to_send';
ALTER TYPE "VendorRequestStatus" ADD VALUE IF NOT EXISTS 'sent_to_vendor';
ALTER TYPE "VendorRequestStatus" ADD VALUE IF NOT EXISTS 'awaiting_vendor_response';
ALTER TYPE "VendorRequestStatus" ADD VALUE IF NOT EXISTS 'complete';

-- Remove old enum values by renaming (Postgres doesn't support DROP VALUE)
-- If 'sent' and 'awaiting_reply' already exist, they are kept for backward compatibility

-- AlterTable: add new columns to vendor_requests
ALTER TABLE "vendor_requests" ADD COLUMN IF NOT EXISTS "template_id" TEXT;
ALTER TABLE "vendor_requests" ADD COLUMN IF NOT EXISTS "first_response_at" TIMESTAMP(3);
ALTER TABLE "vendor_requests" ADD COLUMN IF NOT EXISTS "resolved_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "vendor_requests_vendor_name_idx" ON "vendor_requests"("vendor_name");

-- CreateTable: vendor_request_reminders
CREATE TABLE "vendor_request_reminders" (
    "id" TEXT NOT NULL,
    "vendor_request_id" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'pending',
    "remind_at" TIMESTAMP(3) NOT NULL,
    "label" TEXT,
    "snoozed_until" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_request_reminders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_request_reminders_vendor_request_id_idx" ON "vendor_request_reminders"("vendor_request_id");
CREATE INDEX "vendor_request_reminders_status_remind_at_idx" ON "vendor_request_reminders"("status", "remind_at");

ALTER TABLE "vendor_request_reminders"
    ADD CONSTRAINT "vendor_request_reminders_vendor_request_id_fkey"
    FOREIGN KEY ("vendor_request_id") REFERENCES "vendor_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: vendor_request_drafts
CREATE TABLE "vendor_request_drafts" (
    "id" TEXT NOT NULL,
    "vendor_request_id" TEXT NOT NULL,
    "tone" "DraftTone" NOT NULL,
    "generated_body" TEXT NOT NULL,
    "edited_body" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_request_drafts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_request_drafts_vendor_request_id_idx" ON "vendor_request_drafts"("vendor_request_id");

ALTER TABLE "vendor_request_drafts"
    ADD CONSTRAINT "vendor_request_drafts_vendor_request_id_fkey"
    FOREIGN KEY ("vendor_request_id") REFERENCES "vendor_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: vendor_request_approvals
CREATE TABLE "vendor_request_approvals" (
    "id" TEXT NOT NULL,
    "vendor_request_id" TEXT NOT NULL,
    "from_status" "VendorRequestStatus" NOT NULL,
    "to_status" "VendorRequestStatus" NOT NULL,
    "approved_by_user_id" TEXT,
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_request_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_request_approvals_vendor_request_id_idx" ON "vendor_request_approvals"("vendor_request_id");

ALTER TABLE "vendor_request_approvals"
    ADD CONSTRAINT "vendor_request_approvals_vendor_request_id_fkey"
    FOREIGN KEY ("vendor_request_id") REFERENCES "vendor_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: vendor_request_templates
CREATE TABLE "vendor_request_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT,
    "scope" "TemplateScope" NOT NULL DEFAULT 'system',
    "title" TEXT NOT NULL,
    "request_type" "VendorRequestType" NOT NULL,
    "default_body" TEXT NOT NULL,
    "placeholders" JSONB,
    "default_urgency" "VendorRequestUrgency" NOT NULL DEFAULT 'medium',
    "default_reminders" JSONB,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_request_templates_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_request_templates_organization_id_idx" ON "vendor_request_templates"("organization_id");
CREATE INDEX "vendor_request_templates_scope_idx" ON "vendor_request_templates"("scope");

-- CreateTable: vendor_score_summaries
CREATE TABLE "vendor_score_summaries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "vendor_name" TEXT NOT NULL,
    "total_requests" INTEGER NOT NULL DEFAULT 0,
    "confirmed_count" INTEGER NOT NULL DEFAULT 0,
    "declined_count" INTEGER NOT NULL DEFAULT 0,
    "avg_response_hours" DOUBLE PRECISION,
    "avg_resolution_hours" DOUBLE PRECISION,
    "avg_follow_ups" DOUBLE PRECISION,
    "overdue_count" INTEGER NOT NULL DEFAULT 0,
    "score" DOUBLE PRECISION,
    "confidence" TEXT,
    "last_calculated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_score_summaries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "vendor_score_summaries_organization_id_vendor_name_key" ON "vendor_score_summaries"("organization_id", "vendor_name");
CREATE INDEX "vendor_score_summaries_organization_id_idx" ON "vendor_score_summaries"("organization_id");

-- CreateTable: vendor_request_timeline
CREATE TABLE "vendor_request_timeline" (
    "id" TEXT NOT NULL,
    "vendor_request_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "vendor_request_timeline_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_request_timeline_vendor_request_id_idx" ON "vendor_request_timeline"("vendor_request_id");

ALTER TABLE "vendor_request_timeline"
    ADD CONSTRAINT "vendor_request_timeline_vendor_request_id_fkey"
    FOREIGN KEY ("vendor_request_id") REFERENCES "vendor_requests"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
