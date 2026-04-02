'use client';

import { Bell, LogOut, Settings, User, Menu, X } from 'lucide-react';
import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { TripyLogo } from '@/components/tripy-logo';
import { resetUser } from '@/lib/analytics';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  NavigationMenu,
  NavigationMenuItem,
  NavigationMenuLink,
  NavigationMenuList,
  navigationMenuTriggerStyle,
} from '@/components/ui/navigation-menu';
import { cn } from '@/components/ui/utils';

interface UserData {
  name: string;
  email: string;
}

export function Navigation() {
  return (
    <Suspense fallback={null}>
      <NavigationInner />
    </Suspense>
  );
}

function NavigationInner() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [user, setUser] = useState<UserData | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  // Build redirect URL that preserves the current page (including query params)
  // so the user returns here after signing in or creating an account.
  const redirectParam = (() => {
    const currentUrl = searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;
    return encodeURIComponent(currentUrl);
  })();

  const loginHref = `/login?redirect=${redirectParam}`;
  const signupHref = `/register?redirect=${redirectParam}`;

  useEffect(() => {
    // Check for logged in user
    const checkUser = () => {
      const accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
      const authToken = localStorage.getItem('auth_token');
      
      if (accessToken || authToken) {
        // Only set user if we have actual user data stored
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          try {
            const parsedUser = JSON.parse(storedUser);
            // Validate that user data exists and has required fields
            if (parsedUser && (parsedUser.name || parsedUser.email)) {
              setUser(parsedUser);
            } else {
              // Invalid user data, clear everything and sign out
              setUser(null);
              localStorage.removeItem('access_token');
              localStorage.removeItem('id_token');
              localStorage.removeItem('refresh_token');
              localStorage.removeItem('auth_token');
              localStorage.removeItem('user');
              sessionStorage.removeItem('access_token');
              sessionStorage.removeItem('id_token');
              sessionStorage.removeItem('refresh_token');
            }
          } catch (e) {
            console.error('Failed to parse user', e);
            // Invalid user data, clear everything and sign out
            setUser(null);
            localStorage.removeItem('access_token');
            localStorage.removeItem('id_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            sessionStorage.removeItem('access_token');
            sessionStorage.removeItem('id_token');
            sessionStorage.removeItem('refresh_token');
          }
        } else {
          // Token exists but no user data - treat as not authenticated
          setUser(null);
          // Clear invalid tokens
          localStorage.removeItem('access_token');
          localStorage.removeItem('id_token');
          localStorage.removeItem('refresh_token');
          localStorage.removeItem('auth_token');
          sessionStorage.removeItem('access_token');
          sessionStorage.removeItem('id_token');
          sessionStorage.removeItem('refresh_token');
        }
      } else {
        // No tokens - user is not signed in
        setUser(null);
      }
    };

    checkUser();

    // Listen for storage events
    window.addEventListener('storage', checkUser);
    window.addEventListener('tripy_auth_change', checkUser);

    return () => {
      window.removeEventListener('storage', checkUser);
      window.removeEventListener('tripy_auth_change', checkUser);
    };
  }, []);

  const handleLogout = () => {
    if (typeof window !== 'undefined') {
      resetUser();
      localStorage.removeItem('access_token');
      localStorage.removeItem('id_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('auth_token');
      localStorage.removeItem('user');
      sessionStorage.removeItem('access_token');
      sessionStorage.removeItem('id_token');
      sessionStorage.removeItem('refresh_token');
      sessionStorage.removeItem('tripy_auth_checked');
    }
    setUser(null);
    window.dispatchEvent(new Event('tripy_auth_change'));
    router.push('/');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  const isActive = (path: string) => pathname === path;

  return (
    <nav data-testid="navigation" data-slot="Navigation" className="bg-white border-b border-slate-200 fixed top-0 left-0 right-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex justify-between h-20">
          {/* Logo and Desktop Nav */}
          <div className="flex">
            <div className="flex-shrink-0 flex items-center mr-6">
              <TripyLogo href="/" showText={false} className="sm:hidden" />
              <div className="hidden sm:block">
                <TripyLogo href="/" />
              </div>
            </div>
            
            {/* Desktop Navigation Menu */}
            <div className="hidden md:flex items-center">
              <NavigationMenu>
                <NavigationMenuList>
                  {user ? (
                    <>
                      <NavigationMenuItem>
                        <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), isActive('/dashboard') && "bg-slate-100 text-slate-900")}>
                          <Link href="/dashboard">Dashboard</Link>
                        </NavigationMenuLink>
                      </NavigationMenuItem>

                      <NavigationMenuItem>
                        <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), pathname.startsWith('/clients') && "bg-slate-100 text-slate-900")}>
                          <Link href="/clients">Clients</Link>
                        </NavigationMenuLink>
                      </NavigationMenuItem>

                      <NavigationMenuItem>
                        <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), pathname.startsWith('/households') && "bg-slate-100 text-slate-900")}>
                          <Link href="/households">Households</Link>
                        </NavigationMenuLink>
                      </NavigationMenuItem>

                      <NavigationMenuItem>
                        <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), pathname.startsWith('/trip-requests') && "bg-slate-100 text-slate-900")}>
                          <Link href="/trip-requests">Trips</Link>
                        </NavigationMenuLink>
                      </NavigationMenuItem>

                      <NavigationMenuItem>
                        <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), pathname.startsWith('/alerts') && "bg-slate-100 text-slate-900")}>
                          <Link href="/alerts">Alerts</Link>
                        </NavigationMenuLink>
                      </NavigationMenuItem>

                      <NavigationMenuItem>
                        <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), isActive('/settings') && "bg-slate-100 text-slate-900")}>
                          <Link href="/settings">Settings</Link>
                        </NavigationMenuLink>
                      </NavigationMenuItem>
                    </>
                  ) : (
                    <>
                      <NavigationMenuItem>
                        <NavigationMenuLink asChild className={cn(navigationMenuTriggerStyle(), isActive('/') && "bg-slate-100 text-slate-900")}>
                          <Link href="/">Home</Link>
                        </NavigationMenuLink>
                      </NavigationMenuItem>
                    </>
                  )}
                </NavigationMenuList>
              </NavigationMenu>
            </div>
          </div>

          {/* Right Side Actions */}
          <div className="hidden md:ml-6 md:flex md:items-center md:space-x-4">
            {user && (
              <button className="relative p-2 hover:bg-slate-100 rounded-xl transition-colors text-slate-500 hover:text-slate-700">
                <Bell className="w-5 h-5" />
                <span className="absolute top-2 right-2 w-2 h-2 bg-red-500 rounded-full border-2 border-white"></span>
              </button>
            )}

            {user ? (
              <DropdownMenu>
                <DropdownMenuTrigger className="outline-none">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-medium shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors cursor-pointer">
                    {getInitials(user.name)}
                  </div>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuLabel>
                    <div className="flex flex-col space-y-1">
                      <p className="text-sm font-medium leading-none">{user.name}</p>
                      <p className="text-xs leading-none text-slate-500">
                        {user.email}
                      </p>
                    </div>
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => router.push('/profile')}>
                    <User className="mr-2 h-4 w-4" />
                    <span>Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => router.push('/settings')}>
                    <Settings className="mr-2 h-4 w-4" />
                    <span>Settings</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                    <LogOut className="mr-2 h-4 w-4" />
                    <span>Log out</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : (
              <div className="flex items-center gap-3">
                <Link
                  href={loginHref}
                  className="text-slate-600 hover:text-slate-900 font-medium text-sm"
                >
                  Log in
                </Link>
                <Link
                  href={signupHref}
                  className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30 font-medium text-sm"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>

          {/* Mobile menu button */}
          <div className="flex items-center md:hidden">
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="inline-flex items-center justify-center p-2 rounded-md text-slate-400 hover:text-slate-500 hover:bg-slate-100 focus:outline-none focus:ring-2 focus:ring-inset focus:ring-blue-500"
            >
              <span className="sr-only">Open main menu</span>
              {mobileMenuOpen ? (
                <X className="block h-6 w-6" aria-hidden="true" />
              ) : (
                <Menu className="block h-6 w-6" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white max-h-[calc(100vh-5rem)] overflow-y-auto">
          <div className="pt-2 pb-3 space-y-1 px-2">
            {user ? (
              <>
                <Link
                  href="/dashboard"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                    isActive('/dashboard')
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  Dashboard
                </Link>
                <Link
                  href="/clients"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                    pathname.startsWith('/clients')
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  Clients
                </Link>
                <Link
                  href="/households"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                    pathname.startsWith('/households')
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  Households
                </Link>
                <Link
                  href="/trip-requests"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                    pathname.startsWith('/trip-requests')
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  Trips
                </Link>
                <Link
                  href="/alerts"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                    pathname.startsWith('/alerts')
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  Alerts
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                    isActive('/settings')
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  Settings
                </Link>
              </>
            ) : (
              <>
                <Link
                  href="/"
                  onClick={() => setMobileMenuOpen(false)}
                  className={`block pl-3 pr-4 py-2 border-l-4 text-base font-medium ${
                    isActive('/')
                      ? 'bg-blue-50 border-blue-500 text-blue-700'
                      : 'border-transparent text-slate-500 hover:bg-slate-50 hover:border-slate-300 hover:text-slate-700'
                  }`}
                >
                  Home
                </Link>
              </>
            )}
          </div>
          <div className="pt-4 pb-4 border-t border-slate-200">
            {user ? (
              <div className="px-4">
                <div className="flex items-center">
                  <div className="flex-shrink-0">
                    <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-medium">
                      {getInitials(user.name)}
                    </div>
                  </div>
                  <div className="ml-3">
                    <div className="text-base font-medium text-slate-800">{user.name}</div>
                    <div className="text-sm font-medium text-slate-500">{user.email}</div>
                  </div>
                </div>
                <div className="mt-3 space-y-1">
                  <button
                    onClick={() => {
                      router.push('/profile');
                      setMobileMenuOpen(false);
                    }}
                    className="block w-full text-left px-4 py-2 text-base font-medium text-slate-500 hover:text-slate-800 hover:bg-slate-100 rounded-md"
                  >
                    Profile
                  </button>
                  <button
                    onClick={handleLogout}
                    className="block w-full text-left px-4 py-2 text-base font-medium text-red-600 hover:text-red-800 hover:bg-red-50 rounded-md"
                  >
                    Log out
                  </button>
                </div>
              </div>
            ) : (
              <div className="px-4 space-y-2">
                <Link
                  href={loginHref}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block w-full text-center px-4 py-3 border border-slate-300 rounded-xl text-slate-700 font-medium hover:bg-slate-50"
                >
                  Log in
                </Link>
                <Link
                  href={signupHref}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block w-full text-center px-4 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700"
                >
                  Sign Up
                </Link>
              </div>
            )}
          </div>
        </div>
      )}
    </nav>
  );
}
