# Tripy: Source of Truth

> *This document defines what Tripy is, what it does for users, and how to think about the product when making decisions.*

---

## What is Tripy?

**Tripy is a flight-only travel planning app that helps people get more value from their credit card points and loyalty programs.**

At its core, Tripy is a **points arbitrage engine for flights**—it finds the gap between what your points are "officially" worth and what they *could* be worth when used strategically for award flights. The difference can be 3x, 5x, or even 10x.

Most travelers accumulate points across multiple credit cards (Chase, Amex, Citi, etc.) but don't know how to use them effectively. Tripy solves this by:

1. Finding the best ways to use your points for **flights** (seat allocation, ticketing, taxes/fees)
2. Comparing cash prices vs. points redemptions
3. Optimizing across multiple cards and loyalty programs
4. Making group travel coordination simple

> **Flight-Only Scope**: Tripy is a points-first, seat-allocation, ticketing optimizer for **flights only**. Lodging/hotels are out of scope. See [GROUP_TRIP_WORKFLOW.md](./GROUP_TRIP_WORKFLOW.md) for the complete product spec.

**What users see**: Simple recommendations and clear savings.
**What's happening behind the curtain**: A sophisticated engine evaluating thousands of combinations to find arbitrage opportunities.

---

## Who is Tripy For?

### Primary Users
- **Points collectors** who have accumulated rewards across multiple credit cards and want to maximize their value
- **Budget-conscious travelers** who want to minimize out-of-pocket spending on trips
- **Group travel organizers** who need to coordinate flights, hotels, and expenses with friends or family

### The Core Problem We Solve
Travelers often:
- Don't know which credit card points to use for a trip
- Miss out on valuable transfer partner opportunities (e.g., transferring Chase points to United)
- Spend hours comparing prices across multiple sites
- Struggle to coordinate group trips and split costs fairly

**Tripy automates all of this in seconds.**

---

## What Users Can Do

### 1. Plan Solo Trips

A single traveler can:

- **Set up a trip**: Choose destinations, dates, number of travelers, and budget
- **Connect their points**: Enter balances from all their credit card and loyalty programs
- **Set preferences**: Choose flight class, cabin preferences, preferred departure times, and whether they need checked bags
- **Choose how to optimize**:
  - *Minimize Cash*: Spend as little money as possible, using points wherever it makes sense
  - *Maximize Value*: Get the best "cents per point" value from redemptions
  - *Balanced*: Find a middle ground between cost, time, and convenience
- **Get optimized results**: See the best flight combinations based on their preferences
- **Compare options**: Review multiple itinerary options side-by-side
- **Follow booking instructions**: Get step-by-step guidance on how to book, including which points to transfer and where

### 2. Plan Group Trips

Groups of friends or family can:

- **Create a group trip**: Set the basic trip parameters
- **Invite members**: Share an invite code or link with friends
- **Pool points**: Combine points across all group members to unlock better redemptions (see [GROUP_TRIP_WORKFLOW.md](./GROUP_TRIP_WORKFLOW.md) for the full product/system workflow)
- **Vote on destinations**: Collaboratively decide where to go
- **Get group-optimized results**: Find itineraries that work for everyone
- **See fair cost splits**: Know exactly who owes what and who should book which parts
- **Settle up**: Clear breakdown of payments between members

### 3. Manage Points & Trips

Users can:

- **Track all their points** in one place across programs
- **See their trip history** and upcoming travel
- **View savings** from past trips
- **Understand point values** across different programs

---

## What Makes Tripy Valuable

### 1. Finds Hidden Value
Tripy discovers redemption opportunities that users would never find manually—like transferring Chase points to a partner airline for 3-5x the value compared to booking through the Chase portal.

### 2. Saves Time
Instead of spending hours comparing prices across multiple websites, Tripy does this automatically and presents the best options in seconds.

### 3. Transparent Comparisons
Users always see both the cash price and the points price, so they can make informed decisions about when to use points vs. pay cash.

### 4. Handles Complexity
Multi-city trips, connecting flights, different airports, group coordination—Tripy handles all the complexity so users don't have to.

### 5. Collaborative Planning
Group trips are notoriously difficult to plan. Tripy makes it easy with shared planning, voting, and fair cost splitting.

---

## The Magic Behind the Curtain

> *This section describes capabilities that power Tripy's recommendations. Users don't need to understand these—they just experience better results.*

Tripy's engine goes deeper than users realize. The goal is to surface great options without requiring users to become points experts themselves.

### Transfer Bonuses
Airlines and hotels periodically offer bonus points when you transfer from credit cards (e.g., "Transfer to Virgin Atlantic and get 30% extra points"). Tripy factors these into recommendations when they make a redemption better.

**What users experience**: "This option saves you an extra 15,000 points" — without needing to know a bonus exists.

### Sweet Spots
Certain airline programs have exceptional redemption values for specific routes—often called "sweet spots" in the points community. For example, using Partner A's miles to book Partner B's first class at a fraction of the typical cost.

**What users experience**: An unexpectedly good option appears that seems too good to be true — but it's real.

### Multi-Hop Optimization
Sometimes the best way to get from A to B isn't direct. Tripy can find routings that users wouldn't think to search—connecting through different cities or using positioning flights—when they result in significantly better value.

**What users experience**: "I didn't even think to connect through Tokyo, but it saved me $800."

### Cross-Program Arbitrage
Different loyalty programs price the same flight differently. Tripy evaluates redemption costs across all available programs and transfer paths to find the cheapest way to book.

**What users experience**: "Book this flight with United miles transferred from Chase" — the optimal path, delivered simply.

---

### Why This Matters for Product Decisions

These capabilities are Tripy's competitive advantage. When evaluating features or fixes:

- **Protect the engine**: Don't simplify in ways that reduce optimization quality
- **Hide the complexity**: Users shouldn't need to understand transfer bonuses or sweet spots to benefit from them
- **Surface the value**: When Tripy finds something special, make sure users know they're getting a great deal — even if they don't know *why*

The depth of the engine is what makes Tripy valuable. The simplicity of the experience is what makes it usable.

---

## Core User Journeys

### Journey 1: Solo Trip (Primary Use Case)

1. User logs in
2. User goes to "Plan Solo Trip"
3. User enters trip details:
   - Where they want to go
   - When they want to travel
   - How many people
   - Their budget limits
4. User connects their credit cards and enters point balances
5. User sets preferences (flight class, hotel quality, times, etc.)
6. User chooses optimization mode (minimize cash, maximize value, or balanced)
7. User clicks "Generate Itineraries"
8. **Tripy shows optimized options**, ranked by the user's criteria
9. User compares options and picks their favorite
10. User follows the booking instructions to complete their reservations

### Journey 2: Group Trip

1. Organizer creates a group trip
2. Organizer invites friends via code or link
3. Friends join and add their own points and preferences
4. Group optionally votes on destinations
5. Organizer generates optimized itineraries for the group
6. Group reviews options together
7. Tripy shows who should book what and who owes whom
8. Group members complete their bookings

### Journey 3: Quick Exploration

1. User browses their dashboard
2. User sees past trips and savings
3. User explores what's possible with their current points
4. User starts planning a new trip

---

## Key Principles for Product Decisions

When making decisions about Tripy, always consider:

### 1. Value First
Everything should help users get more value from their points. If a feature doesn't contribute to better redemptions, lower costs, or easier planning—question whether it belongs.

### 2. Simplicity Over Complexity
Travel planning is already complicated. Tripy should make it simpler, not add more steps. Hide complexity; show results.

### 3. Trust Through Transparency
Users should always understand:
- Why a particular option is recommended
- How much they're saving
- What their points are worth
- The trade-offs between options

### 4. Group Travel is a Superpower
Many travel apps ignore groups. Tripy embraces them. Any feature that makes group coordination easier is valuable.

### 5. The Booking Gap
Tripy helps users *find* and *compare* options, then provides *instructions* to book. We don't book on behalf of users (yet). The experience should be seamless even with this limitation—clear instructions, correct transfer paths, accurate pricing.

---

## What Success Looks Like

### For Users
- "I saved $500 on my trip to Japan by using Tripy"
- "I had no idea I could transfer my Chase points to Hyatt for 3x the value"
- "Planning our group trip to Mexico used to take weeks—Tripy did it in 10 minutes"
- "I finally understand what my points are actually worth"

### For the Product
- Users successfully find and book trips that maximize their point value
- Users return to plan additional trips
- Group organizers invite friends who become new users
- Users trust Tripy's recommendations

---

## Common Scenarios & How to Think About Them

### "The user can't find any good options"
- Are they being too restrictive with dates or times?
- Do they have enough points allocated?
- Are their airports too limited?
- Is the optimization mode appropriate for their goals?

### "The points calculations seem wrong"
- Are point balances entered correctly?
- Are transfer rates up to date?
- Is the comparison (cash vs. points) clear?

### "Group coordination is confusing"
- Is it clear who needs to do what?
- Is the settlement calculation easy to understand?
- Does everyone know their role in booking?

### "The booking instructions are unclear"
- Are transfer steps explained simply?
- Is timing guidance provided (some transfers take days)?
- Are there alternative paths if the primary one fails?

---

## Glossary

**Points**: Rewards earned from credit cards or loyalty programs that can be redeemed for travel

**Transfer Partner**: An airline or hotel program that accepts transferred points from a credit card (e.g., Chase → United)

**Cents Per Point (CPP)**: A measure of point value—higher is better (e.g., 2 CPP means each point is worth 2 cents)

**Out-of-Pocket (OOP)**: The actual cash a user pays after using points

**Optimization Mode**: The strategy Tripy uses to find the best results (minimize cash, maximize value, or balanced)

**Points Pool**: When group members combine their points for better redemption options

**Settlement**: The calculation of who owes money to whom in a group trip

**Points Arbitrage**: Finding redemptions where points are worth significantly more than their "default" value — the core of what Tripy does

**Transfer Bonus**: A promotional offer where transferring points to a partner gives you extra points (e.g., 30% bonus). Time-limited but can dramatically improve value.

**Sweet Spot**: An airline or hotel redemption that offers exceptional value compared to alternatives — often specific routes or cabin classes that are underpriced in a loyalty program's award chart

**Multi-Hop**: A routing that connects through intermediate cities to achieve better pricing or availability, even when a more direct option exists

---

## Summary

**Tripy helps travelers get more from their credit card points by finding optimal redemptions, comparing options transparently, and making group travel coordination simple.**

Underneath, Tripy is a points arbitrage engine that evaluates transfer bonuses, sweet spots, and multi-hop routings. But users don't need to know any of that — they just see great recommendations and clear savings.

**This document defines what users experience, not how deep the engine goes. That's intentional.**

When in doubt, ask: *"Does this help users save money, save time, or travel better with friends?"*

If yes, it belongs in Tripy.
