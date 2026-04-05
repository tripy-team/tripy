/**
 * TripGenerationLoader - Full-screen progress overlay for trip optimization.
 * Shows animated progress bar with stage-based messages to indicate work is happening.
 */
'use client';

import { useEffect, useState, useCallback } from 'react';
import { 
  Sparkles, 
  Plane, 
  Calculator, 
  CheckCircle2, 
  Users, 
  Zap,
  MapPin,
  TrendingUp
} from 'lucide-react';

// Optimization stages with realistic timing estimates
// Backend can take up to 60s, so stages are spread across that duration.
// Progress is deliberately back-loaded: early stages advance quickly to show
// activity, while later stages move slowly so the bar is still moving when
// the API finishes (avoids the "stuck at 98%" feeling).
const OPTIMIZATION_STAGES = [
  { 
    stage: 'preparing', 
    label: 'Preparing your trip data...', 
    sublabel: 'Loading destinations and preferences',
    icon: MapPin,
    minProgress: 0,
    maxProgress: 5,
    minDuration: 2000,
    maxDuration: 4000,
  },
  { 
    stage: 'searching', 
    label: 'Searching flight options...', 
    sublabel: 'Scanning airlines and award availability',
    icon: Plane,
    minProgress: 5,
    maxProgress: 20,
    minDuration: 10000,
    maxDuration: 18000,
  },
  { 
    stage: 'pooling', 
    label: 'Pooling points...', 
    sublabel: 'Aggregating points from all members',
    icon: Users,
    minProgress: 20,
    maxProgress: 30,
    minDuration: 4000,
    maxDuration: 8000,
  },
  { 
    stage: 'optimizing', 
    label: 'Running optimization algorithm...', 
    sublabel: 'Finding the best value for your trip',
    icon: Calculator,
    minProgress: 30,
    maxProgress: 55,
    minDuration: 18000,
    maxDuration: 30000,
  },
  { 
    stage: 'allocating', 
    label: 'Allocating bookings...', 
    sublabel: 'Assigning flights and calculating costs',
    icon: Zap,
    minProgress: 55,
    maxProgress: 75,
    minDuration: 10000,
    maxDuration: 18000,
  },
  { 
    stage: 'finalizing', 
    label: 'Finalizing results...', 
    sublabel: 'Calculating savings and polishing details',
    icon: TrendingUp,
    minProgress: 75,
    maxProgress: 95,
    minDuration: 12000,
    maxDuration: 22000,
  },
];

interface TripGenerationLoaderProps {
  isVisible: boolean;
  isComplete?: boolean;
  onComplete?: () => void;
  estimatedDuration?: number;
  /** Streaming mode: real phase from backend */
  streamPhase?: string | null;
  /** Streaming mode: message from backend */
  streamMessage?: string | null;
  /** Streaming mode: {current, total, unit} progress from backend */
  streamProgress?: { current: number; total: number; unit: string } | null;
  /** Streaming mode: error from backend */
  streamError?: { code: string; userMessage: string } | null;
}

const PHASE_MAP: Record<string, { stageIdx: number; baseProgress: number }> = {
  loading:    { stageIdx: 0, baseProgress: 3 },
  airports:   { stageIdx: 1, baseProgress: 10 },
  flights:    { stageIdx: 1, baseProgress: 15 },
  optimizing: { stageIdx: 3, baseProgress: 40 },
  saving:     { stageIdx: 5, baseProgress: 80 },
  tips:       { stageIdx: 5, baseProgress: 90 },
};

export function TripGenerationLoader({ 
  isVisible, 
  isComplete: apiComplete = false,
  onComplete,
  estimatedDuration = 55000,
  streamPhase,
  streamMessage,
  streamProgress,
  streamError,
}: TripGenerationLoaderProps) {
  const [progress, setProgress] = useState(0);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [waitingForApi, setWaitingForApi] = useState(false);

  const isStreaming = streamPhase != null;

  useEffect(() => {
    if (!isStreaming || !streamPhase) return;
    const mapping = PHASE_MAP[streamPhase];
    if (!mapping) return;

    let pct = mapping.baseProgress;
    if (streamProgress && streamProgress.total > 0) {
      const ratio = streamProgress.current / streamProgress.total;
      const stageRange = (OPTIMIZATION_STAGES[mapping.stageIdx]?.maxProgress ?? 50) - mapping.baseProgress;
      pct = mapping.baseProgress + ratio * Math.max(stageRange, 10);
    }
    setProgress(Math.min(pct, 95));
    setCurrentStageIndex(mapping.stageIdx);
  }, [isStreaming, streamPhase, streamProgress]);

  // Calculate stage durations proportionally based on estimated total duration
  const getScaledDuration = useCallback((minDuration: number, maxDuration: number) => {
    const baseTotal = OPTIMIZATION_STAGES.reduce(
      (sum, s) => sum + (s.minDuration + s.maxDuration) / 2, 
      0
    );
    const scale = estimatedDuration / baseTotal;
    const avgDuration = (minDuration + maxDuration) / 2;
    // Add some randomness for realistic feel
    const variance = (maxDuration - minDuration) * 0.3;
    return avgDuration * scale + (Math.random() - 0.5) * variance;
  }, [estimatedDuration]);

  useEffect(() => {
    if (!isVisible) {
      setProgress(0);
      setCurrentStageIndex(0);
      setWaitingForApi(false);
      return;
    }

    let animationFrame: number;
    let startTime: number;
    let stageStartTime: number;
    let stageIndex = 0;
    let currentProgress = 0;
    let stageDuration = getScaledDuration(
      OPTIMIZATION_STAGES[0].minDuration,
      OPTIMIZATION_STAGES[0].maxDuration
    );
    let waitingStartTime: number | null = null;

    const animate = (timestamp: number) => {
      if (!startTime) {
        startTime = timestamp;
        stageStartTime = timestamp;
      }

      const stage = OPTIMIZATION_STAGES[stageIndex];
      const stageElapsed = timestamp - stageStartTime;
      const stageProgressRatio = Math.min(stageElapsed / stageDuration, 1);
      
      // Ease-out progression within each stage (slower deceleration for later stages)
      const easeOut = 1 - Math.pow(1 - stageProgressRatio, stageIndex >= 4 ? 3 : 2);
      currentProgress = stage.minProgress + (stage.maxProgress - stage.minProgress) * easeOut;
      
      setProgress(currentProgress);
      setCurrentStageIndex(stageIndex);

      // Move to next stage
      if (stageProgressRatio >= 1 && stageIndex < OPTIMIZATION_STAGES.length - 1) {
        stageIndex++;
        stageStartTime = timestamp;
        stageDuration = getScaledDuration(
          OPTIMIZATION_STAGES[stageIndex].minDuration,
          OPTIMIZATION_STAGES[stageIndex].maxDuration
        );
      }

      // Once stages are done, slowly creep from 95 toward 99 over ~30s
      // so the bar keeps moving even while waiting for the API
      if (currentProgress >= 95 && stageProgressRatio >= 1 && stageIndex >= OPTIMIZATION_STAGES.length - 1) {
        if (!waitingStartTime) {
          waitingStartTime = timestamp;
          setWaitingForApi(true);
        }
        const waitElapsed = timestamp - waitingStartTime;
        // Asymptotically approach 99% over ~30 seconds using logarithmic ease
        const creep = Math.min(4, 4 * (1 - 1 / (1 + waitElapsed / 15000)));
        currentProgress = 95 + creep;
        setProgress(currentProgress);
      }

      // Always keep animating (the creep ensures the bar never looks stuck)
      if (currentProgress < 99.5) {
        animationFrame = requestAnimationFrame(animate);
      }
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      if (animationFrame) {
        cancelAnimationFrame(animationFrame);
      }
    };
  }, [isVisible, getScaledDuration]);

  // Handle completion when API signals it's done
  useEffect(() => {
    if (apiComplete && isVisible) {
      // API is done - complete the progress bar
      setProgress(100);
      setCurrentStageIndex(OPTIMIZATION_STAGES.length - 1);
      
      // Small delay for the completion animation, then redirect
      const timeout = setTimeout(() => {
        onComplete?.();
      }, 800);
      return () => clearTimeout(timeout);
    }
  }, [apiComplete, isVisible, onComplete]);

  if (!isVisible) return null;

  const currentStage = OPTIMIZATION_STAGES[currentStageIndex];
  const Icon = currentStage.icon;
  const isAnimationComplete = progress >= 100;
  const isWaitingForServer = waitingForApi && !apiComplete;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 backdrop-blur-sm">
      <div className="bg-white rounded-3xl shadow-2xl p-8 max-w-md w-full mx-4 relative overflow-hidden">
        {/* Animated background gradient */}
        <div className="absolute inset-0 bg-gradient-to-br from-blue-50 via-white to-emerald-50 opacity-50" />
        
        {/* Content */}
        <div className="relative z-10">
          {/* Animated icon */}
          <div className="flex justify-center mb-6">
            <div className={`
              w-24 h-24 rounded-2xl flex items-center justify-center
              ${isAnimationComplete 
                ? 'bg-gradient-to-br from-green-500 to-emerald-600' 
                : 'bg-gradient-to-br from-blue-600 to-blue-700'
              }
              shadow-xl transition-all duration-500
              ${!isAnimationComplete ? 'animate-pulse' : ''}
            `}>
              {isAnimationComplete ? (
                <CheckCircle2 className="w-12 h-12 text-white" />
              ) : (
                <Icon className="w-12 h-12 text-white animate-bounce" />
              )}
            </div>
          </div>

          {/* Title */}
          <h2 className="text-2xl font-bold text-slate-900 text-center mb-2">
            {isAnimationComplete 
              ? 'Trip Generated!' 
              : isWaitingForServer 
                ? 'Almost there...'
                : 'Generating Your Trip'
            }
          </h2>

          {/* Stage label */}
          <p className="text-lg text-slate-700 text-center mb-1">
            {streamError
              ? streamError.userMessage
              : isAnimationComplete 
                ? 'Redirecting to results...' 
                : isStreaming && streamMessage
                  ? streamMessage
                  : isWaitingForServer
                    ? 'Finalizing your trip details...'
                    : currentStage.label
            }
          </p>
          <p className="text-sm text-slate-500 text-center mb-6">
            {isAnimationComplete 
              ? '' 
              : isWaitingForServer
                ? 'This may take a moment for complex routes'
                : currentStage.sublabel
            }
          </p>

          {/* Progress bar */}
          <div className="mb-4">
            <div className="w-full h-4 bg-slate-200 rounded-full overflow-hidden shadow-inner">
              <div 
                className={`
                  h-full rounded-full transition-colors duration-300
                  ${isAnimationComplete 
                    ? 'bg-gradient-to-r from-green-500 to-emerald-500' 
                    : 'bg-gradient-to-r from-blue-500 to-blue-600'
                  }
                `}
                style={{ 
                  width: `${Math.max(2, Math.min(progress, 100))}%`,
                  minWidth: progress > 0 ? '8px' : '0px'
                }}
              />
            </div>
            <div className="mt-2 flex justify-between text-sm">
              <span className="text-slate-500">
                {isAnimationComplete ? 'Complete' : isWaitingForServer ? 'Finishing up' : 'Optimizing'}
              </span>
              <span className={`font-medium ${isAnimationComplete ? 'text-green-600' : 'text-blue-600'}`}>
                {`${Math.round(progress)}%`}
              </span>
            </div>
          </div>
          
          {/* Stage indicators */}
          <div className="flex justify-center gap-2 mt-6">
            {OPTIMIZATION_STAGES.map((stage, idx) => {
              const isActive = idx === currentStageIndex;
              const isStageCompleted = idx < currentStageIndex || isAnimationComplete;
              const StageIcon = stage.icon;
              
              return (
                <div 
                  key={stage.stage}
                  className={`
                    w-8 h-8 rounded-full flex items-center justify-center transition-all duration-300
                    ${isStageCompleted 
                      ? 'bg-green-100 text-green-600' 
                      : isActive 
                        ? 'bg-blue-100 text-blue-600 scale-110' 
                        : 'bg-slate-100 text-slate-400'
                    }
                  `}
                  title={stage.label}
                >
                  {isStageCompleted ? (
                    <CheckCircle2 className="w-4 h-4" />
                  ) : (
                    <StageIcon className="w-4 h-4" />
                  )}
                </div>
              );
            })}
          </div>

          {/* Tips while waiting */}
          {!isAnimationComplete && (
            <div className="mt-8 p-4 bg-blue-50 rounded-xl border border-blue-100">
              <div className="flex items-start gap-3">
                <Sparkles className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="text-sm font-medium text-blue-900 mb-1">
                    {isWaitingForServer ? 'Hang tight!' : 'Did you know?'}
                  </p>
                  <p className="text-xs text-blue-700">
                    {isWaitingForServer 
                      ? 'We\'re running complex optimization algorithms to find the absolute best value for your group.'
                      : 'Our algorithm analyzes thousands of flight combinations to find the best value using your group\'s combined points.'
                    }
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default TripGenerationLoader;
