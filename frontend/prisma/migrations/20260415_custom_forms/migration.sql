-- Add custom_form variant to IntakeFormVariant enum
ALTER TYPE "IntakeFormVariant" ADD VALUE 'custom_form';

-- Add custom questions and form answers to intake_form_tokens
ALTER TABLE "intake_form_tokens"
  ADD COLUMN IF NOT EXISTS "custom_questions" JSONB,
  ADD COLUMN IF NOT EXISTS "form_answers" JSONB,
  ADD COLUMN IF NOT EXISTS "advisor_email" TEXT;
