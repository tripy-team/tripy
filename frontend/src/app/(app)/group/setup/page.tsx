'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, MapPin, Copy, Check, Plus, X } from 'lucide-react';
import { createTrip, addDestination, getInviteCode } from '@/lib/api';

export default function GroupTripSetup() {
    const router = useRouter();
    const [startDate, setStartDate] = useState('');
    const [endDate, setEndDate] = useState('');
    const [cities, setCities] = useState<string[]>([]);
    const [newCity, setNewCity] = useState('');
    const [inviteLink, setInviteLink] = useState('');
    const [copied, setCopied] = useState(false);
    const [isGenerating, setIsGenerating] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const generateInvite = async () => {
        if (cities.length < 2 || !startDate || !endDate) {
            setError('Please fill in all required fields (dates and at least 2 cities)');
            return;
        }

        setIsGenerating(true);
        setError(null);

        try {
            // 1. Create trip
            const tripTitle = cities.length > 0 
                ? `Group Trip to ${cities[0]}` 
                : 'Group Trip';
            const trip = await createTrip({
                title: tripTitle,
                start_date: startDate,
                end_date: endDate,
            });

            // 2. Add destinations
            for (const city of cities) {
                await addDestination({
                    trip_id: trip.tripId,
                    name: city,
                    must_include: false,
                    excluded: false,
                });
            }

            // 3. Get invite code
            const inviteResponse = await getInviteCode(trip.tripId);
            
            // 4. Set invite link (using relative URL for now, can be made configurable)
            const frontendUrl = typeof window !== 'undefined' 
                ? window.location.origin 
                : 'tripy.app';
            setInviteLink(`${frontendUrl}/group/join/${inviteResponse.inviteCode}`);
        } catch (err) {
            console.error('Error generating invite:', err);
            setError(err instanceof Error ? err.message : 'Failed to generate invite link. Please try again.');
        } finally {
            setIsGenerating(false);
        }
    };

    const copyInvite = () => {
        navigator.clipboard.writeText(inviteLink);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const addCity = () => {
        if (newCity.trim() && !cities.includes(newCity.trim())) {
            setCities([...cities, newCity.trim()]);
            setNewCity('');
        }
    };

    const removeCity = (city: string) => {
        setCities(cities.filter(c => c !== city));
    };

    return (
        <div className="min-h-full p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
            <div className="max-w-4xl mx-auto">
                {/* Header */}
                <div className="mb-12">
                    <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                        <Users className="w-4 h-4" />
                        <span>Group Trip · You&apos;re the admin</span>
                    </div>
                    <h1 className="text-4xl mb-3 tracking-tight text-slate-900 font-bold">Create group trip</h1>
                    <p className="text-slate-600">Set up your trip and invite members to join</p>
                </div>

                <div className="space-y-6">
                    {/* Trip Dates */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                        <h2 className="text-2xl mb-6 text-slate-900 font-semibold">Trip Details</h2>

                        <div className="grid md:grid-cols-2 gap-6">
                            <div>
                                <label className="block text-sm text-slate-600 mb-3 font-medium">Start Date</label>
                                <input
                                    type="date"
                                    value={startDate}
                                    onChange={(e) => setStartDate(e.target.value)}
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                />
                            </div>

                            <div>
                                <label className="block text-sm text-slate-600 mb-3 font-medium">End Date</label>
                                <input
                                    type="date"
                                    value={endDate}
                                    onChange={(e) => setEndDate(e.target.value)}
                                    min={startDate || undefined}
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                />
                            </div>
                        </div>
                    </div>

                    {/* Cities (Admin Only) */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                        <div className="flex items-center gap-3 mb-6">
                            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
                                <MapPin className="w-5 h-5 text-blue-600" />
                            </div>
                            <div className="flex-1">
                                <h2 className="text-2xl text-slate-900 font-semibold">Destinations</h2>
                                <p className="text-sm text-slate-600">As admin, you control which cities to visit</p>
                            </div>
                        </div>

                        <div className="space-y-4">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={newCity}
                                    onChange={(e) => setNewCity(e.target.value)}
                                    onKeyPress={(e) => e.key === 'Enter' && addCity()}
                                    placeholder="Add a city..."
                                    className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                />
                                <button
                                    onClick={addCity}
                                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                                >
                                    <Plus className="w-5 h-5" />
                                </button>
                            </div>

                            {cities.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {cities.map((city) => (
                                        <div
                                            key={city}
                                            className="flex items-center gap-2 px-4 py-2 bg-blue-50 border border-blue-200 rounded-xl group hover:bg-blue-100 transition-colors"
                                        >
                                            <MapPin className="w-4 h-4 text-blue-600" />
                                            <span className="text-slate-900">{city}</span>
                                            <button
                                                onClick={() => removeCity(city)}
                                                className="ml-1 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X className="w-4 h-4 text-slate-600" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Invite Members */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                        <h2 className="text-2xl mb-6 text-slate-900 font-semibold">Invite Members</h2>

                        {!inviteLink ? (
                            <>
                                <button
                                    onClick={generateInvite}
                                    disabled={cities.length < 2 || !startDate || !endDate || isGenerating}
                                    className="w-full px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm font-medium"
                                >
                                    {isGenerating ? 'Generating...' : 'Generate Invite Link'}
                                </button>
                                {error && (
                                    <div className="mt-4 bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-xl text-sm">
                                        {error}
                                    </div>
                                )}
                            </>
                        ) : (
                            <div className="space-y-4">
                                <div className="flex gap-2">
                                    <input
                                        type="text"
                                        value={inviteLink}
                                        readOnly
                                        className="flex-1 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-600"
                                    />
                                    <button
                                        onClick={copyInvite}
                                        className="px-6 py-3 bg-slate-100 rounded-xl hover:bg-slate-200 transition-colors"
                                    >
                                        {copied ? (
                                            <Check className="w-5 h-5 text-green-600" />
                                        ) : (
                                            <Copy className="w-5 h-5 text-slate-600" />
                                        )}
                                    </button>
                                </div>

                                <p className="text-sm text-slate-600">
                                    Share this link with your travel companions. They&apos;ll add their own budget, points, and starting airport.
                                </p>

                                <button
                                    onClick={() => router.push('/group/dashboard')}
                                    className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-semibold"
                                >
                                    Continue to Dashboard
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
