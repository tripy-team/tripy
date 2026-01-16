# Tripy Frontend

AI-powered flight & hotel recommendations using credit-card points.

## Quick Start

```bash
npm install
npm run dev
# Open http://localhost:3000
```

## Project Structure

```
src/
├── app/           # Next.js pages
├── components/    # All React components (flat)
├── lib/
│   ├── api.ts    # API client (all endpoints)
│   └── utils.ts  # Helper functions
└── types.ts      # TypeScript types
```

## Key Files

- **`/src/lib/api.ts`** - All API endpoints
- **`/src/lib/utils.ts`** - Validation & formatting helpers
- **`/src/types.ts`** - All TypeScript types
- **`/src/components/`** - All components (no nesting)

## Usage

### API Calls

```typescript
import { auth, trips, destinations } from '@/lib/api';

// Login
await auth.login(email, password);

// Create trip
await trips.create(title, start_date, end_date);

// Add destination
await destinations.add(trip_id, city_name);
```

### Types

```typescript
import { Trip, Itinerary, User } from '@/types';
```

### Utils

```typescript
import { validateEmail, formatCurrency, formatPoints } from '@/lib/utils';
```

## Adding Features

1. Add types to `/src/types.ts`
2. Add API methods to `/src/lib/api.ts`
3. Create component in `/src/components/`
4. Create page in `/src/app/`

See [ARCHITECTURE.md](./ARCHITECTURE.md) for detailed examples.

## Environment Variables

```env
NEXT_PUBLIC_API_URL=https://api.tripy.com
```

## Tech Stack

- Next.js 15.3.5 (App Router)
- React 19.0.0
- TypeScript 5.9.2
- Tailwind CSS 4.1.11
- React Aria Components
- Leaflet & React Leaflet

## Scripts

```bash
npm run dev      # Development server
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Lint code
```

## Documentation

- **[ARCHITECTURE.md](./ARCHITECTURE.md)** - Architecture & patterns
- **[BACKEND_INTEGRATION_TODOS.md](./BACKEND_INTEGRATION_TODOS.md)** - Backend integration checklist

## Design Philosophy

**Simple and straightforward.**

- Flat component structure
- One file for API, utils, types
- No over-abstraction
- Easy to understand and modify

See [ARCHITECTURE.md](./ARCHITECTURE.md) for details.
