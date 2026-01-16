'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { LogOut, User } from 'lucide-react';
import { auth } from '@/lib/api';

export function TopBar() {
    const router = useRouter();
    const [isAuthenticated, setIsAuthenticated] = useState(false);
    const [isDemoMode, setIsDemoMode] = useState(false);
    const [showDropdown, setShowDropdown] = useState(false);

    useEffect(() => {
        // Check if user is logged in
        const token = localStorage.getItem('auth_token');
        setIsAuthenticated(!!token);
        setIsDemoMode(token === 'demo-token');
    }, []);

    const handleLogout = () => {
        auth.logout();
        setIsAuthenticated(false);
        router.push('/');
    };

    return (
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-between">
            <Link href={isAuthenticated ? '/dashboard' : '/'} className="flex items-center gap-2">
                <div className="text-2xl font-bold text-blue-600">Tripy</div>
                {isDemoMode && (
                    <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-800 rounded-full font-medium">
                        Demo
                    </span>
                )}
            </Link>

            <div className="flex items-center gap-4">
                {isAuthenticated ? (
                    <>
                        <Link
                            href="/dashboard"
                            className="px-4 py-2 text-slate-700 hover:text-slate-900 font-medium transition-colors"
                        >
                            Dashboard
                        </Link>
                        <Link
                            href="/explore"
                            className="px-4 py-2 text-slate-700 hover:text-slate-900 font-medium transition-colors"
                        >
                            Explore
                        </Link>

                        <div className="relative">
                            <button
                                onClick={() => setShowDropdown(!showDropdown)}
                                className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-medium shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors"
                            >
                                <User className="w-5 h-5" />
                            </button>

                            {showDropdown && (
                                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50">
                                    <button
                                        onClick={handleLogout}
                                        className="w-full px-4 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2"
                                    >
                                        <LogOut className="w-4 h-4" />
                                        Log out
                                    </button>
                                </div>
                            )}
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
