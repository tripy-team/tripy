'use client';

import Link from 'next/link';
import { Bell } from 'lucide-react';

export function TopBar() {
    // TODO: Replace with actual auth check
    // Endpoint: GET /users/me (check if user exists and is authenticated)
    // Use React Query or SWR to cache and manage auth state
    const isAuthenticated = false;

    return (
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-end">
            <div className="flex items-center gap-4">
                {isAuthenticated ? (
                    <>
                        <button className="relative p-2 hover:bg-blue-50 rounded-xl transition-colors">
                            <Bell className="w-5 h-5 text-slate-600" />
                            <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full"></span>
                        </button>

                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-medium shadow-lg shadow-blue-600/20">
                            SC
                        </div>
                    </>
                ) : (
                    <div className="flex items-center gap-3">
                        <Link
                            href="/login"
                            className="px-4 py-2 text-slate-700 hover:text-slate-900 font-medium transition-colors"
                        >
                            Log in
                        </Link>
                        <Link
                            href="/register"
                            className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium shadow-sm"
                        >
                            Sign up
                        </Link>
                    </div>
                )}
            </div>
        </header>
    );
}
