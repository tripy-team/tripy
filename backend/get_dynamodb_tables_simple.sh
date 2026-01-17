#!/bin/bash
# Simplified version - just lists tables and lets you pick

set -e

echo "🔍 Fetching DynamoDB tables from AWS..."
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed"
    echo "Install: brew install awscli (macOS) or https://aws.amazon.com/cli/"
    exit 1
fi

# Check AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured"
    echo "Run: aws configure"
    exit 1
fi

# Get region
AWS_REGION=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "us-west-2")}
export AWS_DEFAULT_REGION=$AWS_REGION

echo "Region: $AWS_REGION"
echo ""

# List tables
TABLES=$(aws dynamodb list-tables --region "$AWS_REGION" --query 'TableNames[]' --output text 2>/dev/null)

if [ -z "$TABLES" ]; then
    echo "⚠️  No tables found. Using defaults..."
    echo ""
fi

echo "================================================"
echo "DynamoDB Table Configuration for .env"
echo "================================================"
echo ""
echo "# ============================================"
echo "# REQUIRED - DynamoDB Table Names"
echo "# ============================================"
echo ""

# Convert tab-separated to newline-separated list
TABLES_LIST=$(echo "$TABLES" | tr '\t' '\n')

# Function to find exact match or return default
find_table() {
    local pattern="$1"
    local default="$2"
    echo "$TABLES_LIST" | grep -iE "^${pattern}$" | head -1 || echo "$default"
}

# Match exact table names - priority: exact match > pattern match > default
USERS_TABLE=$(find_table "tripy-users" "tripy-users")
TRIPS_TABLE=$(find_table "tripy-trips" "tripy-trips")
TRIP_MEMBERS_TABLE=$(find_table "tripy-trip-members" "tripy-trip-members")
POINTS_TABLE=$(find_table "tripy-points" "tripy-points")
DESTINATIONS_TABLE=$(find_table "tripy-destinations" "tripy-destinations")
DESTINATION_VOTES_TABLE=$(find_table "tripy-destination-votes" "tripy-destination-votes")
ITINERARY_TABLE=$(find_table "tripy-itinerary" "tripy-itinerary")

echo "USERS_TABLE=$USERS_TABLE"
echo "TRIPS_TABLE=$TRIPS_TABLE"
echo "TRIP_MEMBERS_TABLE=$TRIP_MEMBERS_TABLE"
echo "POINTS_TABLE=$POINTS_TABLE"
echo "DESTINATIONS_TABLE=$DESTINATIONS_TABLE"
echo "DESTINATION_VOTES_TABLE=$DESTINATION_VOTES_TABLE"
echo "ITINERARY_TABLE=$ITINERARY_TABLE"

echo ""
echo "================================================"
echo ""
echo "✅ Copy the output above into backend/.env"
echo ""
echo "💡 Tip: If table names don't match, edit .env manually with correct names"
