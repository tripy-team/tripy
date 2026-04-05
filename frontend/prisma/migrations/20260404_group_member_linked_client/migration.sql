-- Add linked_client_id to family_members for tracking group member points
ALTER TABLE "family_members" ADD COLUMN IF NOT EXISTS "linked_client_id" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "family_members_linked_client_id_key" ON "family_members"("linked_client_id");

DO $$ BEGIN
    ALTER TABLE "family_members"
        ADD CONSTRAINT "family_members_linked_client_id_fkey"
        FOREIGN KEY ("linked_client_id") REFERENCES "clients"("id")
        ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
