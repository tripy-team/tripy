'use client';

import { Building2, MapPin, TrendingDown, Award, Sparkles, AlertTriangle, Info } from 'lucide-react';
import type { HotelSuggestionGroup, CategorizedHotelSuggestion } from '@/lib/api';
import HotelRecommendationCard from './HotelRecommendationCard';

interface Props {
  groups: HotelSuggestionGroup[];
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

const CATEGORY_META: Record<string, { icon: typeof Award; classes: string }> = {
  best_value: { icon: TrendingDown, classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  best_points: { icon: Award, classes: 'bg-indigo-50 text-indigo-700 border-indigo-200' },
  best_stay: { icon: Sparkles, classes: 'bg-amber-50 text-amber-800 border-amber-200' },
};

function CategoryBadge({ category, label }: { category: string; label: string }) {
  const meta = CATEGORY_META[category] ?? { icon: Info, classes: 'bg-slate-50 text-slate-600 border-slate-200' };
  const Icon = meta.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${meta.classes}`}>
      <Icon className="w-3.5 h-3.5" />
      {label}
    </span>
  );
}

function SuggestionBlock({ suggestion }: { suggestion: CategorizedHotelSuggestion }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <CategoryBadge category={suggestion.category} label={suggestion.label} />
      </div>

      <HotelRecommendationCard recommendation={suggestion.recommendation} />

      {suggestion.whyThisOption && (
        <p className="text-xs text-slate-600">{suggestion.whyThisOption}</p>
      )}

      {suggestion.tradeoffs.length > 0 && (
        <ul className="space-y-1">
          {suggestion.tradeoffs.map((t, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-slate-500">
              <Info className="w-3 h-3 mt-0.5 flex-shrink-0 text-slate-400" />
              <span>{t}</span>
            </li>
          ))}
        </ul>
      )}

      {suggestion.risks.length > 0 && (
        <ul className="space-y-1">
          {suggestion.risks.map((r, i) => (
            <li key={i} className="flex items-start gap-1.5 text-xs text-amber-700">
              <AlertTriangle className="w-3 h-3 mt-0.5 flex-shrink-0 text-amber-500" />
              <span>{r}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function HotelSuggestionsSection({ groups }: Props) {
  const populated = groups.filter((g) => g.suggestions.length > 0);
  if (populated.length === 0) return null;

  return (
    <div className="space-y-6">
      {populated.map((group, gi) => (
        <div key={`${group.destination}-${gi}`} className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Building2 className="w-4 h-4 text-indigo-600" />
              <h3 className="text-sm font-semibold text-slate-900">
                Hotels in {group.destination}
              </h3>
              <span className="flex items-center gap-1 text-xs text-slate-500">
                <MapPin className="w-3 h-3" />
                {formatDate(group.checkIn)} → {formatDate(group.checkOut)} · {group.nights} night
                {group.nights !== 1 ? 's' : ''}
              </span>
            </div>
            {group.cashBudgetAllocated != null && (
              <span className="text-xs text-slate-400">
                {formatUsd(group.cashBudgetAllocated)} cash allocated to this stay
              </span>
            )}
          </div>

          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {group.suggestions.map((s) => (
              <SuggestionBlock key={`${s.category}-${s.recommendation.hotelId}`} suggestion={s} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
