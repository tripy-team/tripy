# Tripy - Your Smart Travel Points Optimizer

## What is Tripy?

Tripy is a travel planning platform that helps you get the most value from your credit card points and airline miles. Instead of guessing whether to pay with cash or points, Tripy's optimization engine calculates the best strategy for every flight—ensuring you maximize savings and never waste your hard-earned rewards.

---

## The Problem Tripy Solves

Most travelers face these challenges when using points for travel:

1. **Confusing Point Values** - Is 50,000 points for a $600 flight a good deal? What about 30,000 points for a $450 flight?
2. **Too Many Transfer Options** - Chase points can transfer to United, British Airways, Air France, and more. Which is best for your trip?
3. **Complex Multi-City Planning** - Should you fly NYC→Tokyo→Paris→Miami or NYC→Paris→Tokyo→Miami?
4. **Balancing Cash and Points** - When should you pay cash vs. use points?

Tripy answers all of these questions automatically using mathematical optimization.

---

## How It Works

### Step 1: Enter Your Trip Details

Tell Tripy where you want to go:
- **Starting Point**: Where your trip begins (e.g., JFK)
- **Destinations**: Cities you want to visit (e.g., Tokyo, Paris)
- **End Point**: Where your trip ends (e.g., Miami)
- **Travel Dates**: When you want to travel
- **Budget**: Maximum cash you're willing to spend

### Step 2: Add Your Points Balances

Enter the points you have available:

**Credit Card Programs:**
- Chase Ultimate Rewards
- American Express Membership Rewards
- Citi ThankYou Points
- Capital One Miles
- Bilt Rewards

**Airline Miles:**
- United MileagePlus
- American AAdvantage
- Delta SkyMiles
- British Airways Avios
- And many more...

### Step 3: Get Optimized Itineraries

Tripy generates multiple itinerary options, each showing:
- The best route through your destinations
- Which flights to pay cash for vs. points
- Which points to transfer and where
- Total cost breakdown (cash + points used)
- How much you're saving compared to all-cash booking

### Step 4: Book with Confidence

For each flight, Tripy provides:
- Step-by-step transfer instructions
- Direct links to booking portals
- Transfer timing guidance
- Surcharges and fees breakdown

---

## The Optimization Engine

### What Makes Tripy Different

Tripy uses **Integer Linear Programming (ILP)**—the same mathematical technique used by airlines to schedule flights and by logistics companies to optimize delivery routes.

The optimizer considers thousands of combinations simultaneously to find the absolute best strategy, weighing:

| Factor | What It Means |
|--------|---------------|
| **Points Value** | Prioritizes redemptions where your points are worth more (higher cents-per-point) |
| **Cash Savings** | Minimizes your out-of-pocket expenses |
| **Travel Time** | Prefers more efficient routes when costs are similar |
| **Award Availability** | Only suggests options with actual award seat availability |

### Understanding Points Value

Tripy measures value using **Cents Per Point (CPP)**:

```
CPP = (Cash Price - Award Surcharges) ÷ Points Required × 100
```

| CPP | Rating | Example |
|-----|--------|---------|
| 3.0+ | Excellent | 50,000 points for a $1,500 flight |
| 1.5-3.0 | Good | 50,000 points for a $1,000 flight |
| 1.0-1.5 | Acceptable | Minimum threshold for recommendation |
| <1.0 | Poor | Never recommended—pay cash instead |

Tripy will **never** recommend using points if you'd get less than 1.0 cpp. In those cases, it tells you to pay cash and save your points for better opportunities.

---

## Fair Cost Splitting for Shared Bookings

When booking travel for multiple people (family, friends, colleagues), Tripy ensures costs are split fairly and transparently.

### How Cost Splitting Works

The platform tracks who pays for what across the entire itinerary:

**Scenario**: You're booking flights for yourself and two friends. Combined, you have:
- Your Chase points: 150,000
- Friend A's Amex points: 80,000  
- Friend B's cash contribution: $1,200

Tripy's optimizer determines the most efficient allocation:

| Segment | Payment Method | Payer | Beneficiary |
|---------|---------------|-------|-------------|
| JFK→Tokyo (You) | 70,000 United miles | You (via Chase transfer) | You |
| JFK→Tokyo (Friend A) | 70,000 United miles | You (via Chase transfer) | Friend A |
| JFK→Tokyo (Friend B) | $890 cash | Friend B | Friend B |
| Tokyo→Miami (All) | $1,100 cash | Friend B ($310) + Friend A ($400 from Amex) + You ($390 cash) | All |

### Cost Allocation Principles

1. **Points are valued fairly** - When someone uses their points to pay for another person's flight, the dollar value is calculated at the actual redemption rate achieved

2. **Cash contributions are tracked** - The system shows exactly how much cash each person contributed

3. **Flexibility in payment** - Any traveler can pay for any other traveler's segments using their points or cash

4. **Transparent breakdown** - Every booking shows a complete ledger of who paid what and who benefited

### Settlement Summary

After optimization, Tripy provides a clear settlement:

```
Final Settlement:
─────────────────────────────────────────
Your total contribution:    $390 cash + 140,000 Chase points
Friend A's contribution:    $400 cash (from Amex at 1.0 cpp)
Friend B's contribution:    $1,200 cash
─────────────────────────────────────────
Your flight value:          $1,850
Friend A's flight value:    $1,200
Friend B's flight value:    $890
─────────────────────────────────────────
Total savings vs. cash:     $1,940 (49% saved)
```

---

## Supported Programs

### Credit Card Transfer Partners

| Credit Card Program | Sample Transfer Partners |
|--------------------|-------------------------|
| Chase Ultimate Rewards | United, British Airways, Air France, Singapore, Hyatt |
| Amex Membership Rewards | Delta, British Airways, Air France, ANA, Hilton |
| Citi ThankYou | Turkish, Air France, Singapore, JetBlue |
| Capital One | Air France, British Airways, Turkish, Avianca |
| Bilt Rewards | American, United, Air France, Turkish, Hyatt |

### Airline Programs

- United MileagePlus
- American AAdvantage  
- Delta SkyMiles
- British Airways Avios
- Air France/KLM Flying Blue
- Singapore KrisFlyer
- Turkish Miles&Smiles
- And many more...

---

## Dynamic Route Optimization

### Automatic City Ordering

For multi-city trips, Tripy automatically determines the optimal order to visit destinations.

**Example:**
- Start: New York (JFK)
- Must visit: Tokyo, Paris  
- End: Miami

The optimizer evaluates both possible routes:
1. JFK → Tokyo → Paris → Miami
2. JFK → Paris → Tokyo → Miami

And selects based on:
- Award availability on each leg
- Points redemption value for each option
- Total cash cost
- Overall travel time

You might assume east-to-west makes sense geographically, but if there's a sweet-spot United award available JFK→Paris and a great ANA award Paris→Tokyo, the optimizer finds it.

---

## Example Optimization

### Input
```
Departure:    Fort Lauderdale (FLL)
Destinations: Tokyo (HND), Paris (CDG)
Arrival:      Orlando (MCO)
Budget:       $3,000
Points:       200,000 Chase Ultimate Rewards
Travel Dates: March 15-28
```

### Tripy's Optimized Result

**Recommended Route: FLL → HND → CDG → MCO**

| Flight | Payment | Cost |
|--------|---------|------|
| FLL → HND | 75,000 United miles (transfer from Chase) + $85 surcharge | 75k pts + $85 |
| HND → CDG | 50,000 Flying Blue miles (transfer from Chase) + $120 surcharge | 50k pts + $120 |
| CDG → MCO | Cash | $650 |

**Summary:**
- Points used: 125,000 Chase UR
- Cash paid: $855
- Points remaining: 75,000 Chase UR
- Cash equivalent of flights: $4,200
- **Total savings: $3,345 (80%)**
- **Average redemption value: 2.7 cpp**

---

## Key Features

| Feature | Description |
|---------|-------------|
| **Real-Time Availability** | Searches actual award seat availability, not theoretical charts |
| **Multi-Source Search** | Combines award availability with cash prices for comparison |
| **Smart Transfers** | Recommends exactly which points to transfer where |
| **Fallback Options** | If your first choice is unavailable, provides alternatives |
| **Budget Awareness** | Never exceeds your cash budget constraints |

---

## Getting Started

1. **Create an account** at tripy.app
2. **Enter your points balances** for all your loyalty programs
3. **Create a new trip** with your destinations and dates
4. **Generate itineraries** and compare options
5. **Follow the booking instructions** for your chosen itinerary

---

## Technical Notes

### Data Sources

| Source | Purpose |
|--------|---------|
| AwardTool API | Award flight availability and pricing |
| SerpAPI (Google Flights) | Cash price comparisons |
| Amadeus | Airport and city search |

### Privacy

- Your points balances are stored securely and only used for optimization
- No booking is made without your explicit action
- You control which points programs to include in each search

---

*Tripy transforms the complexity of points travel into simple, optimized recommendations—so you can travel more while spending less.*
