-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "InferenceCategory" ADD VALUE 'dining_preference';
ALTER TYPE "InferenceCategory" ADD VALUE 'dietary_restriction';
ALTER TYPE "InferenceCategory" ADD VALUE 'experience_interest';
ALTER TYPE "InferenceCategory" ADD VALUE 'accessibility_need';

-- AlterTable
ALTER TABLE "inferred_preferences" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'trip_history',
ADD COLUMN     "source_field" TEXT;
