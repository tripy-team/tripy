'use client';

import { Plane, Calendar, MapPin, CreditCard, Users, User } from 'lucide-react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

interface Trip {
  id: string;
  destination: string;
  image: string;
  dates: string;
  status: 'upcoming' | 'completed';
  pointsRedeemed: string;
  type: 'Solo' | 'Group';
  travelers: number;
  location: string;
  description: string;
}

export default function MyTripsPage() {
  const router = useRouter();

  // TODO: Replace with API call to fetch user's trips
  // Endpoint: GET /trips (list user trips)
  const trips: Trip[] = [
    {
      id: '1',
      destination: 'Tokyo Adventure',
      image: 'https://images.unsplash.com/photo-1730385835399-4d0f24898919?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxUb2t5byUyMGNpdHklMjBzdHJlZXQlMjBuaWdodCUyMG5lb258ZW58MXx8fHwxNzY4NTQ0MTQxfDA&ixlib=rb-4.1.0&q=80&w=1080',
      dates: 'Oct 15 - Oct 22, 2024',
      status: 'upcoming',
      pointsRedeemed: '120,000',
      type: 'Solo',
      travelers: 1,
      location: 'Tokyo, Japan',
      description: 'Neon streets of Shinjuku, ancient temples in Asakusa, and the Tsukiji Outer Market.'
    },
    {
      id: '2',
      destination: 'Paris Weekend',
      image: 'https://images.unsplash.com/photo-1637179515556-2ad0055eb4fb?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxQYXJpcyUyMEVpZmZlbCUyMFRvd2VyJTIwc3Vuc2V0fGVufDF8fHx8MTc2ODU0NDE0MXww&ixlib=rb-4.1.0&q=80&w=1080',
      dates: 'Jun 10 - Jun 14, 2023',
      status: 'completed',
      pointsRedeemed: '85,000',
      type: 'Group',
      travelers: 4,
      location: 'Paris, France',
      description: 'Louvre museum tour, sunset views from Montmartre, and a day trip to Versailles.'
    },
    {
      id: '3',
      destination: 'New York City',
      image: 'https://images.unsplash.com/photo-1648799545370-d8676f02e041?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxOZXclMjBZb3JrJTIwQ2l0eSUyMHNreWxpbmUlMjBkYXl8ZW58MXx8fHwxNzY4NTQ0MTQxfDA&ixlib=rb-4.1.0&q=80&w=1080',
      dates: 'Mar 05 - Mar 08, 2023',
      status: 'completed',
      pointsRedeemed: '45,000',
      type: 'Group',
      travelers: 2,
      location: 'New York, USA',
      description: 'Broadway show, shopping in SoHo, and walking the Brooklyn Bridge.'
    },
    {
      id: '4',
      destination: 'London Fog',
      image: 'https://images.unsplash.com/photo-1634440919887-e802e5446958?crop=entropy&cs=tinysrgb&fit=max&fm=jpg&ixid=M3w3Nzg4Nzd8MHwxfHNlYXJjaHwxfHxMb25kb24lMjBCaWclMjBCZW4lMjBicmlkZ2V8ZW58MXx8fHwxNzY4NTQ0MTQyfDA&ixlib=rb-4.1.0&q=80&w=1080',
      dates: 'Nov 12 - Nov 18, 2022',
      status: 'completed',
      pointsRedeemed: '60,000',
      type: 'Solo',
      travelers: 1,
      location: 'London, UK',
      description: 'British Museum, afternoon tea at The Savoy, and the Tower of London.'
    }
  ];

  const upcomingTrips = trips.filter(t => t.status === 'upcoming');
  const pastTrips = trips.filter(t => t.status === 'completed');

  const TripCard = ({ trip }: { trip: Trip }) => (
    <div className="group flex overflow-hidden border border-slate-200 rounded-xl hover:shadow-lg transition-all duration-300 bg-white">
      {/* Image Section - Smaller width */}
      <div className="relative w-32 sm:w-40 shrink-0 bg-slate-100">
        <img 
          src={trip.image} 
          alt={trip.destination} 
          className="absolute inset-0 w-full h-full object-cover"
        />
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/5 transition-colors" />
      </div>
      
      {/* Content Section */}
      <div className="flex flex-col flex-1 p-3 sm:p-4 gap-2">
        {/* Top: Header Info */}
        <div className="flex justify-between items-start gap-2">
          <div className="min-w-0">
            <h3 className="font-bold text-slate-900 leading-tight truncate text-base sm:text-lg">{trip.destination}</h3>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">{trip.location}</span>
            </div>
          </div>
          <span className={`shrink-0 text-[10px] px-2 h-5 font-medium rounded-full flex items-center ${
            trip.status === 'upcoming' 
              ? 'bg-blue-50 text-blue-700 hover:bg-blue-100' 
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
          }`}>
            {trip.status === 'upcoming' ? 'Upcoming' : 'Completed'}
          </span>
        </div>

        {/* Middle: Description & Date */}
        <div className="flex-1 flex flex-col gap-2">
            <p className="text-xs text-slate-600 leading-relaxed line-clamp-2">
                {trip.description}
            </p>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 font-medium">
                <Calendar className="w-3.5 h-3.5 text-slate-400" />
                {trip.dates}
            </div>
        </div>

        {/* Bottom: Metrics Grid */}
        <div className="grid grid-cols-2 gap-4 mt-2 pt-2 border-t border-slate-100/50">
            <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-0.5">Points</span>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-700">
                    <CreditCard className="w-3.5 h-3.5 text-emerald-500" />
                    {trip.pointsRedeemed}
                </div>
            </div>
            
            <div className="flex flex-col">
                <span className="text-[10px] uppercase tracking-wider text-slate-400 font-bold mb-0.5">Travelers</span>
                <div className="flex items-center gap-1.5 text-xs sm:text-sm font-semibold text-slate-700">
                    {trip.type === 'Solo' ? <User className="w-3.5 h-3.5 text-indigo-500" /> : <Users className="w-3.5 h-3.5 text-indigo-500" />}
                    {trip.type === 'Solo' ? 'Solo' : `${trip.travelers} People`}
                </div>
            </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
          <div className="text-center sm:text-left">
            <h1 className="text-2xl font-bold text-slate-900">My Trips</h1>
            <p className="text-sm text-slate-500 mt-1">Track your points usage and travel history</p>
          </div>
          <Link 
            href="/solo/setup"
            className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm text-sm"
          >
            <Plane className="w-4 h-4" />
            Plan New Trip
          </Link>
        </div>

        {upcomingTrips.length > 0 && (
          <section className="mb-8">
            <div className="flex items-center gap-3 mb-4">
              <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Upcoming Adventures</h2>
              <div className="h-px flex-1 bg-slate-200"></div>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {upcomingTrips.map(trip => (
                <TripCard key={trip.id} trip={trip} />
              ))}
            </div>
          </section>
        )}

        <section>
          <div className="flex items-center gap-3 mb-4">
            <h2 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Past Memories</h2>
            <div className="h-px flex-1 bg-slate-200"></div>
          </div>
          <div className="grid md:grid-cols-2 gap-4">
            {pastTrips.map(trip => (
              <TripCard key={trip.id} trip={trip} />
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
