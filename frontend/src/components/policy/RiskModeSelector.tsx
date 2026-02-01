'use client';

import React from 'react';
import { RiskMode, RISK_MODES } from '@/lib/policyConfig';

interface RiskModeSelectorProps {
  value: RiskMode;
  onChange: (mode: RiskMode) => void;
  className?: string;
  variant?: 'buttons' | 'dropdown' | 'toggle';
}

export function RiskModeSelector({
  value,
  onChange,
  className = '',
  variant = 'buttons',
}: RiskModeSelectorProps) {
  if (variant === 'dropdown') {
    return (
      <div className={`relative ${className}`}>
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Risk Mode
        </label>
        <select
          value={value}
          onChange={(e) => onChange(e.target.value as RiskMode)}
          className="block w-full px-3 py-2 border border-gray-300 rounded-lg
                     bg-white text-gray-900 
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        >
          {(Object.keys(RISK_MODES) as RiskMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {RISK_MODES[mode].icon} {RISK_MODES[mode].label}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (variant === 'toggle') {
    return (
      <div className={`inline-flex rounded-lg bg-gray-100 p-1 ${className}`}>
        {(Object.keys(RISK_MODES) as RiskMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => onChange(mode)}
            className={`px-3 py-1.5 rounded-md text-sm font-medium transition-colors
                       ${
                         value === mode
                           ? 'bg-white text-gray-900 shadow-sm'
                           : 'text-gray-600 hover:text-gray-900'
                       }`}
          >
            <span className="mr-1">{RISK_MODES[mode].icon}</span>
            {RISK_MODES[mode].label}
          </button>
        ))}
      </div>
    );
  }

  // Default: buttons variant
  return (
    <div className={`space-y-2 ${className}`}>
      <label className="block text-sm font-medium text-gray-700">
        Risk Preference
      </label>
      <div className="grid grid-cols-3 gap-2">
        {(Object.keys(RISK_MODES) as RiskMode[]).map((mode) => {
          const config = RISK_MODES[mode];
          const isSelected = value === mode;

          return (
            <button
              key={mode}
              onClick={() => onChange(mode)}
              className={`relative flex flex-col items-center p-3 rounded-lg border-2
                         transition-all ${
                           isSelected
                             ? 'border-blue-500 bg-blue-50'
                             : 'border-gray-200 bg-white hover:border-gray-300'
                         }`}
            >
              <span className="text-2xl mb-1">{config.icon}</span>
              <span
                className={`font-medium ${
                  isSelected ? 'text-blue-700' : 'text-gray-900'
                }`}
              >
                {config.label}
              </span>
              <span className="text-xs text-gray-500 text-center mt-1">
                {config.description}
              </span>

              {/* Selection indicator */}
              {isSelected && (
                <div className="absolute top-2 right-2 w-2 h-2 bg-blue-500 rounded-full" />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

// =============================================================================
// COMPACT RISK MODE INDICATOR
// =============================================================================

interface RiskModeIndicatorProps {
  mode: RiskMode;
  onClick?: () => void;
  className?: string;
}

export function RiskModeIndicator({
  mode,
  onClick,
  className = '',
}: RiskModeIndicatorProps) {
  const config = RISK_MODES[mode];

  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                  border border-gray-200 bg-white hover:bg-gray-50
                  transition-colors ${className}`}
    >
      <span>{config.icon}</span>
      <span className="text-sm font-medium text-gray-700">{config.label}</span>
    </button>
  );
}

export default RiskModeSelector;
