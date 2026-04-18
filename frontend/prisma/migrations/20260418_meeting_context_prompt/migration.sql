-- Add optional pre-meeting context prompt so advisors can brief the AI
ALTER TABLE "discovery_meeting_sessions" ADD COLUMN "context_prompt" TEXT;
