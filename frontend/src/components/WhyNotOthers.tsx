'use client';

import { useState } from 'react';
import { ChevronDown, ChevronUp, XCircle } from 'lucide-react';

interface RejectedAlternative {
  label: string;
  description: string;
  rejectionReason: string;
  priceOrPoints?: string;
}

interface WhyNotOthersProps {
  alternatives: RejectedAlternative[];
}

export default function WhyNotOthers({ alternatives }: WhyNotOthersProps) {
  const [isOpen, setIsOpen] = useState(false);

  if (!alternatives || alternatives.length === 0) return null;

  return (
    <div className="mt-6 border border-slate-200 rounded-xl overflow-hidden bg-white">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-2">
          <XCircle className="w-4 h-4 text-slate-400" />
          <span className="text-sm font-medium text-slate-700">
            Why we didn&apos;t pick the other options
          </span>
          <span className="text-xs text-slate-400">({alternatives.length})</span>
        </div>
        {isOpen ? (
          <ChevronUp className="w-4 h-4 text-slate-400" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-400" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-slate-100 divide-y divide-slate-100">
          {alternatives.map((alt, i) => (
            <div key={i} className="px-5 py-4">
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-sm font-semibold text-slate-800">{alt.label}</span>
                    {alt.priceOrPoints && (
                      <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                        {alt.priceOrPoints}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-slate-600">{alt.rejectionReason}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
