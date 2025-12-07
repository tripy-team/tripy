'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Users, MapPin, Calendar, Copy, Check, Plus, X } from 'lucide-react';

export default function GroupTripSetup() {
    const router = useRouter();
    const [tripName, setTripName] = useState('');
    const [duration, setDuration] = useState(14);
    const [startDate, setStartDate] = useState('');
    const [cities, setCities] = useState<string[]>([]);
    const [newCity, setNewCity] = useState('');
    const [inviteLink, setInviteLink] = useState('');
    const [copied, setCopied] = useState(false);

    const generateInvite = () => {
        const code = Math.random().toString(36).substring(2, 8).toUpperCase();
        setInviteLink(`tripy.app/group/join/${code}`);
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
                    {/* Trip Name */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                        <h2 className="text-2xl mb-6 text-slate-900 font-semibold">Trip Details</h2>

                        <div className="space-y-6">
                            <div>
                                <label className="block text-sm text-slate-600 mb-3 font-medium">Trip Name</label>
                                <input
                                    type="text"
                                    value={tripName}
                                    onChange={(e) => setTripName(e.target.value)}
                                    placeholder="e.g., European Adventure 2025"
                                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                />
                            </div>

                            <div className="grid md:grid-cols-2 gap-6">
                                <div>
                                    <label className="block text-sm text-slate-600 mb-3 font-medium">Duration</label>
                                    <div className="flex items-baseline gap-2 mb-3">
                                        <span className="text-3xl text-slate-900">{duration}</span>
                                        <span className="text-slate-500">days</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="3"
                                        max="30"
                                        value={duration}
                                        onChange={(e) => setDuration(Number(e.target.value))}
                                        className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                                    />
                                </div>

                                <div>
                                    <label className="block text-sm text-slate-600 mb-3 font-medium">Start Date</label>
                                    <input
                                        type="date"
                                        value={startDate}
                                        onChange={(e) => setStartDate(e.target.value)}
                                        className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                                    />
                                </div>
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
                            <button
                                onClick={generateInvite}
                                disabled={!tripName || cities.length < 2}
                                className="w-full px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-sm font-medium"
                            >
                                Generate Invite Link
                            </button>
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
