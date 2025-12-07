'use client';

import { Bell } from 'lucide-react';

export function TopBar() {
    return (
        <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-end">
            <div className="flex items-center gap-4">
                <button className="relative p-2 hover:bg-blue-50 rounded-xl transition-colors">
                    <Bell className="w-5 h-5 text-slate-600" />
                    <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full"></span>
                </button>

                <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-medium shadow-lg shadow-blue-600/20">
                    SC
                </div>
            </div>
        </header>
    );
}
