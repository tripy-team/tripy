'use client';

import { TopBar } from '@/components/top-bar';

export default function AppLayout({
    children,
}: {
    children: React.ReactNode;
}) {
    return (
        <div className="flex flex-col min-h-screen bg-slate-50">
            <TopBar />
            <main className="flex-1">
                {children}
            </main>
        </div>
    );
}

