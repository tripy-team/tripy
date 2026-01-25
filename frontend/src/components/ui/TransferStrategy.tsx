/**
 * TransferStrategy - Complete view of optimized point transfer strategy.
 * Shows summary, transfer plan, and payment breakdown to minimize out-of-pocket costs.
 */
'use client';

import { useState } from 'react';
import { 
  Wallet, 
  ArrowRightLeft, 
  CreditCard, 
  Plane, 
  Hotel, 
  ChevronDown, 
  ChevronUp,
  Check,
  ExternalLink,
  Sparkles,
  TrendingDown,
} from 'lucide-react';

// Types for the optimization response
export interface TransferPlanItem {
  from_program: string;
  from_program_name: string;
  to_program: string;
  to_program_name: string;
  points_to_transfer: number;
  transfer_ratio: string;
  resulting_points: number;
  transfer_time: string;
  portal_url: string;
  booking_url: string;
  for_items: string[];
  steps: string[];
}

export interface PaymentPlanItem {
  item_id: string;
  item_type: 'flight' | 'hotel';
  description: string;
  payment_type: 'cash' | 'points';
  cash_paid: number;
  points_used?: number;
  program_used?: string;
  program_name?: string;
  transfer_from?: string;
  transfer_from_name?: string;
}

export interface TransferStrategySolution {
  status: string;
  total_out_of_pocket: number;
  total_points_used: number;
  all_cash_cost: number;
  savings: number;
  savings_percentage: number;
  points_breakdown: Record<string, number>;
  points_remaining: Record<string, number>;
  payment_plan: PaymentPlanItem[];
  transfer_plan: TransferPlanItem[];
  summary?: {
    total_out_of_pocket: string;
    all_cash_would_cost: string;
    you_save: string;
    savings_percentage: string;
    total_points_used: string;
  };
  transfer_summary?: Array<{
    action: string;
    ratio: string;
    you_get: string;
    time: string;
  }>;
  booking_order?: Array<{
    step: number;
    type: 'transfer' | 'booking';
    action: string;
    url?: string;
    item_type?: string;
  }>;
}

interface TransferStrategyProps {
  solution: TransferStrategySolution;
  className?: string;
}

export function TransferStrategy({ solution, className = '' }: TransferStrategyProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('summary');
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };
  
  const formatPoints = (points: number) => {
    if (points >= 1000) {
      return `${(points / 1000).toFixed(points % 1000 === 0 ? 0 : 1)}k`;
    }
    return points.toLocaleString();
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Summary Card */}
      <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl p-6 text-white">
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5" />
          <h2 className="font-semibold text-lg">Optimized Payment Strategy</h2>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-purple-200 text-sm">You Pay</div>
            <div className="text-2xl font-bold">{formatCurrency(solution.total_out_of_pocket)}</div>
          </div>
          <div>
            <div className="text-purple-200 text-sm">All Cash Would Be</div>
            <div className="text-lg font-medium line-through opacity-75">{formatCurrency(solution.all_cash_cost)}</div>
          </div>
          <div>
            <div className="text-purple-200 text-sm flex items-center gap-1">
              <TrendingDown className="w-4 h-4" />
              You Save
            </div>
            <div className="text-2xl font-bold text-green-300">{formatCurrency(solution.savings)}</div>
          </div>
          <div>
            <div className="text-purple-200 text-sm">Points Used</div>
            <div className="text-lg font-medium">{solution.total_points_used.toLocaleString()}</div>
          </div>
        </div>
        
        {solution.savings > 0 && (
          <div className="mt-4 bg-white/10 rounded-lg px-4 py-2 text-sm">
            <span className="font-medium">💡 </span>
            Save {solution.savings_percentage.toFixed(0)}% by using your points strategically
          </div>
        )}
      </div>

      {/* Transfer Plan */}
      {solution.transfer_plan.length > 0 && (
        <CollapsibleSection
          title="Step 1: Transfer Points"
          subtitle={`${solution.transfer_plan.length} transfer${solution.transfer_plan.length > 1 ? 's' : ''} needed`}
          icon={<ArrowRightLeft className="w-5 h-5 text-purple-600" />}
          isExpanded={expandedSection === 'transfers'}
          onToggle={() => setExpandedSection(expandedSection === 'transfers' ? null : 'transfers')}
        >
          <div className="space-y-3">
            {solution.transfer_plan.map((transfer, idx) => (
              <TransferCard key={idx} transfer={transfer} index={idx + 1} />
            ))}
          </div>
        </CollapsibleSection>
      )}

      {/* Payment Breakdown */}
      <CollapsibleSection
        title="Step 2: Book Your Trip"
        subtitle={`${solution.payment_plan.length} item${solution.payment_plan.length > 1 ? 's' : ''} to book`}
        icon={<CreditCard className="w-5 h-5 text-green-600" />}
        isExpanded={expandedSection === 'payments'}
        onToggle={() => setExpandedSection(expandedSection === 'payments' ? null : 'payments')}
      >
        <div className="space-y-2">
          {solution.payment_plan.map((payment, idx) => (
            <PaymentCard key={idx} payment={payment} />
          ))}
        </div>
        
        {/* Total */}
        <div className="mt-4 pt-4 border-t border-slate-200 flex justify-between items-center">
          <span className="font-medium text-slate-700">Total Out-of-Pocket</span>
          <span className="text-xl font-bold text-slate-900">{formatCurrency(solution.total_out_of_pocket)}</span>
        </div>
      </CollapsibleSection>

      {/* Points Remaining */}
      {Object.keys(solution.points_remaining).length > 0 && (
        <CollapsibleSection
          title="Points Remaining"
          subtitle="After all transfers and bookings"
          icon={<Wallet className="w-5 h-5 text-blue-600" />}
          isExpanded={expandedSection === 'remaining'}
          onToggle={() => setExpandedSection(expandedSection === 'remaining' ? null : 'remaining')}
        >
          <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
            {Object.entries(solution.points_remaining).map(([program, points]) => (
              <div key={program} className="bg-slate-50 rounded-lg p-3">
                <div className="text-xs text-slate-500 uppercase">{program}</div>
                <div className="font-medium text-slate-900">{points.toLocaleString()}</div>
              </div>
            ))}
          </div>
        </CollapsibleSection>
      )}
    </div>
  );
}

// Collapsible section component
interface CollapsibleSectionProps {
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  isExpanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

function CollapsibleSection({ title, subtitle, icon, isExpanded, onToggle, children }: CollapsibleSectionProps) {
  return (
    <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden">
      <button
        onClick={onToggle}
        className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
      >
        <div className="flex items-center gap-3">
          {icon}
          <div className="text-left">
            <div className="font-medium text-slate-900">{title}</div>
            <div className="text-sm text-slate-500">{subtitle}</div>
          </div>
        </div>
        {isExpanded ? (
          <ChevronUp className="w-5 h-5 text-slate-400" />
        ) : (
          <ChevronDown className="w-5 h-5 text-slate-400" />
        )}
      </button>
      
      {isExpanded && (
        <div className="px-4 pb-4 border-t border-slate-100">
          <div className="pt-4">
            {children}
          </div>
        </div>
      )}
    </div>
  );
}

// Transfer card component
function TransferCard({ transfer, index }: { transfer: TransferPlanItem; index: number }) {
  const [showSteps, setShowSteps] = useState(false);
  
  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-medium flex-shrink-0">
          {index}
        </div>
        <div className="flex-1 min-w-0">
          <div className="font-medium text-slate-900">
            Transfer {transfer.points_to_transfer.toLocaleString()} points
          </div>
          <div className="text-sm text-slate-600 mt-1 flex items-center gap-2">
            <span>{transfer.from_program_name}</span>
            <ArrowRightLeft className="w-4 h-4 text-slate-400" />
            <span>{transfer.to_program_name}</span>
          </div>
          <div className="flex flex-wrap gap-2 mt-2 text-xs">
            <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded-full">
              {transfer.transfer_ratio} ratio
            </span>
            <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded-full">
              {transfer.transfer_time}
            </span>
            <span className="bg-green-100 text-green-700 px-2 py-1 rounded-full">
              = {transfer.resulting_points.toLocaleString()} pts
            </span>
          </div>
          
          {transfer.for_items.length > 0 && (
            <div className="text-xs text-slate-500 mt-2">
              For: {transfer.for_items.join(', ')}
            </div>
          )}
          
          {/* Steps toggle */}
          {transfer.steps.length > 0 && (
            <div className="mt-3">
              <button
                onClick={() => setShowSteps(!showSteps)}
                className="text-sm text-blue-600 hover:text-blue-700 font-medium"
              >
                {showSteps ? 'Hide steps' : 'Show steps'}
              </button>
              
              {showSteps && (
                <ol className="mt-2 space-y-1 text-sm text-slate-600">
                  {transfer.steps.map((step, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="text-slate-400">{i + 1}.</span>
                      <span>{step.replace(/^\d+\.\s*/, '')}</span>
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
          
          {/* Portal link */}
          {transfer.portal_url && (
            <a
              href={transfer.portal_url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-3 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700"
            >
              Open transfer portal
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

// Payment card component
function PaymentCard({ payment }: { payment: PaymentPlanItem }) {
  const icon = payment.item_type === 'flight' ? (
    <Plane className="w-4 h-4" />
  ) : (
    <Hotel className="w-4 h-4" />
  );
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };
  
  return (
    <div className="flex items-center justify-between p-3 bg-slate-50 rounded-lg">
      <div className="flex items-center gap-3">
        <div className={`p-2 rounded-lg ${payment.item_type === 'flight' ? 'bg-blue-100 text-blue-600' : 'bg-amber-100 text-amber-600'}`}>
          {icon}
        </div>
        <div>
          <div className="font-medium text-slate-900">{payment.description}</div>
          {payment.payment_type === 'points' ? (
            <div className="text-sm text-slate-500">
              {payment.points_used?.toLocaleString()} {payment.program_name} points
              {payment.cash_paid > 0 && ` + ${formatCurrency(payment.cash_paid)} fees`}
            </div>
          ) : (
            <div className="text-sm text-slate-500">Pay with cash</div>
          )}
        </div>
      </div>
      <div className="text-right">
        <div className={`font-medium ${payment.payment_type === 'points' ? 'text-green-600' : 'text-slate-900'}`}>
          {formatCurrency(payment.cash_paid)}
        </div>
        {payment.payment_type === 'points' && (
          <div className="text-xs text-green-600 flex items-center gap-1">
            <Check className="w-3 h-3" />
            Using points
          </div>
        )}
      </div>
    </div>
  );
}

// Compact summary for embedding in other components
export function TransferStrategySummary({ solution }: { solution: TransferStrategySolution }) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  };
  
  return (
    <div className="flex items-center justify-between p-3 bg-gradient-to-r from-purple-50 to-indigo-50 rounded-lg border border-purple-200">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-purple-600" />
        <span className="text-sm font-medium text-purple-900">Optimized Strategy</span>
      </div>
      <div className="text-right">
        <div className="font-bold text-purple-900">{formatCurrency(solution.total_out_of_pocket)}</div>
        <div className="text-xs text-green-600">Save {formatCurrency(solution.savings)}</div>
      </div>
    </div>
  );
}

// Types for booking instructions
export interface BookingInstruction {
  step: number;
  type: 'transfer' | 'flight' | 'hotel' | 'other';
  action: string;
  description: string;
  url?: string;
  payment_type?: 'cash' | 'points';
  cash_to_pay?: number;
  points_to_use?: number;
}

export interface GuaranteedBookingPlan {
  status: string;
  booking_plan: {
    status: string;
    summary: {
      total_out_of_pocket: number;
      all_cash_cost: number;
      savings: number;
      savings_percentage: number;
      total_points_used: number;
    };
    transfer_steps: any[];
    booking_steps: any[];
    all_steps: any[];
    transfer_wait_days: number;
    recommended_order: string[];
    general_notes: string[];
    important_warnings: string[];
  };
  summary: {
    total_out_of_pocket: number;
    all_cash_cost: number;
    savings: number;
    savings_percentage: number;
    total_points_used: number;
  };
  flights: any[];
  booking_instructions: BookingInstruction[];
  warnings: string[];
  notes: string[];
}

interface GuaranteedBookingPlanProps {
  plan: GuaranteedBookingPlan;
  className?: string;
}

// Guaranteed booking plan component - always shows a bookable route
export function GuaranteedBookingPlanView({ plan, className = '' }: GuaranteedBookingPlanProps) {
  const [expandedSection, setExpandedSection] = useState<string | null>('summary');
  
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };
  
  const { summary, booking_instructions, warnings, notes } = plan;
  const isFallback = plan.status === 'Fallback' || plan.status === 'Error';
  
  return (
    <div className={`space-y-4 ${className}`}>
      {/* Status Banner for Fallback */}
      {isFallback && (
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
          <div className="flex items-start gap-3">
            <div className="bg-amber-100 rounded-full p-1">
              <span className="text-amber-600">⚠️</span>
            </div>
            <div>
              <h3 className="font-medium text-amber-900">Cash Booking Available</h3>
              <p className="text-sm text-amber-700 mt-1">
                Points optimization wasn&apos;t available for this route. Showing cash booking options instead.
              </p>
            </div>
          </div>
        </div>
      )}
      
      {/* Warnings */}
      {warnings && warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((warning, idx) => (
            <div key={idx} className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-sm text-amber-700">
              ⚠️ {warning}
            </div>
          ))}
        </div>
      )}
      
      {/* Summary Card */}
      <div className={`rounded-2xl p-6 text-white ${isFallback ? 'bg-gradient-to-br from-slate-600 to-slate-700' : 'bg-gradient-to-br from-purple-600 to-indigo-700'}`}>
        <div className="flex items-center gap-2 mb-4">
          <Sparkles className="w-5 h-5" />
          <h2 className="font-semibold text-lg">
            {isFallback ? 'Booking Summary' : 'Your Optimized Booking Plan'}
          </h2>
        </div>
        
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <div className="text-white/70 text-sm">You Pay</div>
            <div className="text-2xl font-bold">{formatCurrency(summary.total_out_of_pocket)}</div>
          </div>
          {!isFallback && (
            <>
              <div>
                <div className="text-white/70 text-sm">All Cash Would Be</div>
                <div className="text-lg font-medium line-through opacity-75">
                  {formatCurrency(summary.all_cash_cost)}
                </div>
              </div>
              <div>
                <div className="text-white/70 text-sm flex items-center gap-1">
                  <TrendingDown className="w-4 h-4" />
                  You Save
                </div>
                <div className="text-2xl font-bold text-green-300">
                  {formatCurrency(summary.savings)}
                </div>
              </div>
              <div>
                <div className="text-white/70 text-sm">Points Used</div>
                <div className="text-lg font-medium">{summary.total_points_used.toLocaleString()}</div>
              </div>
            </>
          )}
          {isFallback && (
            <div className="col-span-2 md:col-span-3">
              <div className="text-white/70 text-sm">Payment Method</div>
              <div className="text-lg font-medium">💳 Cash / Credit Card</div>
            </div>
          )}
        </div>
        
        {!isFallback && summary.savings > 0 && (
          <div className="mt-4 bg-white/10 rounded-lg px-4 py-2 text-sm">
            <span className="font-medium">💡 </span>
            Save {summary.savings_percentage.toFixed(0)}% by using your points strategically
          </div>
        )}
      </div>

      {/* Booking Instructions */}
      {booking_instructions && booking_instructions.length > 0 && (
        <CollapsibleSection
          title="Booking Steps"
          subtitle={`${booking_instructions.length} step${booking_instructions.length > 1 ? 's' : ''} to complete`}
          icon={<CreditCard className="w-5 h-5 text-green-600" />}
          isExpanded={expandedSection === 'instructions'}
          onToggle={() => setExpandedSection(expandedSection === 'instructions' ? null : 'instructions')}
        >
          <div className="space-y-3">
            {booking_instructions.map((instruction, idx) => (
              <BookingInstructionCard key={idx} instruction={instruction} />
            ))}
          </div>
        </CollapsibleSection>
      )}
      
      {/* Notes */}
      {notes && notes.length > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
          <h3 className="font-medium text-blue-900 mb-2">💡 Tips</h3>
          <ul className="space-y-1">
            {notes.map((note, idx) => (
              <li key={idx} className="text-sm text-blue-700 flex gap-2">
                <span className="text-blue-400">•</span>
                {note}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

// Booking instruction card component
function BookingInstructionCard({ instruction }: { instruction: BookingInstruction }) {
  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(amount);
  };
  
  const getIcon = () => {
    switch (instruction.type) {
      case 'transfer':
        return <ArrowRightLeft className="w-4 h-4" />;
      case 'flight':
        return <Plane className="w-4 h-4" />;
      case 'hotel':
        return <Hotel className="w-4 h-4" />;
      default:
        return <CreditCard className="w-4 h-4" />;
    }
  };
  
  const getIconBg = () => {
    switch (instruction.type) {
      case 'transfer':
        return 'bg-purple-100 text-purple-600';
      case 'flight':
        return 'bg-blue-100 text-blue-600';
      case 'hotel':
        return 'bg-amber-100 text-amber-600';
      default:
        return 'bg-slate-100 text-slate-600';
    }
  };
  
  return (
    <div className="bg-slate-50 rounded-xl p-4">
      <div className="flex items-start gap-3">
        <div className={`w-8 h-8 rounded-full flex items-center justify-center font-medium flex-shrink-0 ${getIconBg()}`}>
          {instruction.step}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-lg ${getIconBg()}`}>
              {getIcon()}
            </div>
            <div className="font-medium text-slate-900">{instruction.action}</div>
          </div>
          <p className="text-sm text-slate-600 mt-1">{instruction.description}</p>
          
          {/* Payment info */}
          {instruction.cash_to_pay !== undefined && instruction.cash_to_pay > 0 && (
            <div className="mt-2 flex items-center gap-2 text-sm">
              <span className={`font-medium ${instruction.payment_type === 'points' ? 'text-green-600' : 'text-slate-900'}`}>
                {formatCurrency(instruction.cash_to_pay)}
              </span>
              {instruction.payment_type === 'points' && instruction.points_to_use && (
                <span className="text-slate-500">
                  + {instruction.points_to_use.toLocaleString()} points
                </span>
              )}
            </div>
          )}
          
          {/* Booking link */}
          {instruction.url && (
            <a
              href={instruction.url}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-2 inline-flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 font-medium"
            >
              {instruction.type === 'transfer' ? 'Open transfer portal' : 'Book now'}
              <ExternalLink className="w-3 h-3" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default TransferStrategy;
