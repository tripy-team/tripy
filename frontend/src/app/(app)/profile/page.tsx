'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Compass,
  CreditCard,
  Loader2,
  MapPin,
  Save,
  Sliders,
} from 'lucide-react';
import { users as usersAPI } from '@/lib/api';
import { getMyClient } from '@/lib/api-client';
import PreferenceProfile from '@/components/PreferenceProfile';

interface ProfileSummary {
  name: string;
  email?: string;
  default_home_airport?: string;
  timezone?: string;
  total_savings?: number | null;
}

export default function ProfilePage() {
  const router = useRouter();

  // Profile
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Editable account fields
  const [accountName, setAccountName] = useState('');
  const [homeAirport, setHomeAirport] = useState('');
  const [timezone, setTimezone] = useState('');
  const [savingAccount, setSavingAccount] = useState(false);
  const [accountSaved, setAccountSaved] = useState(false);

  // Travel preferences (self-client)
  const [myClientId, setMyClientId] = useState<string | null>(null);
  const [prefsLoading, setPrefsLoading] = useState(true);
  const [prefsError, setPrefsError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setProfileLoading(true);
        const p = await usersAPI.getProfile();
        setProfile({
          name: p.name || 'Trip Hacker',
          email: p.email,
          default_home_airport: p.default_home_airport,
          timezone: p.timezone,
          total_savings: p.total_savings ?? 0,
        });
        setAccountName(p.name || '');
        setHomeAirport(p.default_home_airport || '');
        setTimezone(p.timezone || '');
        usersAPI.calculateSavings().then((result) => {
          setProfile((prev) => prev ? { ...prev, total_savings: result.total_savings } : null);
        }).catch((err) => console.error('Error calculating savings:', err));
      } catch (e) {
        console.error('Error loading profile:', e);
      } finally {
        setProfileLoading(false);
      }
    };
    load();
  }, []);

  // Resolve the signed-in traveler's own profile (self client) for preferences.
  useEffect(() => {
    let active = true;
    setPrefsLoading(true);
    setPrefsError(null);
    getMyClient()
      .then((c) => {
        if (active) setMyClientId(c.id);
      })
      .catch((err) => {
        if (active) setPrefsError(err?.message || 'Could not load your travel preferences.');
      })
      .finally(() => {
        if (active) setPrefsLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const handleSaveAccount = async () => {
    setSavingAccount(true);
    setAccountSaved(false);
    try {
      await usersAPI.updateProfile({
        name: accountName.trim(),
        default_home_airport: homeAirport.trim(),
        timezone: timezone.trim(),
      });
      setProfile((prev) =>
        prev
          ? {
              ...prev,
              name: accountName.trim() || 'Trip Hacker',
              default_home_airport: homeAirport.trim(),
              timezone: timezone.trim(),
            }
          : prev,
      );
      setAccountSaved(true);
      setTimeout(() => setAccountSaved(false), 3000);
    } catch (err) {
      console.error('Failed to update account:', err);
    } finally {
      setSavingAccount(false);
    }
  };

  const initials =
    profile?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'TH';

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Page header */}
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            Profile
          </h1>
          <p className="text-slate-500 mt-1">
            Manage your account, travel preferences, and points.
          </p>
        </div>

        {/* Profile card */}
        {profileLoading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 shadow-sm flex items-center justify-center">
            <div className="flex items-center gap-3 text-slate-500">
              <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
              Loading profile...
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center gap-6 mb-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl bg-slate-800 flex items-center justify-center text-white text-2xl font-semibold shadow-lg shadow-slate-800/20">
                  {initials}
                </div>
                <div className="absolute -bottom-2 -right-2 bg-white rounded-full p-1.5 shadow-lg border border-slate-200">
                  <Compass className="w-3.5 h-3.5 text-slate-700" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-700">
                  <Compass className="w-3 h-3" />
                  Trip Hacker
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">
                  {profile?.name || 'Trip Hacker'}
                </h2>
                {profile?.email && (
                  <p className="text-slate-500 text-sm">{profile.email}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Home airport</div>
                  <div className="text-sm font-medium text-slate-900">{profile?.default_home_airport || 'Not set'}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Your savings</div>
                  <div className="text-sm font-medium text-slate-900">
                    {profile?.total_savings ? `$${profile.total_savings.toLocaleString()}` : '$0'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Timezone</div>
                  <div className="text-sm font-medium text-slate-900">{profile?.timezone || 'Not set'}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-[0.18em] mb-3">
            Quick actions
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              onClick={() => router.push('/plan')}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
            >
              <MapPin className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-slate-900">Plan a trip</div>
                <div className="text-xs text-slate-500">Find the cheapest way to book with cash or points.</div>
              </div>
            </button>
            <button
              onClick={() => router.push('/my-trips')}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
            >
              <Calendar className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-slate-900">My trips</div>
                <div className="text-xs text-slate-500">Review trips you&apos;ve planned and saved.</div>
              </div>
            </button>
            <button
              onClick={() => router.push('/explore')}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
            >
              <Compass className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-slate-900">Explore</div>
                <div className="text-xs text-slate-500">Discover destinations worth your points.</div>
              </div>
            </button>
          </div>
        </div>

        {/* Account */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="font-semibold text-slate-900 mb-5">Account</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Name</label>
              <input
                type="text"
                value={accountName}
                onChange={(e) => setAccountName(e.target.value)}
                placeholder="Your name"
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Home airport</label>
              <input
                type="text"
                value={homeAirport}
                onChange={(e) => setHomeAirport(e.target.value)}
                placeholder="e.g., JFK"
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Timezone</label>
              <input
                type="text"
                value={timezone}
                onChange={(e) => setTimezone(e.target.value)}
                placeholder="e.g., America/New_York"
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>
          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSaveAccount}
              disabled={savingAccount}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {savingAccount ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
              Save
            </button>
            {accountSaved && <span className="text-sm text-green-600">Saved!</span>}
          </div>
        </div>

        {/* Travel preferences */}
        <div className="pt-2">
          <div className="mb-2 flex items-center gap-2">
            <Sliders className="h-5 w-5 text-slate-400" />
            <h2 className="text-lg font-semibold text-slate-900">Travel preferences</h2>
          </div>
          <p className="mb-6 text-sm text-slate-500">
            How you like to travel — used to personalize every trip we plan for you.
          </p>

          {prefsLoading ? (
            <div className="flex items-center gap-3 text-slate-500 py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading your travel preferences...
            </div>
          ) : prefsError || !myClientId ? (
            <div className="rounded-xl border border-slate-200 bg-white py-8 text-center text-sm text-slate-500">
              {prefsError || 'Could not load your travel preferences.'}
            </div>
          ) : (
            <PreferenceProfile clientId={myClientId} />
          )}
        </div>

      </div>
    </div>
  );
}
