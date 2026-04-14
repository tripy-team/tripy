'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Users,
  ArrowRightLeft,
  Plus,
  Loader2,
  RefreshCw,
  ExternalLink,
} from 'lucide-react';
import { getDashboard, scrapeTransferBonuses } from '@/lib/api-client';
import type {
  DashboardData,
  TransferBonusDetail,
} from '@/lib/api-client';

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
}: {
  label: string;
  value: number | string;
  icon: React.ComponentType<{ className?: string }>;
  color: string;
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
          <p className="text-2xl font-bold text-slate-900">{typeof value === 'number' ? value.toLocaleString() : value}</p>
        </div>
      </div>
    </div>
  );
}

function daysUntil(dateStr: string): number {
  const diff = new Date(dateStr).getTime() - Date.now();
  return Math.ceil(diff / 86400000);
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

export default function DashboardPage() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const hasSynced = useRef(false);

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    getDashboard()
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  useEffect(load, [load]);

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

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading dashboard...</span>
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

  return (
    <div className="max-w-6xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">
          Welcome back{data.advisorName ? `, ${data.advisorName}` : ''}
        </h1>
        <p className="mt-1 text-slate-500">Here&apos;s what&apos;s happening across your practice.</p>
      </div>

      {/* Stats Grid */}
      <div className="mb-8 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <StatCard label="Total Clients" value={data.totalClients ?? 0} icon={Users} color="blue" />
        <StatCard label="Active Transfer Bonuses" value={data.transferBonusCount ?? 0} icon={ArrowRightLeft} color="green" />
      </div>

      {/* Transfer Bonuses Section */}
      <div className="mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
          <div className="flex items-center gap-2">
            <div>
              <h2 className="font-semibold text-slate-900">Active Transfer Bonuses</h2>
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
