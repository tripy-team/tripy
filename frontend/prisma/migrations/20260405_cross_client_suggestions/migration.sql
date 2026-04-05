-- AlterTable: Add cross-client suggestion fields
ALTER TABLE "meeting_profile_suggestions" ADD COLUMN "target_client_id" TEXT;
ALTER TABLE "meeting_profile_suggestions" ADD COLUMN "source_description" TEXT;

-- CreateIndex
CREATE INDEX "meeting_profile_suggestions_target_client_id_idx" ON "meeting_profile_suggestions"("target_client_id");

-- AddForeignKey
ALTER TABLE "meeting_profile_suggestions" ADD CONSTRAINT "meeting_profile_suggestions_target_client_id_fkey" FOREIGN KEY ("target_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
