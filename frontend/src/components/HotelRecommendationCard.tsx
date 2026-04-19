'use client';

import { Building2, Star, MapPin, ExternalLink, Award, AlertTriangle, CheckCircle2 } from 'lucide-react';
import type { HotelRecommendation } from '@/lib/api';

interface Props {
  recommendation: HotelRecommendation;
}

function formatDate(iso: string): string {
  try {
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    });
  } catch {
    return iso;
  }
}

function nights(checkIn: string, checkOut: string): number {
  try {
    const ci = new Date(checkIn);
    const co = new Date(checkOut);
    return Math.max(1, Math.round((co.getTime() - ci.getTime()) / 86400000));
  } catch {
    return 1;
  }
}

function formatUsd(n: number): string {
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}

export default function HotelRecommendationCard({ recommendation: r }: Props) {
  const n = nights(r.checkIn, r.checkOut);
  const hasPoints = r.pointsTotal != null && r.pointsTotal > 0;

  // Prefer the backend's explicit payment recommendation when present;
  // fall back to the "has points → show points" heuristic for legacy data.
  const showPointsPrimary =
    r.recommendedPayment === 'points' ||
    (r.recommendedPayment == null && hasPoints);

  const overBudgetBy =
    r.fitsBudget === false && r.cashBudgetAllocated != null
      ? Math.max(0, r.priceTotal - r.cashBudgetAllocated)
      : 0;

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-10 h-10 bg-indigo-100 rounded-lg flex items-center justify-center flex-shrink-0">
            <Building2 className="w-5 h-5 text-indigo-600" />
          </div>
          <div className="min-w-0">
            <h4 className="text-sm font-semibold text-slate-900 truncate">{r.hotelName}</h4>
            <div className="flex items-center gap-2 mt-0.5">
              <div className="flex items-center gap-0.5">
                {Array.from({ length: r.starLevel }).map((_, i) => (
                  <Star key={i} className="w-3 h-3 text-amber-400 fill-amber-400" />
                ))}
              </div>
              {r.rating != null && (
                <span className="text-xs text-slate-500">{r.rating.toFixed(1)}</span>
              )}
            </div>
            <div className="flex items-center gap-1 mt-1 text-xs text-slate-500">
              <MapPin className="w-3 h-3" />
              <span>{r.destination}</span>
            </div>
          </div>
        </div>

        <div className="text-right flex-shrink-0">
          {showPointsPrimary && hasPoints ? (
            <>
              <div className="flex items-center justify-end gap-1">
                <Award className="w-3.5 h-3.5 text-indigo-500" />
                <p className="text-lg font-bold text-indigo-700">
                  {r.pointsTotal!.toLocaleString()} pts
                </p>
              </div>
              <p className="text-xs text-indigo-500">
                {r.pointsPerNight!.toLocaleString()} pts/night · {n} night{n !== 1 ? 's' : ''}
              </p>
              <p className="text-[10px] text-slate-400 mt-0.5">
                or {formatUsd(r.priceTotal)} cash
                {r.redemptionValueCpp != null && (
                  <> · {r.redemptionValueCpp.toFixed(1)}¢/pt</>
                )}
              </p>
            </>
          ) : (
            <>
              <p className="text-lg font-bold text-slate-900">{formatUsd(r.priceTotal)}</p>
              <p className="text-xs text-slate-500">
                {formatUsd(r.nightlyRate)}/night · {n} night{n !== 1 ? 's' : ''}
              </p>
              {hasPoints && (
                <p className="text-[10px] text-slate-400 mt-0.5">
                  or {r.pointsTotal!.toLocaleString()} pts
                </p>
              )}
            </>
          )}
          {r.roomCount > 1 && (
            <p className="text-xs text-slate-400">{r.roomCount} rooms</p>
          )}
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {/* Payment recommendation badge */}
        {r.recommendedPayment === 'points' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-50 text-[10px] font-semibold text-indigo-700 border border-indigo-100">
            <Award className="w-3 h-3" />
            Book with points
          </span>
        )}
        {r.recommendedPayment === 'cash' && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[10px] font-semibold text-emerald-700 border border-emerald-100">
            Pay cash
          </span>
        )}

        {/* Budget-fit badge */}
        {r.fitsBudget === true && r.cashBudgetAllocated != null && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-50 text-[10px] font-medium text-emerald-700">
            <CheckCircle2 className="w-3 h-3" />
            Within budget
          </span>
        )}
        {r.fitsBudget === false && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-[10px] font-medium text-amber-800 border border-amber-100">
            <AlertTriangle className="w-3 h-3" />
            {overBudgetBy > 0
              ? `Over budget by ${formatUsd(overBudgetBy)}`
              : 'Over budget'}
          </span>
        )}

        {/* Loyalty program badge */}
        {r.loyaltyProgram && (
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-50 text-[10px] font-medium text-slate-600 border border-slate-200">
            {r.loyaltyProgram}
          </span>
        )}
      </div>

      <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
        <span>{formatDate(r.checkIn)}</span>
        <span className="text-slate-300">→</span>
        <span>{formatDate(r.checkOut)}</span>
      </div>

      {r.amenities.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {r.amenities.slice(0, 4).map((a) => (
            <span
              key={a}
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-medium bg-slate-100 text-slate-600"
            >
              {a}
            </span>
          ))}
          {r.amenities.length > 4 && (
            <span className="text-[10px] text-slate-400">+{r.amenities.length - 4} more</span>
          )}
        </div>
      )}

      {r.recommendationReason && (
        <p className="mt-2 text-xs text-slate-500 italic">{r.recommendationReason}</p>
      )}

      {r.bookingUrl && (
        <a
          href={r.bookingUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:text-blue-700"
        >
          View on {r.hotelName.split(' ')[0]}
          <ExternalLink className="w-3 h-3" />
        </a>
      )}
    </div>
  );
}
