'use client';

import { ExploreMap } from '@/components/explore-map';

export default function ExplorePage() {
    return (
        <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/30 to-white p-8">
            <div className="max-w-7xl mx-auto">
                <div className="mb-8">
                    <h1 className="text-4xl mb-2 text-slate-900 font-bold">Explore Destinations</h1>
                    <p className="text-slate-600">Discover amazing places around the world</p>
                </div>
                <ExploreMap />
            </div>
        </div>
    );
}

