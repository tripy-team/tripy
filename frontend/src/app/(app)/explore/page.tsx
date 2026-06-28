'use client';

import { Search, Globe, CreditCard, Bookmark } from 'lucide-react';
import { useState, useEffect } from 'react';
import Image from 'next/image';
import { getOptimizedImageUrl } from '@/lib/image-utils';
import { users as usersAPI } from '@/lib/api';
import type { SavedDestination } from '@/lib/api';

interface Destination {
  city: string;
  country: string;
  points: string;
  airline: string;
  image: string;
}

export default function ExplorePage() {
  const [searchTerm, setSearchTerm] = useState('');
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [saved, setSaved] = useState<SavedDestination[]>([]);
  const [savingCity, setSavingCity] = useState<string | null>(null);

  useEffect(() => {
    const loadDestinations = async () => {
      const dests = [
        { city: 'Paris', country: 'France', points: '45,000', airline: 'Air France' },
        { city: 'Tokyo', country: 'Japan', points: '75,000', airline: 'JAL / ANA' },
        { city: 'Maldives', country: 'Maldives', points: '90,000', airline: 'Qatar Airways' },
        { city: 'Santorini', country: 'Greece', points: '60,000', airline: 'Aegean / Lufthansa' }
      ];

      // Load images for each destination
      const destinationsWithImages = await Promise.all(
        dests.map(async (dest) => {
          let imageUrl = '';
          try {
            imageUrl = await getOptimizedImageUrl(dest.city, 'medium');
          } catch (err) {
            console.error('Error loading image for', dest.city, err);
          }
          return {
            ...dest,
            image: imageUrl || '/placeholder-trip.jpg'
          };
        })
      );

      setDestinations(destinationsWithImages);
    };

    loadDestinations();

    // Load the traveler's saved destinations.
    usersAPI.getProfile()
      .then((p) => setSaved(p.saved_destinations ?? []))
      .catch(() => setSaved([]));
  }, []);

  const isSaved = (city: string) => saved.some((d) => d.city === city);

  const toggleSave = async (dest: Destination) => {
    const next = isSaved(dest.city)
      ? saved.filter((d) => d.city !== dest.city)
      : [...saved, { city: dest.city, country: dest.country }];
    const prev = saved;
    setSaved(next); // optimistic
    setSavingCity(dest.city);
    try {
      await usersAPI.updateProfile({ saved_destinations: next });
    } catch (err) {
      console.error('Failed to update saved destinations:', err);
      setSaved(prev); // rollback
    } finally {
      setSavingCity(null);
    }
  };

  const filtered = destinations.filter((d) => {
    if (!searchTerm.trim()) return true;
    const q = searchTerm.toLowerCase();
    return d.city.toLowerCase().includes(q) || d.country.toLowerCase().includes(q);
  });

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold text-slate-900 mb-4">Explore the World with Points</h1>
        <p className="text-lg text-slate-600 max-w-2xl mx-auto">
          Discover how far your credit card points can take you. Browse popular destinations and see estimated point costs for flights and hotels.
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
        {filtered.map((dest) => {
          const savedNow = isSaved(dest.city);
          return (
            <div key={dest.city} className="group">
              <div className="relative aspect-[4/5] rounded-2xl overflow-hidden mb-4">
                <Image
                  src={dest.image}
                  alt={dest.city}
                  fill
                  className="object-cover group-hover:scale-105 transition-transform duration-500"
                  sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 25vw"
                />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                <button
                  onClick={() => toggleSave(dest)}
                  disabled={savingCity === dest.city}
                  aria-label={savedNow ? `Remove ${dest.city} from saved` : `Save ${dest.city}`}
                  className={`absolute top-3 right-3 flex h-9 w-9 items-center justify-center rounded-full backdrop-blur-sm transition-colors disabled:opacity-60 ${
                    savedNow ? 'bg-blue-600 text-white' : 'bg-white/80 text-slate-700 hover:bg-white'
                  }`}
                >
                  <Bookmark className="h-4 w-4" fill={savedNow ? 'currentColor' : 'none'} />
                </button>
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
          );
        })}
      </div>
    </div>
  );
}
