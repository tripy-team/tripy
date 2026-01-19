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
            return;
        }

        // Simple auth check - just verify tokens and user data exist
        const accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
        const authToken = localStorage.getItem('auth_token');
        const storedUser = localStorage.getItem('user');
        
        // Must have both token AND user data to be considered authenticated
        if (!accessToken && !authToken) {
            // No tokens - user is not authenticated
            hasCheckedRef.current = true;
            setIsChecking(false);
            router.replace('/login');
            return;
        }
        
        if (!storedUser) {
            // Token exists but no user data - clear tokens and redirect
            localStorage.removeItem('access_token');
            localStorage.removeItem('id_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('auth_token');
            sessionStorage.removeItem('access_token');
            sessionStorage.removeItem('id_token');
            sessionStorage.removeItem('refresh_token');
            hasCheckedRef.current = true;
            setIsChecking(false);
            router.replace('/login');
            return;
        }
        
        // Validate user data
        try {
            const parsedUser = JSON.parse(storedUser);
            if (!parsedUser || (!parsedUser.name && !parsedUser.email)) {
                // Invalid user data - clear everything and redirect
                localStorage.removeItem('access_token');
                localStorage.removeItem('id_token');
                localStorage.removeItem('refresh_token');
                localStorage.removeItem('auth_token');
                localStorage.removeItem('user');
                sessionStorage.removeItem('access_token');
                sessionStorage.removeItem('id_token');
                sessionStorage.removeItem('refresh_token');
                hasCheckedRef.current = true;
                setIsChecking(false);
                router.replace('/login');
                return;
            }
        } catch (_e) {
            // Invalid user data - clear everything and redirect
            localStorage.removeItem('access_token');
            localStorage.removeItem('id_token');
            localStorage.removeItem('refresh_token');
            localStorage.removeItem('auth_token');
            localStorage.removeItem('user');
            sessionStorage.removeItem('access_token');
            sessionStorage.removeItem('id_token');
            sessionStorage.removeItem('refresh_token');
            hasCheckedRef.current = true;
            setIsChecking(false);
            router.replace('/login');
            return;
        }
        
        // User is authenticated - allow access
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

