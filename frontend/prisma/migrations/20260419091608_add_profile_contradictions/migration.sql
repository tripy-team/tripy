-- CreateEnum
CREATE TYPE "ContradictionStatus" AS ENUM ('unresolved', 'resolved', 'dismissed');

-- CreateTable
CREATE TABLE "profile_contradictions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "client_id" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "previous_value" JSONB NOT NULL,
    "new_value" JSONB NOT NULL,
    "evidence" TEXT NOT NULL,
    "status" "ContradictionStatus" NOT NULL DEFAULT 'unresolved',
    "resolution_note" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "profile_contradictions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "profile_contradictions_session_id_idx" ON "profile_contradictions"("session_id");

-- CreateIndex
CREATE INDEX "profile_contradictions_client_id_status_idx" ON "profile_contradictions"("client_id", "status");

-- AddForeignKey
ALTER TABLE "profile_contradictions" ADD CONSTRAINT "profile_contradictions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "discovery_meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "profile_contradictions" ADD CONSTRAINT "profile_contradictions_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
