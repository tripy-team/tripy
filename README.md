# Tripy Onboarding Guide

Welcome to Tripy! This guide will help you understand the project structure, locate key files, and understand our ultimate goal.

## 🎯 Ultimate Goal

**Tripy is an AI-powered travel planning platform that helps users maximize their credit card points and loyalty program rewards to plan affordable, optimized trips.**

### Core Value Proposition
- **Spend Less, Travel Smarter**: Users can leverage their existing credit card points to get 3-10x more value than cash
- **AI-Powered Optimization**: Automatically calculates the best redemption value across all loyalty programs
- **Collaborative Planning**: Groups can vote on destinations, split costs, and plan trips together
- **Smart Route Planning**: Optimizes multi-city itineraries with start/end destinations and intermediate stops

### Key Features
1. **Points Management**: Users can add and track multiple credit card and loyalty program points
2. **Trip Planning**: Solo and group trip planning with destination voting
3. **Itinerary Generation**: AI-generated optimized routes considering points, budget, and preferences
4. **Cost Optimization**: Finds the best combination of cash and points to minimize total cost
5. **Group Collaboration**: Real-time voting, cost splitting, and itinerary comparison

---

## 📁 Project Structure

```
tripy/
├── frontend/          # Next.js React frontend application
├── backend/           # FastAPI Python backend service
├── infra/             # AWS CDK infrastructure as code
├── scripts/           # Utility scripts (image curation, etc.)
└── README.md          # Root README
```

---

## 🎨 Frontend (`/frontend`)

**Technology Stack**: Next.js 15, React 19, TypeScript, Tailwind CSS

### Key Directories

#### `/frontend/src/app/` - Next.js App Router Pages
```
app/
├── (app)/              # Authenticated routes (protected by layout)
│   ├── dashboard/      # Main dashboard showing all trips
│   ├── my-trips/       # User's trip list
│   ├── points-setup/   # Add/manage credit card points
│   ├── solo/           # Solo trip planning
│   │   ├── setup/      # Configure solo trip (destinations, dates, budget)
│   │   ├── results/    # View generated itineraries
│   │   └── comparison/ # Compare multiple itineraries
│   └── group/          # Group trip planning
│       ├── setup/      # Configure group trip
│       ├── join/       # Join trip via invite code
│       ├── voting/     # Vote on destinations
│       ├── results/    # View group itineraries
│       ├── points-strategy/ # Optimize points allocation
│       └── comparison/ # Compare group itineraries
├── (auth)/             # Authentication routes
│   ├── login/          # User login
│   ├── register/       # User registration
│   └── forgot-password/# Password reset
├── about/              # About/explanation page
└── page.tsx            # Landing page
```

#### `/frontend/src/components/` - Reusable React Components
- **`navigation.tsx`** - Main navigation bar
- **`trip-card.tsx`** - Trip display card component
- **`city-autocomplete.tsx`** - City search with fuzzy matching
- **`date-range-picker.tsx`** - Date range selection component
- **`trip-chatbot-inline.tsx`** - AI chatbot for trip planning
- **`ui/`** - UI primitives (dropdown-menu, navigation-menu)

#### `/frontend/src/lib/` - Core Libraries
- **`api.ts`** - **CRITICAL**: All API client functions and endpoints
  - `auth.*` - Authentication (login, register, refresh, forgot password)
  - `trips.*` - Trip CRUD operations
  - `destinations.*` - Destination management
  - `itineraries.*` - Itinerary generation and retrieval
  - `points.*` - Points management
  - `users.*` - User profile management
  - `cities.*` - City search API
- **`trip-extractor.ts`** - NLP extraction from natural language (chatbot)
- **`image-utils.ts`** - Image optimization and CDN utilities
- **`utils.ts`** - Helper functions

#### `/frontend/src/types.ts` - TypeScript Type Definitions
All shared TypeScript interfaces and types.

---

## ⚙️ Backend (`/backend`)

**Technology Stack**: FastAPI (Python), AWS Lambda, DynamoDB, Cognito

### Key Directories

#### `/backend/src/app.py` - **MAIN ENTRY POINT**
FastAPI application with all API endpoints:
- Authentication endpoints (`/auth/*`)
- Trip endpoints (`/trips/*`)
- Destination endpoints (`/destinations/*`)
- Itinerary endpoints (`/itineraries/*`)
- Points endpoints (`/points/*`)
- User profile endpoints (`/users/*`)
- City search endpoints (`/cities/*`)
- Image endpoints (`/images/*`)

#### `/backend/src/services/` - Business Logic Layer
- **`trip_service.py`** - Trip creation, retrieval, listing
- **`destination_service.py`** - Destination management and voting
- **`itinerary_service.py`** - Itinerary generation and optimization
- **`points_service.py`** - Points aggregation and management
- **`user_service.py`** - User profile management
- **`auth_service.py`** - Authentication with AWS Cognito
- **`city_service.py`** - City search using Amadeus API
- **`image_service.py`** - City image management (S3/CloudFront)
- **`route_service.py`** - Route generation algorithms

#### `/backend/src/repos/` - Data Access Layer (DynamoDB)
- **`trip_repo.py`** - Trip data persistence
- **`destination_repo.py`** - Destination data
- **`itinerary_repo.py`** - Itinerary storage
- **`points_repo.py`** - Points data
- **`user_repo.py`** - User profiles
- **`city_image_repo.py`** - City image metadata

#### `/backend/src/handlers/` - Legacy Lambda Handlers
Contains original Lambda handler functions (some may be deprecated):
- **`flights.py`** - Flight search and pricing
- **`planTrip.py`** - Trip planning algorithms
- **`flightGraph.py`** - Flight graph optimization
- **`ilp_adapter.py`** - Integer Linear Programming adapter

#### `/backend/src/utils/` - Utilities
- **`jwt_auth.py`** - JWT token verification (Cognito)
- **`analytics.py`** - Analytics tracking (Kinesis Firehose)
- **`errors.py`** - Error handling utilities

#### `/backend/src/models.py` - Pydantic Models
Request/response validation models for all API endpoints.

---

## ☁️ Infrastructure (`/infra`)

**Technology Stack**: AWS CDK (TypeScript)

### Key Files
- **`lib/apiStackLambda.ts`** - Lambda function stack (API Gateway + Lambda)
- **`lib/dbStack.ts`** - DynamoDB tables
- **`bin/app-lambda.ts`** - CDK app entry point for Lambda deployment

### AWS Services Used
- **Lambda** - Serverless API functions
- **API Gateway** - HTTP API endpoints
- **DynamoDB** - NoSQL database (trips, users, destinations, etc.)
- **Cognito** - User authentication
- **S3** - City image storage
- **CloudFront** - CDN for images
- **Kinesis Firehose** - Analytics data streaming

---

## 🚀 Getting Started

### Prerequisites
- Node.js 18+ and npm
- Python 3.9+
- AWS CLI configured
- AWS account with appropriate permissions

### Frontend Setup
```bash
cd frontend
npm install
cp env.example .env.local
# Edit .env.local with your backend URL
npm run dev
```

### Backend Setup
```bash
cd backend
python -m venv venv
source venv/bin/activate  # On Windows: venv\Scripts\activate
pip install -r requirements.txt
cp env.example .env
# Edit .env with AWS credentials and Cognito details
python -m uvicorn src.app:app --reload
```

### Environment Variables

**Frontend** (`.env.local`):
```env
NEXT_PUBLIC_BACKEND_URL=http://localhost:8000
NEXT_PUBLIC_CDN_DOMAIN=your-cloudfront-domain.cloudfront.net
```

**Backend** (`.env`):
```env
USER_POOL_ID=us-east-1_xxxxx
USER_POOL_CLIENT_ID=xxxxx
AWS_REGION=us-east-1
DYNAMODB_TRIPS_TABLE=tripy-trips
DYNAMODB_DESTINATIONS_TABLE=tripy-destinations
# ... see backend/env.example for full list
```

---

## 🔑 Key Concepts

### Authentication Flow
1. User registers/logs in via Cognito
2. Frontend receives JWT tokens (access_token, id_token, refresh_token)
3. Tokens stored in sessionStorage
4. API requests include `Authorization: Bearer <token>` header
5. Backend verifies JWT using Cognito public keys

### Trip Planning Flow
1. **Setup**: User enters destinations, dates, budget, credit cards
2. **Destination Voting** (group trips): Members vote on destinations
3. **Itinerary Generation**: Backend generates optimized routes
4. **Points Optimization**: Allocates points across travelers (group trips)
5. **Comparison**: User compares multiple itinerary options
6. **Selection**: User picks preferred itinerary

### Data Flow
```
Frontend (React) 
  → API Client (api.ts)
    → Backend (FastAPI)
      → Service Layer (business logic)
        → Repository Layer (DynamoDB)
          → DynamoDB Tables
```

---

## 📝 Important Files to Know

### Frontend
- **`frontend/src/lib/api.ts`** - All API communication
- **`frontend/src/app/(app)/solo/setup/page.tsx`** - Solo trip setup (main planning UI)
- **`frontend/src/app/(app)/group/setup/page.tsx`** - Group trip setup
- **`frontend/src/components/trip-chatbot-inline.tsx`** - AI chatbot component
- **`frontend/src/lib/trip-extractor.ts`** - Natural language processing

### Backend
- **`backend/src/app.py`** - All API endpoints (start here)
- **`backend/src/services/trip_service.py`** - Core trip logic
- **`backend/src/services/itinerary_service.py`** - Itinerary generation
- **`backend/src/utils/jwt_auth.py`** - Authentication middleware
- **`backend/src/models.py`** - API request/response models

---

## 🛠️ Development Workflow

### Making API Changes
1. Update `backend/src/models.py` if adding new request/response fields
2. Add endpoint in `backend/src/app.py`
3. Implement business logic in `backend/src/services/`
4. Add API client function in `frontend/src/lib/api.ts`
5. Use in frontend components

### Adding a New Page
1. Create page in `frontend/src/app/(app)/your-page/page.tsx`
2. Add route to navigation if needed (`frontend/src/components/navigation.tsx`)
3. Use API client from `frontend/src/lib/api.ts`

### Adding a New Component
1. Create in `frontend/src/components/your-component.tsx`
2. Export and use in pages
3. Follow existing component patterns (use Tailwind CSS)

---

## 🎨 Design System

- **Primary Color**: Blue (`blue-600`, `#2563eb`)
- **Secondary**: Slate grays for text and borders
- **Accent**: Yellow (`yellow-400`) for highlights
- **Components**: Rounded corners (`rounded-xl`, `rounded-2xl`)
- **Spacing**: Consistent padding (`p-8`, `gap-4`, etc.)

---

## 📊 Database Schema (DynamoDB)

### Tables
- **`tripy-trips`** - Trip metadata (title, dates, creator, status)
- **`tripy-destinations`** - Destinations for each trip
- **`tripy-itineraries`** - Generated itineraries
- **`tripy-points`** - Points balances per trip/user
- **`tripy-trip-members`** - Group trip membership
- **`tripy-users`** - User profiles (budget, credit cards)
- **`tripy-city-images`** - City image metadata (S3 keys)

---

## 🧪 Testing

### Frontend E2E Tests
```bash
cd frontend
npm run test:e2e  # Playwright tests
```

### Backend Testing
```bash
cd backend
pytest  # If tests are set up
```

---

## 🚢 Deployment

### Frontend
- Deployed via AWS Amplify
- Build command: `npm run build`
- Environment variables set in Amplify console

### Backend
- Deployed as Lambda functions via CDK
- Or via App Runner (legacy, see `backend/apprunner.yaml`)
- Environment variables in Lambda configuration

### Infrastructure
```bash
cd infra
npm install
cdk bootstrap
cdk deploy
```

---

## 📚 Additional Resources

- **Frontend README**: `frontend/README.md`
- **About Page**: Visit `/about` in the app for user-facing explanation
- **API Documentation**: FastAPI auto-docs at `/docs` when backend is running

---

## 🎯 Current Priorities

1. **User Experience**: Streamlined trip planning with AI chatbot
2. **Points Optimization**: Maximize redemption value across programs
3. **Group Collaboration**: Smooth voting and cost-splitting
4. **Performance**: Fast image loading, responsive UI
5. **Scalability**: Serverless architecture for cost efficiency

---

## 💡 Tips for New Developers

1. **Start with the API**: Understand `frontend/src/lib/api.ts` and `backend/src/app.py`
2. **Follow the Data Flow**: Frontend → API Client → Backend → Service → Repository → DB
3. **Check Existing Patterns**: Look at similar features before creating new ones
4. **Use TypeScript Types**: Check `frontend/src/types.ts` for available types
5. **Test Locally**: Always test API changes locally before deploying

---

## ❓ Questions?

- Check existing code for patterns
- Review API endpoints in `backend/src/app.py`
- Look at similar components/pages for reference
- Check the about page (`/about`) for user-facing feature explanations

---

**Welcome to Tripy! Happy coding! 🚀**
