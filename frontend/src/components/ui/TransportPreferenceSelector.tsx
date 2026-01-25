/**
 * TransportPreferenceSelector - Allows users to choose their transport preference
 * for trip optimization (any, flights only, trains preferred).
 */
'use client';

import { Plane, Train, Shuffle } from 'lucide-react';

type TransportPreference = 'any' | 'flight_only' | 'train_preferred';

interface TransportPreferenceSelectorProps {
  value: TransportPreference;
  onChange: (value: TransportPreference) => void;
  className?: string;
}

const OPTIONS: Array<{
  value: TransportPreference;
  label: string;
  description: string;
  icon: typeof Plane;
}> = [
  {
    value: 'any',
    label: 'Any',
    description: 'Optimize for cost across all transport',
    icon: Shuffle,
  },
  {
    value: 'flight_only',
    label: 'Flights Only',
    description: 'Only consider flights',
    icon: Plane,
  },
  {
    value: 'train_preferred',
    label: 'Prefer Trains',
    description: 'Use trains when practical',
    icon: Train,
  },
];

export function TransportPreferenceSelector({
  value,
  onChange,
  className = '',
}: TransportPreferenceSelectorProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-sm font-medium text-slate-700">
        Transport Preference
      </label>
      <div className="grid grid-cols-3 gap-2">
        {OPTIONS.map((option) => {
          const Icon = option.icon;
          const isSelected = value === option.value;
          
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onChange(option.value)}
              className={`
                p-3 rounded-xl border-2 text-left transition-all
                ${isSelected
                  ? 'border-blue-600 bg-blue-50 shadow-sm'
                  : 'border-slate-200 hover:border-slate-300 bg-white'
                }
              `}
            >
              <Icon 
                className={`w-5 h-5 mb-2 ${isSelected ? 'text-blue-600' : 'text-slate-400'}`} 
              />
              <div className={`font-medium text-sm ${isSelected ? 'text-blue-900' : 'text-slate-900'}`}>
                {option.label}
              </div>
              <div className="text-xs text-slate-500 mt-1 leading-tight">
                {option.description}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default TransportPreferenceSelector;
