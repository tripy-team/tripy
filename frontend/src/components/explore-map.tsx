'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { MapPin, Plane, TrendingUp, Star, ArrowRight, Search } from 'lucide-react';
import dynamic from 'next/dynamic';

// Dynamically import Leaflet components to avoid SSR issues
const MapContainer = dynamic(
    () => import('react-leaflet').then((mod) => mod.MapContainer),
    { ssr: false }
);
const TileLayer = dynamic(
    () => import('react-leaflet').then((mod) => mod.TileLayer),
    { ssr: false }
);
const Marker = dynamic(
    () => import('react-leaflet').then((mod) => mod.Marker),
    { ssr: false }
);
const Popup = dynamic(
    () => import('react-leaflet').then((mod) => mod.Popup),
    { ssr: false }
);

interface Destination {
    id: string;
    name: string;
    country: string;
    lat: number;
    lng: number;
    avgPoints: number;
    avgCash: number;
    popularity: number;
    image: string;
    description: string;
    bestTime: string;
    category: 'beach' | 'city' | 'adventure' | 'culture';
}

export function ExploreMap() {
    const [selectedDestination, setSelectedDestination] = useState<Destination | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [categoryFilter, setCategoryFilter] = useState<string>('all');
    const [isMounted, setIsMounted] = useState(false);

    useEffect(() => {
        setIsMounted(true);
    }, []);

    const destinations: Destination[] = [
        {
            id: '1',
            name: 'Tokyo',
            country: 'Japan',
            lat: 35.6762,
            lng: 139.6503,
            avgPoints: 85000,
            avgCash: 450,
            popularity: 95,
            image: 'https://images.unsplash.com/photo-1540959733332-eab4deabeeaf?w=400&q=80',
            description: 'Modern metropolis blending tradition with cutting-edge technology',
            bestTime: 'March - May, September - November',
            category: 'city'
        },
        {
            id: '2',
            name: 'Paris',
            country: 'France',
            lat: 48.8566,
            lng: 2.3522,
            avgPoints: 75000,
            avgCash: 650,
            popularity: 98,
            image: 'https://images.unsplash.com/photo-1502602898657-3e91760cbb34?w=400&q=80',
            description: 'City of lights, art, fashion, and romance',
            bestTime: 'April - June, September - October',
            category: 'city'
        },
        {
            id: '3',
            name: 'Bali',
            country: 'Indonesia',
            lat: -8.4095,
            lng: 115.1889,
            avgPoints: 65000,
            avgCash: 320,
            popularity: 92,
            image: 'https://images.unsplash.com/photo-1537996194471-e657df975ab4?w=400&q=80',
            description: 'Tropical paradise with temples, beaches, and rice terraces',
            bestTime: 'April - October',
            category: 'beach'
        },
        {
            id: '4',
            name: 'New York',
            country: 'USA',
            lat: 40.7128,
            lng: -74.0060,
            avgPoints: 45000,
            avgCash: 500,
            popularity: 96,
            image: 'https://images.unsplash.com/photo-1496442226666-8d4d0e62e6e9?w=400&q=80',
            description: 'The city that never sleeps, cultural melting pot',
            bestTime: 'April - June, September - November',
            category: 'city'
        },
        {
            id: '5',
            name: 'Dubai',
            country: 'UAE',
            lat: 25.2048,
            lng: 55.2708,
            avgPoints: 95000,
            avgCash: 700,
            popularity: 89,
            image: 'https://images.unsplash.com/photo-1512453979798-5ea266f8880c?w=400&q=80',
            description: 'Luxury shopping, ultramodern architecture, and desert adventures',
            bestTime: 'November - March',
            category: 'city'
        },
        {
            id: '6',
            name: 'Santorini',
            country: 'Greece',
            lat: 36.3932,
            lng: 25.4615,
            avgPoints: 70000,
            avgCash: 550,
            popularity: 94,
            image: 'https://images.unsplash.com/photo-1613395877344-13d4a8e0d49e?w=400&q=80',
            description: 'Iconic white-washed buildings with stunning sunset views',
            bestTime: 'April - November',
            category: 'beach'
        },
        {
            id: '7',
            name: 'Machu Picchu',
            country: 'Peru',
            lat: -13.1631,
            lng: -72.5450,
            avgPoints: 80000,
            avgCash: 480,
            popularity: 91,
            image: 'https://images.unsplash.com/photo-1587595431973-160d0d94add1?w=400&q=80',
            description: 'Ancient Incan citadel set high in the Andes Mountains',
            bestTime: 'May - September',
            category: 'adventure'
        },
        {
            id: '8',
            name: 'Singapore',
            country: 'Singapore',
            lat: 1.3521,
            lng: 103.8198,
            avgPoints: 55000,
            avgCash: 420,
            popularity: 87,
            image: 'https://images.unsplash.com/photo-1525625293386-3f8f99389edd?w=400&q=80',
            description: 'Futuristic city-state with incredible food and gardens',
            bestTime: 'February - April',
            category: 'city'
        },
        {
            id: '9',
            name: 'Rome',
            country: 'Italy',
            lat: 41.9028,
            lng: 12.4964,
            avgPoints: 72000,
            avgCash: 580,
            popularity: 97,
            image: 'https://images.unsplash.com/photo-1552832230-c0197dd311b5?w=400&q=80',
            description: 'Eternal city filled with ancient history and incredible cuisine',
            bestTime: 'April - June, September - October',
            category: 'culture'
        },
        {
            id: '10',
            name: 'Maldives',
            country: 'Maldives',
            lat: 3.2028,
            lng: 73.2207,
            avgPoints: 110000,
            avgCash: 850,
            popularity: 93,
            image: 'https://images.unsplash.com/photo-1514282401047-d79a71a590e8?w=400&q=80',
            description: 'Luxury overwater bungalows and pristine coral reefs',
            bestTime: 'November - April',
            category: 'beach'
        },
        {
            id: '11',
            name: 'Iceland',
            country: 'Iceland',
            lat: 64.9631,
            lng: -19.0208,
            avgPoints: 88000,
            avgCash: 620,
            popularity: 88,
            image: 'https://images.unsplash.com/photo-1504829857797-ddff29c27927?w=400&q=80',
            description: 'Land of fire and ice with geysers, glaciers, and Northern Lights',
            bestTime: 'June - August (summer), September - March (Northern Lights)',
            category: 'adventure'
        },
        {
            id: '12',
            name: 'Sydney',
            country: 'Australia',
            lat: -33.8688,
            lng: 151.2093,
            avgPoints: 105000,
            avgCash: 720,
            popularity: 90,
            image: 'https://images.unsplash.com/photo-1506973035872-a4ec16b8e8d9?w=400&q=80',
            description: 'Iconic harbor city with beaches, Opera House, and vibrant culture',
            bestTime: 'September - November, March - May',
            category: 'city'
        },
        {
            id: '13',
            name: 'Cape Town',
            country: 'South Africa',
            lat: -33.9249,
            lng: 18.4241,
            avgPoints: 78000,
            avgCash: 380,
            popularity: 86,
            image: 'https://images.unsplash.com/photo-1580060839134-75a5edca2e99?w=400&q=80',
            description: 'Stunning coastline meets Table Mountain with rich culture',
            bestTime: 'November - March',
            category: 'adventure'
        },
        {
            id: '14',
            name: 'Kyoto',
            country: 'Japan',
            lat: 35.0116,
            lng: 135.7681,
            avgPoints: 82000,
            avgCash: 420,
            popularity: 94,
            image: 'https://images.unsplash.com/photo-1493976040374-85c8e12f0c0e?w=400&q=80',
            description: 'Ancient temples, traditional gardens, and geisha culture',
            bestTime: 'March - May, October - November',
            category: 'culture'
        },
        {
            id: '15',
            name: 'Barcelona',
            country: 'Spain',
            lat: 41.3851,
            lng: 2.1734,
            avgPoints: 68000,
            avgCash: 480,
            popularity: 93,
            image: 'https://images.unsplash.com/photo-1583422409516-2895a77efded?w=400&q=80',
            description: 'Gaudí architecture, beaches, and vibrant nightlife',
            bestTime: 'May - June, September - October',
            category: 'city'
        }
    ];

    const filteredDestinations = destinations.filter(dest => {
        const matchesSearch = dest.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            dest.country.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesCategory = categoryFilter === 'all' || dest.category === categoryFilter;
        return matchesSearch && matchesCategory;
    });

    const categories = [
        { id: 'all', label: 'All Destinations', icon: '🌍' },
        { id: 'city', label: 'Cities', icon: '🏙️' },
        { id: 'beach', label: 'Beaches', icon: '🏖️' },
        { id: 'adventure', label: 'Adventure', icon: '⛰️' },
        { id: 'culture', label: 'Culture', icon: '🏛️' }
    ];

    const getCategoryColor = (category: string) => {
        switch (category) {
            case 'city': return '#3b82f6';
            case 'beach': return '#06b6d4';
            case 'adventure': return '#22c55e';
            case 'culture': return '#a855f7';
            default: return '#3b82f6';
        }
    };

    return (
        <div className="grid lg:grid-cols-3 gap-6">
            {/* Left Side - Map and Search */}
            <div className="lg:col-span-2 space-y-6">
                {/* Search and Filter */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                    <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1 relative">
                            <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 w-5 h-5 text-slate-400" />
                            <input
                                type="text"
                                placeholder="Search destinations..."
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                className="w-full pl-12 pr-4 py-3 bg-slate-50 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                            />
                        </div>
                    </div>

                    {/* Category Pills */}
                    <div className="flex flex-wrap gap-2 mt-4">
                        {categories.map(cat => (
                            <button
                                key={cat.id}
                                onClick={() => setCategoryFilter(cat.id)}
                                className={`px-4 py-2 rounded-xl text-sm transition-all font-medium ${categoryFilter === cat.id
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/20'
                                    : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                                    }`}
                            >
                                <span className="mr-2">{cat.icon}</span>
                                {cat.label}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Interactive Map */}
                <div className="bg-white rounded-2xl p-6 border border-slate-200 shadow-sm">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl text-slate-900 font-semibold">Explore Popular Destinations</h2>
                        <span className="text-sm text-slate-500">{filteredDestinations.length} destinations</span>
                    </div>

                    <div className="relative w-full h-[500px] rounded-2xl overflow-hidden">
                        {isMounted ? (
                            <MapWithMarkers
                                destinations={filteredDestinations}
                                selectedDestination={selectedDestination}
                                onSelectDestination={setSelectedDestination}
                                getCategoryColor={getCategoryColor}
                            />
                        ) : (
                            <div className="w-full h-full bg-slate-100 animate-pulse flex items-center justify-center">
                                <div className="text-slate-400">Loading map...</div>
                            </div>
                        )}
                    </div>

                    {/* Map Legend */}
                    <div className="mt-4 flex flex-wrap gap-4 text-sm">
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-blue-500"></div>
                            <span className="text-slate-600">Cities</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-cyan-500"></div>
                            <span className="text-slate-600">Beaches</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-green-500"></div>
                            <span className="text-slate-600">Adventure</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="w-3 h-3 rounded-full bg-purple-500"></div>
                            <span className="text-slate-600">Culture</span>
                        </div>
                        <div className="flex items-center gap-2 ml-auto">
                            <span className="text-slate-500 text-xs">💡 Click markers for details</span>
                        </div>
                    </div>
                </div>
            </div>

            {/* Right Side - Destination Details */}
            <div className="lg:col-span-1">
                {selectedDestination ? (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden sticky top-4">
                        {/* Image */}
                        <div className="relative h-48">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                                src={selectedDestination.image}
                                alt={selectedDestination.name}
                                className="w-full h-full object-cover"
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                            <div className="absolute bottom-4 left-4 right-4">
                                <h3 className="text-white text-2xl mb-1 font-semibold">{selectedDestination.name}</h3>
                                <div className="flex items-center gap-2 text-white/90 text-sm">
                                    <MapPin className="w-4 h-4" />
                                    {selectedDestination.country}
                                </div>
                            </div>

                            {/* Popularity Badge */}
                            <div className="absolute top-4 right-4 px-3 py-1 bg-white/20 backdrop-blur-sm rounded-full border border-white/30 flex items-center gap-1">
                                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                                <span className="text-white text-xs font-medium">{selectedDestination.popularity}% Popular</span>
                            </div>

                            {/* Category Badge */}
                            <div 
                                className="absolute top-4 left-4 px-3 py-1 rounded-full text-xs font-medium text-white"
                                style={{ backgroundColor: getCategoryColor(selectedDestination.category) }}
                            >
                                {selectedDestination.category.charAt(0).toUpperCase() + selectedDestination.category.slice(1)}
                            </div>
                        </div>

                        {/* Content */}
                        <div className="p-6">
                            <p className="text-slate-600 mb-4 text-sm leading-relaxed">
                                {selectedDestination.description}
                            </p>

                            {/* Stats */}
                            <div className="space-y-3 mb-4 pb-4 border-b border-slate-100">
                                <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2 text-slate-600">
                                        <TrendingUp className="w-4 h-4 text-yellow-600" />
                                        <span>Avg. Points</span>
                                    </div>
                                    <span className="text-slate-900 font-medium">{selectedDestination.avgPoints.toLocaleString()}</span>
                                </div>

                                <div className="flex items-center justify-between text-sm">
                                    <div className="flex items-center gap-2 text-slate-600">
                                        <span className="text-green-600 font-semibold">$</span>
                                        <span>Avg. Cash</span>
                                    </div>
                                    <span className="text-slate-900 font-medium">${selectedDestination.avgCash}</span>
                                </div>

                                <div className="flex items-start justify-between text-sm">
                                    <div className="flex items-center gap-2 text-slate-600">
                                        <Plane className="w-4 h-4 text-blue-600" />
                                        <span>Best Time</span>
                                    </div>
                                    <span className="text-slate-900 text-right text-xs max-w-[150px] font-medium">
                                        {selectedDestination.bestTime}
                                    </span>
                                </div>
                            </div>

                            {/* Actions */}
                            <div className="space-y-2">
                                <Link
                                    href="/solo/setup"
                                    className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all group font-medium"
                                >
                                    <span>Plan Trip Here</span>
                                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                                </Link>
                                <button className="w-full px-4 py-3 bg-slate-100 text-slate-700 rounded-xl hover:bg-slate-200 transition-all text-sm font-medium">
                                    View Flight Deals
                                </button>
                            </div>
                        </div>
                    </div>
                ) : (
                    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 text-center sticky top-4">
                        <div className="w-16 h-16 bg-blue-100 rounded-full flex items-center justify-center mx-auto mb-4">
                            <MapPin className="w-8 h-8 text-blue-600" />
                        </div>
                        <h3 className="text-xl mb-2 text-slate-900 font-semibold">Select a Destination</h3>
                        <p className="text-slate-600 text-sm">
                            Click on any marker on the map to view destination details and start planning your trip
                        </p>
                    </div>
                )}
            </div>
        </div>
    );
}

// Separate component for the map to handle Leaflet properly
function MapWithMarkers({
    destinations,
    selectedDestination,
    onSelectDestination,
    getCategoryColor
}: {
    destinations: Destination[];
    selectedDestination: Destination | null;
    onSelectDestination: (dest: Destination) => void;
    getCategoryColor: (category: string) => string;
}) {
    const [leafletLoaded, setLeafletLoaded] = useState(false);
    const [L, setL] = useState<typeof import('leaflet') | null>(null);

    useEffect(() => {
        // Import Leaflet on the client side
        import('leaflet').then((leaflet) => {
            setL(leaflet.default);
            setLeafletLoaded(true);
        });
    }, []);

    if (!leafletLoaded || !L) {
        return (
            <div className="w-full h-full bg-slate-100 animate-pulse flex items-center justify-center">
                <div className="text-slate-400">Loading map...</div>
            </div>
        );
    }

    // Create custom icons for each category
    const createIcon = (color: string, isSelected: boolean) => {
        return L.divIcon({
            className: 'custom-marker',
            html: `
                <div style="
                    width: ${isSelected ? '24px' : '16px'};
                    height: ${isSelected ? '24px' : '16px'};
                    background-color: ${color};
                    border: 3px solid white;
                    border-radius: 50%;
                    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
                    transition: all 0.2s ease;
                    ${isSelected ? 'transform: scale(1.2);' : ''}
                "></div>
            `,
            iconSize: [isSelected ? 24 : 16, isSelected ? 24 : 16],
            iconAnchor: [isSelected ? 12 : 8, isSelected ? 12 : 8],
        });
    };

    return (
        <MapContainer
            center={[20, 0]}
            zoom={2}
            minZoom={2}
            maxZoom={18}
            style={{ height: '100%', width: '100%' }}
            scrollWheelZoom={true}
            className="rounded-2xl"
        >
            <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
            />
            {destinations.map((dest) => (
                <Marker
                    key={dest.id}
                    position={[dest.lat, dest.lng]}
                    icon={createIcon(
                        getCategoryColor(dest.category),
                        selectedDestination?.id === dest.id
                    )}
                    eventHandlers={{
                        click: () => onSelectDestination(dest),
                    }}
                >
                    <Popup>
                        <div className="text-center p-1">
                            <strong className="text-sm">{dest.name}</strong>
                            <p className="text-xs text-slate-600 m-0">{dest.country}</p>
                            <p className="text-xs text-blue-600 m-0 mt-1">{dest.avgPoints.toLocaleString()} pts</p>
                        </div>
                    </Popup>
                </Marker>
            ))}
        </MapContainer>
    );
}
