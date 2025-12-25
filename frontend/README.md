# Tripy Frontend

AI-powered travel planning application that helps you maximize credit card points for flights and hotels.

## Tech Stack

- **Framework**: Next.js 15 (App Router)
- **Language**: TypeScript
- **Styling**: Tailwind CSS v4
- **UI Components**: React Aria Components, Lucide Icons
- **Maps**: Leaflet + React-Leaflet (OpenStreetMap)
- **Build**: Turbopack (dev), Next.js (production)

## Getting Started

### Prerequisites

- Node.js 18+
- npm, yarn, pnpm, or bun

### Installation

```bash
# Install dependencies
npm install

# Copy environment variables (if needed)
cp .env.example .env.local

# Start development server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Project Structure

```
src/
├── app/                    # Next.js App Router
│   ├── (app)/              # Main app layout (with navigation)
│   │   ├── dashboard/      # User dashboard
│   │   ├── explore/        # Explore destinations map
│   │   ├── solo/           # Solo trip planning flow
│   │   │   ├── setup/      # Configure trip
│   │   │   ├── results/    # View itineraries
│   │   │   └── comparison/ # Compare itineraries
│   │   └── group/          # Group trip planning flow
│   │       ├── setup/      # Create group trip
│   │       ├── dashboard/  # Admin dashboard
│   │       ├── join/       # Member join page
│   │       ├── voting/     # Vote on itineraries
│   │       ├── results/    # View results
│   │       ├── comparison/ # Compare options
│   │       ├── winner/     # Winning itinerary
│   │       └── points-strategy/ # Points allocation
│   ├── api/                # API routes
│   ├── globals.css         # Global styles + Tailwind
│   └── layout.tsx          # Root layout
└── components/             # Reusable components
    ├── Navigation.tsx      # Sidebar navigation
    ├── TopBar.tsx          # Top bar with user info
    ├── TripCard.tsx        # Trip display card
    ├── ExploreMap.tsx      # Interactive world map
    ├── RouteMap.tsx        # Trip route visualization
    └── ...                 # Other UI components
```

## Key Features

- **Solo Trip Planning**: Configure budget, dates, destinations and get AI-optimized itineraries
- **Group Trip Planning**: Collaborative planning with voting and points pooling
- **Interactive Map**: Explore 15+ destinations with real-time filtering
- **Points Optimization**: Maximize credit card points for travel rewards

## Available Scripts

```bash
npm run dev      # Start dev server (Turbopack)
npm run build    # Build for production
npm run start    # Start production server
npm run lint     # Run ESLint
```

## Environment Variables

See `.env.example` for required environment variables.

## Contributing

1. Create a feature branch from `main`
2. Make your changes
3. Run `npm run lint` and `npm run build` to verify
4. Submit a pull request

## Architecture Notes

- **Route Groups**: `(app)` provides shared navigation layout
- **Client Components**: Pages with interactivity use `'use client'`
- **Image Handling**: External images use `<img>` with eslint-disable (Unsplash URLs)
- **Map SSR**: Leaflet is dynamically imported to avoid SSR issues
