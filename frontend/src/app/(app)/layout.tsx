'use client';

import { Navigation } from '@/components/Navigation';
import { TopBar } from '@/components/TopBar';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex h-screen bg-slate-50">
            <Navigation />
            <div className="flex-1 flex flex-col overflow-hidden">
                <TopBar />
                <main className="flex-1 overflow-y-auto">
                    {children}
                </main>
            </div>
        </div>
    );
}

