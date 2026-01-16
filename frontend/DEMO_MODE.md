# Demo Mode

## Overview

Since authentication isn't hooked up to the backend yet, we've implemented a simple **Demo Mode** that allows users to explore the dashboard without signing up.

This is a common pattern used by B2B SaaS companies (like Figma, Linear, Notion) to reduce friction for first-time visitors.

## How It Works

### User Flow

```
Landing Page
    ↓
Click "Try Demo" button
    ↓
Sets demo token in localStorage
    ↓
Redirects to /dashboard
    ↓
Full access to all features
```

### Implementation

**Landing Page** (`/src/app/page.tsx`):
- Primary CTA is now "Try Demo" instead of "Get Started"
- Clicking sets a demo token and redirects to dashboard
- No signup required

**Demo Token**:
```typescript
localStorage.setItem('auth_token', 'demo-token');
localStorage.setItem('user', JSON.stringify({
    name: 'Demo User',
    email: 'demo@tripy.com'
}));
```

**Demo Indicator** (`/src/components/top-bar.tsx`):
- Small "Demo" badge appears next to logo when in demo mode
- Subtle yellow badge that doesn't interfere with UX

## Benefits

### For Users
- **Zero friction** - No signup required to try the product
- **Full features** - Can explore everything without commitment
- **Clear indication** - Demo badge shows they're in demo mode

### For Product
- **Higher conversion** - Users can try before signing up
- **Better UX** - No fake signup forms while backend isn't ready
- **Industry standard** - Pattern used by top SaaS companies

## When to Use Demo Mode

**Use demo mode when:**
- Backend authentication isn't ready yet
- You want to let users explore without signup
- You're demoing the product to investors/stakeholders
- You want to reduce signup friction

**Replace with real auth when:**
- Backend authentication is implemented
- You need to track individual users
- You need to persist user-specific data

## Technical Details

### Auth Check Logic

All auth checks use the same pattern:
```typescript
const token = localStorage.getItem('auth_token');
const isAuthenticated = !!token;
```

This works for both:
- Real tokens (from backend)
- Demo token (`'demo-token'`)

### Demo Mode Detection

```typescript
const isDemoMode = localStorage.getItem('auth_token') === 'demo-token';
```

### Logout Behavior

Clicking logout in demo mode:
- Clears demo token
- Redirects to landing page
- User can click "Try Demo" again anytime

## Migration to Real Auth

When backend auth is ready, simply:

1. **Update login endpoint** in `/src/lib/api.ts`:
```typescript
export const auth = {
  login: async (email: string, password: string) => {
    const response = await request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    // Returns real JWT token from backend
    return response;
  },
};
```

2. **Update landing page CTAs**:
- Change "Try Demo" back to "Get Started" → links to `/login`
- Keep "Sign Up" button → links to `/register`

3. **Remove demo badge** from TopBar (or keep it, but only show for `demo-token`)

4. **Optional: Keep demo mode** for public demos:
```typescript
// Allow both real auth and demo mode
const token = localStorage.getItem('auth_token');
const isAuthenticated = !!token;
const isDemoMode = token === 'demo-token';
```

## Comparison to Other Approaches

### ❌ Fake Login Form
```typescript
// Bad: Pretend form that doesn't do anything
<form onSubmit={(e) => { e.preventDefault(); /* nothing */ }}>
  <input type="email" />
  <button>Login</button>
</form>
```
**Problems**: Confusing, feels broken, wastes user's time

### ❌ Hardcoded Credentials
```typescript
// Bad: Requires user to know secret credentials
if (email === 'demo@example.com' && password === 'demo123') {
  // login
}
```
**Problems**: Adds friction, user has to remember, not discoverable

### ✅ One-Click Demo (Our Approach)
```typescript
// Good: Single click, instant access
onClick={() => {
  localStorage.setItem('auth_token', 'demo-token');
  router.push('/dashboard');
}}
```
**Benefits**: Zero friction, instant gratification, clear intent

## Best Practices

### 1. Make Demo Mode Obvious
- Clear "Try Demo" CTA on landing page
- Demo badge in TopBar
- Optional: Demo banner at top of dashboard

### 2. Full Feature Access
- Don't limit features in demo mode
- Let users explore everything
- Goal is to show value, not gate features

### 3. Easy Exit
- Logout works normally
- Can switch to real signup anytime
- Demo data doesn't persist (since it's not saved to backend)

### 4. Clear Messaging
- "No signup required for demo"
- "Full access to all features"
- Makes it clear this is temporary/exploration

## Industry Examples

Companies that use similar demo/try patterns:

- **Figma** - "Try Figma" → instant access with sample project
- **Linear** - Demo workspace with example data
- **Notion** - Template galleries you can duplicate
- **Vercel** - Deploy without signup (limited)
- **Stripe** - Test mode with fake cards

## Summary

Demo mode is a professional, user-friendly solution that:

1. ✅ Lets users access dashboard immediately
2. ✅ Requires zero setup or configuration
3. ✅ Works with existing auth check logic
4. ✅ Doesn't interfere with real auth when it's ready
5. ✅ Follows industry best practices
6. ✅ Provides better UX than alternatives

**Perfect for the current stage where backend auth isn't hooked up yet!**
