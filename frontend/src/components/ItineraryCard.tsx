/**
 * ItineraryCard - Displays an itinerary option with route, costs, and transport modes.
 * Uses the new TransportSegment and SavingsCompact components.
 */
'use client';

import { useState } from 'react';
import { 
  MapPin, 
  Clock, 
  TrendingUp, 
  Sparkles, 
  Edit3, 
  Check, 
  DollarSign, 
  Zap,
  ChevronRight,
  Plane,
  Train,
  Bus,
  Car,
} from 'lucide-react';
import { SavingsCompact } from '@/components/ui/SavingsBreakdown';

interface City {
  name: string;
  days: number;
}

interface ItineraryCardProps {
  id: number;
  name: string;
  cities: City[];
  routeDisplay?: string[];
  totalCost: number;
  pointsCost: number;
  score: number;
  withinBudget?: boolean;
  withinPoints?: boolean;
  isSelected?: boolean;
  isEditing?: boolean;
  includeHotels?: boolean;
  onSelect?: () => void;
  onEdit?: () => void;
  onCityDaysChange?: (cityIndex: number, days: number) => void;
  onCompareToggle?: (checked: boolean) => void;
  isComparing?: boolean;
}

// Transport mode icons for route display
function getTransportIcon(segment: string) {
  const lower = segment.toLowerCase();
  if (lower.includes('train') || lower.includes('rail')) return Train;
  if (lower.includes('bus')) return Bus;
  if (lower.includes('car') || lower.includes('drive')) return Car;
  return Plane;
}

export function ItineraryCard({
  id,
  name,
  cities,
  routeDisplay,
  totalCost,
  pointsCost,
  score,
  withinBudget = true,
  withinPoints = true,
  isSelected = false,
  isEditing = false,
  includeHotels = true,
  onSelect,
  onEdit,
  onCityDaysChange,
  onCompareToggle,
  isComparing = false,
}: ItineraryCardProps) {
  const totalDays = cities.reduce((sum, c) => sum + c.days, 0);
  
  // Calculate estimated savings (points at 1.5 cpp average)
  const estimatedSavings = Math.round(pointsCost * 0.015);
  const allCashEquivalent = totalCost + estimatedSavings;
  
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onSelect?.();
        }
      }}
      className={`
        bg-white border-2 rounded-2xl overflow-hidden transition-all shadow-sm cursor-pointer
        ${isSelected
          ? 'border-blue-600 shadow-lg shadow-blue-600/10 ring-2 ring-blue-600/20'
          : 'border-slate-200 hover:border-blue-300'
        }
      `}
    >
      <div className="p-6">
        {/* Header */}
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2">
              <h3 className="text-2xl text-slate-900 font-semibold">{name}</h3>
              {score >= 90 && (
                <span className="px-3 py-1 bg-yellow-100 text-yellow-800 rounded-full text-sm font-medium">
                  <Sparkles className="w-3 h-3 inline mr-1" />
                  Best match
                </span>
              )}
            </div>
            <div className="flex items-center gap-4 text-sm text-slate-600">
              <span className="flex items-center gap-1">
                <MapPin className="w-4 h-4" />
                {cities.length} cities
              </span>
              <span className="flex items-center gap-1">
                <Clock className="w-4 h-4" />
                {totalDays} days
              </span>
              <span className="flex items-center gap-1">
                <TrendingUp className="w-4 h-4" />
                {score}/100
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2" onClick={(e) => e.stopPropagation()}>
            {/* Budget & points badges */}
            {!withinBudget && (
              <span className="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                Over budget
              </span>
            )}
            {!withinPoints && (
              <span className="px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full text-xs font-medium">
                Exceeds points
              </span>
            )}
            {withinBudget && withinPoints && (
              <span className="px-2.5 py-1 bg-emerald-100 text-emerald-700 rounded-full text-xs font-medium">
                Within budget & points
              </span>
            )}
            
            {/* Edit button */}
            {onEdit && (
              <button
                onClick={onEdit}
                className="p-2 hover:bg-blue-50 rounded-lg transition-colors"
              >
                {isEditing ? (
                  <Check className="w-5 h-5 text-green-600" />
                ) : (
                  <Edit3 className="w-5 h-5 text-slate-600" />
                )}
              </button>
            )}
            
            {/* Compare checkbox */}
            {onCompareToggle && (
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={isComparing}
                  onChange={(e) => onCompareToggle(e.target.checked)}
                  className="w-5 h-5"
                />
                <span className="text-sm text-slate-600 group-hover:text-slate-900">Compare</span>
              </label>
            )}
          </div>
        </div>

        {/* Cost Summary */}
        <div className="mb-6 grid grid-cols-3 gap-3 p-4 bg-gradient-to-br from-blue-50 to-slate-50 rounded-xl border border-blue-100">
          <div>
            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
              <DollarSign className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Cost</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">${totalCost.toLocaleString()}</div>
            <div className="text-xs text-slate-500 mt-0.5">Out-of-pocket</div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
              <Zap className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Points</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{(pointsCost / 1000).toFixed(0)}k</div>
            <div className="text-xs text-slate-500 mt-0.5">To use</div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 text-slate-600 mb-1">
              <TrendingUp className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wider">Score</span>
            </div>
            <div className="text-2xl font-bold text-slate-900">{score}</div>
            <div className="text-xs text-slate-500 mt-0.5">Match quality</div>
          </div>
        </div>

        {/* Route Display */}
        {routeDisplay && routeDisplay.length > 0 && (
          <div className="mb-4 p-3 bg-slate-50 rounded-lg">
            <div className="text-xs text-slate-500 mb-2 font-medium">Route</div>
            <div className="flex flex-wrap items-center gap-1.5 text-sm text-slate-700">
              {routeDisplay.map((stop, i) => (
                <span key={i} className="flex items-center gap-1.5">
                  <span className="font-medium">{stop}</span>
                  {i < routeDisplay.length - 1 && (
                    <ChevronRight className="w-4 h-4 text-slate-400" />
                  )}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Cities */}
        <div className="space-y-3 mb-6">
          {cities.map((city, index) => (
            <div
              key={index}
              className="flex items-center gap-4 p-4 bg-blue-50 rounded-xl border border-blue-100"
            >
              <div className="w-8 h-8 bg-blue-600 text-white rounded-lg flex items-center justify-center flex-shrink-0 font-semibold">
                {index + 1}
              </div>

              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <MapPin className="w-4 h-4 text-blue-600" />
                  <span className="font-medium text-slate-900">{city.name}</span>
                </div>

                {isEditing && onCityDaysChange ? (
                  <div className="flex items-center gap-3" onClick={(e) => e.stopPropagation()}>
                    <input
                      type="range"
                      min="1"
                      max="10"
                      value={city.days}
                      onChange={(e) => onCityDaysChange(index, Number(e.target.value))}
                      className="flex-1 h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                    />
                    <span className="text-sm text-slate-600 w-16 font-medium">{city.days} days</span>
                  </div>
                ) : (
                  <div className="text-sm text-slate-600">{city.days} days</div>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Savings Summary */}
        <SavingsCompact 
          allCashCost={allCashEquivalent} 
          outOfPocket={totalCost} 
          className="mb-4"
        />

        {/* Action Buttons */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onSelect?.();
          }}
          className={`
            w-full px-6 py-3 rounded-xl transition-all font-medium
            ${isSelected
              ? 'bg-blue-600 text-white shadow-sm'
              : 'bg-slate-100 text-slate-900 hover:bg-slate-200'
            }
          `}
        >
          {isSelected ? (
            <span className="flex items-center justify-center gap-2">
              <Check className="w-5 h-5" /> Selected
            </span>
          ) : (
            'Select This Route'
          )}
        </button>
      </div>
    </div>
  );
}

export default ItineraryCard;
