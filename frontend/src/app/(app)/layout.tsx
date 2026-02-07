'use client';

import { useEffect, useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Navigation } from '@/components/navigation';
import { ScrollToTop } from '@/components/scroll-to-top';
import { SKIP_API_AUTH, isAuthenticated } from '@/lib/api';

const AUTH_CHECKED_KEY = 'tripy_auth_checked_session';

// Routes that DO NOT require authentication — users can generate trips anonymously
const PUBLIC_ROUTES = [
    '/solo/setup',
    '/solo/results',
];

function isPublicRoute(pathname: string): boolean {
    return PUBLIC_ROUTES.some(route => pathname.startsWith(route));
}

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const pathname = usePathname();
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
        // Skip authentication check if offline mode is enabled
        if (SKIP_API_AUTH) {
            console.log('[AppLayout] Authentication check skipped (offline mode)');
            setIsChecking(false);
            return;
        }

        // Ensure we're in the browser
        if (typeof window === 'undefined') {
            setIsChecking(false);
            return;
        }

        // PUBLIC ROUTES: Never block trip generation behind auth
        if (isPublicRoute(pathname)) {
            if (process.env.NODE_ENV === 'development') {
                console.log('[AppLayout] Public route — skipping auth gate:', pathname);
            }
            sessionStorage.setItem(AUTH_CHECKED_KEY, 'true');
            setIsChecking(false);
            return;
        }

        // Check if we've already validated auth this session (persists across remounts)
        const alreadyChecked = sessionStorage.getItem(AUTH_CHECKED_KEY) === 'true';
        
        if (alreadyChecked) {
            // Already checked - verify tokens still exist quickly
            const accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
            const idToken = localStorage.getItem('id_token') || sessionStorage.getItem('id_token');
            
            if (accessToken || idToken) {
                // Tokens still exist - allow access immediately
                setIsChecking(false);
                return;
            }
            // Tokens cleared - remove flag and re-check below
            sessionStorage.removeItem(AUTH_CHECKED_KEY);
        }

        // First time check or tokens were cleared
        const accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
        const idToken = localStorage.getItem('id_token') || sessionStorage.getItem('id_token');
        
        // Debug logging (remove in production)
        if (process.env.NODE_ENV === 'development') {
            console.log('[AppLayout] Auth check:', {
                alreadyChecked,
                hasAccessToken: !!accessToken,
                hasIdToken: !!idToken,
                pathname: window.location.pathname
            });
        }
        
        // Only redirect if we have NO tokens at all
        if (!accessToken && !idToken) {
            sessionStorage.setItem(AUTH_CHECKED_KEY, 'true');
            setIsChecking(false);
            router.replace('/login');
            return;
        }
        
        // User has a token - allow access
        sessionStorage.setItem(AUTH_CHECKED_KEY, 'true');
        setIsChecking(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pathname]); // Re-check when route changes

    // Show loading state while checking authentication
    if (isChecking) {
        return (
            <div className="flex flex-col min-h-screen bg-slate-50">
                <Navigation />
                <main className="flex-1 flex items-center justify-center pt-20">
                    <div className="text-center">
                        <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
                        <p className="mt-4 text-slate-600">Loading...</p>
                    </div>
                </main>
            </div>
        );
    }

    return (
        <div className="flex flex-col min-h-screen bg-slate-50">
            <ScrollToTop />
            <Navigation />
            {/* pt-20 = navbar height (h-20) so content starts below the fixed nav */}
            <main className="flex-1 pt-20">
                {children}
            </main>
        </div>
    );
}

