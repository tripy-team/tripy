/**
 * ItineraryLoadingState - Progress indicator for itinerary generation.
 * Shows animated progress bar and status messages.
 */
'use client';

import { Sparkles, Plane, Train, Zap, Calculator, CheckCircle2 } from 'lucide-react';

interface ItineraryLoadingStateProps {
  progress: number;
  message: string;
  className?: string;
}

// Step icons based on progress
function getStepIcon(progress: number) {
  if (progress < 25) return Sparkles;
  if (progress < 50) return Plane;
  if (progress < 70) return Train;
  if (progress < 90) return Zap;
  if (progress < 100) return Calculator;
  return CheckCircle2;
}

export function ItineraryLoadingState({
  progress,
  message,
  className = '',
}: ItineraryLoadingStateProps) {
  const Icon = getStepIcon(progress);
  const isComplete = progress >= 100;
  
  return (
    <div className={`flex flex-col items-center justify-center py-12 ${className}`}>
      {/* Animated icon */}
      <div className={`
        w-20 h-20 rounded-2xl flex items-center justify-center mb-6
        ${isComplete 
          ? 'bg-green-100' 
          : 'bg-gradient-to-br from-blue-600 to-blue-700 animate-pulse'
        }
        shadow-xl
      `}>
        <Icon className={`w-10 h-10 ${isComplete ? 'text-green-600' : 'text-white'}`} />
      </div>
      
      {/* Progress bar */}
      <div className="w-64 mb-4">
        <div className="h-2 bg-slate-200 rounded-full overflow-hidden">
          <div 
            className={`
              h-full rounded-full transition-all duration-500 ease-out
              ${isComplete ? 'bg-green-500' : 'bg-blue-600'}
            `}
            style={{ width: `${progress}%` }}
          />
        </div>
        <div className="mt-2 flex justify-between text-xs text-slate-500">
          <span>Optimizing</span>
          <span>{Math.round(progress)}%</span>
        </div>
      </div>
      
      {/* Status message */}
      <p className={`text-lg font-medium ${isComplete ? 'text-green-700' : 'text-slate-700'}`}>
        {message || 'Generating your itinerary...'}
      </p>
      
      {/* Subtitle */}
      {!isComplete && (
        <p className="text-sm text-slate-500 mt-2 max-w-sm text-center">
          We&apos;re analyzing flights, trains, and award availability to find the best value for you.
        </p>
      )}
    </div>
  );
}

// Skeleton loading for itinerary cards
export function ItineraryCardSkeleton() {
  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 animate-pulse">
      {/* Header skeleton */}
      <div className="flex items-start justify-between mb-4">
        <div>
          <div className="h-6 w-40 bg-slate-200 rounded mb-2" />
          <div className="h-4 w-24 bg-slate-200 rounded" />
        </div>
        <div className="h-6 w-20 bg-slate-200 rounded-full" />
      </div>
      
      {/* Cost summary skeleton */}
      <div className="grid grid-cols-3 gap-3 p-4 bg-slate-50 rounded-xl mb-4">
        <div>
          <div className="h-3 w-12 bg-slate-200 rounded mb-2" />
          <div className="h-6 w-16 bg-slate-200 rounded" />
        </div>
        <div>
          <div className="h-3 w-12 bg-slate-200 rounded mb-2" />
          <div className="h-6 w-16 bg-slate-200 rounded" />
        </div>
        <div>
          <div className="h-3 w-12 bg-slate-200 rounded mb-2" />
          <div className="h-6 w-16 bg-slate-200 rounded" />
        </div>
      </div>
      
      {/* Cities skeleton */}
      <div className="space-y-3">
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex items-center gap-4 p-3 bg-slate-50 rounded-lg">
            <div className="w-8 h-8 bg-slate-200 rounded-lg" />
            <div className="flex-1">
              <div className="h-4 w-24 bg-slate-200 rounded mb-1" />
              <div className="h-3 w-16 bg-slate-200 rounded" />
            </div>
          </div>
        ))}
      </div>
      
      {/* Button skeleton */}
      <div className="h-12 w-full bg-slate-200 rounded-xl mt-4" />
    </div>
  );
}

// Multiple skeleton cards
export function ItineraryListSkeleton({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-6">
      {Array.from({ length: count }).map((_, i) => (
        <ItineraryCardSkeleton key={i} />
      ))}
    </div>
  );
}

export default ItineraryLoadingState;
