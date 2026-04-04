-- CreateEnum
CREATE TYPE "MeetingSessionStatus" AS ENUM ('active', 'completed', 'archived');
CREATE TYPE "MeetingEntryRole" AS ENUM ('advisor_note', 'question_answer', 'system');
CREATE TYPE "ProfileSuggestionStatus" AS ENUM ('pending', 'approved', 'rejected', 'committed');

-- CreateTable: discovery_meeting_sessions
CREATE TABLE "discovery_meeting_sessions" (
    "id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "advisor_user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "MeetingSessionStatus" NOT NULL DEFAULT 'active',
    "summary" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovery_meeting_sessions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "discovery_meeting_sessions_client_id_idx" ON "discovery_meeting_sessions"("client_id");
CREATE INDEX "discovery_meeting_sessions_advisor_user_id_idx" ON "discovery_meeting_sessions"("advisor_user_id");

ALTER TABLE "discovery_meeting_sessions"
    ADD CONSTRAINT "discovery_meeting_sessions_client_id_fkey"
    FOREIGN KEY ("client_id") REFERENCES "clients"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "discovery_meeting_sessions"
    ADD CONSTRAINT "discovery_meeting_sessions_advisor_user_id_fkey"
    FOREIGN KEY ("advisor_user_id") REFERENCES "users"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

-- CreateTable: meeting_entries
CREATE TABLE "meeting_entries" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "MeetingEntryRole" NOT NULL,
    "content" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_entries_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_entries_session_id_idx" ON "meeting_entries"("session_id");

ALTER TABLE "meeting_entries"
    ADD CONSTRAINT "meeting_entries_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "discovery_meeting_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: meeting_question_suggestions
CREATE TABLE "meeting_question_suggestions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "question_text" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "priority" TEXT NOT NULL,
    "target_fields" JSONB NOT NULL,
    "is_used" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_question_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_question_suggestions_session_id_idx" ON "meeting_question_suggestions"("session_id");

ALTER TABLE "meeting_question_suggestions"
    ADD CONSTRAINT "meeting_question_suggestions_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "discovery_meeting_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: meeting_profile_suggestions
CREATE TABLE "meeting_profile_suggestions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "target_field" TEXT NOT NULL,
    "suggested_value" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "evidence" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "status" "ProfileSuggestionStatus" NOT NULL DEFAULT 'pending',
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "meeting_profile_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "meeting_profile_suggestions_session_id_idx" ON "meeting_profile_suggestions"("session_id");
CREATE INDEX "meeting_profile_suggestions_session_id_status_idx" ON "meeting_profile_suggestions"("session_id", "status");

ALTER TABLE "meeting_profile_suggestions"
    ADD CONSTRAINT "meeting_profile_suggestions_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "discovery_meeting_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable: meeting_recaps
CREATE TABLE "meeting_recaps" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "traveler_summary" TEXT NOT NULL,
    "new_preferences_learned" TEXT NOT NULL,
    "unresolved_questions" TEXT NOT NULL,
    "next_steps" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "meeting_recaps_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "meeting_recaps_session_id_key" ON "meeting_recaps"("session_id");

ALTER TABLE "meeting_recaps"
    ADD CONSTRAINT "meeting_recaps_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "discovery_meeting_sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
