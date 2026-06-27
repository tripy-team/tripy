'use client';

import { Plane, Calendar, MapPin, Users, User, Trash2, X, Check, Crown, UserPlus, Loader2, Search } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { trips as tripsAPI } from '@/lib/api';

interface Trip {
  id: string;
  destination: string;
  dates: string;
  status: 'planning' | 'upcoming' | 'completed';
  pointsRedeemed: string;
  type: 'Solo' | 'Group';
  travelers: number;
  location: string;
  description: string;
  role: 'owner' | 'member';
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
  // User's flight preferences from membership
  userDepartureAirport?: string;
  userArrivalAirport?: string;
  userIsRoundTrip?: boolean;
}

type TripFilter = 'all' | 'created' | 'joined';

// Initial batch size for fast loading, then load more
const INITIAL_LOAD_LIMIT = 12;
const LOAD_MORE_BATCH_SIZE = 20;

// Transform API trip to display format - memoized outside component
function transformApiTrip(trip: ApiTrip): Trip {
  const startDate = trip.startDate ? new Date(trip.startDate) : null;
  const endDate = trip.endDate ? new Date(trip.endDate) : null;
  const now = new Date();
  
  let datesStr = 'TBD';
  if (startDate && endDate) {
    datesStr = `${startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else if (startDate) {
    datesStr = startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  
  let status: 'planning' | 'upcoming' | 'completed' = 'planning';
  if (endDate && endDate < now) {
    status = 'completed';
  } else if (startDate) {
    status = 'upcoming';
  }
  
  const memberCount = trip.memberCount || 1;
  const tripType: 'Solo' | 'Group' = memberCount > 1 ? 'Group' : 'Solo';
  const destinationName = trip.firstDestination || trip.title || 'Trip';
  
  // Build intuitive title showing route: "SEA → Paris" or "SEA → Paris → SEA"
  const departureAirport = trip.userDepartureAirport;
  const arrivalAirport = trip.userArrivalAirport;
  const isRoundTrip = trip.userIsRoundTrip !== false; // default true
  
  let displayTitle: string;
  let location: string;
  
  if (departureAirport && destinationName && destinationName !== 'Trip') {
    // Build route-style title
    if (isRoundTrip) {
      // Round trip: "SEA → Paris → SEA"
      displayTitle = `${departureAirport} → ${destinationName} → ${departureAirport}`;
    } else if (arrivalAirport && arrivalAirport !== departureAirport) {
      // One-way with different arrival: "SEA → Paris → JFK"
      displayTitle = `${departureAirport} → ${destinationName} → ${arrivalAirport}`;
    } else {
      // One-way: "SEA → Paris"
      displayTitle = `${departureAirport} → ${destinationName}`;
    }
    location = destinationName;
  } else {
    // Fallback to destination name only
    displayTitle = destinationName;
    location = trip.firstDestination || 'Location TBD';
  }
  
  const description = trip.destinations && trip.destinations.length > 0
    ? `Visiting ${trip.destinations.join(', ')}`
    : `Your ${tripType.toLowerCase()} trip to ${destinationName}`;

  return {
    id: trip.tripId,
    destination: displayTitle,
    dates: datesStr,
    status,
    pointsRedeemed: '0',
    type: tripType,
    travelers: memberCount,
    location,
    description,
    role: (trip.role === 'owner' ? 'owner' : 'member') as 'owner' | 'member',
  };
}

export default function MyTripsPage() {
  const router = useRouter();
  const [trips, setTrips] = useState<Trip[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [totalTrips, setTotalTrips] = useState(0);
  const [isManageMode, setIsManageMode] = useState(false);
  const [selectedTripIds, setSelectedTripIds] = useState<Set<string>>(new Set());
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [tripFilter, setTripFilter] = useState<TripFilter>('all');
  
  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [showSearchResults, setShowSearchResults] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  
  // Close search dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (searchRef.current && !searchRef.current.contains(event.target as Node)) {
        setShowSearchResults(false);
      }
    };
    
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Initial load - fetch first batch quickly without details
  useEffect(() => {
    const fetchTrips = async () => {
      try {
        setIsLoading(true);
        const response = await tripsAPI.list({ 
          limit: INITIAL_LOAD_LIMIT,
          offset: 0,
          includeDetails: false  // Fast mode - skip expensive DB calls
        });
        
        // Transform API trips to display format
        const transformedTrips: Trip[] = response.trips.map(transformApiTrip);
        
        setTrips(transformedTrips);
        setTotalTrips(response.total || transformedTrips.length);
        setHasMore(response.has_more || false);
      } catch (err) {
        console.error('Error fetching trips:', err);
        setTrips([]);
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrips();
  }, []);

  // Load more trips when user navigates past current loaded trips
  const loadMoreTrips = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;
    
    try {
      setIsLoadingMore(true);
      const response = await tripsAPI.list({
        limit: LOAD_MORE_BATCH_SIZE,
        offset: trips.length,
        includeDetails: false
      });
      
      const newTrips = response.trips.map(transformApiTrip);
      setTrips(prev => [...prev, ...newTrips]);
      setHasMore(response.has_more || false);
    } catch (err) {
      console.error('Error loading more trips:', err);
    } finally {
      setIsLoadingMore(false);
    }
  }, [trips.length, hasMore, isLoadingMore]);

  const handleToggleManageMode = () => {
    setIsManageMode(!isManageMode);
    setSelectedTripIds(new Set());
  };

  const handleToggleSelectTrip = (tripId: string) => {
    const newSelected = new Set(selectedTripIds);
    if (newSelected.has(tripId)) {
      newSelected.delete(tripId);
    } else {
      newSelected.add(tripId);
    }
    setSelectedTripIds(newSelected);
  };

  const handleDeleteSelected = () => {
    if (selectedTripIds.size === 0) return;
    setShowDeleteModal(true);
  };

  const handleDeleteConfirm = async () => {
    if (selectedTripIds.size === 0) return;

    try {
      setIsDeleting(true);
      
      // Delete all selected trips
      const deletePromises = Array.from(selectedTripIds).map(tripId =>
        tripsAPI.delete(tripId)
      );
      
      await Promise.all(deletePromises);
      
      // Remove deleted trips from state
      setTrips(trips.filter(t => !selectedTripIds.has(t.id)));
      setSelectedTripIds(new Set());
      setShowDeleteModal(false);
      setIsManageMode(false);
    } catch (err) {
      console.error('Error deleting trips:', err);
      alert('Failed to delete some trips. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  const handleDeleteCancel = () => {
    setShowDeleteModal(false);
  };

  // Memoized filtered trips for performance
  const filteredTrips = useMemo(() => {
    return trips.filter(t => {
      if (tripFilter === 'created') return t.role === 'owner';
      if (tripFilter === 'joined') return t.role === 'member';
      return true;
    });
  }, [trips, tripFilter]);

  const planningTrips = useMemo(() => filteredTrips.filter(t => t.status === 'planning'), [filteredTrips]);
  const upcomingTrips = useMemo(() => filteredTrips.filter(t => t.status === 'upcoming'), [filteredTrips]);
  const pastTrips = useMemo(() => filteredTrips.filter(t => t.status === 'completed'), [filteredTrips]);
  
  // Count trips by role for filter badges
  const createdCount = useMemo(() => trips.filter(t => t.role === 'owner').length, [trips]);
  const joinedCount = useMemo(() => trips.filter(t => t.role === 'member').length, [trips]);

  // Search results - filter trips by destination/location matching search query
  const searchResults = useMemo(() => {
    if (!searchQuery.trim()) return [];
    const query = searchQuery.toLowerCase().trim();
    return trips.filter(t => 
      t.destination.toLowerCase().includes(query) ||
      t.location.toLowerCase().includes(query) ||
      t.description.toLowerCase().includes(query)
    ).slice(0, 8); // Limit dropdown results
  }, [trips, searchQuery]);

  // Trip card component
  const TripCard = ({ trip }: { trip: Trip }) => {
    const isSelected = selectedTripIds.has(trip.id);
    
    return (
      <div
        className={`group overflow-hidden border rounded-xl hover:shadow-lg transition-all duration-300 bg-white relative min-h-[160px] flex flex-col ${
          isManageMode ? 'cursor-pointer' : 'cursor-pointer'
        } ${
          isSelected ? 'border-blue-500 ring-2 ring-blue-200' : 'border-slate-200'
        }`}
        onClick={() => {
          if (isManageMode) {
            handleToggleSelectTrip(trip.id);
          } else {
            router.push(`/trips/${trip.id}`);
          }
        }}
      >
        {/* Selection Checkbox in Manage Mode */}
        {isManageMode && (
          <div className="absolute top-3 left-3 z-10">
            <div
              className={`w-6 h-6 rounded-md border-2 flex items-center justify-center transition-all ${
                isSelected
                  ? 'bg-blue-600 border-blue-600'
                  : 'bg-white border-slate-300 group-hover:border-blue-400'
              }`}
            >
              {isSelected && <Check className="w-4 h-4 text-white" />}
            </div>
          </div>
        )}

        {/* Content Section */}
        <div className={`flex flex-col p-5 gap-3 flex-1 ${isManageMode ? 'pl-12' : ''}`}>
          {/* Top: Badges */}
          <div className="flex items-center gap-1.5 flex-wrap">
            {/* Role Badge */}
            <span className={`text-[10px] px-2 py-1 font-medium rounded-full flex items-center gap-1 ${
              trip.role === 'owner'
                ? 'bg-amber-50 text-amber-700'
                : 'bg-emerald-50 text-emerald-700'
            }`}>
              {trip.role === 'owner' ? <Crown className="w-3 h-3" /> : <UserPlus className="w-3 h-3" />}
              {trip.role === 'owner' ? 'Owner' : 'Member'}
            </span>
            {/* Type Badge */}
            <span className={`text-[10px] px-2 py-1 font-medium rounded-full flex items-center gap-1 ${
              trip.type === 'Solo' ? 'bg-indigo-50 text-indigo-700' : 'bg-pink-50 text-pink-700'
            }`}>
              {trip.type === 'Solo' ? <User className="w-3 h-3" /> : <Users className="w-3 h-3" />}
              {trip.type === 'Solo' ? 'Solo' : `${trip.travelers} travelers`}
            </span>
          </div>
          
          {/* Title - now wraps instead of truncating */}
          <div>
            <h3 className="font-bold text-slate-900 leading-snug text-base break-words">{trip.destination}</h3>
            <div className="flex items-center gap-1.5 text-xs text-slate-500 mt-1.5">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span>{trip.location}</span>
            </div>
          </div>

          {/* Bottom: Date and status */}
          <div className="flex items-center justify-between mt-auto pt-3 border-t border-slate-100">
            <div className="flex items-center gap-1.5 text-xs text-slate-600 font-medium">
              <Calendar className="w-3.5 h-3.5 text-slate-400" />
              {trip.dates}
            </div>
            <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              trip.status === 'planning' ? 'bg-purple-50 text-purple-700' :
              trip.status === 'upcoming' ? 'bg-blue-50 text-blue-700' :
              'bg-slate-100 text-slate-600'
            }`}>
              {trip.status === 'planning' ? 'Planning' : trip.status === 'upcoming' ? 'Upcoming' : 'Completed'}
            </span>
          </div>
        </div>
      </div>
    );
  };

  // Trip section component
  const TripSection = ({ 
    title, 
    trips: sectionTrips, 
    colorClass 
  }: { 
    title: string; 
    trips: Trip[]; 
    colorClass: string;
  }) => {
    if (sectionTrips.length === 0) return null;

    return (
      <section className="mb-8">
        <div className="flex items-center gap-3 mb-4">
          <h2 className={`text-xs font-bold uppercase tracking-wider ${colorClass}`}>{title}</h2>
          <span className="text-xs text-slate-400">({sectionTrips.length})</span>
          <div className="h-px flex-1 bg-slate-200"></div>
        </div>
        
        {/* Trip cards grid - wider cards for route titles */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
          {sectionTrips.map(trip => (
            <TripCard key={trip.id} trip={trip} />
          ))}
        </div>
      </section>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50/50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <div className="flex flex-col sm:flex-row justify-between items-center mb-8 gap-4">
          <div className="text-center sm:text-left">
            <h1 className="text-2xl font-bold text-slate-900">My Trips</h1>
            <p className="text-sm text-slate-500 mt-1">Track your points usage and travel history</p>
          </div>
          <div className="flex gap-3">
            {!isManageMode ? (
              <>
                <button
                  onClick={handleToggleManageMode}
                  className="flex items-center gap-2 bg-slate-100 text-slate-700 px-5 py-2 rounded-xl font-medium hover:bg-slate-200 transition-colors text-sm"
                >
                  <Trash2 className="w-4 h-4" />
                  Manage Trips
                </button>
                <Link 
                  href="/plan"
                  className="flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm text-sm"
                >
                  <Plane className="w-4 h-4" />
                  Plan New Trip
                </Link>
              </>
            ) : (
              <>
                <button
                  onClick={handleToggleManageMode}
                  className="flex items-center gap-2 bg-slate-100 text-slate-700 px-5 py-2 rounded-xl font-medium hover:bg-slate-200 transition-colors text-sm"
                >
                  <X className="w-4 h-4" />
                  Cancel
                </button>
                <button
                  onClick={handleDeleteSelected}
                  disabled={selectedTripIds.size === 0}
                  className="flex items-center gap-2 bg-red-600 text-white px-5 py-2 rounded-xl font-medium hover:bg-red-700 transition-colors shadow-sm text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-4 h-4" />
                  Delete {selectedTripIds.size > 0 && `(${selectedTripIds.size})`}
                </button>
              </>
            )}
          </div>
        </div>

        {/* Search Bar */}
        <div className="relative mb-6" ref={searchRef}>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search trips by destination..."
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setShowSearchResults(e.target.value.trim().length > 0);
              }}
              onFocus={() => {
                if (searchQuery.trim()) setShowSearchResults(true);
              }}
              className="w-full pl-10 pr-4 py-2.5 bg-white border border-slate-200 rounded-xl text-sm placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setShowSearchResults(false);
                }}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
          
          {/* Search Results Dropdown */}
          {showSearchResults && searchQuery.trim() && (
            <div className="absolute top-full left-0 right-0 mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-50 max-h-80 overflow-y-auto">
              {searchResults.length > 0 ? (
                <div className="py-2">
                  <div className="px-3 py-1.5 text-xs font-medium text-slate-400 uppercase">
                    {searchResults.length} trip{searchResults.length !== 1 ? 's' : ''} found
                  </div>
                  {searchResults.map(trip => (
                    <button
                      key={trip.id}
                      onClick={() => {
                        router.push(`/trips/${trip.id}`);
                        setShowSearchResults(false);
                        setSearchQuery('');
                      }}
                      className="w-full px-3 py-2.5 flex items-start gap-3 hover:bg-slate-50 transition-colors text-left"
                    >
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center">
                        <MapPin className="w-4 h-4 text-blue-600" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-slate-900 truncate">{trip.destination}</div>
                        <div className="text-xs text-slate-500 flex items-center gap-2">
                          <span>{trip.location}</span>
                          <span>•</span>
                          <span>{trip.dates}</span>
                        </div>
                      </div>
                      <div className="flex-shrink-0">
                        <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${
                          trip.status === 'planning' ? 'bg-purple-50 text-purple-700' :
                          trip.status === 'upcoming' ? 'bg-blue-50 text-blue-700' :
                          'bg-slate-100 text-slate-600'
                        }`}>
                          {trip.status === 'planning' ? 'Planning' : trip.status === 'upcoming' ? 'Upcoming' : 'Past'}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="px-4 py-6 text-center text-sm text-slate-500">
                  No trips found for &quot;{searchQuery}&quot;
                </div>
              )}
            </div>
          )}
        </div>

        {/* Trip Filter Tabs */}
        <div className="flex gap-2 mb-6">
          <button
            onClick={() => setTripFilter('all')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tripFilter === 'all'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            All Trips ({trips.length})
          </button>
          <button
            onClick={() => setTripFilter('created')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tripFilter === 'created'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Created ({createdCount})
          </button>
          <button
            onClick={() => setTripFilter('joined')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              tripFilter === 'joined'
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Joined ({joinedCount})
          </button>
        </div>

        {isManageMode && (
          <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-xl">
            <p className="text-sm text-blue-800">
              Select the trips you want to delete, then click the Delete button.
            </p>
          </div>
        )}

        {/* Loading State */}
        {isLoading && (
          <div className="flex flex-col items-center justify-center py-16">
            <Loader2 className="w-10 h-10 text-blue-600 animate-spin mb-4" />
            <p className="text-slate-500">Loading your trips...</p>
          </div>
        )}

        {/* Trip Sections - only show when not loading */}
        {!isLoading && (
          <>
            {/* Quick summary stats */}
            {(filteredTrips.length > 0 || totalTrips > 0) && (
              <div className="flex items-center flex-wrap gap-4 mb-6 pb-4 border-b border-slate-100">
                <div className="flex items-center gap-2 text-sm text-slate-600">
                  <span className="font-medium">
                    {tripFilter === 'all' ? (
                      hasMore ? `${trips.length} of ${totalTrips}` : trips.length
                    ) : filteredTrips.length}
                  </span>
                  <span>trip{(tripFilter === 'all' ? totalTrips : filteredTrips.length) !== 1 ? 's' : ''}</span>
                  {hasMore && tripFilter === 'all' && (
                    <span className="text-xs text-slate-400">(showing first {trips.length})</span>
                  )}
                </div>
                {planningTrips.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-purple-600 bg-purple-50 px-2 py-1 rounded-full">
                    <span className="font-semibold">{planningTrips.length}</span> planning
                  </div>
                )}
                {upcomingTrips.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-full">
                    <span className="font-semibold">{upcomingTrips.length}</span> upcoming
                  </div>
                )}
                {pastTrips.length > 0 && (
                  <div className="flex items-center gap-1.5 text-xs text-slate-500 bg-slate-100 px-2 py-1 rounded-full">
                    <span className="font-semibold">{pastTrips.length}</span> completed
                  </div>
                )}
              </div>
            )}

            {/* In Planning Section */}
            <TripSection
              title="In Planning"
              trips={planningTrips}
              colorClass="text-purple-500"
            />

            {/* Upcoming Adventures Section */}
            <TripSection
              title="Upcoming Adventures"
              trips={upcomingTrips}
              colorClass="text-blue-500"
            />

            {/* Past Memories Section */}
            <TripSection
              title="Past Memories"
              trips={pastTrips}
              colorClass="text-slate-400"
            />

            {/* Load More Trips from Server Button */}
            {hasMore && (
              <div className="flex justify-center mt-6 mb-8">
                <button
                  onClick={loadMoreTrips}
                  disabled={isLoadingMore}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 shadow-sm"
                >
                  {isLoadingMore ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Loading more trips...
                    </>
                  ) : (
                    <>
                      Load More Trips
                      <span className="text-xs text-blue-200">
                        ({totalTrips - trips.length} remaining)
                      </span>
                    </>
                  )}
                </button>
              </div>
            )}

            {/* Empty State - only show when no trips at all */}
            {filteredTrips.length === 0 && (
              <div className="text-center py-12">
                {tripFilter === 'joined' ? (
                  <>
                    <UserPlus className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">No joined trips</h3>
                    <p className="text-slate-500 mb-6">Join a group trip using an invite link to see it here!</p>
                  </>
                ) : tripFilter === 'created' ? (
                  <>
                    <Crown className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">No trips created</h3>
                    <p className="text-slate-500 mb-6">Create your first trip to get started!</p>
                    <Link 
                      href="/plan"
                      className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      <Plane className="w-4 h-4" />
                      Plan New Trip
                    </Link>
                  </>
                ) : (
                  <>
                    <Plane className="w-16 h-16 text-slate-300 mx-auto mb-4" />
                    <h3 className="text-lg font-semibold text-slate-700 mb-2">No trips yet</h3>
                    <p className="text-slate-500 mb-6">Start planning your first adventure!</p>
                    <Link 
                      href="/plan"
                      className="inline-flex items-center gap-2 bg-blue-600 text-white px-5 py-2 rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-sm"
                    >
                      <Plane className="w-4 h-4" />
                      Plan New Trip
                    </Link>
                  </>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-6 shadow-xl">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-12 h-12 bg-red-100 rounded-full flex items-center justify-center">
                <Trash2 className="w-6 h-6 text-red-600" />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900">Delete {selectedTripIds.size} Trip{selectedTripIds.size > 1 ? 's' : ''}</h3>
                <p className="text-sm text-slate-500">This action cannot be undone</p>
              </div>
            </div>
            
            <div className="mb-6">
              <p className="text-slate-700 mb-2">
                Are you sure you want to delete {selectedTripIds.size} trip{selectedTripIds.size > 1 ? 's' : ''}?
              </p>
              <p className="text-sm text-slate-500">
                All trip data, including destinations, itineraries, and points information will be permanently removed.
              </p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={handleDeleteCancel}
                disabled={isDeleting}
                className="flex-1 px-4 py-3 bg-slate-100 text-slate-700 rounded-xl font-medium hover:bg-slate-200 transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteConfirm}
                disabled={isDeleting}
                className="flex-1 px-4 py-3 bg-red-600 text-white rounded-xl font-medium hover:bg-red-700 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isDeleting ? (
                  <>
                    <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="w-4 h-4" />
                    Delete Trip{selectedTripIds.size > 1 ? 's' : ''}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
