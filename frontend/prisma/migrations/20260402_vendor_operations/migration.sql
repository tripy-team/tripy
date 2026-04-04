-- CreateEnum (vendor infrastructure enums)
CREATE TYPE "VendorRequestType" AS ENUM ('room_upgrade', 'early_check_in', 'late_check_out', 'connecting_rooms', 'airport_transfer', 'amenity_request', 'dining_request', 'celebration_request', 'quote_request', 'custom_request');
CREATE TYPE "VendorRequestUrgency" AS ENUM ('low', 'medium', 'high', 'urgent');
CREATE TYPE "VendorRequestStatus" AS ENUM ('draft', 'needs_advisor_review', 'needs_client_approval', 'approved_to_send', 'sent_to_vendor', 'awaiting_vendor_response', 'follow_up_needed', 'confirmed', 'declined', 'complete', 'cancelled');
CREATE TYPE "ReminderStatus" AS ENUM ('pending', 'completed', 'snoozed', 'auto_resolved');
CREATE TYPE "DraftTone" AS ENUM ('gentle_nudge', 'firm_reminder', 'escalation', 'urgent_deadline');
CREATE TYPE "TemplateScope" AS ENUM ('system', 'organization');

-- CreateTable: vendor_requests
CREATE TABLE "vendor_requests" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "trip_request_id" TEXT NOT NULL,
    "client_id" TEXT,
    "created_by_user_id" TEXT NOT NULL,
    "template_id" TEXT,
    "vendor_name" TEXT NOT NULL,
    "vendor_contact" TEXT,
    "request_type" "VendorRequestType" NOT NULL,
    "request_details" TEXT,
    "date_sent" TIMESTAMP(3),
    "urgency" "VendorRequestUrgency" NOT NULL DEFAULT 'medium',
    "due_date" TIMESTAMP(3),
    "status" "VendorRequestStatus" NOT NULL DEFAULT 'draft',
    "follow_up_count" INTEGER NOT NULL DEFAULT 0,
    "internal_notes" TEXT,
    "final_outcome" TEXT,
    "archived_at" TIMESTAMP(3),
    "first_response_at" TIMESTAMP(3),
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_requests_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "vendor_requests_organization_id_idx" ON "vendor_requests"("organization_id");
CREATE INDEX "vendor_requests_trip_request_id_idx" ON "vendor_requests"("trip_request_id");
CREATE INDEX "vendor_requests_client_id_idx" ON "vendor_requests"("client_id");
CREATE INDEX "vendor_requests_status_idx" ON "vendor_requests"("status");
CREATE INDEX "vendor_requests_due_date_idx" ON "vendor_requests"("due_date");
CREATE INDEX "vendor_requests_vendor_name_idx" ON "vendor_requests"("vendor_name");

ALTER TABLE "vendor_requests"
    ADD CONSTRAINT "vendor_requests_organization_id_fkey"
    FOREIGN KEY ("organization_id") REFERENCES "organizations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vendor_requests"
    ADD CONSTRAINT "vendor_requests_trip_request_id_fkey"
    FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "vendor_requests"
    ADD CONSTRAINT "vendor_requests_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "vendor_requests"
    ADD CONSTRAINT "vendor_requests_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

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
