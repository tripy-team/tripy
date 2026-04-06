-- AlterTable: Add round column to meeting_question_suggestions
ALTER TABLE "meeting_question_suggestions" ADD COLUMN "round" INTEGER NOT NULL DEFAULT 1;
