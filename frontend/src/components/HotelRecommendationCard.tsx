'use client';

import { Building2, Star, MapPin, ExternalLink } from 'lucide-react';
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

export default function HotelRecommendationCard({ recommendation: r }: Props) {
  const n = nights(r.checkIn, r.checkOut);

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
          <p className="text-lg font-bold text-slate-900">
            ${r.priceTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
          <p className="text-xs text-slate-500">
            ${r.nightlyRate.toLocaleString(undefined, { maximumFractionDigits: 0 })}/night · {n} night{n !== 1 ? 's' : ''}
          </p>
          {r.roomCount > 1 && (
            <p className="text-xs text-slate-400">{r.roomCount} rooms</p>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1.5 text-xs text-slate-600">
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
