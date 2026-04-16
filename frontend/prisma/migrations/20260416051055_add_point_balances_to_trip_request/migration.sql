-- AlterTable
ALTER TABLE "client_intakes" ADD COLUMN     "preferred_flight_routing" TEXT;

-- AlterTable
ALTER TABLE "trip_requests" ADD COLUMN     "point_balances" JSONB;
