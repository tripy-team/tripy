'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import {
  Loader2,
  RotateCcw,
  Save,
  Download,
  DollarSign,
  Coins,
  TrendingUp,
  Clock,
  ArrowRightLeft,
  Crown,
  Shuffle,
  Baby,
} from 'lucide-react';
import type { TradeoffWeights } from '@/lib/api-client';
import {
  getTradeoffRanking,
  updateTradeoffRanking,
  getClientDefaultTradeoffWeights,
} from '@/lib/api-client';

const CATEGORIES: {
  key: keyof TradeoffWeights;
  label: string;
  description: string;
  icon: typeof DollarSign;
}[] = [
  {
    key: 'cashCost',
    label: 'Lowest Cash Cost',
    description: 'Minimize out-of-pocket spend',
    icon: DollarSign,
  },
  {
    key: 'pointsUsage',
    label: 'Lowest Points Usage',
    description: 'Conserve points balances',
    icon: Coins,
  },
  {
    key: 'redemptionValue',
    label: 'Best Redemption Value',
    description: 'Maximize cents-per-point value',
    icon: TrendingUp,
  },
  {
    key: 'travelTime',
    label: 'Least Travel Time',
    description: 'Shortest total journey duration',
    icon: Clock,
  },
  {
    key: 'fewestLayovers',
    label: 'Fewest Layovers',
    description: 'Prefer nonstop or direct routes',
    icon: ArrowRightLeft,
  },
  {
    key: 'premiumExperience',
    label: 'Premium Experience',
    description: 'Prioritize comfort and cabin class',
    icon: Crown,
  },
  {
    key: 'flexibility',
    label: 'Flexibility',
    description: 'Changeable / refundable bookings',
    icon: Shuffle,
  },
  {
    key: 'familyConvenience',
    label: 'Family Convenience',
    description: 'Kid-friendly timing, seating, logistics',
    icon: Baby,
  },
];

const DEFAULT_WEIGHTS: TradeoffWeights = {
  cashCost: 50,
  pointsUsage: 50,
  redemptionValue: 50,
  travelTime: 50,
  fewestLayovers: 50,
  premiumExperience: 50,
  flexibility: 50,
  familyConvenience: 50,
};

interface TradeoffRankingPanelProps {
  tripRequestId: string;
  clientId?: string | null;
}

export default function TradeoffRankingPanel({
  tripRequestId,
  clientId,
}: TradeoffRankingPanelProps) {
  const [weights, setWeights] = useState<TradeoffWeights>(DEFAULT_WEIGHTS);
  const [savedWeights, setSavedWeights] = useState<TradeoffWeights>(DEFAULT_WEIGHTS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [hasClientDefaults, setHasClientDefaults] = useState(false);
  const [importingDefaults, setImportingDefaults] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const successTimeout = useRef<ReturnType<typeof setTimeout>>(undefined);

  const isDirty = JSON.stringify(weights) !== JSON.stringify(savedWeights);

  const loadRanking = useCallback(async () => {
    try {
      const ranking = await getTradeoffRanking(tripRequestId);
      const w: TradeoffWeights = {
        cashCost: ranking.cashCost,
        pointsUsage: ranking.pointsUsage,
        redemptionValue: ranking.redemptionValue,
        travelTime: ranking.travelTime,
        fewestLayovers: ranking.fewestLayovers,
        premiumExperience: ranking.premiumExperience,
        flexibility: ranking.flexibility,
        familyConvenience: ranking.familyConvenience,
      };
      setWeights(w);
      setSavedWeights(w);
    } catch {
      // Use defaults on error
    } finally {
      setLoading(false);
    }
  }, [tripRequestId]);

  const checkClientDefaults = useCallback(async () => {
    if (!clientId) return;
    try {
      const defaults = await getClientDefaultTradeoffWeights(clientId);
      setHasClientDefaults(defaults !== null);
    } catch {
      // no defaults available
    }
  }, [clientId]);

  useEffect(() => {
    loadRanking();
    checkClientDefaults();
  }, [loadRanking, checkClientDefaults]);

  const handleSliderChange = (key: keyof TradeoffWeights, value: number) => {
    setWeights((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    setSaveSuccess(false);
    try {
      await updateTradeoffRanking(tripRequestId, weights);
      setSavedWeights(weights);
      setSaveSuccess(true);
      if (successTimeout.current) clearTimeout(successTimeout.current);
      successTimeout.current = setTimeout(() => setSaveSuccess(false), 2000);
    } catch (err) {
      console.error('Failed to save tradeoff ranking:', err);
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    setWeights(savedWeights);
  };

  const handleResetToDefaults = () => {
    setWeights(DEFAULT_WEIGHTS);
  };

  const handleImportClientDefaults = async () => {
    if (!clientId) return;
    setImportingDefaults(true);
    try {
      const defaults = await getClientDefaultTradeoffWeights(clientId);
      if (defaults) {
        setWeights(defaults);
      }
    } catch (err) {
      console.error('Failed to import client defaults:', err);
    } finally {
      setImportingDefaults(false);
    }
  };

  const handleSaveAsClientDefault = async () => {
    if (!clientId) return;
    setSaving(true);
    try {
      const { updateClientPreferences } = await import('@/lib/api-client');
      await updateClientPreferences(clientId, {
        defaultTradeoffWeights: weights,
      } as Parameters<typeof updateClientPreferences>[1]);
      setHasClientDefaults(true);
    } catch (err) {
      console.error('Failed to save as client default:', err);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
        <span className="ml-2 text-sm text-slate-500">Loading rankings...</span>
      </div>
    );
  }

  const sorted = [...CATEGORIES].sort((a, b) => weights[b.key] - weights[a.key]);

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <h2 className="font-semibold text-slate-900">Tradeoff Priorities</h2>
          <p className="mt-0.5 text-xs text-slate-500">
            Drag sliders to set what matters most for this trip
          </p>
        </div>
        <div className="flex items-center gap-2">
          {clientId && hasClientDefaults && (
            <button
              onClick={handleImportClientDefaults}
              disabled={importingDefaults}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-60"
            >
              {importingDefaults ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              Import Client Defaults
            </button>
          )}
          <button
            onClick={handleResetToDefaults}
            className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            Reset All
          </button>
        </div>
      </div>

      <div className="px-5 py-4">
        <div className="space-y-4">
          {sorted.map(({ key, label, description, icon: Icon }, index) => {
            const value = weights[key];
            const intensity =
              value >= 80
                ? 'text-blue-700 bg-blue-50'
                : value >= 60
                  ? 'text-blue-600 bg-blue-50/60'
                  : value >= 40
                    ? 'text-slate-600 bg-slate-50'
                    : value >= 20
                      ? 'text-slate-400 bg-slate-50/60'
                      : 'text-slate-300 bg-white';

            return (
              <div key={key} className="group">
                <div className="mb-1.5 flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="text-xs font-bold text-slate-300 tabular-nums">
                      {index + 1}
                    </span>
                    <div className={`rounded-lg p-1.5 ${intensity}`}>
                      <Icon className="h-4 w-4" />
                    </div>
                    <div>
                      <span className="text-sm font-medium text-slate-900">{label}</span>
                      <p className="text-xs text-slate-400">{description}</p>
                    </div>
                  </div>
                  <span className="min-w-[2.5rem] text-right text-sm font-semibold tabular-nums text-slate-700">
                    {value}
                  </span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={value}
                  onChange={(e) => handleSliderChange(key, Number(e.target.value))}
                  className="h-2 w-full cursor-pointer appearance-none rounded-full bg-slate-100 accent-blue-600 transition-all [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-blue-600 [&::-webkit-slider-thumb]:shadow-sm [&::-webkit-slider-thumb]:transition-transform [&::-webkit-slider-thumb]:hover:scale-110"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-slate-100 px-5 py-3">
        <div className="flex items-center gap-2">
          {clientId && (
            <button
              onClick={handleSaveAsClientDefault}
              disabled={saving}
              className="text-xs font-medium text-slate-500 hover:text-slate-700"
            >
              Save as client default
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <button
              onClick={handleReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Discard Changes
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={saving || !isDirty}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saveSuccess ? (
              <>
                <Save className="h-3.5 w-3.5" />
                Saved
              </>
            ) : (
              <>
                <Save className="h-3.5 w-3.5" />
                Save Rankings
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
