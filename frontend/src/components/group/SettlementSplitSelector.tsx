'use client';

/**
 * Settlement split method selector for group bookings.
 * Allows users to choose how to split costs among group members.
 */

import React from 'react';
import { Equal, Users, Coins, Pencil } from 'lucide-react';
import type { SettlementSplitMethod } from '@/types/group-booking';

interface SplitOption {
  type: SettlementSplitMethod;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const SPLIT_OPTIONS: SplitOption[] = [
  {
    type: 'equal',
    title: 'Split Equally',
    description: 'Everyone pays the same amount',
    icon: <Equal className="w-5 h-5" />,
  },
  {
    type: 'proportional_travelers',
    title: 'By Travelers',
    description: 'Split based on how many people each member is booking for',
    icon: <Users className="w-5 h-5" />,
  },
  {
    type: 'proportional_points',
    title: 'By Points Used',
    description: 'Members using more points pay less cash',
    icon: <Coins className="w-5 h-5" />,
  },
  {
    type: 'custom',
    title: 'Custom Split',
    description: 'Define your own percentages',
    icon: <Pencil className="w-5 h-5" />,
  },
];

interface SettlementSplitSelectorProps {
  value: SettlementSplitMethod;
  onChange: (method: SettlementSplitMethod) => void;
}

export function SettlementSplitSelector({
  value,
  onChange,
}: SettlementSplitSelectorProps) {
  return (
    <div className="space-y-4">
      <div>
        <h3 className="text-lg font-semibold mb-1">
          How should costs be split?
        </h3>
        <p className="text-sm text-gray-500">
          Choose how to calculate each person's fair share for settlement.
        </p>
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {SPLIT_OPTIONS.map((option) => (
          <button
            key={option.type}
            onClick={() => onChange(option.type)}
            className={`
              p-3 rounded-lg border-2 text-left transition-all
              ${value === option.type
                ? 'border-green-500 bg-green-50'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }
            `}
          >
            <div className="flex items-start gap-3">
              <div className={`
                p-2 rounded-lg
                ${value === option.type 
                  ? 'bg-green-100 text-green-600' 
                  : 'bg-gray-100 text-gray-600'
                }
              `}>
                {option.icon}
              </div>
              <div>
                <h4 className="font-medium text-sm">{option.title}</h4>
                <p className="text-xs text-gray-500 mt-0.5">
                  {option.description}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
      
      {/* Explanation for proportional options */}
      {value === 'proportional_travelers' && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <p>
            <strong>Example:</strong> If Alice is booking for 2 people and Bob for 1, 
            Alice pays 2/3 of the total and Bob pays 1/3.
          </p>
        </div>
      )}
      
      {value === 'proportional_points' && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm text-blue-800">
          <p>
            <strong>Example:</strong> If Alice uses 80% of the total points, 
            she gets a discount on her cash share (up to 50% reduction).
          </p>
        </div>
      )}
      
      {value === 'custom' && (
        <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-800">
          <p>
            Set custom percentages in each member's profile to define exact split ratios.
          </p>
        </div>
      )}
    </div>
  );
}

export default SettlementSplitSelector;
