'use client';

import { useState, useEffect } from 'react';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { getClientPreferences } from '@/lib/api-client';
import type { ClientPreference, LoyaltyBalance, FamilyMember } from '@/lib/api-client';

interface CompletenessCheck {
  key: string;
  label: string;
  filled: boolean;
  tab: 'preferences' | 'balances' | 'group';
  points: number;
}

function computeCompleteness(
  preferences: ClientPreference | null,
  balances: LoyaltyBalance[],
  familyMembers: FamilyMember[],
): { pct: number; missing: CompletenessCheck[]; total: number; filled: number } {
  const checks: CompletenessCheck[] = [
    // Flight (33 pts)
    {
      key: 'cabin',
      label: 'Cabin preference',
      filled: !!preferences?.preferredCabin,
      tab: 'preferences',
      points: 10,
    },
    {
      key: 'nonstop',
      label: 'Nonstop preference',
      filled: preferences?.prefersNonstop !== undefined && preferences?.prefersNonstop !== null,
      tab: 'preferences',
      points: 8,
    },
    {
      key: 'airlines',
      label: 'Preferred airlines',
      filled: (preferences?.preferredAirlines?.length ?? 0) > 0,
      tab: 'preferences',
      points: 8,
    },
    {
      key: 'avoidBasic',
      label: 'Basic economy stance',
      filled: preferences?.avoidBasicEconomy !== undefined && preferences?.avoidBasicEconomy !== null,
      tab: 'preferences',
      points: 7,
    },
    // Budget & Points (25 pts)
    {
      key: 'redemption',
      label: 'Redemption style',
      filled: !!preferences?.redemptionStyle,
      tab: 'preferences',
      points: 9,
    },
    {
      key: 'budget',
      label: 'Budget sensitivity',
      filled: !!preferences?.budgetSensitivity,
      tab: 'preferences',
      points: 8,
    },
    {
      key: 'pointsVsCash',
      label: 'Points vs. cash preference',
      filled: !!preferences?.pointsVsCash,
      tab: 'preferences',
      points: 8,
    },
    // Loyalty (17 pts)
    {
      key: 'loyalty',
      label: 'Loyalty programs on file',
      filled: balances.length > 0,
      tab: 'balances',
      points: 17,
    },
    // Personalization (25 pts)
    {
      key: 'food',
      label: 'Food preferences',
      filled: (preferences?.foodPreferences?.length ?? 0) > 0,
      tab: 'preferences',
      points: 8,
    },
    {
      key: 'activities',
      label: 'Activity preferences',
      filled: (preferences?.activityPreferences?.length ?? 0) > 0,
      tab: 'preferences',
      points: 8,
    },
    {
      key: 'family',
      label: 'Family or group info',
      filled: !!preferences?.familyConsiderations || familyMembers.length > 0,
      tab: 'group',
      points: 9,
    },
  ];

  const total = checks.reduce((sum, c) => sum + c.points, 0);
  const filledPts = checks.reduce((sum, c) => (c.filled ? sum + c.points : sum), 0);
  const pct = Math.round((filledPts / total) * 100);
  const missing = checks.filter((c) => !c.filled);

  return { pct, missing, total, filled: filledPts };
}

interface ProfileCompletenessScoreProps {
  clientId: string;
  balances: LoyaltyBalance[];
  familyMembers: FamilyMember[];
  onTabChange: (tab: 'preferences' | 'balances' | 'group') => void;
}

export default function ProfileCompletenessScore({
  clientId,
  balances,
  familyMembers,
  onTabChange,
}: ProfileCompletenessScoreProps) {
  const [preferences, setPreferences] = useState<ClientPreference | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getClientPreferences(clientId)
      .then(setPreferences)
      .catch(() => setPreferences(null))
      .finally(() => setLoading(false));
  }, [clientId]);

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="h-4 w-36 animate-pulse rounded bg-slate-200" />
          <div className="h-7 w-10 animate-pulse rounded bg-slate-200" />
        </div>
        <div className="h-2 w-full animate-pulse rounded-full bg-slate-200" />
      </div>
    );
  }

  const { pct, missing } = computeCompleteness(preferences, balances, familyMembers);

  type ColorKey = 'emerald' | 'amber' | 'red';
  const colorKey: ColorKey = pct >= 80 ? 'emerald' : pct >= 45 ? 'amber' : 'red';

  const colorConfig: Record<ColorKey, { bar: string; bg: string; border: string; text: string; label: string }> = {
    emerald: {
      bar: 'bg-emerald-500',
      bg: 'bg-emerald-50',
      border: 'border-emerald-200',
      text: 'text-emerald-700',
      label: 'Strong',
    },
    amber: {
      bar: 'bg-amber-400',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
      text: 'text-amber-700',
      label: 'Developing',
    },
    red: {
      bar: 'bg-red-400',
      bg: 'bg-red-50',
      border: 'border-red-200',
      text: 'text-red-700',
      label: 'Incomplete',
    },
  };

  const { bar, bg, border, text, label } = colorConfig[colorKey];

  return (
    <div className={`rounded-xl border ${border} ${bg} p-5`}>
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-slate-900">Profile Completeness</p>
          <p className={`text-xs font-medium ${text}`}>{label}</p>
        </div>
        <span className={`text-2xl font-bold tabular-nums ${text}`}>{pct}%</span>
      </div>

      {/* Progress bar */}
      <div className="mb-4 h-2 w-full overflow-hidden rounded-full bg-white/70">
        <div
          className={`h-full rounded-full transition-all duration-500 ${bar}`}
          style={{ width: `${pct}%` }}
        />
      </div>

      {missing.length === 0 ? (
        <div className="flex items-center gap-2 text-sm text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          Profile is complete
        </div>
      ) : (
        <div className="space-y-1.5">
          <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Missing info
          </p>
          {missing.slice(0, 4).map((item) => (
            <button
              key={item.key}
              onClick={() => onTabChange(item.tab)}
              className="flex w-full items-center justify-between rounded-lg bg-white/60 px-3 py-2 text-left text-xs text-slate-700 transition-colors hover:bg-white"
            >
              <span>{item.label}</span>
              <ChevronRight className="h-3 w-3 flex-shrink-0 text-slate-400" />
            </button>
          ))}
          {missing.length > 4 && (
            <p className="pl-1 text-xs text-slate-400">+{missing.length - 4} more fields</p>
          )}
        </div>
      )}
    </div>
  );
}
