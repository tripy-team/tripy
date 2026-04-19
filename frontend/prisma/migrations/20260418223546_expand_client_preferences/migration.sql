-- Expand ClientPreference so live-call extractions for loyalty, budget,
-- destinations, departure airports, date flexibility, travel pace, and past
-- trip feedback have a first-class home (previously these fields were
-- extracted by Gemma but silently dropped on merge because no column existed).

ALTER TABLE "client_preferences"
  ADD COLUMN "loyalty_notes"                TEXT,
  ADD COLUMN "budget_notes"                 TEXT,
  ADD COLUMN "preferred_destinations"       JSONB,
  ADD COLUMN "preferred_departure_airports" JSONB,
  ADD COLUMN "date_flexibility"             TEXT,
  ADD COLUMN "travel_pace"                  TEXT,
  ADD COLUMN "past_trip_feedback"           TEXT;
