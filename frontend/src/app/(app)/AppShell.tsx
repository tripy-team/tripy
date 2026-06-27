'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import Link from 'next/link';
import {
  HelpCircle,
  User,
  LogOut,
  Loader2,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { TripyLogo } from '@/components/tripy-logo';
import { getMe } from '@/lib/api-client';
import type { User as UserType } from '@/lib/api-client';
import { syncSessionCookie, clearSessionCookie } from '@/lib/session-cookie';

// Consumer (B2C) navigation — everyday people planning their own trips.
const NAV_ITEMS = [
  // Single unified planning flow — handles one traveler or a whole group.
  { href: '/plan', label: 'Plan a Trip' },
  { href: '/my-trips', label: 'My Trips' },
  { href: '/explore', label: 'Explore' },
];

/**
 * Authenticated app chrome (nav, user menu, logout).
 *
 * `initialUser` comes from the server layout, which read the session cookie and
 * authenticated the user server-side. When it's present we render immediately
 * with no client round-trip — the old blocking getMe() gate is gone.
 *
 * When it's null (no fresh cookie yet — e.g. an existing session right after
 * this shipped, or an expired cookie) we fall back to the original client gate:
 * check the localStorage token, backfill the cookie, getMe(), and redirect to
 * /login only if that fails. So behavior is never worse than before, and once
 * the cookie is backfilled the next load takes the fast server path.
 */
export default function AppShell({
  initialUser,
  children,
}: {
  initialUser: UserType | null;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [user, setUser] = useState<UserType | null>(initialUser);
  // If the server already authenticated us, there's nothing to check.
  const [isChecking, setIsChecking] = useState(initialUser === null);

  useEffect(() => {
    // Server already resolved the user from the cookie — fast path, no gate.
    if (initialUser) return;

    // Fallback path: no fresh cookie. Reproduce the original client-side gate.
    const bypass = process.env.NEXT_PUBLIC_DEV_AUTH_BYPASS === 'true';
    const token = localStorage.getItem('tripy_token');
    if (!token && !bypass) {
      router.replace('/login');
      return;
    }

    // Backfill the httpOnly session cookie so the NEXT load can render on the
    // server (this is what upgrades a pre-cookie session to the fast path).
    if (token) void syncSessionCookie(token);

    getMe()
      .then(setUser)
      .catch(() => {
        if (bypass) {
          setIsChecking(false);
          return;
        }
        localStorage.removeItem('tripy_token');
        localStorage.removeItem('tripy_user');
        router.replace('/login');
      })
      .finally(() => setIsChecking(false));
  }, [router, initialUser]);

  const handleLogout = () => {
    localStorage.removeItem('tripy_token');
    localStorage.removeItem('tripy_user');
    void clearSessionCookie();
    router.push('/login');
  };

  if (isChecking) {
    return (
      <div className="flex h-screen items-center justify-center bg-slate-50">
        <div className="text-center">
          <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-600" />
          <p className="mt-4 text-slate-500">Loading...</p>
        </div>
      </div>
    );
  }

  const isActive = (href: string) => {
    // "Plan a Trip" stays highlighted across the whole planning flow, including
    // the legacy solo/group routes it now subsumes.
    if (href === '/plan') {
      return (
        pathname.startsWith('/plan') ||
        pathname.startsWith('/solo') ||
        pathname.startsWith('/group')
      );
    }
    return pathname.startsWith(href);
  };

  const isUUID = (s?: string) =>
    !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

  const displayName = (() => {
    if (!user) return '';
    const first = isUUID(user.firstName) ? '' : (user.firstName ?? '');
    const last = isUUID(user.lastName) ? '' : (user.lastName ?? '');
    const full = `${first} ${last}`.trim();
    return full || user.email.split('@')[0];
  })();

  const initials = (() => {
    if (!user) return '';
    const first = isUUID(user.firstName) ? '' : (user.firstName?.[0] ?? '');
    const last = isUUID(user.lastName) ? '' : (user.lastName?.[0] ?? '');
    const combined = (first + last).toUpperCase();
    return combined || user.email[0].toUpperCase();
  })();

  return (
    <div className="min-h-screen bg-slate-50">
      {/* Top navbar */}
      <header className="fixed top-0 left-0 right-0 z-40 h-16 border-b border-slate-200 bg-white">
        <div className="mx-auto flex h-full w-full max-w-7xl items-center gap-8 px-6">
          {/* Logo */}
          <TripyLogo href="/explore" />

          {/* Nav links */}
          <nav className="flex items-center gap-1">
            {NAV_ITEMS.map((item) => {
              const active = isActive(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active
                      ? 'bg-blue-50 text-blue-700'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </nav>

          {/* Spacer */}
          <div className="flex-1" />

          {/* User dropdown */}
          {user && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="flex items-center gap-2 rounded-lg px-2 py-1.5 transition-colors hover:bg-slate-50">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-600 text-sm font-medium text-white">
                    {initials}
                  </div>
                  <span className="text-sm font-medium text-slate-700">
                    {displayName}
                  </span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuLabel>
                  <div className="flex flex-col space-y-1">
                    <p className="text-sm font-medium leading-none">{displayName}</p>
                    <p className="text-xs leading-none text-slate-500">{user.email}</p>
                  </div>
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => router.push('/profile')}>
                  <User className="mr-2 h-4 w-4" />
                  <span>Profile & Settings</span>
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push('/help')}>
                  <HelpCircle className="mr-2 h-4 w-4" />
                  <span>Help Center</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                  <LogOut className="mr-2 h-4 w-4" />
                  <span>Log out</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </header>

      {/* Main content */}
      <main className="pt-16">
        <div className="mx-auto max-w-7xl p-6">{children}</div>
      </main>
    </div>
  );
}
