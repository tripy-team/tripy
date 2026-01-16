'use client';

import { Search, Globe, CreditCard } from 'lucide-react';
import { useState } from 'react';

export default function ExplorePage() {
  const [searchTerm, setSearchTerm] = useState('');

  const destinations = [
    {
      city: 'Paris',
      country: 'France',
      points: '45,000',
      airline: 'Air France',
      image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?q=80&w=2073&auto=format&fit=crop'
    },
    {
      city: 'Tokyo',
      country: 'Japan',
      points: '75,000',
      airline: 'JAL / ANA',
      image: 'https://images.unsplash.com/photo-1503899036084-c55cdd92da26?q=80&w=2070&auto=format&fit=crop'
    },
    {
      city: 'Maldives',
      country: 'Maldives',
      points: '90,000',
      airline: 'Qatar Airways',
      image: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?q=80&w=2065&auto=format&fit=crop'
    },
    {
      city: 'Santorini',
      country: 'Greece',
      points: '60,000',
      airline: 'Aegean / Lufthansa',
      image: 'https://images.unsplash.com/photo-1613395877344-13d4c79e4284?q=80&w=2074&auto=format&fit=crop'
    }
  ];

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-slate-900 mb-4">Explore the World with Points</h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Discover how far your credit card points can take you. We analyze award availability across major airline alliances.
        </p>
      </div>

      <div className="max-w-2xl mx-auto mb-16 relative">
        <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 w-5 h-5" />
        <input
          type="text"
          placeholder="Where do you want to go?"
          className="w-full pl-12 pr-4 py-4 rounded-2xl border border-slate-200 shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent outline-none text-lg"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
        />
      </div>

      <div className="grid md:grid-cols-2 lg:grid-cols-4 gap-6">
        {destinations.map((dest) => (
          <div key={dest.city} className="group cursor-pointer">
            <div className="relative aspect-[4/5] rounded-2xl overflow-hidden mb-4">
              <img
                src={dest.image}
                alt={dest.city}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
              <div className="absolute bottom-4 left-4 text-white">
                <h3 className="text-xl font-bold">{dest.city}</h3>
                <p className="opacity-90">{dest.country}</p>
              </div>
            </div>
            <div className="flex items-center justify-between text-sm">
              <div className="flex items-center gap-2 text-slate-600">
                <Globe className="w-4 h-4" />
                <span>{dest.airline}</span>
              </div>
              <div className="flex items-center gap-1 font-semibold text-blue-600">
                <CreditCard className="w-4 h-4" />
                <span>{dest.points} pts</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
