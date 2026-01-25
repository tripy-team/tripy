'use client';

/**
 * Strategy selector for group booking allocation.
 * Allows users to choose how to split booking responsibilities.
 */

import React, { useState, useCallback } from 'react';
import { Sparkles, Split, ArrowLeftRight, UserCheck } from 'lucide-react';
import type { 
  BookingAllocationStrategy, 
  AllocationStrategyType,
  MemberBookingCapability 
} from '@/types/group-booking';

interface StrategyOption {
  type: AllocationStrategyType;
  title: string;
  description: string;
  icon: React.ReactNode;
}

const STRATEGIES: StrategyOption[] = [
  {
    type: 'optimize',
    title: 'Optimize Automatically',
    description: 'System assigns based on who has best points for each segment',
    icon: <Sparkles className="w-5 h-5" />,
  },
  {
    type: 'by_segment_type',
    title: 'Split by Type',
    description: 'One person books all flights, another all hotels',
    icon: <Split className="w-5 h-5" />,
  },
  {
    type: 'by_direction',
    title: 'Split by Direction',
    description: 'One books outbound flights, another books return',
    icon: <ArrowLeftRight className="w-5 h-5" />,
  },
  {
    type: 'manual',
    title: 'Manual Assignment',
    description: 'You decide who books each segment',
    icon: <UserCheck className="w-5 h-5" />,
  },
];

interface BookingAllocationSelectorProps {
  members: MemberBookingCapability[];
  onStrategyChange: (strategy: BookingAllocationStrategy) => void;
  initialStrategy?: BookingAllocationStrategy;
}

export function BookingAllocationSelector({
  members,
  onStrategyChange,
  initialStrategy,
}: BookingAllocationSelectorProps) {
  const [strategyType, setStrategyType] = useState<AllocationStrategyType>(
    initialStrategy?.strategyType || 'optimize'
  );
  
  // For by_segment_type
  const [flightBooker, setFlightBooker] = useState<string>(
    initialStrategy?.flightBooker || members[0]?.memberId || ''
  );
  const [hotelBooker, setHotelBooker] = useState<string>(
    initialStrategy?.hotelBooker || members[1]?.memberId || members[0]?.memberId || ''
  );
  
  // For by_direction
  const [outboundBooker, setOutboundBooker] = useState<string>(
    initialStrategy?.outboundBooker || members[0]?.memberId || ''
  );
  const [returnBooker, setReturnBooker] = useState<string>(
    initialStrategy?.returnBooker || members[1]?.memberId || members[0]?.memberId || ''
  );
  
  const buildStrategy = useCallback((): BookingAllocationStrategy => {
    const strategy: BookingAllocationStrategy = { strategyType };
    
    if (strategyType === 'by_segment_type') {
      strategy.flightBooker = flightBooker;
      strategy.hotelBooker = hotelBooker;
    } else if (strategyType === 'by_direction') {
      strategy.outboundBooker = outboundBooker;
      strategy.returnBooker = returnBooker;
    }
    
    return strategy;
  }, [strategyType, flightBooker, hotelBooker, outboundBooker, returnBooker]);
  
  const handleStrategyTypeChange = (type: AllocationStrategyType) => {
    setStrategyType(type);
    // Build and emit the strategy
    const strategy: BookingAllocationStrategy = { strategyType: type };
    
    if (type === 'by_segment_type') {
      strategy.flightBooker = flightBooker;
      strategy.hotelBooker = hotelBooker;
    } else if (type === 'by_direction') {
      strategy.outboundBooker = outboundBooker;
      strategy.returnBooker = returnBooker;
    }
    
    onStrategyChange(strategy);
  };
  
  const handleMemberChange = (setter: (v: string) => void, value: string) => {
    setter(value);
    // Rebuild and emit strategy after state update
    setTimeout(() => {
      onStrategyChange(buildStrategy());
    }, 0);
  };
  
  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold mb-2">
          How should we split booking responsibilities?
        </h3>
        <p className="text-sm text-gray-500 mb-4">
          Each person will use their own points for segments they book.
          Points are never combined across accounts.
        </p>
      </div>
      
      {/* Strategy Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {STRATEGIES.map((strategy) => (
          <button
            key={strategy.type}
            onClick={() => handleStrategyTypeChange(strategy.type)}
            className={`
              p-4 rounded-lg border-2 text-left transition-all
              ${strategyType === strategy.type
                ? 'border-blue-500 bg-blue-50'
                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
              }
            `}
          >
            <div className="flex items-start gap-3">
              <div className={`
                p-2 rounded-lg
                ${strategyType === strategy.type ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-600'}
              `}>
                {strategy.icon}
              </div>
              <div>
                <h4 className="font-medium">{strategy.title}</h4>
                <p className="text-sm text-gray-500 mt-1">
                  {strategy.description}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
      
      {/* Additional options for by_segment_type */}
      {strategyType === 'by_segment_type' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
          <MemberSelector
            label="Who books flights?"
            members={members}
            value={flightBooker}
            onChange={(v) => handleMemberChange(setFlightBooker, v)}
          />
          <MemberSelector
            label="Who books hotels?"
            members={members}
            value={hotelBooker}
            onChange={(v) => handleMemberChange(setHotelBooker, v)}
          />
        </div>
      )}
      
      {/* Additional options for by_direction */}
      {strategyType === 'by_direction' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-gray-50 rounded-lg">
          <MemberSelector
            label="Who books outbound flights?"
            members={members}
            value={outboundBooker}
            onChange={(v) => handleMemberChange(setOutboundBooker, v)}
          />
          <MemberSelector
            label="Who books return flights?"
            members={members}
            value={returnBooker}
            onChange={(v) => handleMemberChange(setReturnBooker, v)}
          />
        </div>
      )}
      
      {/* Manual mode notice */}
      {strategyType === 'manual' && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <p className="text-sm text-yellow-800">
            Manual assignment: After generating the plan, you'll be able to 
            reassign individual segments to different members.
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MEMBER SELECTOR COMPONENT
// =============================================================================

interface MemberSelectorProps {
  label: string;
  members: MemberBookingCapability[];
  value: string;
  onChange: (memberId: string) => void;
}

function MemberSelector({ label, members, value, onChange }: MemberSelectorProps) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
      >
        {members.map((member) => (
          <option key={member.memberId} value={member.memberId}>
            {member.memberName}
            {Object.keys(member.points).length > 0 && (
              ` (${formatPoints(member.points)})`
            )}
          </option>
        ))}
      </select>
    </div>
  );
}

function formatPoints(points: Record<string, number>): string {
  const programs = Object.entries(points)
    .filter(([, balance]) => balance > 0)
    .map(([program, balance]) => `${(balance / 1000).toFixed(0)}k ${program}`)
    .slice(0, 2);
  
  return programs.join(', ') || 'no points';
}

export default BookingAllocationSelector;
