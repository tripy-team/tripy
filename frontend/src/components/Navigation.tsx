'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Home, Plane, ChevronRight, ChevronLeft } from 'lucide-react';
import { useState } from 'react';

export function Navigation() {
    const pathname = usePathname();
    const [isExpanded, setIsExpanded] = useState(true);

    return (
        <>
            <nav className={`bg-white border-r border-slate-200 flex flex-col py-8 transition-all duration-300 overflow-hidden ${isExpanded ? 'w-20' : 'w-0'
                }`}>
                <div className="flex items-center justify-center mb-12">
                    <Link href="/" className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/20 flex-shrink-0">
                            <Plane className="w-5 h-5 text-white" />
                        </div>
                    </Link>
                </div>

                <div className="flex flex-col gap-2 items-center">
                    <Link
                        href="/"
                        className={`rounded-xl flex items-center transition-all w-12 h-12 justify-center ${pathname === '/'
                            ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                            : 'text-slate-400 hover:bg-blue-50 hover:text-blue-600'
                            }`}
                    >
                        <Home className="w-5 h-5 flex-shrink-0" />
                    </Link>
                </div>

                <button
                    onClick={() => setIsExpanded(false)}
                    className="mt-auto w-12 h-12 mx-auto flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-xl transition-all"
                    aria-label="Collapse sidebar"
                >
                    <ChevronLeft className="w-5 h-5" />
                </button>
            </nav>

            {!isExpanded && (
                <button
                    onClick={() => setIsExpanded(true)}
                    className="fixed left-0 top-1/2 -translate-y-1/2 w-8 h-16 bg-white border border-slate-200 border-l-0 rounded-r-xl flex items-center justify-center text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-all shadow-sm z-50"
                    aria-label="Expand sidebar"
                >
                    <ChevronRight className="w-5 h-5" />
                </button>
            )}
        </>
    );
}