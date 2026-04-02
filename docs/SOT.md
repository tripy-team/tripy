# Tripy B2B Implementation Spec
## AI Loyalty Point Wealth Management System for Travel Advisors

Use this document as the source of truth for implementation. The product is **not** a generic travel CRM. It is a **loyalty portfolio management and redemption strategy workspace** for travel advisors.

The core promise is:
- help advisors manage client loyalty balances like a portfolio
- recommend the best redemption path for a client or family
- decide when to use cash vs points
- decide which traveler should redeem with which currency
- decide when to wait for a transfer bonus
- explain the recommendation clearly to the advisor and client

---

# 1. Product scope

## Primary user
Travel advisor, award booking consultant, luxury travel advisor, or concierge-style planner.

## End customer
The advisor's client or household.

## Core jobs to be done
1. Store a client's travel loyalty balances and redemption preferences
2. Understand who can use which points and what transfer rules apply
3. Generate a recommendation for a trip using cash, points, or a mix
4. Explain the recommendation in advisor-facing and client-facing language
5. Monitor for changes such as transfer bonuses or expiration risk

## Explicit non-goals for v1
- full itinerary builder
- commission tracking
- invoicing
- supplier CRM
- full travel agency operations suite
- end-to-end live booking engine

---

# 2. MVP definition

Build an MVP with the following capabilities:

1. Advisor account and workspace
2. Client and household management
3. Loyalty wallet with manual point entry
4. Program rules engine for transfer and pooling logic
5. Trip request form
6. Recommendation engine for loyalty allocation strategy
7. AI explanation generator
8. Client-ready recommendation memo
9. Alerts for transfer bonus opportunities and point expiration

---

# 3. Core product objects

## Organization
Represents a travel agency or solo advisor workspace.

Fields:
- id
- name
- slug
- plan_tier
- created_at
- updated_at

## User
Represents an advisor or admin inside an organization.

Fields:
- id
- organization_id
- first_name
- last_name
- email
- password_hash or external_auth_id
- role enum: admin, advisor, viewer
- created_at
- updated_at

## Client
Represents a customer of the travel advisor.

Fields:
- id
- organization_id
- owner_user_id
- first_name
- last_name
- email
- phone
- date_of_birth optional
- notes
- status enum: active, archived
- created_at
- updated_at

## Household
Represents a family, couple, or travel group.

Fields:
- id
- organization_id
- name
- notes
- created_at
- updated_at

## HouseholdMember
Maps clients into households.

Fields:
- id
- household_id
- client_id
- relationship_label
- can_redeem_for_household boolean
- created_at

## LoyaltyProgram
Catalog table for programs.

Fields:
- id
- code
- name
- category enum: airline, hotel, transferable_bank
- issuer optional
- supports_transfer boolean
- supports_pooling boolean
- supports_expiration boolean
- default_point_value_cents optional
- created_at
- updated_at

Examples:
- chase_ultimate_rewards
- amex_membership_rewards
- capital_one_miles
- citi_thankyou
- bilt_rewards
- united_mileageplus
- alaska_mileage_plan
- delta_skymiles
- flying_blue
- aeroplan
- hyatt
- hilton_honors
- marriott_bonvoy

## ClientLoyaltyBalance
Stores a client's balance for a program.

Fields:
- id
- client_id
- household_id optional
- loyalty_program_id
- balance
- expiration_date optional
- source enum: manual, imported, estimated
- last_verified_at optional
- notes optional
- created_at
- updated_at

## BalanceLedgerEntry
Audit trail for balance changes.

Fields:
- id
- client_loyalty_balance_id
- previous_balance
- new_balance
- change_reason
- changed_by_user_id
- created_at

## ProgramTransferRule
Represents whether one currency can transfer to another.

Fields:
- id
- from_program_id
- to_program_id
- ratio_numerator
- ratio_denominator
- minimum_transfer_amount optional
- transfer_increment optional
- estimated_transfer_time_hours optional
- is_irreversible boolean
- is_active boolean
- notes
- created_at
- updated_at

Example:
- Chase -> Aeroplan 1:1
- Amex -> Flying Blue 1:1

## ProgramPoolingRule
Represents sharing/pooling rules.

Fields:
- id
- loyalty_program_id
- pooling_scope enum: none, household_only, authorized_user_like, book_for_others, unrestricted
- notes
- created_at
- updated_at

## TransferBonus
Represents temporary transfer promotions.

Fields:
- id
- from_program_id
- to_program_id
- bonus_percent
- starts_at
- ends_at
- source_url optional
- source_label optional
- is_active boolean
- created_at
- updated_at

## ClientPreference
Travel behavior and redemption preferences.

Fields:
- id
- client_id
- preferred_cabin enum: economy, premium_economy, business, first, flexible
- prefers_nonstop boolean
- max_layover_minutes optional
- willing_to_reposition boolean
- redemption_style enum: save_points, balanced, maximize_experience
- avoid_basic_economy boolean
- preferred_airlines json
- avoided_airlines json
- notes
- created_at
- updated_at

## TripRequest
A new trip planning request for a client or household.

Fields:
- id
- organization_id
- owner_user_id
- client_id optional
- household_id optional
- title
- origin_airports json
- destination_airports json
- departure_date
- return_date optional
- traveler_count
- cabin_preference enum
- flexibility_days optional
- budget_cash optional
- notes
- status enum: draft, analyzing, complete, archived
- created_at
- updated_at

## TripTraveler
Maps specific clients onto a trip.

Fields:
- id
- trip_request_id
- client_id
- traveler_type enum: adult, child, infant, senior
- must_travel_with_client_id optional
- created_at

## RecommendationRun
Represents one engine execution for a trip request.

Fields:
- id
- trip_request_id
- created_by_user_id
- status enum: queued, running, complete, failed
- model_version optional
- engine_version
- created_at
- completed_at optional

## RecommendationOption
Each candidate strategy returned by the engine.

Fields:
- id
- recommendation_run_id
- rank
- title
- strategy_type enum: points_only, cash_only, mixed, hold_and_wait
- total_cash_cost
- total_points_used json
- estimated_total_value_cents optional
- weighted_score optional
- is_recommended boolean
- summary
- created_at

## RecommendationTravelerAllocation
Per traveler breakdown for a recommendation.

Fields:
- id
- recommendation_option_id
- trip_traveler_id
- payment_type enum: cash, points, mixed
- loyalty_program_id optional
- points_used optional
- cash_used optional
- taxes_and_fees optional
- rationale optional
- created_at

## RecommendationInsight
Specific AI or rules-based insight attached to a recommendation.

Fields:
- id
- recommendation_option_id
- insight_type enum: overexposed_program, wait_for_bonus, preserve_currency, low_value_redemption, transfer_risk, expiration_risk, convenience_tradeoff
- title
- body
- severity enum: info, warning, critical
- created_at

## RecommendationMemo
Client-facing and advisor-facing output.

Fields:
- id
- recommendation_run_id
- internal_summary
- client_summary
- email_draft
- pdf_url optional
- share_token optional
- created_at
- updated_at

## AlertSubscription
Watchers for client, household, or trip-level monitoring.

Fields:
- id
- organization_id
- client_id optional
- household_id optional
- trip_request_id optional
- alert_type enum: transfer_bonus, expiration, goal_watch
- target_program_id optional
- target_route json optional
- is_active boolean
- created_at
- updated_at

## AlertEvent
Actual triggered events.

Fields:
- id
- alert_subscription_id
- title
- body
- metadata json
- triggered_at
- is_read boolean

---

# 4. Database schema guidance

Use PostgreSQL with Prisma or Drizzle.

## Suggested enums
- user_role
- client_status
- program_category
- trip_status
- recommendation_run_status
- strategy_type
- payment_type
- insight_type
- severity
- alert_type
- redemption_style
- cabin_preference
- pooling_scope

## Suggested indexes
- client.organization_id
- client.owner_user_id
- household.organization_id
- client_loyalty_balance.client_id
- client_loyalty_balance.loyalty_program_id
- transfer_bonus.from_program_id + to_program_id + ends_at
- trip_request.organization_id
- trip_request.client_id
- trip_request.household_id
- recommendation_run.trip_request_id
- recommendation_option.recommendation_run_id
- alert_subscription.organization_id

---

# 5. Backend architecture

## Stack recommendation
- Next.js frontend
- FastAPI or Next.js API routes for backend
- PostgreSQL
- Prisma or SQLAlchemy
- OpenAI for narrative explanations
- background jobs using BullMQ, Celery, or hosted queue

## Service modules
Create these backend modules:

1. auth
2. organizations
3. users
4. clients
5. households
6. loyalty_programs
7. balances
8. transfer_rules
9. transfer_bonuses
10. trip_requests
11. recommendation_engine
12. ai_explanations
13. memos_exports
14. alerts_monitoring
15. analytics_audit

---

# 6. Backend API routes

Use REST for simplicity.

## Auth and workspace
- POST /auth/signup
- POST /auth/login
- POST /auth/logout
- GET /me
- GET /organization
- PATCH /organization

## Clients
- GET /clients
- POST /clients
- GET /clients/:id
- PATCH /clients/:id
- DELETE /clients/:id

## Households
- GET /households
- POST /households
- GET /households/:id
- PATCH /households/:id
- POST /households/:id/members
- DELETE /households/:id/members/:memberId

## Preferences
- GET /clients/:id/preferences
- PUT /clients/:id/preferences

## Loyalty programs and rules
- GET /loyalty-programs
- GET /transfer-rules
- GET /pooling-rules
- GET /transfer-bonuses
- POST /admin/transfer-bonuses
- PATCH /admin/transfer-bonuses/:id

## Client balances
- GET /clients/:id/balances
- POST /clients/:id/balances
- PATCH /clients/:id/balances/:balanceId
- DELETE /clients/:id/balances/:balanceId
- GET /clients/:id/balance-ledger

## Household portfolio summary
- GET /households/:id/portfolio-summary

This endpoint should return:
- total balances by program
- estimated portfolio value
- point concentration by program
- expiring balances
- underutilized programs

## Trip requests
- GET /trip-requests
- POST /trip-requests
- GET /trip-requests/:id
- PATCH /trip-requests/:id
- POST /trip-requests/:id/travelers
- DELETE /trip-requests/:id/travelers/:travelerId

## Recommendation engine
- POST /trip-requests/:id/analyze
- GET /recommendation-runs/:id
- GET /recommendation-runs/:id/options
- GET /recommendation-options/:id
- POST /recommendation-options/:id/select

## AI narrative endpoints
- POST /recommendation-runs/:id/generate-memo
- GET /recommendation-runs/:id/memo

## Alerts and monitoring
- GET /alerts
- GET /alert-subscriptions
- POST /alert-subscriptions
- PATCH /alert-subscriptions/:id
- DELETE /alert-subscriptions/:id

## Exports and sharing
- POST /recommendation-runs/:id/export-pdf
- POST /recommendation-runs/:id/share
- GET /shared/recommendations/:shareToken

---

# 7. Recommendation engine design

Do not overbuild the engine in v1. Start rules-first, then layer AI explanations on top.

## Engine inputs
- trip details
- traveler list
- client preferences
- client and household balances
- transfer rules
- pooling rules
- live transfer bonuses
- advisor notes

## Engine outputs
Generate 3-5 candidate strategies:
1. minimize cash
2. preserve flexible currencies
3. maximize premium redemption value
4. balanced strategy
5. wait strategy if timing suggests not to redeem now

## Core engine responsibilities
1. Determine which balances are usable for each traveler
2. Determine which bank currencies can transfer into which travel programs
3. Apply live transfer bonus math
4. Estimate strategic value of each currency
5. Recommend traveler-level allocation
6. Flag risky or low-value paths
7. Produce a ranked set of strategies

## Simple v1 scoring model
Each recommendation option gets a score based on:
- lower cash cost is better
- lower strategic depletion of highly flexible currencies is better
- better estimated cents per point is better
- fewer irreversible transfers is better
- fewer convenience penalties is better

Example pseudocode:

score = (
  cash_savings_weight * normalized_cash_savings
  + cpp_weight * normalized_cpp
  - flexibility_penalty_weight * flexible_currency_spend_penalty
  - transfer_risk_weight * transfer_risk
  - inconvenience_weight * inconvenience_penalty
)

## Important v1 insight rules
Create rules for these insights:
- client is overexposed to a low-value program
- client is underusing a high-value program
- current transfer bonus makes an option more attractive
- preserve a highly flexible bank currency for future use
- points value is too poor and cash is smarter
- partial family redemption is optimal
- taxes and fees make the award less compelling

---

# 8. AI explanation layer

AI should explain, not replace, the rules engine.

## AI tasks
1. Summarize why the top strategy was chosen
2. Explain why alternative strategies ranked lower
3. Convert technical logic into advisor language
4. Convert advisor language into client-friendly language
5. Generate a copyable email draft

## Prompt design guidance
Pass structured inputs into the model:
- top recommendation option
- alternative options
- traveler allocations
- insights
- preferences
- trip details

Generate these outputs:
- internal_summary
- client_summary
- email_draft
- short_talking_points

---

# 9. Frontend app structure

## Main pages

### Auth
- /login
- /signup

### Dashboard
- /dashboard

Show:
- total clients
- households
- expiring points soon
- live transfer bonuses relevant to stored balances
- active trip analyses
- recent alerts

### Clients
- /clients
- /clients/new
- /clients/:id

### Client profile tabs
- overview
- balances
- preferences
- households
- trips
- recommendations
- alerts
- notes

### Households
- /households
- /households/new
- /households/:id

Household page should show:
- members
- total loyalty assets
- exposure by program
- active trips
- advisor notes

### Trip requests
- /trip-requests
- /trip-requests/new
- /trip-requests/:id

Trip page should show:
- trip inputs
- travelers
- analysis status
- recommendation runs

### Recommendation results
- /recommendation-runs/:id

This is the most important page.

Sections:
1. Header summary
2. Top recommendation card
3. Side-by-side alternative strategies
4. Traveler allocation table
5. Portfolio insights
6. Why this won
7. Why not the others
8. Client memo preview
9. Export / share actions

### Alerts
- /alerts
- /monitoring

### Settings
- /settings
- /settings/billing
- /settings/team

---

# 10. UI component list

Build reusable components:

## General
- AppShell
- Sidebar
- TopNav
- EmptyState
- LoadingState
- ErrorState
- SectionHeader
- StatCard

## Client components
- ClientCard
- ClientProfileHeader
- PreferenceBadgeList
- NotesPanel

## Loyalty components
- LoyaltyBalanceTable
- AddBalanceModal
- ProgramBadge
- BalanceHistoryDrawer
- PortfolioExposureChart
- ExpirationWarningCard
- TransferBonusBanner

## Trip components
- TripRequestForm
- TravelerSelector
- CabinPreferenceSelector
- BudgetInput
- FlexibilitySelector

## Recommendation components
- RecommendationCard
- StrategyComparisonTable
- TravelerAllocationTable
- InsightBadge
- InsightPanel
- ExplanationPanel
- ClientMemoPreview
- ShareRecommendationModal
- ExportPdfButton

## Alerts components
- AlertFeed
- WatchlistCard
- ExpirationAlertCard
- TransferBonusAlertCard

---

# 11. Portfolio and analytics logic

Even in v1, include basic portfolio analytics because this is core to the positioning.

## Household portfolio summary calculations
Return:
- total points by program
- estimated USD-equivalent value using default point valuations
- concentration percentage by program
- points expiring in 30, 60, 90 days
- flexible currency percentage vs locked airline or hotel currencies

## Suggested heuristic insights
- If over 40 percent of estimated value is in one low-flexibility program, create concentration warning
- If points expire within 60 days, create expiration warning
- If client has large bank currency balance but keeps using poor fixed-value paths, create underutilization insight
- If a live transfer bonus exists for a compatible route or program, create opportunity insight

---

# 12. Background jobs

Use jobs for:
- recalculating household portfolio summaries
- refreshing transfer bonus feeds
- generating recommendation memos
- sending alerts
- scanning expiring balances daily

Suggested jobs:
- nightly_transfer_bonus_sync
- daily_expiration_scan
- recommendation_memo_generation
- alert_dispatch

---

# 13. Seed data required

Seed these tables on day one:

## Loyalty programs
Populate a curated set of 15-20 major programs.

## Transfer rules
Seed major bank-to-airline and bank-to-hotel rules.

## Pooling rules
Seed human-readable pooling policies.

## Point valuation defaults
Add a lookup for estimated cents-per-point baselines.

Examples:
- Chase Ultimate Rewards: 1.7
- Amex Membership Rewards: 1.6
- Alaska Mileage Plan: 1.5
- Hyatt: 1.9
- Hilton: 0.5
- Marriott: 0.7

These do not need to be perfect. They are for portfolio heuristics and explanation support.

---

# 14. Permissions model

## Admin
- manage workspace
- manage team
- manage all clients
- manage transfer bonus records

## Advisor
- manage own clients
- create analyses
- view organization-wide program data

## Viewer
- read-only access to assigned clients and recommendation outputs

---

# 15. Suggested implementation order

## Phase 1: foundation
1. auth and organizations
2. users and roles
3. clients
4. households
5. loyalty programs seed
6. client balances and ledger
7. preferences

## Phase 2: trip workflow
8. trip requests
9. traveler mapping
10. recommendation engine with rules-based ranking
11. recommendation results page

## Phase 3: AI and outputs
12. AI explanation generator
13. client-facing memo
14. email draft generation
15. PDF export and share page

## Phase 4: monitoring
16. transfer bonus records
17. alert subscriptions
18. expiration alerts
19. transfer opportunity alerts

---

# 16. What success looks like

A travel advisor should be able to:
1. create a client and household
2. enter loyalty balances for each traveler
3. submit a trip request
4. receive a ranked recommendation with mixed cash and points allocation
5. understand why the recommendation won
6. send a clean client-ready explanation in minutes

If that loop works, the MVP is successful.

---

# 17. Copy-paste Cursor build prompt

Use this prompt in Cursor:

Build a B2B SaaS web application called Tripy for travel advisors. The product is an AI loyalty point wealth management system for advisors who manage client points and recommend how to book trips using cash, points, or a mix.

Tech stack:
- Next.js with TypeScript
- PostgreSQL
- Prisma
- REST API routes
- Tailwind UI
- OpenAI for explanation generation

Core requirements:
1. Multi-tenant organization support
2. User roles: admin, advisor, viewer
3. Client management
4. Household management
5. Loyalty wallet per client with manual entry and ledger history
6. Loyalty program catalog with airline, hotel, and bank currencies
7. Transfer rules and pooling rules
8. Transfer bonus model
9. Client travel preferences
10. Trip request workflow
11. Recommendation engine that outputs 3-5 ranked strategies for how a client or family should pay with cash, points, or both
12. Per-traveler allocation support, including passenger A on points and passenger B on cash
13. Recommendation insights such as preserve Chase, wait for a transfer bonus, low-value Hilton redemption, overexposed to a program, and expiration risk
14. AI-generated internal summary, client summary, and email draft based on structured recommendation data
15. Dashboard, clients list, client detail page, households page, trip request page, recommendation results page, alerts page, and settings page
16. Alerts for transfer bonuses and expiring balances

Implement the database schema, API routes, seed scripts, and UI pages. Use clean component boundaries and production-style TypeScript types. Start with manual data entry, not live scraping. Use rules-based strategy scoring first, then layer LLM explanations on top. Make the recommendation results page the centerpiece of the app.

---

# 18. Final product positioning

Tripy is not a generic advisor CRM.

Tripy is a loyalty portfolio management and redemption strategy platform for travel advisors. It helps advisors track client loyalty assets, analyze redemption options, and deliver high-quality booking guidance with clear explanations.

