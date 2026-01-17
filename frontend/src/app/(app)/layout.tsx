'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Navigation } from '@/components/navigation';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    const router = useRouter();
    const [isChecking, setIsChecking] = useState(true);

    useEffect(() => {
        // Check if user is authenticated
        const checkAuth = () => {
            const accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
            const authToken = localStorage.getItem('auth_token');
            
            if (!accessToken && !authToken) {
                // User is not authenticated, redirect to login
                router.push('/login');
                return;
            }
            
            setIsChecking(false);
        };

        checkAuth();
    }, [router]);

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

