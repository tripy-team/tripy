'use client';

/**
 * StrategyComparisonCard Component
 * 
 * Shows comparison of optimization strategies (OOP, CPP, Balanced).
 * Fixup 7: Uses pure fetch (fetchOptimizeSolo) NOT useSoloOptimization hook.
 * This avoids state race conditions when running multiple optimizations.
 */

import { useState, useEffect } from 'react';
import { DollarSign, TrendingUp, Scale, Loader2, Check } from 'lucide-react';
import { fetchOptimizeSolo, type OptimizeSoloResponse } from '@/lib/hooks/useSoloOptimization';

interface StrategyComparisonCardProps {
  tripId: string;
  pointsMap: Record<string, number>;
  currentMode: 'oop' | 'cpp' | 'balanced';
  onSelectMode?: (mode: 'oop' | 'cpp' | 'balanced') => void;
}

interface StrategySummary {
  mode: 'oop' | 'cpp' | 'balanced';
  totalOutOfPocket: number;
  averageCpp: number;
  totalSavings: number;
  loaded: boolean;
  error?: string;
}

const STRATEGY_CONFIG = {
  oop: {
    label: 'Min Cash',
    description: 'Minimize out-of-pocket',
    icon: DollarSign,
    color: 'emerald',
  },
  cpp: {
    label: 'Max Value',
    description: 'Maximize points value',
    icon: TrendingUp,
    color: 'blue',
  },
  balanced: {
    label: 'Balanced',
    description: 'Balance cash & value',
    icon: Scale,
    color: 'purple',
  },
};

export function StrategyComparisonCard({ 
  tripId, 
  pointsMap, 
  currentMode, 
  onSelectMode 
}: StrategyComparisonCardProps) {
  const [strategies, setStrategies] = useState<Record<string, StrategySummary>>({
    oop: { mode: 'oop', totalOutOfPocket: 0, averageCpp: 0, totalSavings: 0, loaded: false },
    cpp: { mode: 'cpp', totalOutOfPocket: 0, averageCpp: 0, totalSavings: 0, loaded: false },
    balanced: { mode: 'balanced', totalOutOfPocket: 0, averageCpp: 0, totalSavings: 0, loaded: false },
  });
  const [loading, setLoading] = useState(false);

  // Fixup 7: Use pure fetch function, NOT hook
  // Load all strategies in parallel when component mounts or points change
  useEffect(() => {
    if (!tripId || Object.keys(pointsMap).length === 0) return;

    const loadStrategies = async () => {
      setLoading(true);
      
      const modes: ('oop' | 'cpp' | 'balanced')[] = ['oop', 'cpp', 'balanced'];
      
      try {
        // Fixup 7: Call fetchOptimizeSolo (pure fetch) NOT useSoloOptimization hook
        // This prevents state race conditions when running multiple optimizations
        const results = await Promise.all(
          modes.map(mode => 
            fetchOptimizeSolo(tripId, pointsMap, mode)
              .then(response => ({ mode, response, error: null }))
              .catch(err => ({ mode, response: null, error: err.message }))
          )
        );
        
        const newStrategies: Record<string, StrategySummary> = {};
        
        for (const { mode, response, error } of results) {
          if (error || !response) {
            newStrategies[mode] = {
              mode,
              totalOutOfPocket: 0,
              averageCpp: 0,
              totalSavings: 0,
              loaded: true,
              error: error || 'No response',
            };
          } else {
            const best = response.itineraries[0];
            newStrategies[mode] = {
              mode,
              totalOutOfPocket: best?.oopMetrics?.totalOutOfPocket || 0,
              averageCpp: best?.oopMetrics?.averageCpp || 0,
              totalSavings: best?.oopMetrics?.cashSaved || 0,
              loaded: true,
            };
          }
        }
        
        setStrategies(newStrategies);
      } finally {
        setLoading(false);
      }
    };
    
    loadStrategies();
  }, [tripId, pointsMap]);

  // Find the best strategy by lowest out-of-pocket
  const bestOop = Object.values(strategies)
    .filter(s => s.loaded && !s.error)
    .reduce((best, s) => s.totalOutOfPocket < best.totalOutOfPocket ? s : best, { totalOutOfPocket: Infinity } as StrategySummary);

  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
      <div className="p-4 border-b border-slate-100">
        <h3 className="font-semibold text-slate-900">Compare Strategies</h3>
        <p className="text-sm text-slate-500">Different ways to optimize your trip</p>
      </div>
      
      {loading && !Object.values(strategies).some(s => s.loaded) ? (
        <div className="p-8 flex items-center justify-center">
          <Loader2 className="w-6 h-6 text-blue-600 animate-spin" />
          <span className="ml-2 text-slate-500">Comparing strategies...</span>
        </div>
      ) : (
        <div className="p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          {Object.entries(STRATEGY_CONFIG).map(([mode, config]) => {
            const strategy = strategies[mode as 'oop' | 'cpp' | 'balanced'];
            const Icon = config.icon;
            const isSelected = currentMode === mode;
            const isBest = strategy?.loaded && !strategy.error && 
              strategy.mode === bestOop.mode && bestOop.totalOutOfPocket < Infinity;
            
            return (
              <button
                key={mode}
                onClick={() => onSelectMode?.(mode as 'oop' | 'cpp' | 'balanced')}
                disabled={!strategy?.loaded || !!strategy?.error}
                className={`relative p-4 rounded-lg border-2 text-left transition-all ${
                  isSelected
                    ? `border-${config.color}-500 bg-${config.color}-50`
                    : 'border-slate-200 hover:border-slate-300'
                } ${strategy?.error ? 'opacity-50' : ''}`}
              >
                {/* Best badge */}
                {isBest && (
                  <div className="absolute -top-2 -right-2 px-2 py-0.5 bg-emerald-500 text-white text-xs font-medium rounded-full flex items-center gap-1">
                    <Check className="w-3 h-3" />
                    Best
                  </div>
                )}
                
                {/* Selected indicator */}
                {isSelected && (
                  <div className="absolute top-2 left-2">
                    <Check className={`w-4 h-4 text-${config.color}-600`} />
                  </div>
                )}
                
                <div className="flex items-center gap-2 mb-2">
                  <Icon className={`w-5 h-5 text-${config.color}-600`} />
                  <span className="font-medium text-slate-900">{config.label}</span>
                </div>
                
                <p className="text-xs text-slate-500 mb-3">{config.description}</p>
                
                {strategy?.loaded ? (
                  strategy.error ? (
                    <div className="text-xs text-red-500">Failed to load</div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Cost:</span>
                        <span className="font-semibold text-slate-900">
                          ${strategy.totalOutOfPocket.toLocaleString()}
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Value:</span>
                        <span className="font-medium text-blue-600">
                          {strategy.averageCpp.toFixed(2)}¢/pt
                        </span>
                      </div>
                      <div className="flex justify-between text-sm">
                        <span className="text-slate-500">Savings:</span>
                        <span className="font-medium text-emerald-600">
                          ${strategy.totalSavings.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex items-center gap-2">
                    <Loader2 className="w-4 h-4 text-slate-400 animate-spin" />
                    <span className="text-xs text-slate-400">Loading...</span>
                  </div>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default StrategyComparisonCard;
