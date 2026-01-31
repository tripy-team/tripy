#!/bin/bash

# ============================================================================
# Tripy Optimization Test Script
# ============================================================================
# Usage: ./test-optimization.sh
#
# Configure your test trip by editing: test-config.sh
# ============================================================================

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONFIG_FILE="$SCRIPT_DIR/test-config.sh"

# ============================================================================
# LOAD CONFIGURATION
# ============================================================================

# Default values (overridden by config file)
API_URL="http://127.0.0.1:8000"
TEST_EMAIL=""
TEST_PASSWORD=""
START_LOCATION=""
DESTINATIONS=""
START_DATE=""
END_DATE=""
MAX_BUDGET=5000
CHASE_POINTS=0
AMEX_POINTS=0
CITI_POINTS=0
CAPITAL_ONE_POINTS=0
BILT_POINTS=0
UNITED_MILES=0
AMERICAN_MILES=0
DELTA_MILES=0
ALASKA_MILES=0
BRITISH_AIRWAYS_MILES=0
EMIRATES_MILES=0

# Load config file
if [[ -f "$CONFIG_FILE" ]]; then
    source "$CONFIG_FILE"
else
    echo -e "${RED}Config file not found: $CONFIG_FILE${NC}"
    echo -e "${YELLOW}Creating default config file...${NC}"
    cat > "$CONFIG_FILE" << 'CONFIGEOF'
#!/bin/bash
# ============================================
# TRIPY OPTIMIZATION TEST CONFIGURATION
# ============================================
# Edit this file to configure your test trip.
# Then run: ./test-optimization.sh
# ============================================

# --------------------------------------------
# TRIP DETAILS
# --------------------------------------------

# Starting location (city name with airport codes)
START_LOCATION="New York (JFK,LGA)"

# Destination(s) - comma-separated for multi-city
DESTINATIONS="Dubai (DXB,DWC)"

# Travel dates (YYYY-MM-DD format)
START_DATE="2026-03-15"
END_DATE="2026-03-22"

# Maximum budget per person (USD)
MAX_BUDGET=5000

# --------------------------------------------
# POINTS BALANCES (set to 0 if you don't have)
# --------------------------------------------

# Bank/Credit Card Points
CHASE_POINTS=100000
AMEX_POINTS=1000000
CITI_POINTS=150000
CAPITAL_ONE_POINTS=0
BILT_POINTS=0

# Airline Miles
UNITED_MILES=0
AMERICAN_MILES=0
DELTA_MILES=0
ALASKA_MILES=0
BRITISH_AIRWAYS_MILES=0
EMIRATES_MILES=0

# --------------------------------------------
# API SETTINGS
# --------------------------------------------

API_URL="http://localhost:8000"
TEST_EMAIL="testuser@test.com"
TEST_PASSWORD="TestPassword123!"
CONFIGEOF
    echo -e "${GREEN}Created: $CONFIG_FILE${NC}"
    echo -e "${YELLOW}Please edit the config file and run again.${NC}"
    exit 0
fi

# Use config values (with fallbacks for old variable names)
EMAIL="${TEST_EMAIL:-$EMAIL}"
PASSWORD="${TEST_PASSWORD:-$PASSWORD}"
START_CITY="${START_LOCATION:-$START_CITY}"
DESTINATION="${DESTINATIONS:-$DESTINATION}"

# ============================================================================
# SCRIPT EXECUTION
# ============================================================================

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  Tripy Optimization Test${NC}"
echo -e "${BLUE}========================================${NC}"

# Check if backend is running
echo -e "\n${YELLOW}Checking backend...${NC}"
if ! curl -s "$API_URL/healthz" > /dev/null 2>&1; then
    echo -e "${RED}Backend is not running at $API_URL${NC}"
    echo -e "${YELLOW}Start it with: ./start-local.sh${NC}"
    exit 1
fi
echo -e "${GREEN}Backend is running${NC}"

# Check credentials
if [[ -z "$EMAIL" || "$EMAIL" == "testuser@test.com" ]]; then
    echo -e "\n${RED}Please edit test-config.sh and set your TEST_EMAIL and TEST_PASSWORD${NC}"
    exit 1
fi

# Display configuration
echo -e "\n${BLUE}Trip Configuration:${NC}"
echo -e "  Route:    $START_CITY → $DESTINATION → $START_CITY"
echo -e "  Dates:    $START_DATE to $END_DATE"
echo -e "  Budget:   \$$MAX_BUDGET"

# Show points summary
POINTS_SUMMARY=""
[[ $CHASE_POINTS -gt 0 ]] && POINTS_SUMMARY+="Chase=$CHASE_POINTS "
[[ $AMEX_POINTS -gt 0 ]] && POINTS_SUMMARY+="Amex=$AMEX_POINTS "
[[ $CITI_POINTS -gt 0 ]] && POINTS_SUMMARY+="Citi=$CITI_POINTS "
[[ $CAPITAL_ONE_POINTS -gt 0 ]] && POINTS_SUMMARY+="CapOne=$CAPITAL_ONE_POINTS "
[[ $BILT_POINTS -gt 0 ]] && POINTS_SUMMARY+="Bilt=$BILT_POINTS "
[[ $UNITED_MILES -gt 0 ]] && POINTS_SUMMARY+="UA=$UNITED_MILES "
[[ $AMERICAN_MILES -gt 0 ]] && POINTS_SUMMARY+="AA=$AMERICAN_MILES "
[[ $DELTA_MILES -gt 0 ]] && POINTS_SUMMARY+="DL=$DELTA_MILES "
[[ $ALASKA_MILES -gt 0 ]] && POINTS_SUMMARY+="AS=$ALASKA_MILES "
echo -e "  Points:   ${POINTS_SUMMARY:-None}"

# Login
echo -e "\n${YELLOW}[1/5] Logging in...${NC}"
LOGIN_RESP=$(curl -s -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}")

# Token can be at tokens.access_token (new format) or access_token (old format)
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "
import sys, json
data = json.load(sys.stdin)
token = data.get('tokens', {}).get('access_token') or data.get('access_token', '')
print(token)
" 2>/dev/null)

if [[ -z "$TOKEN" ]]; then
    echo -e "${RED}Login failed. Check your EMAIL and PASSWORD.${NC}"
    echo -e "Response: $LOGIN_RESP"
    exit 1
fi
echo -e "${GREEN}Logged in successfully${NC}"

# Create trip
echo -e "\n${YELLOW}[2/5] Creating trip...${NC}"
TRIP_RESP=$(curl -s -X POST "$API_URL/trips" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"title\": \"Test Trip\", \"start_date\": \"$START_DATE\", \"end_date\": \"$END_DATE\", \"max_budget\": $MAX_BUDGET, \"include_hotels\": false}")

TRIP_ID=$(echo "$TRIP_RESP" | python3 -c "import sys, json; print(json.load(sys.stdin).get('tripId', ''))" 2>/dev/null)

if [[ -z "$TRIP_ID" ]]; then
    echo -e "${RED}Failed to create trip${NC}"
    echo -e "Response: $TRIP_RESP"
    exit 1
fi
echo -e "${GREEN}Trip created: $TRIP_ID${NC}"

# Add destinations
echo -e "\n${YELLOW}[3/5] Adding destinations...${NC}"

# Add start city
curl -s -X POST "$API_URL/destinations/add" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"trip_id\": \"$TRIP_ID\", \"name\": \"$START_CITY\", \"is_start\": true, \"is_end\": true}" > /dev/null

echo -e "  ${GREEN}✓${NC} Start/End: $START_CITY"

# Add destination
curl -s -X POST "$API_URL/destinations/add" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"trip_id\": \"$TRIP_ID\", \"name\": \"$DESTINATION\", \"must_include\": true}" > /dev/null

echo -e "  ${GREEN}✓${NC} Destination: $DESTINATION"

# Add points
echo -e "\n${YELLOW}[4/5] Adding points balances...${NC}"

# Helper function to add points
add_points() {
    local program="$1"
    local balance="$2"
    local display_name="$3"
    
    if [[ $balance -gt 0 ]]; then
        RESP=$(curl -s -X POST "$API_URL/points/upsert" \
            -H "Content-Type: application/json" \
            -H "Authorization: Bearer $TOKEN" \
            -d "{\"trip_id\": \"$TRIP_ID\", \"program\": \"$program\", \"balance\": $balance}")
        if echo "$RESP" | grep -q "balance"; then
            echo -e "  ${GREEN}✓${NC} $display_name: $balance"
        else
            echo -e "  ${RED}✗${NC} $display_name: Failed"
        fi
    fi
}

# Bank/Credit Card Points
add_points "Chase Ultimate Rewards" "$CHASE_POINTS" "Chase UR"
add_points "Amex Membership Rewards" "$AMEX_POINTS" "Amex MR"
add_points "Citi ThankYou Points" "$CITI_POINTS" "Citi TYP"
add_points "Capital One Miles" "$CAPITAL_ONE_POINTS" "Capital One"
add_points "Bilt Rewards" "$BILT_POINTS" "Bilt"

# Airline Miles
add_points "United MileagePlus" "$UNITED_MILES" "United"
add_points "American Airlines AAdvantage" "$AMERICAN_MILES" "American"
add_points "Delta SkyMiles" "$DELTA_MILES" "Delta"
add_points "Alaska Mileage Plan" "$ALASKA_MILES" "Alaska"
add_points "British Airways Avios" "$BRITISH_AIRWAYS_MILES" "British Airways"
add_points "Emirates Skywards" "$EMIRATES_MILES" "Emirates"

# Generate itinerary
echo -e "\n${YELLOW}[5/5] Running optimization...${NC}"
echo -e "${YELLOW}Mode: ${OPTIMIZATION_MODE:-money_saving}${NC}"
echo -e "${YELLOW}(This may take 30-60 seconds)${NC}"

RESULT_FILE=$(mktemp)
OPT_MODE="${OPTIMIZATION_MODE:-money_saving}"
curl -s -X POST "$API_URL/itinerary/generate" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $TOKEN" \
    -d "{\"trip_id\": \"$TRIP_ID\", \"optimization_mode\": \"$OPT_MODE\"}" > "$RESULT_FILE"

STATUS=$(python3 -c "import sys, json; print(json.load(open('$RESULT_FILE')).get('status', 'unknown'))" 2>/dev/null)

echo -e "\n${BLUE}========================================${NC}"
echo -e "${BLUE}  RESULT: $STATUS${NC}"
echo -e "${BLUE}========================================${NC}"

if [[ "$STATUS" == "Optimal" ]]; then
    echo -e "\n${GREEN}✓ Optimization successful!${NC}\n"
    
    # Parse and display results
    python3 << PYEOF
import json
result = json.load(open('$RESULT_FILE'))
solution = result.get('solution', {})
totals = solution.get('totals', {})

# Show optimization mode used
opt_mode = totals.get('optimization_mode', '$OPT_MODE')
mode_labels = {
    'cpp_focused': 'CPP Focused (cpp > 1.0)',
    'money_saving': 'Money Saving (cpp > 0)',
    'balanced': 'Balanced (cpp/time/stops)',
    'oop': 'Money Saving (legacy)',
    'cpp': 'CPP Focused (legacy)',
}
print(f"⚙️  Strategy:     {mode_labels.get(opt_mode, opt_mode)}")
print()

# Route
paths = solution.get('path', {})
for traveler, path in paths.items():
    if path:
        print(f"🗺️  ROUTE: {' → '.join(path)}")
        print()

# Summary
cash = result.get('out_of_pocket', totals.get('cash', 0))
points = totals.get('airline_points', 0)
value = totals.get('points_value', 0)

print(f"💵 Out of Pocket: \${cash:,.0f}")
print(f"✈️  Points Used:   {points:,.0f}")
print(f"💰 Points Value:  \${value:,.0f}")
if value > 0 and points > 0:
    cpp = (value * 100) / points
    print(f"📊 Cents/Point:   {cpp:.2f}¢")

# Flight details
pay_modes = solution.get('pay_mode', {})
edges = solution.get('edges', {})

print(f"\n{'─'*50}")
print("FLIGHT DETAILS:")
print(f"{'─'*50}")

for traveler, payments in pay_modes.items():
    for i, pm in enumerate(payments):
        edge = pm.get('edge', [])
        origin = edge[0] if len(edge) > 0 else '?'
        dest = edge[1] if len(edge) > 1 else '?'
        flight = edge[2] if len(edge) > 2 else ''
        
        print(f"\n  Segment {i+1}: {origin} → {dest}")
        if flight:
            print(f"  Flight:   {flight}")
        
        if pm.get('type') == 'cash':
            fare = pm.get('fare', 0)
            print(f"  Payment:  💵 \${fare:,.0f} CASH")
        else:
            via = pm.get('via', {})
            miles = pm.get('miles', 0)
            sur = pm.get('surcharge', 0)
            cpp_val = pm.get('cents_per_point', 0)
            
            if 'native' in via:
                print(f"  Payment:  ✈️  {miles:,.0f} {via['native']} miles + \${sur:,.0f} taxes")
            else:
                source = via.get('source', '?')
                airline = via.get('airline', '?')
                print(f"  Payment:  🔄 {miles:,.0f} miles ({source} → {airline}) + \${sur:,.0f} taxes")
            
            if cpp_val:
                print(f"  Value:    {cpp_val:.2f}¢ per point")

# Transfer instructions
transfers = totals.get('transfers', {})
has_transfers = any(s for t in transfers.values() for s in t.values())
if has_transfers:
    print(f"\n{'─'*50}")
    print("TRANSFER INSTRUCTIONS:")
    print(f"{'─'*50}")
    for traveler, sources in transfers.items():
        for source, airlines in sources.items():
            for airline, details in airlines.items():
                pts = details.get('source_points', 0)
                delivered = details.get('delivered_airline_points', 0)
                print(f"\n  🔄 Transfer {pts:,} {source.upper()} points → {airline}")
                print(f"     You'll receive: {delivered:,} {airline} miles")

print()
PYEOF

elif [[ "$STATUS" == "error" ]]; then
    echo -e "\n${RED}✗ Optimization failed${NC}"
    python3 -c "import json; r=json.load(open('$RESULT_FILE')); print(f\"  Error: {r.get('message', 'Unknown')}\")"
else
    echo -e "\n${YELLOW}Unexpected status: $STATUS${NC}"
    cat "$RESULT_FILE" | python3 -m json.tool 2>/dev/null | head -50
fi

# Cleanup
rm -f "$RESULT_FILE"

echo ""
