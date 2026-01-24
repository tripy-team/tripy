'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { MapPin, Calendar, CreditCard, Users, Plane, Hotel, ArrowRight, TrendingUp } from 'lucide-react';
import { getOptimizedImageUrl, getImageDimensions } from '@/lib/image-utils';
import { useState, useEffect } from 'react';

interface Trip {
    id: string;
    name: string;
    destination: string;
    dates: string;
    status: 'upcoming' | 'planning' | 'completed';
    type: 'solo' | 'group';
    pointsUsed: number;
    cashSaved?: number;
    thumbnail: string;
    members: number;
    hotel: string;
    flightClass: string;
}

interface TripCardProps {
    trip: Trip;
}

// Placeholder gradient image (blue gradient SVG)
const PLACEHOLDER_IMAGE = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iNDAwIiBoZWlnaHQ9IjMwMCIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48ZGVmcz48bGluZWFyR3JhZGllbnQgaWQ9ImEiIHgxPSIwJSIgeTE9IjAlIiB4Mj0iMTAwJSIgeTI9IjEwMCUiPjxzdG9wIG9mZnNldD0iMCUiIHN0b3AtY29sb3I9IiM2MzY2RjEiLz48c3RvcCBvZmZzZXQ9IjEwMCUiIHN0b3AtY29sb3I9IiM0NzU1OTkiLz48L2xpbmVhckdyYWRpZW50PjwvZGVmcz48cmVjdCB3aWR0aD0iMTAwJSIgaGVpZ2h0PSIxMDAlIiBmaWxsPSJ1cmwoI2EpIi8+PC9zdmc+';

export function TripCard({ trip }: TripCardProps) {
    const router = useRouter();
    const [imageUrl, setImageUrl] = useState(trip.thumbnail || PLACEHOLDER_IMAGE);
    const [isImageLoading, setIsImageLoading] = useState(true);
    const { width, height } = getImageDimensions('thumbnail');

    useEffect(() => {
        // Load optimized image URL
        getOptimizedImageUrl(trip.destination, 'thumbnail')
            .then((url) => {
                // Only update if we got a valid URL
                if (url && url.trim() !== '') {
                    setImageUrl(url);
                } else {
                    // Keep placeholder if no URL returned
                    setImageUrl(PLACEHOLDER_IMAGE);
                }
            })
            .catch(() => {
                // Fallback to placeholder if optimization fails
                setImageUrl(PLACEHOLDER_IMAGE);
            });
    }, [trip.destination, trip.thumbnail]);

    const getStatusColor = (status: string) => {
        switch (status) {
            case 'upcoming':
                return 'bg-green-100 text-green-700 border-green-200';
            case 'planning':
                return 'bg-yellow-100 text-yellow-700 border-yellow-200';
            case 'completed':
                return 'bg-slate-100 text-slate-700 border-slate-200';
            default:
                return 'bg-slate-100 text-slate-700 border-slate-200';
        }
    };

    return (
        <div
            data-testid={`trip-card-${trip.id}`}
            data-slot="trip-card"
            onClick={() => router.push(`/trips/${trip.id}`)}
            className="bg-white rounded-2xl border border-slate-200 shadow-sm hover:shadow-xl transition-all duration-300 overflow-hidden group cursor-pointer"
        >
            {/* Thumbnail */}
            <div className="relative h-48 overflow-hidden bg-slate-200">
                <Image
                    src={imageUrl}
                    alt={trip.destination}
                    width={width}
                    height={height}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-500"
                    loading="lazy"
                    onLoad={() => setIsImageLoading(false)}
                    onError={() => {
                        // Fallback to placeholder on error
                        setImageUrl(PLACEHOLDER_IMAGE);
                        setIsImageLoading(false);
                    }}
                />
                {isImageLoading && (
                    <div className="absolute inset-0 bg-slate-200 animate-pulse" />
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-black/20 to-transparent"></div>

                {/* Status Badge */}
                <div className={`absolute top-4 right-4 px-3 py-1 rounded-full text-xs border ${getStatusColor(trip.status)} backdrop-blur-sm`}>
                    {trip.status.charAt(0).toUpperCase() + trip.status.slice(1)}
                </div>

                {/* Trip Type Badge */}
                <div className="absolute top-4 left-4 px-3 py-1 rounded-full text-xs bg-white/20 text-white border border-white/30 backdrop-blur-sm flex items-center gap-1">
                    {trip.type === 'solo' ? (
                        <>
                            <Plane className="w-3 h-3" />
                            Solo
                        </>
                    ) : (
                        <>
                            <Users className="w-3 h-3" />
                            Group
                        </>
                    )}
                </div>

                {/* Destination */}
                <div className="absolute bottom-4 left-4 right-4">
                    <h3 className="text-white text-xl mb-1 font-semibold">{trip.name}</h3>
                    <div className="flex items-center gap-2 text-white/90 text-sm">
                        <MapPin className="w-4 h-4" />
                        {trip.destination}
                    </div>
                </div>
            </div>

            {/* Content */}
            <div className="p-6">
                {/* Dates */}
                <div className="flex items-center gap-2 text-slate-600 mb-4 pb-4 border-b border-slate-100">
                    <Calendar className="w-4 h-4 text-blue-600" />
                    <span className="text-sm">{trip.dates}</span>
                </div>

                {/* Details Grid */}
                <div className="space-y-3 mb-4">
                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-slate-600">
                            <CreditCard className="w-4 h-4 text-yellow-600" />
                            <span>Points Used</span>
                        </div>
                        <span className="text-slate-900 font-medium">{trip.pointsUsed.toLocaleString()}</span>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-slate-600">
                            <TrendingUp className="w-4 h-4 text-green-600" />
                            <span>Cash Saved</span>
                        </div>
                        <span className="text-green-600 font-medium">${trip.cashSaved?.toLocaleString() || 0}</span>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-slate-600">
                            <Hotel className="w-4 h-4 text-purple-600" />
                            <span>Hotel</span>
                        </div>
                        <span className="text-slate-900 text-xs text-right max-w-[150px] truncate font-medium">{trip.hotel}</span>
                    </div>

                    <div className="flex items-center justify-between text-sm">
                        <div className="flex items-center gap-2 text-slate-600">
                            <Plane className="w-4 h-4 text-blue-600" />
                            <span>Flight</span>
                        </div>
                        <span className="text-slate-900 font-medium">{trip.flightClass}</span>
                    </div>

                    {trip.type === 'group' && (
                        <div className="flex items-center justify-between text-sm">
                            <div className="flex items-center gap-2 text-slate-600">
                                <Users className="w-4 h-4 text-pink-600" />
                                <span>Members</span>
                            </div>
                            <span className="text-slate-900 font-medium">{trip.members}</span>
                        </div>
                    )}
                </div>

                {/* Action Button */}
                <button
                    onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/trips/${trip.id}`);
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all group/btn font-medium"
                >
                    <span>View Details</span>
                    <ArrowRight className="w-4 h-4 group-hover/btn:translate-x-1 transition-transform" />
                </button>
            </div>
        </div>
    );
}

