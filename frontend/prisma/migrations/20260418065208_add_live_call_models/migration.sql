-- CreateEnum
CREATE TYPE "LiveCallStatus" AS ENUM ('waiting', 'connecting', 'active', 'paused', 'ended');

-- AlterEnum
ALTER TYPE "MeetingEntryRole" ADD VALUE 'live_transcript';

-- CreateTable
CREATE TABLE "live_call_sessions" (
    "id" TEXT NOT NULL,
    "meeting_session_id" TEXT NOT NULL,
    "status" "LiveCallStatus" NOT NULL DEFAULT 'waiting',
    "video_provider" TEXT NOT NULL DEFAULT 'webrtc',
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "duration" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "live_call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transcript_chunks" (
    "id" TEXT NOT NULL,
    "live_call_id" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "start_ms" INTEGER NOT NULL,
    "end_ms" INTEGER NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transcript_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "live_call_sessions_meeting_session_id_idx" ON "live_call_sessions"("meeting_session_id");

-- CreateIndex
CREATE INDEX "transcript_chunks_live_call_id_idx" ON "transcript_chunks"("live_call_id");

-- CreateIndex
CREATE INDEX "transcript_chunks_live_call_id_processed_idx" ON "transcript_chunks"("live_call_id", "processed");

-- AddForeignKey
ALTER TABLE "live_call_sessions" ADD CONSTRAINT "live_call_sessions_meeting_session_id_fkey" FOREIGN KEY ("meeting_session_id") REFERENCES "discovery_meeting_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transcript_chunks" ADD CONSTRAINT "transcript_chunks_live_call_id_fkey" FOREIGN KEY ("live_call_id") REFERENCES "live_call_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
