-- CreateEnum
CREATE TYPE "SettlementSplitMethod" AS ENUM ('equal', 'proportional_to_cost', 'custom');

-- CreateEnum
CREATE TYPE "PointValuationMethod" AS ENUM ('actual_redemption', 'benchmark_cpp', 'tpg_market');

-- AlterEnum
ALTER TYPE "StrategyType" ADD VALUE 'group_pooled';

-- AlterTable
ALTER TABLE "recommendation_traveler_allocations" ADD COLUMN     "point_source_client_id" TEXT,
ADD COLUMN     "point_value_cents" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "trip_travelers" ADD COLUMN     "cabin_preference" "CabinPreference",
ADD COLUMN     "departure_date" TIMESTAMP(3),
ADD COLUMN     "return_date" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "group_settlements" (
    "id" TEXT NOT NULL,
    "trip_request_id" TEXT NOT NULL,
    "created_by_client_id" TEXT,
    "split_method" "SettlementSplitMethod" NOT NULL DEFAULT 'proportional_to_cost',
    "point_valuation_method" "PointValuationMethod" NOT NULL DEFAULT 'actual_redemption',
    "contribution_ledger" JSONB NOT NULL,
    "fair_shares" JSONB NOT NULL,
    "transfers" JSONB NOT NULL,
    "memo" TEXT,
    "engine_version" TEXT NOT NULL DEFAULT 'v1',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "group_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "group_settlements_trip_request_id_idx" ON "group_settlements"("trip_request_id");

-- AddForeignKey
ALTER TABLE "recommendation_traveler_allocations" ADD CONSTRAINT "recommendation_traveler_allocations_point_source_client_id_fkey" FOREIGN KEY ("point_source_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_trip_request_id_fkey" FOREIGN KEY ("trip_request_id") REFERENCES "trip_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "group_settlements" ADD CONSTRAINT "group_settlements_created_by_client_id_fkey" FOREIGN KEY ("created_by_client_id") REFERENCES "clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
