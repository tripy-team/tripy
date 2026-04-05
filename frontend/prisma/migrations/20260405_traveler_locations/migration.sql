-- AlterTable
ALTER TABLE "trip_travelers" ADD COLUMN "origin_airports" JSONB;
ALTER TABLE "trip_travelers" ADD COLUMN "destination_airports" JSONB;
ALTER TABLE "trip_travelers" ADD COLUMN "use_leader_cities" BOOLEAN NOT NULL DEFAULT false;
