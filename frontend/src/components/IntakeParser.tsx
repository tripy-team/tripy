'use client';

import { useState } from 'react';
import { intakeAPI } from '@/lib/api';

interface TripIntakeResult {
  travelers: {
    name: string | null;
    origin: string | null;
    loyalty_programs: { program: string; points: number | null }[];
    relationship: string | null;
    cabin_preference: string | null;
  }[];
  destinations: string[];
  date_range: {
    start_date: string | null;
    end_date: string | null;
    duration_days: number | null;
    flexibility_days: number;
  } | null;
  cabin_preference: string;
  cabin_qualifier: string | null;
  budget: {
    amount: number | null;
    budget_type: string;
    currency: string;
  } | null;
  points_preference: string;
  special_constraints: string[];
  confidence: number;
}

interface IntakeParserProps {
  clientId?: string;
  orgId?: string;
  onParsed?: (result: TripIntakeResult) => void;
  onCreateTrip?: (result: TripIntakeResult) => void;
}

export default function IntakeParser({ clientId, orgId, onParsed, onCreateTrip }: IntakeParserProps) {
  const [input, setInput] = useState('');
  const [result, setResult] = useState<TripIntakeResult | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [clientContextApplied, setClientContextApplied] = useState(false);

  const handleParse = async () => {
    if (!input.trim() || loading) return;
    setLoading(true);
    setResult(null);
    setSuggestions([]);

    try {
      const response = await intakeAPI.parse(input.trim(), clientId, orgId);
      const parsed = response as unknown as {
        result: TripIntakeResult;
        client_context_applied: boolean;
        suggestions: string[];
      };
      setResult(parsed.result);
      setSuggestions(parsed.suggestions);
      setClientContextApplied(parsed.client_context_applied);
      onParsed?.(parsed.result);
    } catch (e) {
      console.error('Intake parse failed:', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-xl border border-gray-200 bg-white">
      <div className="border-b border-gray-200 px-6 py-4">
        <h3 className="text-lg font-semibold text-gray-900">AI Trip Intake</h3>
        <p className="text-sm text-gray-500">
          Paste a client request and TripsHacker will extract structured trip details
        </p>
      </div>

      <div className="p-6">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={`Example: "Family of 4 from NYC and LA to Rome in June. Parents want business class if reasonable. Use Chase and Amex points first. Total budget under 12k."`}
          rows={4}
          className="w-full rounded-lg border border-gray-300 px-4 py-3 text-sm focus:border-blue-500 focus:outline-none resize-none"
        />
        <button
          onClick={handleParse}
          disabled={!input.trim() || loading}
          className="mt-3 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {loading ? 'Extracting...' : 'Extract Trip Details'}
        </button>
      </div>

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="border-t border-amber-200 bg-amber-50 px-6 py-3">
          <p className="text-xs font-medium uppercase text-amber-600 mb-1">Missing information</p>
          <ul className="space-y-1 text-sm text-amber-800">
            {suggestions.map((s, idx) => (
              <li key={idx}>• {s}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Parsed result */}
      {result && (
        <div className="border-t border-gray-200 p-6 space-y-4">
          {clientContextApplied && (
            <div className="rounded-lg bg-blue-50 px-3 py-2 text-sm text-blue-700">
              Client profile context was applied to improve extraction.
            </div>
          )}

          <div className="flex items-center justify-between">
            <h4 className="font-semibold text-gray-900">Extracted Details</h4>
            <span
              className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                result.confidence >= 0.8
                  ? 'bg-green-100 text-green-700'
                  : result.confidence >= 0.5
                  ? 'bg-amber-100 text-amber-700'
                  : 'bg-red-100 text-red-700'
              }`}
            >
              {Math.round(result.confidence * 100)}% confidence
            </span>
          </div>

          {/* Travelers */}
          {result.travelers.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase text-gray-400 mb-1">Travelers</p>
              <div className="space-y-1">
                {result.travelers.map((t, idx) => (
                  <div key={idx} className="rounded-lg bg-gray-50 px-3 py-2 text-sm">
                    <span className="font-medium">{t.name || `Traveler ${idx + 1}`}</span>
                    {t.origin && <span className="text-gray-500"> from {t.origin}</span>}
                    {t.relationship && <span className="text-gray-400"> ({t.relationship})</span>}
                    {t.cabin_preference && (
                      <span className="ml-2 rounded bg-gray-200 px-1.5 py-0.5 text-xs capitalize">
                        {t.cabin_preference}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Destinations */}
          {result.destinations.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase text-gray-400 mb-1">Destinations</p>
              <div className="flex gap-2">
                {result.destinations.map((d, idx) => (
                  <span key={idx} className="rounded-full bg-blue-100 px-3 py-1 text-sm text-blue-700">
                    {d}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Dates */}
          {result.date_range && (
            <div>
              <p className="text-xs font-medium uppercase text-gray-400 mb-1">Dates</p>
              <p className="text-sm text-gray-700">
                {result.date_range.start_date || '?'} – {result.date_range.end_date || '?'}
                {result.date_range.flexibility_days > 0 && (
                  <span className="text-gray-400"> (±{result.date_range.flexibility_days} days)</span>
                )}
              </p>
            </div>
          )}

          {/* Budget */}
          {result.budget && result.budget.amount && (
            <div>
              <p className="text-xs font-medium uppercase text-gray-400 mb-1">Budget</p>
              <p className="text-sm text-gray-700">
                ${result.budget.amount.toLocaleString()} {result.budget.currency}
                <span className="text-gray-400"> ({result.budget.budget_type})</span>
              </p>
            </div>
          )}

          {/* Preferences */}
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600 capitalize">
              Cabin: {result.cabin_preference}
              {result.cabin_qualifier && ` (${result.cabin_qualifier})`}
            </span>
            <span className="rounded-full bg-gray-100 px-3 py-1 text-xs text-gray-600">
              Points: {result.points_preference.replace('_', ' ')}
            </span>
          </div>

          {/* Special constraints */}
          {result.special_constraints.length > 0 && (
            <div>
              <p className="text-xs font-medium uppercase text-gray-400 mb-1">Constraints</p>
              <ul className="space-y-1 text-sm text-gray-600">
                {result.special_constraints.map((c, idx) => (
                  <li key={idx}>• {c}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Create trip CTA */}
          {onCreateTrip && (
            <button
              onClick={() => onCreateTrip(result)}
              className="mt-2 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700"
            >
              Create Trip from Intake
            </button>
          )}
        </div>
      )}
    </div>
  );
}
