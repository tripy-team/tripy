#!/bin/bash
#
# Test Optimization Script
# ========================
# Run this script to test the ILP optimization without using the web UI.
#
# Usage:
#   ./scripts/run_test.sh                    # Use defaults (JFK -> Dubai -> JFK)
#   ./scripts/run_test.sh --preset tokyo     # Use Tokyo preset
#   ./scripts/run_test.sh --help             # Show all options
#

set -e

# ============================================================================
# CONFIGURATION - EDIT THESE VALUES
# ============================================================================

# Authentication (set your credentials here or use environment variables)
EMAIL="ezhong0211business@gmail.com"
PASSWORD="Tequinox0211!1"
TOKEN="${TRIPY_AUTH_TOKEN:-}"

# API URL
API_URL="${TRIPY_API_URL:-http://127.0.0.1:8000}"

# Default trip configuration
START_CITY="New York (JFK,LGA)"
END_CITY=""  # Empty = same as start (round trip)
DESTINATIONS=("Dubai (DXB,DWC)")
TRIP_DAYS=7
START_OFFSET=30  # Days from now
MAX_BUDGET=5000

# ============================================================================
# PRESETS - Common test scenarios
# ============================================================================

apply_preset() {
    case "$1" in
        dubai|default)
            START_CITY="New York (JFK,LGA)"
            DESTINATIONS=("Dubai (DXB,DWC)")
            TRIP_DAYS=7
            MAX_BUDGET=5000
            ;;
        tokyo)
            START_CITY="New York (JFK,LGA)"
            DESTINATIONS=("Tokyo (NRT,HND)")
            TRIP_DAYS=10
            MAX_BUDGET=4000
            ;;
        europe)
            START_CITY="New York (JFK,LGA)"
            DESTINATIONS=("London (LHR,LGW)" "Paris (CDG,ORY)")
            TRIP_DAYS=14
            MAX_BUDGET=6000
            ;;
        multi-city)
            START_CITY="New York (JFK,LGA)"
            DESTINATIONS=("Dubai (DXB,DWC)" "Abu Dhabi (AUH)")
            TRIP_DAYS=10
            MAX_BUDGET=7000
            ;;
        short)
            START_CITY="New York (JFK,LGA)"
            DESTINATIONS=("Miami (MIA)")
            TRIP_DAYS=3
            MAX_BUDGET=1000
            ;;
        lax-dubai)
            START_CITY="Los Angeles (LAX)"
            DESTINATIONS=("Dubai (DXB,DWC)")
            TRIP_DAYS=7
            MAX_BUDGET=5000
            ;;
        *)
            echo "Unknown preset: $1"
            echo "Available presets: dubai, tokyo, europe, multi-city, short, lax-dubai"
            exit 1
            ;;
    esac
}

# ============================================================================
# ARGUMENT PARSING
# ============================================================================

VERBOSE=""
PRESET=""

show_help() {
    cat << EOF
Usage: $0 [OPTIONS]

Test the ILP optimization by creating a trip and running the optimizer.

OPTIONS:
    --preset NAME       Use a preset configuration
                        Available: dubai (default), tokyo, europe, multi-city, short, lax-dubai
    
    --start CITY        Start city (e.g., "New York (JFK,LGA)")
    --end CITY          End city (default: same as start for round trip)
    --dest CITY         Destination to visit (can be specified multiple times)
    --days N            Trip duration in days
    --budget N          Maximum budget in dollars
    --offset N          Days from now to start the trip
    
    --email EMAIL       Login email
    --password PASS     Login password
    --token TOKEN       Use existing JWT token
    
    --verbose, -v       Show verbose output
    --help, -h          Show this help message

EXAMPLES:
    # Default test (JFK -> Dubai -> JFK)
    $0

    # Use Tokyo preset
    $0 --preset tokyo

    # Custom trip
    $0 --start "Los Angeles (LAX)" --dest "Singapore (SIN)" --days 10

    # With authentication
    $0 --email me@example.com --password mypass

    # Multiple destinations
    $0 --dest "Dubai (DXB,DWC)" --dest "Abu Dhabi (AUH)" --days 12

ENVIRONMENT VARIABLES:
    TRIPY_EMAIL         Default email for login
    TRIPY_PASSWORD      Default password for login
    TRIPY_AUTH_TOKEN    JWT token (skips login)
    TRIPY_API_URL       API URL (default: http://127.0.0.1:8000)

EOF
}

# Parse arguments
CUSTOM_DESTS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --preset)
            PRESET="$2"
            shift 2
            ;;
        --start)
            START_CITY="$2"
            shift 2
            ;;
        --end)
            END_CITY="$2"
            shift 2
            ;;
        --dest)
            CUSTOM_DESTS+=("$2")
            shift 2
            ;;
        --days)
            TRIP_DAYS="$2"
            shift 2
            ;;
        --budget)
            MAX_BUDGET="$2"
            shift 2
            ;;
        --offset)
            START_OFFSET="$2"
            shift 2
            ;;
        --email)
            EMAIL="$2"
            shift 2
            ;;
        --password)
            PASSWORD="$2"
            shift 2
            ;;
        --token)
            TOKEN="$2"
            shift 2
            ;;
        --verbose|-v)
            VERBOSE="--verbose"
            shift
            ;;
        --help|-h)
            show_help
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            show_help
            exit 1
            ;;
    esac
done

# Apply preset if specified
if [[ -n "$PRESET" ]]; then
    apply_preset "$PRESET"
fi

# Override destinations if custom ones provided
if [[ ${#CUSTOM_DESTS[@]} -gt 0 ]]; then
    DESTINATIONS=("${CUSTOM_DESTS[@]}")
fi

# ============================================================================
# VALIDATION
# ============================================================================

# Check if Python script exists
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON_SCRIPT="$SCRIPT_DIR/test_optimization.py"

if [[ ! -f "$PYTHON_SCRIPT" ]]; then
    echo "Error: Python script not found at $PYTHON_SCRIPT"
    exit 1
fi

# Check authentication
if [[ -z "$TOKEN" && -z "$EMAIL" ]]; then
    echo "============================================"
    echo "  AUTHENTICATION REQUIRED"
    echo "============================================"
    echo ""
    echo "Please provide credentials using one of:"
    echo "  1. Environment variables: TRIPY_EMAIL and TRIPY_PASSWORD"
    echo "  2. Command line: --email and --password"
    echo "  3. JWT token: --token or TRIPY_AUTH_TOKEN"
    echo ""
    read -p "Email: " EMAIL
    read -s -p "Password: " PASSWORD
    echo ""
fi

# ============================================================================
# BUILD AND RUN COMMAND
# ============================================================================

echo ""
echo "============================================"
echo "  TEST CONFIGURATION"
echo "============================================"
echo "  Start:        $START_CITY"
echo "  End:          ${END_CITY:-$START_CITY (round trip)}"
echo "  Destinations: ${DESTINATIONS[*]}"
echo "  Duration:     $TRIP_DAYS days"
echo "  Budget:       \$$MAX_BUDGET"
echo "  Start in:     $START_OFFSET days"
echo "============================================"
echo ""

# Build command
CMD=(python "$PYTHON_SCRIPT")
CMD+=(--api-url "$API_URL")
CMD+=(--start "$START_CITY")

if [[ -n "$END_CITY" ]]; then
    CMD+=(--end "$END_CITY")
fi

for dest in "${DESTINATIONS[@]}"; do
    CMD+=(--dest "$dest")
done

CMD+=(--days "$TRIP_DAYS")
CMD+=(--budget "$MAX_BUDGET")
CMD+=(--offset "$START_OFFSET")

if [[ -n "$TOKEN" ]]; then
    CMD+=(--token "$TOKEN")
elif [[ -n "$EMAIL" && -n "$PASSWORD" ]]; then
    CMD+=(--email "$EMAIL" --password "$PASSWORD")
fi

if [[ -n "$VERBOSE" ]]; then
    CMD+=($VERBOSE)
fi

# Run the command
echo "Running: ${CMD[*]}"
echo ""

"${CMD[@]}"
