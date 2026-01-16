'use client';

import { Navigation } from '@/components/navigation';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col min-h-screen bg-slate-50">
            <Navigation />
            <main className="flex-1 overflow-y-auto">
                {children}
            </main>
        </div>
    );
}

