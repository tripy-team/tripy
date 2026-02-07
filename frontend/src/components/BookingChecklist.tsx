'use client';

import { useState } from 'react';
import { Check, Copy, ArrowRight, Clock, Shield, Eye, ChevronDown, ChevronUp } from 'lucide-react';
import type { BookingDetails, BookingChecklistStep } from '@/lib/api';
import TransferInfoBanner from '@/components/TransferInfoBanner';

interface BookingChecklistProps {
  bookingDetails: BookingDetails;
  onStepComplete?: (stepNumber: number) => void;
}

function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
      const el = document.createElement('textarea');
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand('copy');
      document.body.removeChild(el);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <button
      onClick={handleCopy}
      className="inline-flex items-center gap-1 px-2 py-1 text-xs bg-slate-100 hover:bg-slate-200 rounded-md transition-colors text-slate-700"
      title={`Copy ${label || text}`}
    >
      {copied ? <Check className="w-3 h-3 text-green-600" /> : <Copy className="w-3 h-3" />}
      <span>{copied ? 'Copied' : (label || text)}</span>
    </button>
  );
}

function StepIcon({ actionType, completed }: { actionType: BookingChecklistStep['actionType']; completed: boolean }) {
  if (completed) {
    return (
      <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
        <Check className="w-4 h-4 text-green-600" />
      </div>
    );
  }

  const icons = {
    transfer: <ArrowRight className="w-4 h-4 text-blue-600" />,
    book: <Shield className="w-4 h-4 text-indigo-600" />,
    save: <Copy className="w-4 h-4 text-amber-600" />,
    monitor: <Eye className="w-4 h-4 text-slate-500" />,
  };

  const bgColors = {
    transfer: 'bg-blue-50',
    book: 'bg-indigo-50',
    save: 'bg-amber-50',
    monitor: 'bg-slate-50',
  };

  return (
    <div className={`w-8 h-8 rounded-full ${bgColors[actionType]} flex items-center justify-center`}>
      {icons[actionType]}
    </div>
  );
}

export default function BookingChecklist({ bookingDetails, onStepComplete }: BookingChecklistProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  const [expanded, setExpanded] = useState(true);

  const toggleStep = (stepNumber: number) => {
    const next = new Set(completedSteps);
    if (next.has(stepNumber)) {
      next.delete(stepNumber);
    } else {
      next.add(stepNumber);
      onStepComplete?.(stepNumber);
    }
    setCompletedSteps(next);
  };

  const { bookingChecklist, flightNumbers, airlines, searchHint, needsTransfer, transferPrograms } = bookingDetails;

  if (!bookingChecklist || bookingChecklist.length === 0) return null;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-5 hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-gradient-to-br from-blue-600 to-indigo-600 rounded-xl flex items-center justify-center">
            <Check className="w-5 h-5 text-white" />
          </div>
          <div className="text-left">
            <h3 className="font-semibold text-slate-900">Your Next Steps</h3>
            <p className="text-sm text-slate-500">
              {completedSteps.size} of {bookingChecklist.length} steps done
              {needsTransfer && ' — transfers required'}
            </p>
          </div>
        </div>
        {expanded ? <ChevronUp className="w-5 h-5 text-slate-400" /> : <ChevronDown className="w-5 h-5 text-slate-400" />}
      </button>

      {expanded && (
        <div className="px-5 pb-5 space-y-1">
          {/* Quick info chips */}
          <div className="flex flex-wrap gap-2 mb-4 pb-4 border-b border-slate-100">
            {airlines.length > 0 && (
              <span className="px-2.5 py-1 bg-slate-100 rounded-full text-xs text-slate-700">
                {airlines.join(', ')}
              </span>
            )}
            {flightNumbers.length > 0 && flightNumbers.slice(0, 3).map((fn) => (
              <CopyButton key={fn} text={fn} label={fn} />
            ))}
            {needsTransfer && transferPrograms.map((tp, idx) => (
              <span key={`${tp}-${idx}`} className="px-2.5 py-1 bg-blue-50 rounded-full text-xs text-blue-700 flex items-center gap-1">
                <ArrowRight className="w-3 h-3" />
                {tp}
              </span>
            ))}
          </div>

          {/* Search hint */}
          {searchHint && (
            <div className="mb-4 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-800">
              <Clock className="w-4 h-4 inline mr-1.5 -mt-0.5" />
              {searchHint}
            </div>
          )}

          {/* Transfer Info Banner */}
          {needsTransfer && (
            <div className="mb-4">
              <TransferInfoBanner variant="compact" />
            </div>
          )}

          {/* Steps */}
          <div className="space-y-3">
            {bookingChecklist.map((step) => {
              const isCompleted = completedSteps.has(step.stepNumber);
              
              return (
                <div
                  key={step.stepNumber}
                  className={`flex items-start gap-3 p-3 rounded-xl cursor-pointer transition-all ${
                    isCompleted
                      ? 'bg-green-50/50 border border-green-100'
                      : 'bg-slate-50 border border-slate-100 hover:border-slate-200'
                  }`}
                  onClick={() => toggleStep(step.stepNumber)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      toggleStep(step.stepNumber);
                    }
                  }}
                >
                  <StepIcon actionType={step.actionType} completed={isCompleted} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-slate-400 font-mono">Step {step.stepNumber}</span>
                      <span className={`font-medium text-sm ${isCompleted ? 'text-green-700 line-through' : 'text-slate-900'}`}>
                        {step.title}
                      </span>
                    </div>
                    <p className={`text-sm mt-0.5 ${isCompleted ? 'text-green-600' : 'text-slate-600'}`}>
                      {step.description}
                    </p>
                    {/* Extra details */}
                    {step.details && step.actionType === 'transfer' && !!step.details.portal_url && (
                      <a
                        href={step.details.portal_url as string}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 mt-2 text-xs text-blue-600 hover:text-blue-800 underline"
                      >
                        Open transfer portal <ArrowRight className="w-3 h-3" />
                      </a>
                    )}
                    {step.details && step.actionType === 'book' && !!step.details.flight_numbers && (
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {(step.details.flight_numbers as string[]).map((fn) => (
                          <CopyButton key={fn} text={fn} label={fn} />
                        ))}
                      </div>
                    )}
                    {step.details && step.actionType === 'save' && !!step.details.what_to_save && (
                      <ul className="mt-2 text-xs text-slate-500 space-y-0.5">
                        {(step.details.what_to_save as string[]).map((item) => (
                          <li key={item} className="flex items-center gap-1.5">
                            <span className="w-1 h-1 bg-slate-400 rounded-full" />
                            {item}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
