'use client';

import { useRouter } from 'next/navigation';
import { MapPin, Calendar, CreditCard, Users, Plane, ArrowRight, TrendingUp } from 'lucide-react';

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
}

interface TripCardProps {
    trip: Trip;
}

// Generate gradient colors based on trip type and status
const getGradientColors = (type: 'solo' | 'group', status: string) => {
    if (type === 'solo') {
        if (status === 'completed') {
            return 'from-slate-500 to-slate-600';
        }
        return 'from-blue-500 to-indigo-600';
    } else {
        if (status === 'completed') {
            return 'from-slate-500 to-slate-600';
        }
        return 'from-purple-500 to-pink-600';
    }
};

export function TripCard({ trip }: TripCardProps) {
    const router = useRouter();
    const gradientColors = getGradientColors(trip.type, trip.status);

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
            {/* Gradient Header */}
            <div className={`relative bg-gradient-to-br ${gradientColors} p-6`}>
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

                {/* Destination - with more space at top */}
                <div className="mt-8">
                    <h3 className="text-white text-2xl mb-2 font-bold">{trip.name}</h3>
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

