-- CreateEnum
CREATE TYPE "ItineraryJobStatus" AS ENUM ('processing', 'complete', 'failed');

-- CreateTable
CREATE TABLE "itinerary_jobs" (
    "id" TEXT NOT NULL,
    "trip_request_id" TEXT NOT NULL,
    "status" "ItineraryJobStatus" NOT NULL DEFAULT 'processing',
    "result" JSONB,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "itinerary_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "itinerary_jobs_trip_request_id_idx" ON "itinerary_jobs"("trip_request_id");

-- AddForeignKey
ALTER TABLE "itinerary_jobs" ADD CONSTRAINT "itinerary_jobs_trip_request_id_fkey" FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
