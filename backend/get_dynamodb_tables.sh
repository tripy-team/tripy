#!/bin/bash
# Script to get DynamoDB table names and format them for .env file
# This queries AWS DynamoDB and formats the output for easy copy-paste

set -e

echo "🔍 Fetching DynamoDB tables from AWS..."
echo ""

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    echo "❌ AWS CLI is not installed or not in PATH"
    echo ""
    echo "Install it from: https://aws.amazon.com/cli/"
    echo "Or use: brew install awscli (on macOS)"
    exit 1
fi

# Check if AWS credentials are configured
if ! aws sts get-caller-identity &> /dev/null; then
    echo "❌ AWS credentials not configured or invalid"
    echo ""
    echo "Run: aws configure"
    echo "Or set environment variables: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY"
    exit 1
fi

# Get AWS region (from env, config, or default)
AWS_REGION=${AWS_REGION:-$(aws configure get region 2>/dev/null || echo "us-west-2")}
export AWS_DEFAULT_REGION=$AWS_REGION

echo "Using AWS region: $AWS_REGION"
echo ""

# List all DynamoDB tables
echo "Fetching tables..."
TABLES=$(aws dynamodb list-tables --region "$AWS_REGION" --query 'TableNames[]' --output text 2>/dev/null)

if [ -z "$TABLES" ]; then
    echo "⚠️  No DynamoDB tables found in region $AWS_REGION"
    echo ""
    echo "Creating template with default table names..."
    echo ""
    echo "# ============================================"
    echo "# REQUIRED - DynamoDB Table Names"
    echo "# ============================================"
    echo "# Update these with your actual table names if different"
    echo "USERS_TABLE=tripy-users"
    echo "TRIPS_TABLE=tripy-trips"
    echo "TRIP_MEMBERS_TABLE=tripy-trip-members"
    echo "POINTS_TABLE=tripy-points"
    echo "DESTINATIONS_TABLE=tripy-destinations"
    echo "DESTINATION_VOTES_TABLE=tripy-destination-votes"
    echo "ITINERARY_TABLE=tripy-itinerary"
    exit 0
fi

echo "Found DynamoDB tables:"
echo "$TABLES" | tr '\t' '\n' | nl
echo ""

# Map table names to environment variables
# This will try to match tables by name patterns
declare -A TABLE_MAP

# Look for tables matching patterns
while IFS= read -r table; do
    case "$table" in
        *user*|*User*|*USER*)
            if [ -z "${TABLE_MAP[USERS_TABLE]}" ]; then
                TABLE_MAP[USERS_TABLE]="$table"
            fi
            ;;
        *trip*|*Trip*|*TRIP*)
            if [[ "$table" == *member* ]] || [[ "$table" == *Member* ]]; then
                if [ -z "${TABLE_MAP[TRIP_MEMBERS_TABLE]}" ]; then
                    TABLE_MAP[TRIP_MEMBERS_TABLE]="$table"
                fi
            elif [ -z "${TABLE_MAP[TRIPS_TABLE]}" ]; then
                TABLE_MAP[TRIPS_TABLE]="$table"
            fi
            ;;
        *point*|*Point*|*POINT*)
            if [ -z "${TABLE_MAP[POINTS_TABLE]}" ]; then
                TABLE_MAP[POINTS_TABLE]="$table"
            fi
            ;;
        *destination*|*Destination*|*DESTINATION*)
            if [[ "$table" == *vote* ]] || [[ "$table" == *Vote* ]]; then
                if [ -z "${TABLE_MAP[DESTINATION_VOTES_TABLE]}" ]; then
                    TABLE_MAP[DESTINATION_VOTES_TABLE]="$table"
                fi
            elif [ -z "${TABLE_MAP[DESTINATIONS_TABLE]}" ]; then
                TABLE_MAP[DESTINATIONS_TABLE]="$table"
            fi
            ;;
        *itinerary*|*Itinerary*|*ITINERARY*)
            if [ -z "${TABLE_MAP[ITINERARY_TABLE]}" ]; then
                TABLE_MAP[ITINERARY_TABLE]="$table"
            fi
            ;;
    esac
done <<< "$TABLES"

# Try exact name matches first (case-insensitive)
for table in $TABLES; do
    table_lower=$(echo "$table" | tr '[:upper:]' '[:lower:]')
    
    case "$table_lower" in
        *tripy-users*|*users*)
            TABLE_MAP[USERS_TABLE]="$table"
            ;;
        *tripy-trips*|*trips*)
            TABLE_MAP[TRIPS_TABLE]="$table"
            ;;
        *tripy-trip-members*|*trip-members*|*tripmembers*)
            TABLE_MAP[TRIP_MEMBERS_TABLE]="$table"
            ;;
        *tripy-points*|*points*)
            TABLE_MAP[POINTS_TABLE]="$table"
            ;;
        *tripy-destinations*|*destinations*)
            TABLE_MAP[DESTINATIONS_TABLE]="$table"
            ;;
        *tripy-destination-votes*|*destination-votes*|*destinationvotes*)
            TABLE_MAP[DESTINATION_VOTES_TABLE]="$table"
            ;;
        *tripy-itinerary*|*itinerary*)
            TABLE_MAP[ITINERARY_TABLE]="$table"
            ;;
    esac
done

# Output formatted .env entries
echo "================================================"
echo "Copy this into your backend/.env file:"
echo "================================================"
echo ""
echo "# ============================================"
echo "# REQUIRED - DynamoDB Table Names"
echo "# ============================================"

# Output each required variable
REQUIRED_VARS=("USERS_TABLE" "TRIPS_TABLE" "TRIP_MEMBERS_TABLE" "POINTS_TABLE" "DESTINATIONS_TABLE" "DESTINATION_VOTES_TABLE" "ITINERARY_TABLE")

for var in "${REQUIRED_VARS[@]}"; do
    if [ -n "${TABLE_MAP[$var]}" ]; then
        echo "$var=${TABLE_MAP[$var]}"
    else
        # Use default name if not found
        default_name=$(echo "$var" | tr '[:upper:]' '[:lower:]' | sed 's/_/-/g')
        echo "$var=tripy-${default_name,,}"  # Comment showing default
        echo "# ⚠️  Table not found - using default name above"
    fi
done

echo ""
echo "================================================"
echo ""

# Show unmatched tables
UNMATCHED_TABLES=""
for table in $TABLES; do
    found=false
    for var in "${REQUIRED_VARS[@]}"; do
        if [ "${TABLE_MAP[$var]}" == "$table" ]; then
            found=true
            break
        fi
    done
    if [ "$found" = false ]; then
        if [ -z "$UNMATCHED_TABLES" ]; then
            UNMATCHED_TABLES="$table"
        else
            UNMATCHED_TABLES="$UNMATCHED_TABLES\n$table"
        fi
    fi
done

if [ -n "$UNMATCHED_TABLES" ]; then
    echo "📋 Other tables found (not mapped):"
    echo -e "$UNMATCHED_TABLES" | nl
    echo ""
    echo "If any of these should be mapped to a variable, update the script or edit .env manually"
fi

echo ""
echo "✅ Done! Copy the output above into backend/.env"
