'use client';

import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Navigation } from '@/components/navigation';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [isChecking, setIsChecking] = useState(true);
    const hasCheckedRef = useRef(false);

    useEffect(() => {
        // Only check auth once - use ref to persist across re-renders
        if (hasCheckedRef.current) {
            // Already checked - allow access (auth persists across route changes)
            setIsChecking(false);
            return;
        }

        // Simple auth check - only verify access_token exists (this is what login sets)
        // Don't require user data - having a token is enough to access protected routes
        const accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
        const idToken = localStorage.getItem('id_token') || sessionStorage.getItem('id_token');
        
        // Only redirect if we have NO tokens at all
        // Having access_token OR id_token means user is authenticated
        if (!accessToken && !idToken) {
            // No tokens - user is not authenticated
            hasCheckedRef.current = true;
            setIsChecking(false);
            router.replace('/login');
            return;
        }
        
        // User has a token - allow access (they're authenticated)
        // We don't require user data here because tokens are the source of truth
        hasCheckedRef.current = true;
        setIsChecking(false);
    }, []); // Only run once on mount

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
            <Navigation />
            <main className="flex-1 overflow-y-auto">
                {children}
            </main>
        </div>
    );
}

