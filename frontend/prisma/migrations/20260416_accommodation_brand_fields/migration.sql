-- Add structured accommodation-brand columns to ClientIntake
ALTER TABLE "client_intakes"
  ADD COLUMN "preferred_accommodation_brands" JSONB,
  ADD COLUMN "accommodation_dealbreakers" JSONB;

-- Add a dedicated InferenceCategory value for accommodation brand preferences
ALTER TYPE "InferenceCategory" ADD VALUE IF NOT EXISTS 'accommodation_preference';

-- Add a new IntakeFormVariant used by the "Share with client" flow
ALTER TYPE "IntakeFormVariant" ADD VALUE IF NOT EXISTS 'profile_link';
