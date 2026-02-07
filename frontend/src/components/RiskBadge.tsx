'use client';

import { useState } from 'react';
import { Shield, AlertTriangle, AlertCircle, ChevronDown, ChevronUp } from 'lucide-react';
import type { ItineraryRisk } from '@/lib/api';

interface RiskBadgeProps {
  risk: ItineraryRisk;
  /** Show inline (compact) or expanded mode */
  variant?: 'badge' | 'card';
}

const RISK_CONFIG = {
  low: {
    label: 'Protected',
    icon: Shield,
    bgColor: 'bg-green-50',
    borderColor: 'border-green-200',
    textColor: 'text-green-700',
    badgeBg: 'bg-green-100',
    badgeText: 'text-green-800',
  },
  medium: {
    label: 'Fragile',
    icon: AlertTriangle,
    bgColor: 'bg-amber-50',
    borderColor: 'border-amber-200',
    textColor: 'text-amber-700',
    badgeBg: 'bg-amber-100',
    badgeText: 'text-amber-800',
  },
  high: {
    label: 'Risky',
    icon: AlertCircle,
    bgColor: 'bg-red-50',
    borderColor: 'border-red-200',
    textColor: 'text-red-700',
    badgeBg: 'bg-red-100',
    badgeText: 'text-red-800',
  },
} as const;

export default function RiskBadge({ risk, variant = 'badge' }: RiskBadgeProps) {
  const [expanded, setExpanded] = useState(false);
  const config = RISK_CONFIG[risk.level];
  const Icon = config.icon;

  if (variant === 'badge') {
    return (
      <span
        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${config.badgeBg} ${config.badgeText}`}
        title={risk.flags[0] || config.label}
      >
        <Icon className="w-3 h-3" />
        {config.label}
      </span>
    );
  }

  // Card variant — expandable with flags
  return (
    <div className={`rounded-xl border ${config.borderColor} ${config.bgColor} overflow-hidden`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-3 hover:opacity-90 transition-opacity"
      >
        <div className="flex items-center gap-2">
          <Icon className={`w-4 h-4 ${config.textColor}`} />
          <span className={`text-sm font-medium ${config.textColor}`}>{config.label}</span>
          {risk.flags.length > 0 && (
            <span className="text-xs text-slate-500">
              — {risk.flags[0].length > 50 ? risk.flags[0].slice(0, 50) + '...' : risk.flags[0]}
            </span>
          )}
        </div>
        {risk.flags.length > 1 && (
          expanded ? <ChevronUp className="w-4 h-4 text-slate-400" /> : <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>
      {expanded && risk.flags.length > 0 && (
        <div className="px-3 pb-3 space-y-1.5">
          {risk.flags.map((flag, i) => (
            <div key={i} className="flex items-start gap-2 text-sm text-slate-700">
              <span className={`mt-1.5 w-1.5 h-1.5 rounded-full ${config.badgeBg} flex-shrink-0`} />
              {flag}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
