#!/bin/zsh
#
# Solo Trip Test Script with Transfer Strategy Display
# =====================================================
# Tests the solo trip optimization and displays transfer strategy clearly.
#
# Usage:
#   ./scripts/test_solo_trip_cli.sh                    # Use defaults (Seattle -> Seoul)
#   ./scripts/test_solo_trip_cli.sh --preset tokyo     # Use Tokyo preset
#   ./scripts/test_solo_trip_cli.sh --help             # Show all options
#

set -e

# ============================================================================
# COLORS FOR OUTPUT
# ============================================================================
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
WHITE='\033[1;37m'
NC='\033[0m' # No Color
BOLD='\033[1m'

# ============================================================================
# CONFIGURATION
# ============================================================================
EMAIL="${TRIPY_EMAIL:-ezhong0211business@gmail.com}"
PASSWORD="${TRIPY_PASSWORD:-Tequinox0211!1}"
API_URL="${TRIPY_API_URL:-http://127.0.0.1:8000}"

# Default trip (Seattle to Seoul - Korean adventure)
START_CITY="Seattle (SEA,BFI)"
END_CITY=""  # Same as start = round trip
DESTINATIONS=("Seoul (GMP,ICN)")
TRIP_DAYS=7
START_OFFSET=45
MAX_BUDGET=5000
OPTIMIZATION_MODE="money_saving"

# Points configuration (realistic balances)
# Use full program names as expected by the API
typeset -A POINTS_BALANCES
POINTS_BALANCES=("Amex Membership Rewards" 1000000)

# ============================================================================
# PRESETS
# ============================================================================
apply_preset() {
    case "$1" in
        seoul|default)
            START_CITY="Seattle (SEA,BFI)"
            DESTINATIONS=("Seoul (GMP,ICN)")
            TRIP_DAYS=7
            MAX_BUDGET=5000
            ;;
        tokyo)
            START_CITY="Seattle (SEA,BFI)"
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
        dubai)
            START_CITY="New York (JFK,LGA)"
            DESTINATIONS=("Dubai (DXB,DWC)")
            TRIP_DAYS=7
            MAX_BUDGET=5000
            ;;
        hawaii)
            START_CITY="Seattle (SEA,BFI)"
            DESTINATIONS=("Honolulu (HNL)")
            TRIP_DAYS=5
            MAX_BUDGET=2000
            ;;
        *)
            echo -e "${RED}Unknown preset: $1${NC}"
            echo "Available: seoul, tokyo, europe, dubai, hawaii"
            exit 1
            ;;
    esac
}

# ============================================================================
# HELP
# ============================================================================
show_help() {
    cat << EOF
${BOLD}Solo Trip Test Script${NC}

${CYAN}USAGE:${NC}
    $0 [OPTIONS]

${CYAN}OPTIONS:${NC}
    --preset NAME       Use preset: seoul, tokyo, europe, dubai, hawaii
    --start CITY        Start city (e.g., "Seattle (SEA,BFI)")
    --dest CITY         Destination (can specify multiple)
    --days N            Trip duration
    --budget N          Max budget
    --mode MODE         Optimization: money_saving, cpp_focused, balanced
    --help, -h          Show this help

${CYAN}EXAMPLES:${NC}
    $0                              # Default: Seattle -> Seoul
    $0 --preset tokyo               # Seattle -> Tokyo
    $0 --start "LAX" --dest "NRT"   # LA -> Tokyo
    $0 --mode cpp_focused           # Maximize points value

EOF
}

# ============================================================================
# PARSE ARGUMENTS
# ============================================================================
CUSTOM_DESTS=()
while [[ $# -gt 0 ]]; do
    case "$1" in
        --preset) apply_preset "$2"; shift 2 ;;
        --start) START_CITY="$2"; shift 2 ;;
        --dest) CUSTOM_DESTS+=("$2"); shift 2 ;;
        --days) TRIP_DAYS="$2"; shift 2 ;;
        --budget) MAX_BUDGET="$2"; shift 2 ;;
        --mode) OPTIMIZATION_MODE="$2"; shift 2 ;;
        --help|-h) show_help; exit 0 ;;
        *) echo "Unknown: $1"; show_help; exit 1 ;;
    esac
done

[[ ${#CUSTOM_DESTS[@]} -gt 0 ]] && DESTINATIONS=("${CUSTOM_DESTS[@]}")
[[ -z "$END_CITY" ]] && END_CITY="$START_CITY"

# ============================================================================
# CALCULATE DATES
# ============================================================================
START_DATE=$(date -v +${START_OFFSET}d +%Y-%m-%d 2>/dev/null || date -d "+${START_OFFSET} days" +%Y-%m-%d)
END_DATE=$(date -v +$((START_OFFSET + TRIP_DAYS))d +%Y-%m-%d 2>/dev/null || date -d "+$((START_OFFSET + TRIP_DAYS)) days" +%Y-%m-%d)

# ============================================================================
# DISPLAY CONFIG
# ============================================================================
echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║          🧪 SOLO TRIP OPTIMIZATION TEST                      ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "${WHITE}📍 Route:${NC}        $START_CITY"
for dest in "${DESTINATIONS[@]}"; do
    echo -e "                 ↓ ${GREEN}$dest${NC}"
done
echo -e "                 ↓ $END_CITY"
echo ""
echo -e "${WHITE}📅 Dates:${NC}        $START_DATE to $END_DATE ($TRIP_DAYS days)"
echo -e "${WHITE}💰 Budget:${NC}       \$$MAX_BUDGET"
echo -e "${WHITE}⚙️  Mode:${NC}         $OPTIMIZATION_MODE"
echo ""
echo -e "${WHITE}💳 Points:${NC}"
for prog in ${(k)POINTS_BALANCES}; do
    printf "                 %-20s %d pts\n" "$prog:" "${POINTS_BALANCES[$prog]}"
done
echo ""

# ============================================================================
# CHECK API
# ============================================================================
echo -e "${YELLOW}[1/6]${NC} Checking API..."
if ! curl -s "$API_URL/healthz" > /dev/null 2>&1; then
    echo -e "${RED}❌ Cannot connect to $API_URL${NC}"
    echo "   Start the backend with: cd backend && uvicorn src.app:app --port 8000 --reload"
    exit 1
fi
echo -e "${GREEN}   ✅ API is running${NC}"

# ============================================================================
# LOGIN
# ============================================================================
echo -e "${YELLOW}[2/6]${NC} Authenticating..."
LOGIN_RESP=$(curl -s -X POST "$API_URL/auth/login" \
    -H "Content-Type: application/json" \
    -d "{\"email\": \"$EMAIL\", \"password\": \"$PASSWORD\"}")

# Token can be in different locations depending on the API response format
TOKEN=$(echo "$LOGIN_RESP" | python3 -c "
import sys,json
d=json.load(sys.stdin)
# Try nested tokens.access_token first, then direct access_token
token = d.get('tokens', {}).get('access_token', '') or d.get('access_token', '')
print(token)
" 2>/dev/null)

if [[ -z "$TOKEN" ]]; then
    echo -e "${RED}❌ Login failed${NC}"
    echo "   Response: $LOGIN_RESP"
    exit 1
fi
echo -e "${GREEN}   ✅ Logged in${NC}"

AUTH_HEADER="Authorization: Bearer $TOKEN"

# ============================================================================
# CREATE TRIP
# ============================================================================
echo -e "${YELLOW}[3/6]${NC} Creating trip..."
TRIP_RESP=$(curl -s -X POST "$API_URL/trips" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{
        \"title\": \"Test Trip - CLI\",
        \"start_date\": \"$START_DATE\",
        \"end_date\": \"$END_DATE\",
        \"max_budget\": $MAX_BUDGET,
        \"include_hotels\": false
    }")

TRIP_ID=$(echo "$TRIP_RESP" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('tripId',''))" 2>/dev/null)

if [[ -z "$TRIP_ID" ]]; then
    echo -e "${RED}❌ Failed to create trip${NC}"
    echo "   Response: $TRIP_RESP"
    exit 1
fi
echo -e "${GREEN}   ✅ Trip ID: $TRIP_ID${NC}"

# ============================================================================
# ADD DESTINATIONS
# ============================================================================
echo -e "${YELLOW}[4/6]${NC} Adding destinations..."

# Add start
curl -s -X POST "$API_URL/destinations/add" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"trip_id\": \"$TRIP_ID\", \"name\": \"$START_CITY\", \"is_start\": true, \"is_end\": true}" > /dev/null
echo -e "   ✅ Start/End: $START_CITY"

# Add destinations
for dest in "${DESTINATIONS[@]}"; do
    curl -s -X POST "$API_URL/destinations/add" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "{\"trip_id\": \"$TRIP_ID\", \"name\": \"$dest\", \"must_include\": true}" > /dev/null
    echo -e "   ✅ Destination: $dest"
done

# ============================================================================
# ADD POINTS
# ============================================================================
echo -e "${YELLOW}[5/6]${NC} Adding points balances..."
for prog in ${(k)POINTS_BALANCES}; do
    curl -s -X POST "$API_URL/points/upsert" \
        -H "$AUTH_HEADER" \
        -H "Content-Type: application/json" \
        -d "{\"trip_id\": \"$TRIP_ID\", \"program\": \"$prog\", \"balance\": ${POINTS_BALANCES[$prog]}}" > /dev/null
    printf "   ✅ %s: %d pts\n" "$prog" "${POINTS_BALANCES[$prog]}"
done

# ============================================================================
# GENERATE ITINERARY
# ============================================================================
echo -e "${YELLOW}[6/6]${NC} Generating optimized itinerary..."
echo -e "   ${CYAN}(This may take 30-90 seconds...)${NC}"
echo ""

START_TIME=$(date +%s)

RESULT=$(curl -s -X POST "$API_URL/itinerary/generate" \
    -H "$AUTH_HEADER" \
    -H "Content-Type: application/json" \
    -d "{\"trip_id\": \"$TRIP_ID\", \"optimization_mode\": \"$OPTIMIZATION_MODE\"}")

END_TIME=$(date +%s)
ELAPSED=$((END_TIME - START_TIME))

# Save raw result for debugging
echo "$RESULT" > /tmp/tripy_last_result.json

# ============================================================================
# PARSE AND DISPLAY RESULTS
# ============================================================================
STATUS=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status','error'))" 2>/dev/null)

echo ""
echo -e "${BOLD}${CYAN}╔══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}${CYAN}║                    📊 OPTIMIZATION RESULTS                   ║${NC}"
echo -e "${BOLD}${CYAN}╚══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "⏱️  Completed in ${BOLD}${ELAPSED}s${NC}"
echo ""

if [[ "$STATUS" == "error" ]]; then
    MSG=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('message','Unknown error'))" 2>/dev/null)
    echo -e "${RED}❌ Optimization failed: $MSG${NC}"
    echo ""
    echo "Raw result saved to: /tmp/tripy_last_result.json"
    exit 1
fi

# Parse the result using Python for complex JSON handling
python3 << 'PYTHON_SCRIPT'
import json
import sys

# Colors
RED = '\033[0;31m'
GREEN = '\033[0;32m'
YELLOW = '\033[1;33m'
BLUE = '\033[0;34m'
PURPLE = '\033[0;35m'
CYAN = '\033[0;36m'
WHITE = '\033[1;37m'
BOLD = '\033[1m'
NC = '\033[0m'

try:
    with open('/tmp/tripy_last_result.json', 'r') as f:
        result = json.load(f)
except Exception as e:
    print(f"{RED}Failed to parse result: {e}{NC}")
    sys.exit(1)

status = result.get('status', 'unknown')
solution = result.get('solution', {})
totals = solution.get('totals', {})

# ============================================================================
# COST SUMMARY
# ============================================================================
print(f"{BOLD}💰 COST SUMMARY{NC}")
print("─" * 50)
oop = result.get('out_of_pocket', totals.get('cash', 0))
points_used = totals.get('airline_points', 0)
points_value = totals.get('points_value', 0)

print(f"   Out of Pocket:     {GREEN}${oop:,.0f}{NC}")
print(f"   Points Used:       {CYAN}{points_used:,.0f}{NC}")
print(f"   Points Value:      {PURPLE}${points_value:,.0f}{NC}")
if points_used > 0:
    cpp = (points_value / points_used) * 100 if points_used else 0
    print(f"   Redemption Rate:   {YELLOW}{cpp:.2f} cpp{NC}")
print()

# ============================================================================
# ROUTE
# ============================================================================
print(f"{BOLD}🗺️  ROUTE{NC}")
print("─" * 50)
paths = solution.get('path', {})
for traveler, path in paths.items():
    route_str = f" {CYAN}→{NC} ".join(path)
    print(f"   {route_str}")
print()

# ============================================================================
# FLIGHT PAYMENTS
# ============================================================================
print(f"{BOLD}✈️  FLIGHT PAYMENTS{NC}")
print("─" * 50)
pay_modes = solution.get('pay_mode', {})
for traveler, payments in pay_modes.items():
    for i, pm in enumerate(payments, 1):
        edge = pm.get('edge', [])
        route = f"{edge[0]} → {edge[1]}" if len(edge) >= 2 else str(edge)
        flight = edge[2] if len(edge) >= 3 else ""
        
        if pm.get('type') == 'cash':
            fare = pm.get('fare', 0)
            print(f"   {i}. {BOLD}{route}{NC} ({flight})")
            print(f"      Payment: {GREEN}${fare:,.0f} cash{NC}")
        else:
            miles = pm.get('miles', 0)
            surcharge = pm.get('surcharge', 0)
            via = pm.get('via', {})
            
            print(f"   {i}. {BOLD}{route}{NC} ({flight})")
            
            if 'native' in via:
                # Direct miles booking
                print(f"      Payment: {CYAN}{miles:,.0f} {via['native']} miles{NC} + ${surcharge:.0f} taxes")
            else:
                # Transfer required
                source = via.get('source', '?')
                airline = via.get('airline', '?')
                print(f"      Payment: {CYAN}{miles:,.0f} miles{NC} + ${surcharge:.0f} taxes")
                print(f"      Transfer: {YELLOW}{source}{NC} → {PURPLE}{airline}{NC}")
        print()

# ============================================================================
# TRANSFER STRATEGY (THE KEY PART!)
# ============================================================================
transfers = totals.get('transfers', {})
has_transfers = False
for traveler, sources in transfers.items():
    for source, airlines in sources.items():
        if airlines:
            has_transfers = True
            break

if has_transfers:
    print(f"{BOLD}🔄 TRANSFER STRATEGY{NC}")
    print("═" * 60)
    print()
    print(f"   {BOLD}This is what you need to do to book this trip:{NC}")
    print()
    
    step = 1
    total_points_to_transfer = 0
    
    for traveler, sources in transfers.items():
        for source, airlines in sources.items():
            source_display = source.upper().replace('_', ' ')
            if source == 'amex':
                source_display = 'AMEX Membership Rewards'
            elif source == 'chase':
                source_display = 'Chase Ultimate Rewards'
            elif source == 'citi':
                source_display = 'Citi ThankYou Points'
            elif source == 'capital_one':
                source_display = 'Capital One Miles'
            
            for airline, details in airlines.items():
                source_pts = details.get('source_points', 0)
                delivered = details.get('delivered_airline_points', 0)
                ratio = delivered / source_pts if source_pts > 0 else 1.0
                
                # Airline name mapping
                airline_names = {
                    'DL': 'Delta SkyMiles',
                    'AA': 'American AAdvantage',
                    'UA': 'United MileagePlus',
                    'AS': 'Alaska Mileage Plan',
                    'AC': 'Air Canada Aeroplan',
                    'BA': 'British Airways Avios',
                    'EK': 'Emirates Skywards',
                    'QR': 'Qatar Privilege Club',
                    'VS': 'Virgin Atlantic Flying Club',
                    'KE': 'Korean Air SKYPASS',
                    'NH': 'ANA Mileage Club',
                    'SQ': 'Singapore KrisFlyer',
                    'CX': 'Cathay Pacific Asia Miles',
                    'AF': 'Air France Flying Blue',
                    'KL': 'KLM Flying Blue',
                    'LH': 'Lufthansa Miles & More',
                }
                airline_display = airline_names.get(airline, f'{airline} Miles')
                
                total_points_to_transfer += source_pts
                
                print(f"   {BOLD}Step {step}:{NC} Transfer Points")
                print()
                print(f"      ┌─────────────────────────────────────────────────────┐")
                print(f"      │  FROM: {WHITE}{source_display}{NC}")
                print(f"      │        {CYAN}{source_pts:,}{NC} points")
                print(f"      │")
                print(f"      │           ↓  (transfer ratio: {ratio:.1f}x)")
                print(f"      │")
                print(f"      │  TO:   {PURPLE}{airline_display}{NC}")
                print(f"      │        {GREEN}{delivered:,}{NC} miles")
                print(f"      └─────────────────────────────────────────────────────┘")
                print()
                
                # Instructions
                print(f"      📱 {YELLOW}How to transfer:{NC}")
                if source == 'amex':
                    print(f"         1. Log into amextravel.com or AMEX app")
                    print(f"         2. Go to Membership Rewards → Transfer Points")
                    print(f"         3. Select '{airline_display}'")
                    print(f"         4. Enter {source_pts:,} points")
                    print(f"         5. Confirm transfer (usually instant)")
                elif source == 'chase':
                    print(f"         1. Log into chase.com/ultimaterewards")
                    print(f"         2. Click 'Transfer to Travel Partners'")
                    print(f"         3. Select '{airline_display}'")
                    print(f"         4. Enter {source_pts:,} points")
                    print(f"         5. Confirm (transfers are usually instant)")
                elif source == 'citi':
                    print(f"         1. Log into thankyou.com")
                    print(f"         2. Go to 'Use Points' → 'Transfer'")
                    print(f"         3. Select '{airline_display}'")
                    print(f"         4. Enter {source_pts:,} points")
                else:
                    print(f"         1. Log into your {source_display} account")
                    print(f"         2. Navigate to points transfer section")
                    print(f"         3. Select '{airline_display}'")
                    print(f"         4. Transfer {source_pts:,} points")
                
                print()
                step += 1
    
    # Summary box
    print()
    print(f"   {BOLD}📋 TRANSFER SUMMARY{NC}")
    print(f"   ╔═══════════════════════════════════════════════════════════╗")
    print(f"   ║  Total points to transfer: {CYAN}{total_points_to_transfer:>15,}{NC}          ║")
    print(f"   ╚═══════════════════════════════════════════════════════════╝")
    print()
    
    # Booking order
    print(f"   {BOLD}📌 BOOKING ORDER:{NC}")
    print(f"      1. First, transfer ALL points (wait for them to post)")
    print(f"      2. Then book flights using the transferred miles")
    print(f"      3. Points usually transfer instantly, but allow 24-48h buffer")
    print()

else:
    print(f"{BOLD}🔄 TRANSFER STRATEGY{NC}")
    print("─" * 50)
    print(f"   {GREEN}No transfers needed!{NC}")
    print(f"   All flights can be booked with cash or existing airline miles.")
    print()

# ============================================================================
# TIPS
# ============================================================================
smart_tips = result.get('smart_tips', {})
transfer_tips = smart_tips.get('transfer_tips', [])
if transfer_tips:
    print(f"{BOLD}💡 SMART TIPS{NC}")
    print("─" * 50)
    for tip in transfer_tips[:5]:
        print(f"   • {tip}")
    print()

print(f"{GREEN}✅ Optimization complete!{NC}")
print(f"   Raw JSON saved to: /tmp/tripy_last_result.json")
print()

PYTHON_SCRIPT

echo ""
echo -e "${GREEN}Done!${NC}"
