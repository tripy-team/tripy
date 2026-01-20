'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navigation } from '@/components/navigation';
import { ScrollToTop } from '@/components/scroll-to-top';

const AUTH_CHECKED_KEY = 'tripy_auth_checked_session';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
        // Ensure we're in the browser
        if (typeof window === 'undefined') {
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
        // Simple auth check - only verify access_token exists (this is what login sets)
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
        // Having access_token OR id_token means user is authenticated
        if (!accessToken && !idToken) {
            // No tokens - user is not authenticated
            sessionStorage.setItem(AUTH_CHECKED_KEY, 'true');
            setIsChecking(false);
            router.replace('/login');
            return;
        }
        
        // User has a token - allow access (they're authenticated)
        // Mark as checked in sessionStorage so we don't check again this session
        sessionStorage.setItem(AUTH_CHECKED_KEY, 'true');
        setIsChecking(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []); // Only run once on mount - router is stable and doesn't need to be in deps

    // Show loading state while checking authentication
    if (isChecking) {
        return (
            <div className="flex flex-col min-h-screen bg-slate-50">
                <Navigation />
                <main className="flex-1 flex items-center justify-center">
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
            {/* Remove overflow-y-auto so dropdowns and popovers (like autocomplete) aren't clipped */}
            <main className="flex-1">
                {children}
            </main>
        </div>
    );
}

