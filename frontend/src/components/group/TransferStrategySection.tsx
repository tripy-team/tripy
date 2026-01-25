'use client';

/**
 * Display transfer strategy instructions for group booking plans.
 * Shows step-by-step transfer instructions before booking.
 */

import React, { useState } from 'react';
import { 
  ArrowRightLeft, 
  Clock, 
  ExternalLink, 
  ChevronDown,
  ChevronUp,
  CreditCard,
  Plane,
  Building2,
  CheckCircle2
} from 'lucide-react';
import type { TransferInfo } from '@/types/group-booking';

interface TransferStrategySectionProps {
  transfers: TransferInfo[];
  className?: string;
}

/**
 * Format points with k suffix for thousands
 */
function formatPoints(points: number): string {
  if (points >= 1000) {
    if (points % 1000 === 0) return `${points / 1000}k`;
    return `${(points / 1000).toFixed(1)}k`;
  }
  return points.toLocaleString();
}

/**
 * Main transfer strategy section component
 */
export function TransferStrategySection({ transfers, className = '' }: TransferStrategySectionProps) {
  if (!transfers || transfers.length === 0) {
    return null;
  }
  
  // Group by member
  const byMember = transfers.reduce((acc, t) => {
    if (!acc[t.memberId]) {
      acc[t.memberId] = { name: t.memberName, transfers: [] };
    }
    acc[t.memberId].transfers.push(t);
    return acc;
  }, {} as Record<string, { name: string; transfers: TransferInfo[] }>);
  
  const totalSourcePoints = transfers.reduce((sum, t) => sum + t.totalSourcePoints, 0);
  
  return (
    <section className={`bg-white rounded-2xl border border-slate-200 overflow-hidden ${className}`}>
      {/* Header */}
      <div className="p-4 border-b border-slate-200 bg-purple-50">
        <h2 className="font-semibold text-slate-900 flex items-center gap-2">
          <ArrowRightLeft className="w-5 h-5 text-purple-600" />
          Transfer Strategy
        </h2>
        <p className="text-sm text-slate-600 mt-1">
          Complete these transfers before booking to use your points optimally
        </p>
      </div>
      
      {/* Member transfer groups */}
      <div className="divide-y divide-slate-200">
        {Object.entries(byMember).map(([memberId, { name, transfers: memberTransfers }]) => (
          <div key={memberId} className="p-4">
            <h3 className="font-medium text-slate-800 mb-3 flex items-center gap-2">
              <CreditCard className="w-4 h-4 text-slate-500" />
              {name}&apos;s Transfers
            </h3>
            
            <div className="space-y-4">
              {memberTransfers.map((transfer, i) => (
                <TransferCard key={`${memberId}-${i}`} transfer={transfer} />
              ))}
            </div>
          </div>
        ))}
      </div>
      
      {/* Summary footer */}
      <div className="p-4 bg-slate-50 border-t border-slate-200">
        <div className="flex items-center justify-between text-sm">
          <span className="text-slate-600">
            {transfers.length} transfer{transfers.length > 1 ? 's' : ''} needed
          </span>
          <span className="font-medium text-slate-800">
            {formatPoints(totalSourcePoints)} total points to transfer
          </span>
        </div>
      </div>
    </section>
  );
}

/**
 * Individual transfer card component
 */
function TransferCard({ transfer }: { transfer: TransferInfo }) {
  const [expanded, setExpanded] = useState(false);
  const [stepsCompleted, setStepsCompleted] = useState<Set<number>>(new Set());
  
  const toggleStep = (index: number) => {
    const newCompleted = new Set(stepsCompleted);
    if (newCompleted.has(index)) {
      newCompleted.delete(index);
    } else {
      newCompleted.add(index);
    }
    setStepsCompleted(newCompleted);
  };
  
  const ProgramIcon = transfer.toProgramType === 'airline' ? Plane : Building2;
  
  return (
    <div className="p-4 bg-slate-50 rounded-xl border border-slate-200">
      {/* Transfer summary */}
      <div className="flex items-center gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-medium text-slate-800">{transfer.fromProgramName}</span>
            <ArrowRightLeft className="w-4 h-4 text-purple-500 flex-shrink-0" />
            <span className="font-medium text-slate-800 flex items-center gap-1">
              <ProgramIcon className="w-3 h-3" />
              {transfer.toProgramName}
            </span>
          </div>
          <div className="text-sm text-slate-600 mt-1">
            {formatPoints(transfer.totalSourcePoints)} points ({transfer.ratioDisplay} ratio)
          </div>
        </div>
        
        {/* Transfer time badge */}
        <div className="flex items-center gap-1 px-2 py-1 bg-white rounded-full text-xs text-slate-600 border border-slate-200">
          <Clock className="w-3 h-3" />
          {transfer.transferTime}
        </div>
      </div>
      
      {/* Action buttons */}
      <div className="flex gap-2 mt-3">
        {transfer.portalUrl && (
          <a
            href={transfer.portalUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
          >
            Transfer Now
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
        
        <button
          onClick={() => setExpanded(!expanded)}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-slate-600 hover:text-slate-800 transition-colors"
        >
          {expanded ? 'Hide steps' : 'Show steps'}
          {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>
      
      {/* Expandable steps */}
      {expanded && (
        <div className="mt-4 pt-4 border-t border-slate-200">
          <ol className="space-y-2">
            {transfer.steps.map((step, i) => {
              const isCompleted = stepsCompleted.has(i);
              return (
                <li 
                  key={i} 
                  className={`flex gap-3 text-sm cursor-pointer transition-opacity ${
                    isCompleted ? 'opacity-50' : ''
                  }`}
                  onClick={() => toggleStep(i)}
                >
                  <span className={`
                    flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center text-xs
                    ${isCompleted 
                      ? 'bg-green-500 text-white' 
                      : 'bg-purple-100 text-purple-600'
                    }
                  `}>
                    {isCompleted ? <CheckCircle2 className="w-3 h-3" /> : i + 1}
                  </span>
                  <span className={`text-slate-600 ${isCompleted ? 'line-through' : ''}`}>
                    {step}
                  </span>
                </li>
              );
            })}
          </ol>
          
          {/* Booking link */}
          {transfer.bookingUrl && (
            <div className="mt-4 pt-3 border-t border-slate-200">
              <a
                href={transfer.bookingUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
              >
                Book at {transfer.toProgramName}
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          )}
        </div>
      )}
      
      {/* Segments covered */}
      {transfer.coversSegments.length > 0 && (
        <div className="mt-3 text-xs text-slate-500">
          Covers: {transfer.coversSegments.join(', ')}
        </div>
      )}
    </div>
  );
}

export default TransferStrategySection;
