'use client';

import { Shield, ShieldCheck, ShieldAlert, ChevronDown, ChevronUp, Check, AlertTriangle, TrendingUp } from 'lucide-react';
import { useState } from 'react';

interface DecisionSummary {
  headline: string;
  confidenceLevel: 'high' | 'medium' | 'low';
  whyGood: string[];
  tradeoffs: string[];
  risks: string[];
  isEstimated?: boolean;
}

interface DecisionHeaderProps {
  summary: DecisionSummary;
  onBookPlan?: () => void;
}

const CONFIDENCE_CONFIG = {
  high: {
    icon: ShieldCheck,
    label: 'High confidence',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
    border: 'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-800',
  },
  medium: {
    icon: Shield,
    label: 'Good confidence',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
    border: 'border-amber-200',
    badge: 'bg-amber-100 text-amber-800',
  },
  low: {
    icon: ShieldAlert,
    label: 'Proceed with caution',
    color: 'text-red-600',
    bg: 'bg-red-50',
    border: 'border-red-200',
    badge: 'bg-red-100 text-red-800',
  },
};

export default function DecisionHeader({ summary, onBookPlan }: DecisionHeaderProps) {
  const [showDetails, setShowDetails] = useState(false);
  const config = CONFIDENCE_CONFIG[summary.confidenceLevel];
  const ConfidenceIcon = config.icon;

  return (
    <div className={`rounded-2xl border-2 ${config.border} ${config.bg} overflow-hidden mb-8`}>
      {/* Main headline area */}
      <div className="p-6 sm:p-8">
        <div className="flex items-start gap-4">
          <div className={`p-3 rounded-xl ${config.badge}`}>
            <ConfidenceIcon className="w-6 h-6" />
          </div>
          <div className="flex-1 min-w-0">
            {/* Confidence badge */}
            <div className="flex items-center gap-2 mb-2">
              <span className={`px-3 py-1 rounded-full text-xs font-semibold ${config.badge}`}>
                {config.label}
              </span>
              {summary.isEstimated && (
                <span className="px-3 py-1 rounded-full text-xs font-semibold bg-slate-100 text-slate-600">
                  Based on estimated balances
                </span>
              )}
            </div>
            
            {/* Big confident headline */}
            <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 leading-tight mb-4">
              {summary.headline}
            </h1>

            {/* Primary CTA */}
            {onBookPlan && (
              <button
                onClick={onBookPlan}
                className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20"
              >
                <Check className="w-5 h-5" />
                Book this plan
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expandable details */}
      <div className="border-t border-slate-200/50">
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="w-full flex items-center justify-between px-6 sm:px-8 py-3 text-sm font-medium text-slate-600 hover:text-slate-800 hover:bg-white/50 transition-colors"
        >
          <span>Why this plan is good &amp; what to watch out for</span>
          {showDetails ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
        </button>

        {showDetails && (
          <div className="px-6 sm:px-8 pb-6 grid sm:grid-cols-3 gap-6">
            {/* Why it's good */}
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-emerald-700 mb-3">
                <TrendingUp className="w-4 h-4" />
                Why it&apos;s good
              </h3>
              <ul className="space-y-2">
                {summary.whyGood.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <Check className="w-4 h-4 text-emerald-500 flex-shrink-0 mt-0.5" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Tradeoffs */}
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-amber-700 mb-3">
                <AlertTriangle className="w-4 h-4" />
                What you&apos;re giving up
              </h3>
              <ul className="space-y-2">
                {summary.tradeoffs.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="text-amber-500 flex-shrink-0 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>

            {/* Risks */}
            <div>
              <h3 className="flex items-center gap-2 text-sm font-semibold text-red-700 mb-3">
                <ShieldAlert className="w-4 h-4" />
                What to watch out for
              </h3>
              <ul className="space-y-2">
                {summary.risks.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                    <span className="text-red-500 flex-shrink-0 mt-0.5">•</span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
