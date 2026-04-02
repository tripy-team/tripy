#!/usr/bin/env bash
#
# setup-db.sh — Post-deploy script for Tripy Aurora PostgreSQL
#
# Reads credentials from Secrets Manager, constructs DATABASE_URL,
# then runs Prisma migrations and seeds demo data.
#
# Prerequisites:
#   - AWS CLI configured with correct profile/region
#   - jq installed (brew install jq)
#   - Node.js and npm available
#
# Usage:
#   cd infra && ./scripts/setup-db.sh
#   cd infra && ./scripts/setup-db.sh --seed      # also seed demo data
#   cd infra && ./scripts/setup-db.sh --url-only   # just print DATABASE_URL

set -euo pipefail

SECRET_NAME="tripy/db-credentials"
DB_NAME="tripy"
FRONTEND_DIR="$(cd "$(dirname "$0")/../../frontend" && pwd)"

# ─── Read secret from Secrets Manager ─────────────────────
echo "Reading database credentials from Secrets Manager..."

SECRET_JSON=$(aws secretsmanager get-secret-value \
    --secret-id "$SECRET_NAME" \
    --query SecretString \
    --output text 2>/dev/null) || {
    echo "ERROR: Could not read secret '$SECRET_NAME'."
    echo "Make sure you have deployed TripyRdsStack: cd infra && cdk deploy TripyRdsStack"
    exit 1
}

DB_USER=$(echo "$SECRET_JSON" | jq -r '.username')
DB_PASS=$(echo "$SECRET_JSON" | jq -r '.password')
DB_HOST=$(echo "$SECRET_JSON" | jq -r '.host')
DB_PORT=$(echo "$SECRET_JSON" | jq -r '.port')

# URL-encode the password (handles special characters)
ENCODED_PASS=$(python3 -c "import urllib.parse; print(urllib.parse.quote('$DB_PASS', safe=''))")

DATABASE_URL="postgresql://${DB_USER}:${ENCODED_PASS}@${DB_HOST}:${DB_PORT}/${DB_NAME}?schema=public&sslmode=require"

echo "Cluster endpoint: ${DB_HOST}:${DB_PORT}"
echo "Database: ${DB_NAME}"
echo "User: ${DB_USER}"

# ─── URL-only mode ────────────────────────────────────────
if [[ "${1:-}" == "--url-only" ]]; then
    echo ""
    echo "DATABASE_URL=${DATABASE_URL}"
    echo ""
    echo "To use locally, add to frontend/.env:"
    echo "  DATABASE_URL=\"${DATABASE_URL}\""
    exit 0
fi

# ─── Run Prisma migrations ────────────────────────────────
echo ""
echo "Running Prisma migrations..."
cd "$FRONTEND_DIR"

export DATABASE_URL
npx prisma migrate deploy

echo "Migrations applied successfully."

# ─── Seed (optional) ──────────────────────────────────────
if [[ "${1:-}" == "--seed" ]]; then
    echo ""
    echo "Seeding database with demo data..."
    npx tsx prisma/seed.ts
    echo "Seed complete."
fi

echo ""
echo "Done. To connect your local dev server to this database, add to frontend/.env:"
echo "  DATABASE_URL=\"${DATABASE_URL}\""
echo ""
echo "To set in Amplify Console:"
echo "  1. Go to Amplify > App > Environment variables"
echo "  2. Add DATABASE_URL with the value above"
echo "  3. Add JWT_SECRET with a strong random string"
echo "  4. Redeploy"
