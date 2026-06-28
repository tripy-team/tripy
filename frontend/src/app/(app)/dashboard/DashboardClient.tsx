'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Image from 'next/image';
import {
  Plane,
  ArrowRightLeft,
  ArrowRight,
  Loader2,
  RefreshCw,
  ExternalLink,
  PiggyBank,
  CreditCard,
  MapPin,
  Clock,
  Bookmark,
  Sparkles,
} from 'lucide-react';
import { getDashboard, scrapeTransferBonuses, getMyClient, getClientBalances, getFamilyMembers } from '@/lib/api-client';
import type {
  DashboardData,
  TransferBonusDetail,
  LoyaltyBalance,
  FamilyMember,
} from '@/lib/api-client';
import { users as usersAPI, trips as tripsAPI } from '@/lib/api';
import type { Trip, SavedDestination } from '@/lib/api';
import ProfileCompletenessScore from '@/components/ProfileCompletenessScore';

const PROGRAM_LOGO_DOMAIN: Record<string, string> = {
  chase_ultimate_rewards: 'chase.com',
  amex_membership_rewards: 'americanexpress.com',
  citi_thankyou: 'citi.com',
  capital_one_miles: 'capitalone.com',
  bilt_rewards: 'biltrewards.com',
  wells_fargo_rewards: 'wellsfargo.com',
  united_mileageplus: 'united.com',
  american_aadvantage: 'aa.com',
  delta_skymiles: 'delta.com',
  southwest_rapid_rewards: 'southwest.com',
  jetblue_trueblue: 'jetblue.com',
  alaska_mileage_plan: 'alaskaair.com',
  british_airways_avios: 'britishairways.com',
  flying_blue: 'airfrance.com',
  virgin_atlantic: 'virginatlantic.com',
  singapore_krisflyer: 'singaporeair.com',
  cathay_pacific: 'cathaypacific.com',
  ana_mileage_club: 'ana.co.jp',
  emirates_skywards: 'emirates.com',
  qatar_privilege_club: 'qatarairways.com',
  turkish_milesandsmiles: 'turkishairlines.com',
  avianca_lifemiles: 'avianca.com',
  aeroplan: 'aircanada.com',
  marriott_bonvoy: 'marriott.com',
  hilton_honors: 'hilton.com',
  hyatt: 'hyatt.com',
  ihg_rewards: 'ihg.com',
  etihad_guest: 'etihad.com',
  qantas_frequent_flyer: 'qantas.com',
  jal_mileage_bank: 'jal.co.jp',
  sas_eurobonus: 'flysas.com',
  rove_miles: 'rovemiles.com',
  lufthansa_miles_and_more: 'lufthansa.com',
};

const PROGRAM_LOGO_OVERRIDE: Record<string, string> = {
  capital_one_miles: '/capital-one-logo.png',
};

function programLogoUrl(code: string): string | null {
  if (PROGRAM_LOGO_OVERRIDE[code]) return PROGRAM_LOGO_OVERRIDE[code];
  const domain = PROGRAM_LOGO_DOMAIN[code];
  return domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=64` : null;
}

function ProgramLogo({ code, name, size = 28 }: { code: string; name: string; size?: number }) {
  const url = programLogoUrl(code);
  const [failed, setFailed] = useState(false);

  if (!url || failed) {
    return (
      <div
        className="flex items-center justify-center rounded-full bg-slate-100 text-xs font-bold text-slate-500"
        style={{ width: size, height: size }}
      >
        {name.charAt(0)}
      </div>
    );
  }

  return (
    <Image
      src={url}
      alt={name}
      width={size}
      height={size}
      className="rounded-full object-contain"
      onError={() => setFailed(true)}
      unoptimized
    />
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
  loading,
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
  loading?: boolean;
}) {
  const colorMap: Record<string, string> = {
    blue: 'bg-blue-50 text-blue-600',
    amber: 'bg-amber-50 text-amber-600',
    green: 'bg-green-50 text-green-600',
  };

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${colorMap[color] ?? colorMap.blue}`}>
          <Icon className="h-5 w-5" />
        </div>
        <div>
          <p className="text-sm text-slate-500">{label}</p>
          {loading ? (
            <div className="mt-1 h-6 w-16 animate-pulse rounded bg-slate-200" />
          ) : (
            <p className="text-2xl font-bold text-slate-900">{typeof value === 'number' ? value.toLocaleString() : value}</p>
          )}
        </div>
      </div>
    </div>
  );
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
}

function formatDateRange(start?: string, end?: string): string {
  if (!start) return 'Dates TBD';
  const s = new Date(start);
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  if (!end) return s.toLocaleDateString('en-US', { ...opts, year: 'numeric' });
  const e = new Date(end);
  return `${s.toLocaleDateString('en-US', opts)} – ${e.toLocaleDateString('en-US', { ...opts, year: 'numeric' })}`;
}

function TransferBonusCard({ bonus }: { bonus: TransferBonusDetail }) {
  const daysLeft = daysUntil(bonus.endsAt);
  const urgency = daysLeft <= 7 ? 'text-red-600' : daysLeft <= 14 ? 'text-amber-600' : 'text-slate-500';

  return (
    <div className="flex items-center justify-between rounded-lg border border-slate-100 bg-white px-4 py-3 transition-colors hover:border-green-200 hover:bg-green-50/30">
      <div className="flex items-center gap-3">
        <ProgramLogo code={bonus.fromProgramCode} name={bonus.fromProgram} size={32} />
        <div className="flex items-center gap-1.5 text-slate-400">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14M12 5l7 7-7 7" />
          </svg>
        </div>
        <ProgramLogo code={bonus.toProgramCode} name={bonus.toProgram} size={32} />
        <div className="ml-1">
          <p className="text-sm font-medium text-slate-900">
            {bonus.fromProgram} → {bonus.toProgram}
          </p>
          <p className="text-xs text-slate-500">
            {bonus.sourceLabel ?? 'Transfer bonus'}
          </p>
        </div>
      </div>
      <div className="flex items-center gap-4">
        <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-sm font-semibold text-green-700">
          +{bonus.bonusPercent}%
        </span>
        <div className="text-right">
          <p className={`text-xs font-medium ${urgency}`}>
            {daysLeft > 0 ? `${daysLeft}d left` : 'Ending today'}
          </p>
          <p className="text-xs text-slate-400">
            ends {new Date(bonus.endsAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
          </p>
        </div>
        {bonus.sourceUrl && (
          <a
            href={bonus.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-slate-400 hover:text-blue-600"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        )}
      </div>
    </div>
  );
}

function SectionHeader({ title, actionLabel, onAction }: { title: string; actionLabel?: string; onAction?: () => void }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="font-semibold text-slate-900">{title}</h2>
      {actionLabel && onAction && (
        <button onClick={onAction} className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 hover:text-blue-700">
          {actionLabel}
          <ArrowRight className="h-3.5 w-3.5" />
        </button>
      )}
    </div>
  );
}

/**
 * Traveler home.
 *
 * `initialData` is the server-rendered Postgres payload (display name + transfer
 * bonuses) from the page Server Component. The traveler-specific metrics — savings
 * and trips (DynamoDB via FastAPI) and loyalty balances (Postgres via /api) — are
 * fetched client-side on mount, each widget rendering its own skeleton until its
 * source resolves. This hybrid keeps the page resilient: one slow source never
 * blanks the others.
 */
export default function DashboardClient({ initialData = null }: { initialData?: DashboardData | null }) {
  const router = useRouter();
  const [data, setData] = useState<DashboardData | null>(initialData);
  const [loading, setLoading] = useState(initialData === null);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const hasSynced = useRef(false);

  // Traveler metrics (client-fetched).
  const [savings, setSavings] = useState<number | null>(null);
  const [savedDestinations, setSavedDestinations] = useState<SavedDestination[]>([]);
  const [trips, setTrips] = useState<Trip[] | null>(null);
  const [tripsTotal, setTripsTotal] = useState(0);
  const [balances, setBalances] = useState<LoyaltyBalance[] | null>(null);
  const [familyMembers, setFamilyMembers] = useState<FamilyMember[]>([]);
  const [myClientId, setMyClientId] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getDashboard()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  // Only fetch the Postgres payload on mount when the server didn't already provide it.
  useEffect(() => {
    if (initialData === null) load();
  }, [initialData, load]);

  useEffect(() => {
    if (!data || hasSynced.current) return;
    hasSynced.current = true;
    setSyncing(true);
    scrapeTransferBonuses()
      .then(() => getDashboard())
      .then(setData)
      .catch(() => {})
      .finally(() => setSyncing(false));
  }, [data]);

  // Traveler-specific data (savings, trips, loyalty balances, family).
  useEffect(() => {
    let active = true;

    usersAPI.getProfile()
      .then((p) => {
        if (!active) return;
        setSavings(p.total_savings ?? 0);
        setSavedDestinations(p.saved_destinations ?? []);
      })
      .catch(() => active && setSavings(0));
    // Recompute savings in the background; cheap UX win, falls back to cached value.
    usersAPI.calculateSavings()
      .then((r) => active && setSavings(r.total_savings))
      .catch(() => {});

    tripsAPI.list({ limit: 50, includeDetails: false })
      .then((r) => {
        if (!active) return;
        setTrips(r.trips);
        setTripsTotal(r.total ?? r.trips.length);
      })
      .catch(() => active && setTrips([]));

    getMyClient()
      .then((c) => {
        if (!active) return null;
        setMyClientId(c.id);
        return Promise.all([getClientBalances(c.id), getFamilyMembers(c.id)]);
      })
      .then((res) => {
        if (!active || !res) return;
        const [b, f] = res;
        setBalances(b);
        setFamilyMembers(f);
      })
      .catch(() => active && setBalances([]));

    return () => {
      active = false;
    };
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading your home...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-32 text-center">
        <p className="text-red-600 mb-4">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  if (!data) return null;

  const transferBonuses = Array.isArray(data.transferBonuses) ? data.transferBonuses : [];
  const topTrips = (trips ?? []).slice(0, 3);
  const totalPoints = (balances ?? []).reduce((sum, b) => sum + (b.balance || 0), 0);
  const programCount = (balances ?? []).length;
  const topBalances = [...(balances ?? [])].sort((a, b) => (b.balance || 0) - (a.balance || 0)).slice(0, 4);
  const expiringSoon = (balances ?? [])
    .filter((b) => b.expirationDate && daysUntil(b.expirationDate) >= 0 && daysUntil(b.expirationDate) <= 90)
    .sort((a, b) => daysUntil(a.expirationDate!) - daysUntil(b.expirationDate!));

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome back{data.displayName ? `, ${data.displayName}` : ''}
        </h1>
        <p className="mt-1 text-slate-500">Here&apos;s your travel snapshot.</p>
      </div>

      {/* Stats Grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard
          label="Total saved"
          value={`$${(savings ?? 0).toLocaleString()}`}
          icon={PiggyBank}
          color="green"
          loading={savings === null}
        />
        <StatCard
          label="Trips planned"
          value={tripsTotal}
          icon={Plane}
          color="blue"
          loading={trips === null}
        />
        <StatCard
          label={programCount === 1 ? 'Points in 1 program' : `Points in ${programCount} programs`}
          value={totalPoints}
          icon={CreditCard}
          color="amber"
          loading={balances === null}
        />
      </div>

      {/* Continue planning + Your points */}
      <div className="mb-6 grid gap-6 lg:grid-cols-2">
        {/* Continue planning */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeader title="Continue planning" actionLabel="All trips" onAction={() => router.push('/my-trips')} />
          {trips === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : topTrips.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center">
              <MapPin className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No trips yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {topTrips.map((trip) => (
                <button
                  key={trip.tripId}
                  onClick={() => router.push(`/trips/${trip.tripId}`)}
                  className="flex w-full items-center justify-between rounded-lg border border-slate-100 px-4 py-3 text-left transition-colors hover:border-blue-200 hover:bg-blue-50/30"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-slate-900">
                      {trip.title || trip.firstDestination || 'Trip'}
                    </p>
                    <p className="text-xs text-slate-500">{formatDateRange(trip.startDate, trip.endDate)}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 flex-shrink-0 text-slate-300" />
                </button>
              ))}
            </div>
          )}
          <button
            onClick={() => router.push('/plan')}
            className="mt-3 inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Sparkles className="h-4 w-4" />
            Plan a new trip
          </button>
        </div>

        {/* Your points */}
        <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeader title="Your points" actionLabel="Manage" onAction={() => router.push('/profile')} />
          {balances === null ? (
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-lg bg-slate-100" />)}
            </div>
          ) : topBalances.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center">
              <CreditCard className="mx-auto h-7 w-7 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No loyalty balances yet.</p>
              <button onClick={() => router.push('/profile')} className="mt-2 text-sm font-medium text-blue-600 hover:text-blue-700">
                Add your points
              </button>
            </div>
          ) : (
            <div className="space-y-2">
              {topBalances.map((b) => (
                <div key={b.id} className="flex items-center justify-between rounded-lg border border-slate-100 px-4 py-2.5">
                  <div className="flex items-center gap-3">
                    {b.loyaltyProgram?.code && <ProgramLogo code={b.loyaltyProgram.code} name={b.programName} size={28} />}
                    <span className="text-sm font-medium text-slate-900">{b.programName}</span>
                  </div>
                  <span className="text-sm font-semibold tabular-nums text-slate-700">{(b.balance || 0).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {/* Expiring points callout */}
          {expiringSoon.length > 0 && (
            <div className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5">
              <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600" />
              <p className="text-xs text-amber-800">
                {expiringSoon.length === 1
                  ? `${expiringSoon[0].programName} points expire in ${daysUntil(expiringSoon[0].expirationDate!)} days.`
                  : `${expiringSoon.length} of your balances expire within 90 days.`}
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Finish your profile */}
      {myClientId && (
        <div className="mb-6">
          <h2 className="mb-3 font-semibold text-slate-900">Finish your profile</h2>
          <ProfileCompletenessScore
            clientId={myClientId}
            balances={balances ?? []}
            familyMembers={familyMembers}
            onTabChange={() => router.push('/profile')}
          />
        </div>
      )}

      {/* Saved destinations */}
      {savedDestinations.length > 0 && (
        <div className="mb-6 rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
          <SectionHeader title="Saved destinations" actionLabel="Explore" onAction={() => router.push('/explore')} />
          <div className="flex flex-wrap gap-2">
            {savedDestinations.map((d) => (
              <button
                key={`${d.city}-${d.country ?? ''}`}
                onClick={() => router.push('/explore')}
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 transition-colors hover:border-blue-200 hover:bg-blue-50"
              >
                <Bookmark className="h-3.5 w-3.5 text-blue-500" />
                {d.city}{d.country ? `, ${d.country}` : ''}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Transfer Bonuses Section */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Current transfer bonuses</h2>
              <p className="text-xs text-slate-500">Current promotions across loyalty programs</p>
            </div>
            {syncing && (
              <div className="flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1">
                <Loader2 className="h-3 w-3 animate-spin text-blue-500" />
                <span className="text-xs text-blue-600">Syncing</span>
              </div>
            )}
          </div>
          <span className="rounded-full bg-green-100 px-2.5 py-0.5 text-xs font-semibold text-green-700">
            {transferBonuses.length} active
          </span>
        </div>
        <div className="divide-y divide-slate-50 p-3">
          {transferBonuses.length === 0 ? (
            <div className="py-8 text-center">
              {syncing ? (
                <>
                  <Loader2 className="mx-auto h-8 w-8 animate-spin text-blue-400" />
                  <p className="mt-2 text-sm text-slate-500">Syncing transfer bonuses from TPG...</p>
                </>
              ) : (
                <>
                  <ArrowRightLeft className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-500">No active transfer bonuses</p>
                </>
              )}
            </div>
          ) : (
            transferBonuses.map((bonus: TransferBonusDetail) => (
              <TransferBonusCard key={bonus.id} bonus={bonus} />
            ))
          )}
        </div>
      </div>
    </div>
  );
}
