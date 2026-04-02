'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { proposalsAPI } from '@/lib/api';

interface Recommendation {
  category: string;
  label: string;
  route_summary: string;
  price_summary: string;
  why_this_option: string;
  tradeoffs: string[];
  risks: string[];
  flights: {
    airline: string;
    origin: string;
    destination: string;
    departure_time: string;
    arrival_time: string;
    duration_display: string;
    stops: number;
    cabin_class: string;
  }[];
  points_summary?: {
    strategy: string;
    savings: number;
    summary: string;
  };
}

interface Proposal {
  proposal_id: string;
  client_name: string;
  advisor_note: string;
  trip_summary: string;
  recommendations: Recommendation[];
  branding: {
    brandName?: string;
    brandColor?: string;
    accentColor?: string;
    logoUrl?: string;
    fontFamily?: string;
    hideTripy?: boolean;
  };
  created_at: string;
  expires_at: string;
}

export default function ProposalPage() {
  const params = useParams();
  const token = params.token as string;
  const [proposal, setProposal] = useState<Proposal | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!token) return;
    proposalsAPI.getShared(token)
      .then((data) => {
        setProposal(data as unknown as Proposal);
      })
      .catch(() => setError('This proposal was not found or has expired.'))
      .finally(() => setLoading(false));
  }, [token]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-pulse text-gray-500">Loading your travel recommendations...</div>
      </div>
    );
  }

  if (error || !proposal) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900 mb-2">Proposal Not Found</h1>
          <p className="text-gray-600">{error || 'This proposal may have expired.'}</p>
        </div>
      </div>
    );
  }

  const { branding } = proposal;
  const brandColor = branding.brandColor || '#1a56db';
  const brandName = branding.brandName || 'Your Travel Advisor';

  return (
    <div className="min-h-screen bg-gray-50">
      <meta name="robots" content="noindex" />

      {/* Header */}
      <header
        className="border-b bg-white px-6 py-4"
        style={{ borderBottomColor: brandColor }}
      >
        <div className="mx-auto max-w-3xl flex items-center gap-3">
          {branding.logoUrl && (
            <img src={branding.logoUrl} alt={brandName} className="h-8 w-auto" />
          )}
          <h1 className="text-lg font-semibold" style={{ color: brandColor }}>
            {brandName}
          </h1>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-8">
        {/* Client greeting */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-gray-900 mb-2">
            Travel Recommendations for {proposal.client_name}
          </h2>
          {proposal.trip_summary && (
            <p className="text-gray-600">{proposal.trip_summary}</p>
          )}
        </div>

        {/* Advisor note */}
        {proposal.advisor_note && (
          <div
            className="mb-8 rounded-lg border-l-4 bg-blue-50 p-4"
            style={{ borderLeftColor: brandColor }}
          >
            <p className="text-gray-700 whitespace-pre-wrap">{proposal.advisor_note}</p>
          </div>
        )}

        {/* Recommendations */}
        <div className="space-y-6">
          {proposal.recommendations.map((rec, idx) => (
            <div key={idx} className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <span
                  className="rounded-full px-3 py-1 text-sm font-medium text-white"
                  style={{ backgroundColor: brandColor }}
                >
                  {rec.label}
                </span>
                <span className="text-lg font-bold text-gray-900">{rec.price_summary}</span>
              </div>

              <p className="mb-3 text-gray-700">{rec.route_summary}</p>
              <p className="mb-4 text-sm text-gray-600 italic">{rec.why_this_option}</p>

              {/* Flights */}
              {rec.flights && rec.flights.length > 0 && (
                <div className="mb-4 space-y-2">
                  {rec.flights.map((flight, fIdx) => (
                    <div key={fIdx} className="flex items-center gap-3 rounded-lg bg-gray-50 p-3 text-sm">
                      <span className="font-medium text-gray-900">{flight.airline}</span>
                      <span className="text-gray-500">
                        {flight.origin} → {flight.destination}
                      </span>
                      <span className="text-gray-400">
                        {flight.stops === 0 ? 'Nonstop' : `${flight.stops} stop${flight.stops > 1 ? 's' : ''}`}
                      </span>
                      {flight.duration_display && (
                        <span className="text-gray-400">{flight.duration_display}</span>
                      )}
                      {flight.cabin_class && (
                        <span className="ml-auto rounded bg-gray-200 px-2 py-0.5 text-xs capitalize">
                          {flight.cabin_class}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {/* Points summary */}
              {rec.points_summary && rec.points_summary.savings > 0 && (
                <div className="mb-4 rounded-lg bg-green-50 p-3 text-sm text-green-800">
                  Saves ${rec.points_summary.savings.toLocaleString()} vs all-cash booking
                </div>
              )}

              {/* Tradeoffs */}
              {rec.tradeoffs.length > 0 && (
                <div className="mb-3">
                  <p className="text-xs font-medium uppercase text-gray-400 mb-1">Things to consider</p>
                  <ul className="space-y-1 text-sm text-gray-600">
                    {rec.tradeoffs.map((t, tIdx) => (
                      <li key={tIdx} className="flex gap-2">
                        <span className="text-amber-500">•</span> {t}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Risks */}
              {rec.risks.length > 0 && (
                <div>
                  <p className="text-xs font-medium uppercase text-gray-400 mb-1">Risks</p>
                  <ul className="space-y-1 text-sm text-red-600">
                    {rec.risks.map((r, rIdx) => (
                      <li key={rIdx} className="flex gap-2">
                        <span>⚠</span> {r}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="mt-12 border-t border-gray-200 pt-6 text-center">
          <p className="text-sm text-gray-500">
            Questions? Contact {brandName}
          </p>
          {!branding.hideTripy && (
            <p className="mt-2 text-xs text-gray-400">Powered by Tripy</p>
          )}
        </div>
      </main>
    </div>
  );
}
