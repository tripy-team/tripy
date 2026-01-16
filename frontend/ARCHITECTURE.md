# Tripy Frontend Architecture

## Overview

Simple, straightforward Next.js application with minimal abstractions. Built with Next.js 15, React 19, and TypeScript.

## Technology Stack

- **Framework**: Next.js 15.3.5 (App Router)
- **React**: 19.0.0
- **TypeScript**: 5.9.2
- **Styling**: Tailwind CSS 4.1.11
- **UI**: React Aria Components, Lucide Icons
- **Maps**: Leaflet & React Leaflet

## Directory Structure

```
src/
├── app/                    # Next.js pages (App Router)
│   ├── (app)/             # Authenticated app routes
│   ├── (auth)/            # Auth pages (login, register)
│   ├── (legal)/           # Terms, privacy
│   ├── about/             # About page
│   ├── contact/           # Contact page
│   └── api/               # API routes
│
├── components/            # All components (flat structure)
│   ├── navigation.tsx
│   ├── top-bar.tsx
│   ├── trip-card.tsx
│   ├── explore-map.tsx
│   ├── route-map.tsx
│   ├── error-boundary.tsx
│   └── ...
│
├── lib/                   # Utilities
│   ├── api.ts            # API client (all endpoints)
│   └── utils.ts          # Helper functions
│
└── types.ts              # All TypeScript types
```

## Design Principles

1. **Flat is better than nested** - All components in one directory
2. **Consolidate similar code** - One file for API, one for utils, one for types
3. **Co-locate when possible** - Keep related code together
4. **Avoid premature abstraction** - Add complexity only when needed

## Key Files

### `/src/lib/api.ts`
All API calls in one place. Simple fetch wrapper with auth token handling.

```typescript
import { auth, trips, destinations } from '@/lib/api';

// Login
await auth.login(email, password);

// Create trip
await trips.create(title, start_date, end_date);

// Add destination
await destinations.add(trip_id, city_name);
```

### `/src/lib/utils.ts`
Common helper functions for validation and formatting.

```typescript
import { validateEmail, formatCurrency, formatPoints } from '@/lib/utils';
```

### `/src/types.ts`
All TypeScript interfaces and types.

```typescript
import { Trip, Itinerary, User, Destination } from '@/types';
```

### `/src/components/error-boundary.tsx`
React error boundary for graceful error handling.

## State Management

**No global state management needed.**

Each page manages its own state with React's useState/useEffect. This is simpler and more straightforward than adding Context API or state libraries.

Example:
```typescript
const [trips, setTrips] = useState<Trip[]>([]);
const [loading, setLoading] = useState(true);

useEffect(() => {
  // Fetch data and update state
}, []);
```

## Data Fetching Pattern

Simple, predictable pattern used throughout the app:

```typescript
'use client';

import { useState, useEffect } from 'react';
import { trips } from '@/lib/api';
import { Trip } from '@/types';

export default function Page() {
  const [data, setData] = useState<Trip[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function fetchData() {
      try {
        const result = await trips.list();
        setData(result);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
  }, []);

  if (loading) return <div>Loading...</div>;
  if (error) return <div>Error: {error}</div>;

  return <div>{/* render data */}</div>;
}
```

## Backend Integration

### API Configuration

Set the backend URL in `.env.local`:
```env
NEXT_PUBLIC_API_URL=https://api.tripy.com
```

### Available Endpoints

See `/src/lib/api.ts` for all available endpoints:

- **auth**: login, register, logout
- **trips**: create, get, invite, join, members
- **destinations**: add, list, vote
- **points**: upsert, summary
- **itineraries**: generate, get
- **users**: me, updateProfile

### Adding New Endpoints

Just add a new method to the appropriate object in `/src/lib/api.ts`:

```typescript
// Add to existing object
export const trips = {
  // ... existing methods

  delete: (trip_id: string) =>
    request('/trips/delete', {
      method: 'POST',
      body: JSON.stringify({ trip_id }),
    }),
};
```

## Adding New Features

### 1. Add Types (if needed)

```typescript
// src/types.ts
export interface Booking {
  id: string;
  tripId: string;
  status: 'pending' | 'confirmed';
}
```

### 2. Add API Methods (if needed)

```typescript
// src/lib/api.ts
export const bookings = {
  create: (trip_id: string, details: any) =>
    request('/bookings', {
      method: 'POST',
      body: JSON.stringify({ trip_id, ...details }),
    }),
};
```

### 3. Create Component (if reusable)

```typescript
// src/components/booking-card.tsx
export function BookingCard({ booking }: { booking: Booking }) {
  return <div>{/* component code */}</div>;
}
```

### 4. Create Page

```typescript
// src/app/(app)/bookings/page.tsx
import { BookingCard } from '@/components/booking-card';

export default function BookingsPage() {
  // page code
}
```

## File Organization Rules

1. **Components**: All go in `/src/components` (flat, no subdirectories)
2. **Pages**: Organized by route in `/src/app`
3. **Types**: All in `/src/types.ts`
4. **API**: All in `/src/lib/api.ts`
5. **Utils**: All in `/src/lib/utils.ts`

## When to Add Complexity

Only add abstractions when you have clear duplication:

- **3+ pages doing the same thing** → Consider extracting a hook
- **API file getting huge (500+ lines)** → Consider splitting by domain
- **Types file getting huge (500+ lines)** → Consider splitting by domain
- **Need truly global state** → Add Context (but try URL state first)

## Common Patterns

### Authentication Check

```typescript
'use client';

import { useEffect, useState } from 'react';
import { users } from '@/lib/api';

export default function Page() {
  const [user, setUser] = useState(null);

  useEffect(() => {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      window.location.href = '/login';
      return;
    }

    users.me().then(setUser).catch(() => {
      window.location.href = '/login';
    });
  }, []);

  if (!user) return <div>Loading...</div>;

  return <div>Welcome {user.name}</div>;
}
```

### Form Handling

```typescript
const [email, setEmail] = useState('');
const [password, setPassword] = useState('');
const [error, setError] = useState('');

async function handleSubmit(e: React.FormEvent) {
  e.preventDefault();

  try {
    const result = await auth.login(email, password);
    localStorage.setItem('auth_token', result.token);
    window.location.href = '/dashboard';
  } catch (err) {
    setError(err.message);
  }
}
```

### List/Detail Pattern

```typescript
const [items, setItems] = useState<Trip[]>([]);
const [selectedId, setSelectedId] = useState<string | null>(null);

const selectedItem = items.find(item => item.id === selectedId);
```

## Styling

Use Tailwind CSS utility classes directly in JSX:

```typescript
<div className="p-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700">
  Click me
</div>
```

For complex responsive layouts:
```typescript
<div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
```

## Development Workflow

```bash
# Start dev server
npm run dev

# Build for production
npm run build

# Run linter
npm run lint
```

## Deployment Checklist

- [ ] Set `NEXT_PUBLIC_API_URL` environment variable
- [ ] Test API connectivity
- [ ] Verify auth flow works
- [ ] Check error boundaries catch errors
- [ ] Test on mobile devices
- [ ] Run `npm run build` successfully

## Troubleshooting

### Import errors
- Check that file exists in `/src/components`, `/src/lib`, or `/src/types.ts`
- Use `@/` prefix for absolute imports

### API errors
- Check `NEXT_PUBLIC_API_URL` is set
- Verify auth token is saved in localStorage
- Check network tab in browser dev tools

### Type errors
- All types should be imported from `/src/types.ts`
- Run `npx tsc --noEmit` to check for type errors

## Summary

This is a simple, pragmatic Next.js application without over-engineering. Everything is in the expected place:

- **Pages** → `/src/app`
- **Components** → `/src/components`
- **API client** → `/src/lib/api.ts`
- **Helpers** → `/src/lib/utils.ts`
- **Types** → `/src/types.ts`

No hidden magic, no complex abstractions. Just straightforward React code that's easy to understand and maintain.
