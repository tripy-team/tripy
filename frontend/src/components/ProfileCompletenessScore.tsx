'use client';

import { useState, useEffect, useMemo } from 'react';
import { CheckCircle2, ChevronRight } from 'lucide-react';
import { getClientPreferences } from '@/lib/api-client';
import type { ClientPreference, LoyaltyBalance, FamilyMember } from '@/lib/api-client';
import { computeProfileCompleteness } from '@/lib/profile-completeness';
import { getProfileField } from '@/lib/profile-fields';

type MissingTab = 'preferences' | 'balances' | 'group';

interface MissingItem {
  key: string;
  label: string;
  tab: MissingTab;
}

function tabForField(key: string): MissingTab {
  if (key === 'loyaltyPrograms') return 'balances';
  if (key === 'familyConsiderations') return 'group';
  return 'preferences';
}

interface ProfileCompletenessScoreProps {
  clientId: string;
  balances: LoyaltyBalance[];
  familyMembers: FamilyMember[];
  onTabChange: (tab: MissingTab) => void;
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

  const { pct, missing } = useMemo(() => {
    const prefsRecord = preferences
      ? (JSON.parse(JSON.stringify(preferences)) as Record<string, unknown>)
      : null;
    const extraFilled = new Set<string>();
    if (balances.length > 0) extraFilled.add('loyaltyPrograms');
    if (familyMembers.length > 0) extraFilled.add('familyConsiderations');

    const result = computeProfileCompleteness(prefsRecord, [], extraFilled);
    const missingItems: MissingItem[] = result.emptyFields.map((key) => ({
      key,
      label: getProfileField(key)?.label ?? key,
      tab: tabForField(key),
    }));
    return { pct: result.overallPercent, missing: missingItems };
  }, [preferences, balances, familyMembers]);

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
