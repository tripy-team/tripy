-- Add cross-source reconciliation metadata to transfer_bonuses.
-- `confidence`: "single" (one source), "high" (>=2 sources agree), "manual" (admin override).
-- `needs_review`: set when scrapers report conflicting bonus % for the same pair.
ALTER TABLE "transfer_bonuses"
  ADD COLUMN "confidence" TEXT NOT NULL DEFAULT 'single',
  ADD COLUMN "needs_review" BOOLEAN NOT NULL DEFAULT false;
