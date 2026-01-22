'use client';

import { Plane, Calendar, MapPin, CreditCard, Users, User } from 'lucide-react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { trips as tripsAPI } from '@/lib/api';

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

interface ApiTrip {
  tripId: string;
  title: string;
  startDate: string;
  endDate: string;
  status: string;
  createdBy: string;
  role?: string;
  memberCount?: number;
  destinations?: string[];
  firstDestination?: string;
}

export default function MyTripsPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const fetchTrips = async () => {
      try {
        setIsLoading(true);
        const response = await tripsAPI.list();
        
        // Transform API trips to display format (with async image loading)
        const transformedTrips: Trip[] = await Promise.all(
          response.trips.map(async (trip: ApiTrip) => {
          // Format dates
          const startDate = trip.startDate ? new Date(trip.startDate) : null;
          const endDate = trip.endDate ? new Date(trip.endDate) : null;
          const now = new Date();
          
          let datesStr = 'TBD';
          if (startDate && endDate) {
            datesStr = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
          } else if (startDate) {
            datesStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
          }
          
          // Determine status
          const isCompleted = endDate ? endDate < now : false;
          const status: 'upcoming' | 'completed' = isCompleted ? 'completed' : 'upcoming';
          
          // Determine trip type (group if multiple members, solo otherwise)
          const memberCount = trip.memberCount || 1;
          const tripType: 'Solo' | 'Group' = memberCount > 1 ? 'Group' : 'Solo';
          
          // Get destination name or use first destination
          const destinationName = trip.firstDestination || trip.title || 'Trip';
          const location = trip.firstDestination || 'Location TBD';
          
          // Fetch city-specific image
          let imageUrl = '';
          try {
            imageUrl = await getOptimizedImageUrl(destinationName, 'thumbnail');
          } catch (err) {
            console.error('Error loading image for', destinationName, err);
          }
          
          // Generate description from trip info
          const description = trip.destinations && trip.destinations.length > 0
            ? `Visiting ${trip.destinations.join(', ')}`
            : `Your ${tripType.toLowerCase()} trip to ${destinationName}`;

          return {
            id: trip.tripId,
            destination: trip.title || destinationName,
            image: imageUrl || '/placeholder-trip.jpg',
            dates: datesStr,
            status: status,
            pointsRedeemed: '0', // TODO: Calculate from points data
            type: tripType,
            travelers: memberCount,
            location: location,
            description: description,
          };
          })
        );
        
        setTrips(transformedTrips);
      } catch (err) {
        console.error('Error fetching trips:', err);
        // Keep empty array on error (don't show dummy data)
        setTrips([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrips();
  }, []);

  const upcomingTrips = trips.filter(t => t.status === 'upcoming');
  const pastTrips = trips.filter(t => t.status === 'completed');

  const TripCard = ({ trip }: { trip: Trip }) => (
    <div
      onClick={() => router.push(`/trips/${trip.id}`)}
      className="group flex overflow-hidden border border-slate-200 rounded-xl hover:shadow-lg transition-all duration-300 bg-white cursor-pointer"
    >
      {/* Image Section - Smaller width */}
      <div className="relative w-32 sm:w-40 shrink-0 bg-slate-100">
        <Image 
          src={trip.image} 
          alt={trip.destination} 
          fill
          className="object-cover"
          sizes="(max-width: 640px) 128px, 160px"
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
          {pastTrips.length > 0 ? (
            <div className="grid md:grid-cols-2 gap-4">
              {pastTrips.map(trip => (
                <TripCard key={trip.id} trip={trip} />
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-slate-500">
              <p>No past trips yet. Start planning your first adventure!</p>
            </div>
          )}
        </section>

        {trips.length === 0 && !isLoading && (
          <div className="text-center py-12">
            <Plane className="w-16 h-16 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-700 mb-2">No trips yet</h3>
            <p className="text-slate-500 mb-6">Start planning your first adventure!</p>
            <Link 
              href="/solo/setup"
              className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm"
            >
              <Plane className="w-4 h-4" />
              Plan New Trip
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
