/**
 * TransferInstructions - Step-by-step guide for transferring points.
 * Tracks completion state and provides interactive checklist.
 */
'use client';

import { useState, useCallback } from 'react';
import { ArrowRightLeft, Check, AlertTriangle, Clock, ExternalLink } from 'lucide-react';
import type { TransferInstruction } from '@/lib/hooks/useItinerary';

interface TransferInstructionsProps {
  instructions: TransferInstruction[];
  onStepComplete?: (step: number) => void;
  className?: string;
}

export function TransferInstructions({
  instructions,
  onStepComplete,
  className = '',
}: TransferInstructionsProps) {
  const [completedSteps, setCompletedSteps] = useState<Set<number>>(new Set());
  
  const markComplete = useCallback((order: number) => {
    setCompletedSteps(prev => new Set([...prev, order]));
    onStepComplete?.(order);
  }, [onStepComplete]);
  
  const markIncomplete = useCallback((order: number) => {
    setCompletedSteps(prev => {
      const next = new Set(prev);
      next.delete(order);
      return next;
    });
  }, []);
  
  const allComplete = completedSteps.size === instructions.length;
  
  return (
    <div className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-slate-200">
        <h3 className="font-semibold text-slate-900 flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-purple-600" />
          Transfer Instructions
        </h3>
        <p className="text-sm text-slate-500 mt-1">
          Complete these transfers to book your trip with points
        </p>
        
        {/* Progress indicator */}
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 h-1.5 bg-slate-100 rounded-full overflow-hidden">
            <div 
              className="h-full bg-purple-500 rounded-full transition-all duration-300"
              style={{ width: `${(completedSteps.size / instructions.length) * 100}%` }}
            />
          </div>
          <span className="text-xs text-slate-500">
            {completedSteps.size}/{instructions.length}
          </span>
        </div>
      </div>
      
      {/* Instructions list */}
      <div className="divide-y divide-slate-200">
        {instructions.map((instruction) => (
          <TransferStep
            key={instruction.order}
            instruction={instruction}
            isComplete={completedSteps.has(instruction.order)}
            onToggle={() => {
              if (completedSteps.has(instruction.order)) {
                markIncomplete(instruction.order);
              } else {
                markComplete(instruction.order);
              }
            }}
          />
        ))}
      </div>
      
      {/* All complete message */}
      {allComplete && (
        <div className="p-4 bg-green-50 border-t border-green-200">
          <div className="flex items-center gap-2 text-green-700">
            <Check className="w-5 h-5" />
            <span className="font-medium">All transfers complete!</span>
          </div>
          <p className="text-sm text-green-600 mt-1">
            You&apos;re ready to book your flights. Points should appear in your accounts shortly.
          </p>
        </div>
      )}
    </div>
  );
}

interface TransferStepProps {
  instruction: TransferInstruction;
  isComplete: boolean;
  onToggle: () => void;
}

function TransferStep({ instruction, isComplete, onToggle }: TransferStepProps) {
  const [expanded, setExpanded] = useState(false);
  
  return (
    <div className={`p-4 ${isComplete ? 'bg-green-50' : ''}`}>
      <div className="flex items-start gap-4">
        {/* Checkbox / Step number */}
        <button
          onClick={onToggle}
          className={`
            w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-all
            ${isComplete 
              ? 'bg-green-500 text-white' 
              : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }
          `}
        >
          {isComplete ? (
            <Check className="w-5 h-5" />
          ) : (
            <span className="font-medium">{instruction.order}</span>
          )}
        </button>
        
        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-900">
            Transfer {instruction.displayPoints || formatPoints(instruction.pointsToTransfer)} points
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {instruction.fromProgram}
            <span className="text-slate-400 mx-2">→</span>
            {instruction.toProgram}
          </div>
          
          {/* Estimated time */}
          <div className="flex items-center gap-1 text-sm text-slate-500 mt-1">
            <Clock className="w-3 h-3" />
            <span>{instruction.estimatedTime}</span>
          </div>
          
          {/* Warning */}
          {instruction.warningMessage && (
            <div className="mt-2 flex items-start gap-2 text-sm text-amber-700 bg-amber-50 p-2 rounded-lg">
              <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
              <span>{instruction.warningMessage}</span>
            </div>
          )}
          
          {/* Expandable instructions */}
          {instruction.instructions && instruction.instructions.length > 0 && (
            <div className="mt-2">
              <button
                onClick={() => setExpanded(!expanded)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {expanded ? 'Hide steps' : 'Show steps'}
              </button>
              
              {expanded && (
                <ol className="mt-2 space-y-1.5 text-sm text-slate-600 pl-1">
                  {instruction.instructions.map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-slate-400">{i + 1}.</span>
                      <span>{step}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          
          {/* Mark complete button */}
          {!isComplete && (
            <button
              onClick={onToggle}
              className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              <Check className="w-4 h-4" />
              Mark as complete
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact transfer summary for cards
export function TransferSummaryCompact({
  instructions,
  className = '',
}: {
  instructions: TransferInstruction[];
  className?: string;
}) {
  if (!instructions || instructions.length === 0) return null;
  
  const totalPoints = instructions.reduce((sum, i) => sum + i.pointsToTransfer, 0);
  
  return (
    <div className={`flex items-center gap-2 text-sm ${className}`}>
      <ArrowRightLeft className="w-4 h-4 text-purple-600" />
      <span className="text-slate-600">
        {instructions.length} transfer{instructions.length > 1 ? 's' : ''} needed
      </span>
      <span className="text-slate-400">•</span>
      <span className="font-medium text-slate-700">
        {formatPoints(totalPoints)} pts total
      </span>
    </div>
  );
}

// Helper
function formatPoints(points: number): string {
  if (points >= 1000) {
    if (points % 1000 === 0) return `${points / 1000}k`;
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toLocaleString();
}

export default TransferInstructions;
