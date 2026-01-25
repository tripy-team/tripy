'use client';

/**
 * Display component for group booking allocation results.
 * Shows who books what, transfer strategy, settlements, and costs.
 */

import React from 'react';
import { 
  Plane, 
  Building2, 
  CreditCard, 
  Coins, 
  ArrowRight,
  ArrowRightLeft,
  CheckCircle2,
  AlertCircle,
  Users,
  Clock,
  ExternalLink
} from 'lucide-react';
import type { 
  GroupBookingPlan, 
  BookingAssignment, 
  MemberBookingSummary,
  GroupSettlement 
} from '@/types/group-booking';
import { TransferStrategySection } from './TransferStrategySection';

interface BookingPlanViewProps {
  plan: GroupBookingPlan;
}

export function BookingPlanView({ plan }: BookingPlanViewProps) {
  return (
    <div className="space-y-8">
      {/* Overview Card */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-6 rounded-xl">
        <div className="flex items-center gap-2 mb-4">
          <Users className="w-5 h-5" />
          <h2 className="text-lg font-semibold">Group Booking Plan</h2>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-blue-100 text-sm">Total Group Cost</p>
            <p className="text-2xl font-bold">
              ${plan.metrics.totalGroupOOP.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">Per Person</p>
            <p className="text-2xl font-bold">
              ${plan.metrics.perPersonEffectiveCost.toFixed(2)}
            </p>
          </div>
          <div>
            <p className="text-blue-100 text-sm">Points Used</p>
            <p className="text-2xl font-bold">
              {plan.metrics.totalPointsUsed.toLocaleString()}
            </p>
          </div>
          {plan.metrics.totalTransfersNeeded !== undefined && plan.metrics.totalTransfersNeeded > 0 && (
            <div>
              <p className="text-blue-100 text-sm">Transfers Needed</p>
              <p className="text-2xl font-bold">
                {plan.metrics.totalTransfersNeeded}
              </p>
            </div>
          )}
        </div>
        
        {/* Validation Status */}
        <div className="flex items-center gap-4 mt-4 pt-4 border-t border-blue-400">
          <ValidationBadge 
            valid={plan.validation.allSegmentsAssigned}
            label="All Assigned"
          />
          <ValidationBadge 
            valid={plan.validation.allMembersWithinBudget}
            label="Within Budget"
          />
          <ValidationBadge 
            valid={plan.validation.allMembersWithinPoints}
            label="Enough Points"
          />
        </div>
      </div>
      
      {/* Warnings */}
      {plan.warnings && plan.warnings.length > 0 && (
        <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="w-5 h-5 text-yellow-600" />
            <span className="font-medium text-yellow-800">Allocation Notes</span>
          </div>
          <ul className="text-sm text-yellow-700 space-y-1 ml-7">
            {plan.warnings.map((warning, index) => (
              <li key={index} className="list-disc">{warning}</li>
            ))}
          </ul>
        </div>
      )}
      
      {/* NEW: Transfer Strategy Section */}
      {plan.transfersNeeded && plan.transfersNeeded.length > 0 && (
        <TransferStrategySection transfers={plan.transfersNeeded} />
      )}
      
      {/* Member Summaries */}
      <section>
        <h3 className="text-xl font-semibold mb-4">Who Books What</h3>
        <div className="grid md:grid-cols-2 gap-4">
          {plan.memberSummaries.map((summary) => (
            <MemberBookingCard key={summary.memberId} summary={summary} />
          ))}
        </div>
      </section>
      
      {/* Assignment Details */}
      <section>
        <h3 className="text-xl font-semibold mb-4">Segment Assignments</h3>
        <div className="space-y-3">
          {plan.assignments.map((assignment) => (
            <AssignmentRow key={assignment.segmentId} assignment={assignment} />
          ))}
        </div>
      </section>
      
      {/* Settlements */}
      {plan.settlements.length > 0 && (
        <section>
          <h3 className="text-xl font-semibold mb-4">Settlements</h3>
          <p className="text-sm text-gray-500 mb-3">
            After all bookings, these transfers balance the costs equally.
          </p>
          <SettlementList settlements={plan.settlements} />
        </section>
      )}
      
      {plan.settlements.length === 0 && (
        <div className="p-4 bg-green-50 border border-green-200 rounded-lg">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-green-600" />
            <span className="font-medium text-green-800">No settlements needed!</span>
          </div>
          <p className="text-sm text-green-700 mt-1">
            Booking responsibilities are balanced - no money transfers required.
          </p>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function ValidationBadge({ valid, label }: { valid: boolean; label: string }) {
  return (
    <div className={`flex items-center gap-1 text-sm ${valid ? 'text-green-200' : 'text-red-200'}`}>
      {valid ? (
        <CheckCircle2 className="w-4 h-4" />
      ) : (
        <AlertCircle className="w-4 h-4" />
      )}
      <span>{label}</span>
    </div>
  );
}

function MemberBookingCard({ summary }: { summary: MemberBookingSummary }) {
  const netSettlement = summary.settlementAmount;
  
  return (
    <div className="p-4 border border-gray-200 rounded-lg bg-white">
      <div className="flex justify-between items-start mb-3">
        <h4 className="font-semibold text-lg">{summary.memberName}</h4>
        <span className="text-sm bg-gray-100 px-2 py-1 rounded">
          {summary.segmentCount} segment{summary.segmentCount !== 1 ? 's' : ''}
        </span>
      </div>
      
      <div className="space-y-2 text-sm">
        {/* Upfront payment */}
        <div className="flex justify-between">
          <span className="text-gray-600">Pays upfront:</span>
          <span className="font-medium">${summary.totalCashUpfront.toFixed(2)}</span>
        </div>
        
        {/* Points used */}
        {summary.totalPointsUsed > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-600">Points used:</span>
            <span className="font-medium">{summary.totalPointsUsed.toLocaleString()}</span>
          </div>
        )}
        
        {/* Programs */}
        {summary.programsUsed.length > 0 && (
          <div className="flex justify-between">
            <span className="text-gray-600">Programs:</span>
            <span className="text-gray-800">{summary.programsUsed.join(', ')}</span>
          </div>
        )}
        
        {/* Settlement */}
        <div className="pt-2 mt-2 border-t border-gray-100">
          <div className="flex justify-between">
            <span className="text-gray-600">Fair share:</span>
            <span className="font-medium">${summary.fairShare.toFixed(2)}</span>
          </div>
          
          {netSettlement !== 0 && (
            <div className="flex justify-between mt-1">
              <span className="text-gray-600">Settlement:</span>
              <span className={`font-medium ${netSettlement > 0 ? 'text-red-600' : 'text-green-600'}`}>
                {netSettlement > 0 ? `Owes $${netSettlement.toFixed(2)}` : `Owed $${Math.abs(netSettlement).toFixed(2)}`}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function AssignmentRow({ assignment }: { assignment: BookingAssignment }) {
  const Icon = assignment.segmentType === 'flight' ? Plane : Building2;
  
  return (
    <div className="p-3 bg-gray-50 rounded-lg">
      <div className="flex items-center gap-4">
        {/* Segment type icon */}
        <div className={`
          p-2 rounded-lg
          ${assignment.segmentType === 'flight' ? 'bg-blue-100 text-blue-600' : 'bg-purple-100 text-purple-600'}
        `}>
          <Icon className="w-5 h-5" />
        </div>
        
        {/* Segment info */}
        <div className="flex-1">
          <p className="font-medium">
            {assignment.segmentSummary || assignment.segmentId}
          </p>
          <p className="text-sm text-gray-500">
            Booked by {assignment.assignedToName}
          </p>
        </div>
        
        {/* Payment info */}
        <div className="text-right">
          {assignment.usesPoints ? (
            <div className="flex items-center gap-1">
              <Coins className="w-4 h-4 text-amber-500" />
              <span className="font-medium">
                {assignment.pointsUsed?.toLocaleString()} {assignment.pointsProgramName || assignment.pointsProgram}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1">
              <CreditCard className="w-4 h-4 text-green-500" />
              <span className="font-medium">${assignment.cashAmount.toFixed(2)}</span>
            </div>
          )}
          
          {assignment.usesPoints && assignment.cashAmount > 0 && (
            <p className="text-xs text-gray-500">
              + ${assignment.cashAmount.toFixed(2)} surcharge
            </p>
          )}
        </div>
      </div>
      
      {/* Transfer info (if applicable) */}
      {assignment.requiresTransfer && assignment.transferFrom && (
        <div className="mt-2 pt-2 border-t border-gray-200">
          <div className="flex items-center gap-2 text-xs text-purple-600">
            <ArrowRightLeft className="w-3 h-3" />
            <span>
              Transfer {assignment.transferPointsFromSource?.toLocaleString()} from {assignment.transferFromName || assignment.transferFrom}
              {assignment.transferRatioDisplay && ` (${assignment.transferRatioDisplay})`}
            </span>
            {assignment.transferTime && (
              <span className="flex items-center gap-1 text-gray-500">
                <Clock className="w-3 h-3" />
                {assignment.transferTime}
              </span>
            )}
            {assignment.transferPortalUrl && (
              <a 
                href={assignment.transferPortalUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto flex items-center gap-1 text-purple-600 hover:text-purple-700"
              >
                Transfer <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function SettlementList({ settlements }: { settlements: GroupSettlement[] }) {
  return (
    <div className="space-y-2">
      {settlements.map((settlement, index) => (
        <div 
          key={index}
          className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg"
        >
          <div className="flex items-center gap-2 flex-1">
            <span className="font-medium">{settlement.fromName}</span>
            <ArrowRight className="w-4 h-4 text-gray-400" />
            <span className="font-medium">{settlement.toName}</span>
          </div>
          
          <span className="text-lg font-semibold text-green-600">
            ${settlement.amount.toFixed(2)}
          </span>
        </div>
      ))}
    </div>
  );
}

export default BookingPlanView;
