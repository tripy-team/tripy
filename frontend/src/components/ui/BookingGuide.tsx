'use client';

/**
 * BookingGuide Component
 * 
 * Step-by-step booking instructions for the selected itinerary.
 * Includes transfer steps and booking steps with actionable URLs.
 */

import { useState } from 'react';
import { 
  Check, 
  Circle, 
  ExternalLink, 
  AlertTriangle, 
  Clock, 
  ArrowRight,
  Plane,
  Building2,
  RefreshCw
} from 'lucide-react';
import { getProgramLabel } from '@/lib/programLabels';
import type { BookingGuideStep } from '@/lib/hooks/useSoloTransferStrategy';

interface BookingGuideProps {
  steps: BookingGuideStep[];
  isPaid: boolean;
  onRefresh?: () => void;
  expiresAt?: string;
}

export function BookingGuide({ steps, isPaid, onRefresh, expiresAt }: BookingGuideProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());

  const toggleStep = (stepNumber: number) => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      if (next.has(stepNumber)) {
        next.delete(stepNumber);
      } else {
        next.add(stepNumber);
      }
      return next;
    });
  };

  // Check if results are stale
  const isStale = expiresAt ? new Date(expiresAt) < new Date() : false;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
      {/* Header */}
      <div className="p-6 border-b border-slate-100">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Booking Instructions</h2>
            <p className="text-sm text-slate-500 mt-1">
              Complete these steps in order to book your trip
            </p>
          </div>
          {onRefresh && (
            <button
              onClick={onRefresh}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-blue-600 hover:bg-blue-50 rounded-lg"
            >
              <RefreshCw className="w-4 h-4" />
              Refresh
            </button>
          )}
        </div>
        
        {/* Staleness warning */}
        {isStale && (
          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-600 mt-0.5" />
            <div className="text-sm text-amber-800">
              <strong>Availability may have changed.</strong> Refresh for the latest prices and availability.
            </div>
          </div>
        )}
        
        {/* Expiry info */}
        {expiresAt && !isStale && (
          <div className="mt-4 text-xs text-slate-500 flex items-center gap-1">
            <Clock className="w-3 h-3" />
            Valid until {new Date(expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </div>
        )}
      </div>

      {/* Steps */}
      <div className="divide-y divide-slate-100">
        {steps.map((step, idx) => {
          const isCompleted = completedSteps.has(step.stepNumber);
          const isLocked = !isPaid && idx > 0;  // Only show first step if not paid

          return (
            <div 
              key={step.stepNumber}
              className={`p-6 ${isLocked ? 'opacity-50' : ''}`}
            >
              <div className="flex items-start gap-4">
                {/* Step indicator */}
                <button
                  onClick={() => !isLocked && toggleStep(step.stepNumber)}
                  disabled={isLocked}
                  className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-colors ${
                    isCompleted 
                      ? 'bg-emerald-500 text-white' 
                      : 'border-2 border-slate-300 text-slate-400'
                  }`}
                >
                  {isCompleted ? (
                    <Check className="w-4 h-4" />
                  ) : (
                    <span className="text-sm font-medium">{step.stepNumber}</span>
                  )}
                </button>

                {/* Step content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    {step.action === 'transfer' && (
                      <ArrowRight className="w-4 h-4 text-blue-500" />
                    )}
                    {step.action === 'book_flight' && (
                      <Plane className="w-4 h-4 text-blue-500" />
                    )}
                    {step.action === 'book_hotel' && (
                      <Building2 className="w-4 h-4 text-amber-500" />
                    )}
                    <h3 className={`font-semibold ${isCompleted ? 'text-slate-400 line-through' : 'text-slate-900'}`}>
                      {step.title}
                    </h3>
                  </div>
                  
                  <p className="text-sm text-slate-600 mt-1">{step.description}</p>

                  {/* Transfer-specific details */}
                  {step.action === 'transfer' && step.details && !isLocked && (
                    <div className="mt-3 p-3 bg-blue-50 rounded-lg text-sm">
                      <div className="flex items-center gap-2 text-blue-700">
                        <span>{step.details.points?.toLocaleString()} points</span>
                        <ArrowRight className="w-3 h-3" />
                        <span>{step.details.to && getProgramLabel(step.details.to)}</span>
                      </div>
                      {step.details.transferTime && (
                        <div className="flex items-center gap-1 mt-1 text-xs text-blue-600">
                          <Clock className="w-3 h-3" />
                          {step.details.transferTime}
                        </div>
                      )}
                      {step.details.warning && (
                        <div className="flex items-center gap-1 mt-2 text-xs text-amber-600">
                          <AlertTriangle className="w-3 h-3" />
                          {step.details.warning}
                        </div>
                      )}
                      {step.details.portalUrl && (
                        <a
                          href={step.details.portalUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 mt-2 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700"
                        >
                          Open Transfer Portal
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                    </div>
                  )}

                  {/* Booking-specific details */}
                  {(step.action === 'book_flight' || step.action === 'book_hotel') && step.details && !isLocked && (
                    <div className="mt-3">
                      {step.details.bookingUrl && (
                        <a
                          href={step.details.bookingUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 px-3 py-1.5 bg-emerald-600 text-white text-sm font-medium rounded-lg hover:bg-emerald-700"
                        >
                          {step.action === 'book_flight' ? 'Book Flight' : 'Book Hotel'}
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      )}
                      
                      {/* Award availability warning */}
                      {step.action === 'book_flight' && (
                        <div className="mt-2 p-2 bg-amber-50 border border-amber-200 rounded text-xs text-amber-700">
                          <AlertTriangle className="w-3 h-3 inline mr-1" />
                          Award availability changes quickly. If this exact flight isn't available, 
                          search for similar times—the points cost should be similar.
                        </div>
                      )}
                    </div>
                  )}

                  {/* Locked state */}
                  {isLocked && (
                    <div className="mt-3 p-3 bg-slate-100 rounded-lg text-sm text-slate-500">
                      🔒 Unlock full instructions to see this step
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Empty state */}
      {steps.length === 0 && (
        <div className="p-8 text-center text-slate-500">
          <Circle className="w-12 h-12 mx-auto mb-3 text-slate-300" />
          <p>No booking instructions available yet.</p>
          <p className="text-sm mt-1">Select an itinerary to see booking steps.</p>
        </div>
      )}
    </div>
  );
}

export default BookingGuide;
