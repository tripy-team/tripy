'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Compass,
  CreditCard,
  MapPin,
  Settings,
  Sparkles,
  User,
  Zap,
} from 'lucide-react';
import { users as usersAPI } from '@/lib/api';

interface ProfileSummary {
  name: string;
  email?: string;
  default_home_airport?: string;
  timezone?: string;
  total_savings?: number | null;
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        setIsLoading(true);
        const p = await usersAPI.getProfile();
        setProfile({
          name: p.name || 'Traveler',
          email: p.email,
          default_home_airport: p.default_home_airport,
          timezone: p.timezone,
          total_savings: p.total_savings ?? 0,
        });

        // Recalculate savings in the background (don't wait for it)
        // This ensures savings are up-to-date whenever user visits profile
        usersAPI.calculateSavings().then((result) => {
          // Update profile with fresh savings data
          setProfile((prev) => prev ? {
            ...prev,
            total_savings: result.total_savings
          } : null);
        }).catch((err) => {
          console.error('Error calculating savings:', err);
          // Don't show error to user - just log it
        });
      } catch (e) {
        console.error('Error loading profile:', e);
      } finally {
        setIsLoading(false);
      }
    };
    load();
  }, []);

  const initials =
    profile?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'TR';

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
              {profile?.name || 'Your Profile'}
            </h1>
            <p className="text-slate-500 mt-2">
              View your account overview, travel preferences, and quick shortcuts.
            </p>
          </div>
          <button
            onClick={() => router.push('/settings')}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 text-sm font-medium shadow-sm"
          >
            <Settings className="w-4 h-4" />
            Account settings
          </button>
        </div>

        {isLoading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 shadow-sm flex items-center justify-center">
            <div className="flex items-center gap-3 text-slate-500">
              <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
              Loading profile...
            </div>
          </div>
        ) : (
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left column – main profile card */}
            <div className="lg:col-span-2 space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                <div className="flex flex-col md:flex-row md:items-center gap-6 mb-6">
                  <div className="relative">
                    <div className="w-24 h-24 rounded-2xl bg-blue-600 flex items-center justify-center text-white text-3xl font-semibold shadow-lg shadow-blue-600/20">
                      {initials}
                    </div>
                    <div className="absolute -bottom-2 -right-2 bg-white rounded-full p-2 shadow-lg border border-slate-200">
                      <User className="w-4 h-4 text-blue-600" />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-blue-50 text-xs font-medium text-blue-700">
                      <Sparkles className="w-3 h-3" />
                      Tripy traveler
                    </div>
                    <h2 className="text-2xl font-semibold text-slate-900">
                      {profile?.name || 'Traveler'}
                    </h2>
                    {profile?.email && (
                      <p className="text-slate-500 text-sm">{profile.email}</p>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center">
                      <MapPin className="w-4 h-4 text-blue-600" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Home airport
                      </div>
                      <div className="text-sm font-medium text-slate-900">
                        {profile?.default_home_airport || 'Not set'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center">
                      <CreditCard className="w-4 h-4 text-emerald-600" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Total savings
                      </div>
                      <div className="text-sm font-medium text-slate-900">
                        {profile?.total_savings
                          ? `$${profile.total_savings.toLocaleString()}`
                          : '$0'}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center">
                      <Calendar className="w-4 h-4 text-violet-600" />
                    </div>
                    <div>
                      <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                        Timezone
                      </div>
                      <div className="text-sm font-medium text-slate-900">
                        {profile?.timezone || 'Not set'}
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Quick actions / shortcuts */}
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-[0.18em] mb-3">
                  Quick actions
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <button
                    onClick={() => router.push('/solo/setup')}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
                  >
                    <Compass className="w-5 h-5 text-blue-600" />
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        Plan a solo trip
                      </div>
                      <div className="text-xs text-slate-500">
                        Use your points to optimize your next adventure.
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => router.push('/my-trips')}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
                  >
                    <Calendar className="w-5 h-5 text-emerald-600" />
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        View my trips
                      </div>
                      <div className="text-xs text-slate-500">
                        See upcoming and past itineraries.
                      </div>
                    </div>
                  </button>

                  <button
                    onClick={() => router.push('/points-setup')}
                    className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
                  >
                    <Zap className="w-5 h-5 text-amber-500" />
                    <div>
                      <div className="text-sm font-medium text-slate-900">
                        Update my points
                      </div>
                      <div className="text-xs text-slate-500">
                        Sync your credit card balances for better routes.
                      </div>
                    </div>
                  </button>
                </div>
              </div>
            </div>

            {/* Right column – small summary panel */}
            <div className="space-y-6">
              <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
                <h3 className="text-sm font-semibold text-slate-500 uppercase tracking-[0.18em] mb-3">
                  Account summary
                </h3>
                <ul className="space-y-3 text-sm text-slate-700">
                  <li className="flex items-center justify-between">
                    <span className="text-slate-500">Email</span>
                    <span className="font-medium text-slate-900">
                      {profile?.email || 'Not set'}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-500">Home airport</span>
                    <span className="font-medium text-slate-900">
                      {profile?.default_home_airport || 'Not set'}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-500">Timezone</span>
                    <span className="font-medium text-slate-900">
                      {profile?.timezone || 'Not set'}
                    </span>
                  </li>
                  <li className="flex items-center justify-between">
                    <span className="text-slate-500">Total savings</span>
                    <span className="font-medium text-slate-900">
                      {profile?.total_savings
                        ? `$${profile.total_savings.toLocaleString()}`
                        : '$0'}
                    </span>
                  </li>
                </ul>
              </div>

              <div className="bg-blue-600 text-white rounded-2xl p-6 shadow-lg shadow-blue-600/20">
                <div className="flex items-center gap-3 mb-3">
                  <Sparkles className="w-5 h-5" />
                  <h3 className="text-sm font-semibold uppercase tracking-[0.18em]">
                    Pro tip
                  </h3>
                </div>
                <p className="text-sm text-blue-50">
                  Keep your home airport up to date so Tripy can suggest the most realistic
                  and valuable itineraries. Your savings grow with every points redemption!
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

