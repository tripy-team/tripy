# Frontend + Agentic ILP Integration Plan

## Executive Summary

This document details the implementation plan to integrate the **Agentic ILP Architecture** with the **Tripy Frontend** to achieve the core goal: **minimize out-of-pocket (OOP) expense** while maximizing points value. The integration ensures users always see results ranked by least cash paid, with transparent cost breakdowns powered by AI agents.

---

## Current State Analysis

### Frontend Architecture

| Component | Technology |
|-----------|------------|
| Framework | Next.js 15 (App Router) |
| UI | React 19, Tailwind CSS v4 |
| State | React hooks, custom hooks (`useTrip`, `useItinerary`, `usePoints`) |
| API Client | Centralized `lib/api.ts` with auth handling |

### Current Results Ranking Logic

```typescript
// Current: Ranks by feasibility, then score
transformed = transformed.sort((a, b) => {
  const sa = (a.withinBudget ? 2 : 0) + (a.withinPoints ? 1 : 0);
  const sb = (b.withinBudget ? 2 : 0) + (b.withinPoints ? 1 : 0);
  if (sb !== sa) return sb - sa;
  return (b.score || 0) - (a.score || 0);
});
```

**Problem:** Results are ranked by score/feasibility, not by actual out-of-pocket cost.

### Current Cost Display

- Shows `totalCost` and `pointsCost` but doesn't emphasize OOP
- Estimates savings with fixed formula: `pointsCost * 0.015`
- No per-segment breakdown
- No transfer instructions in results

---

## Target State: OOP-First UI

### New Ranking Logic

```typescript
// Target: Rank by out-of-pocket (lowest first)
transformed = transformed.sort((a, b) => {
  // Primary: Lowest OOP first
  if (a.outOfPocket !== b.outOfPocket) {
    return a.outOfPocket - b.outOfPocket;
  }
  // Secondary: Within constraints preferred
  const sa = (a.withinBudget ? 2 : 0) + (a.withinPoints ? 1 : 0);
  const sb = (b.withinBudget ? 2 : 0) + (b.withinPoints ? 1 : 0);
  if (sb !== sa) return sb - sa;
  // Tertiary: Higher savings percentage
  return (b.savingsPercentage || 0) - (a.savingsPercentage || 0);
});
```

### New UI Priorities

1. **OOP prominently displayed** - Large, clear "You Pay" amount
2. **Savings highlighted** - Show cash saved vs all-cash price
3. **Per-segment breakdown** - Click to expand each flight/hotel
4. **Transfer instructions** - Step-by-step with portal links
5. **AI explanations** - Cost Breakdown Agent explains each decision

---

## Architecture Integration

```
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                                 FRONTEND (Next.js)                                   │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   /solo/setup ───► /solo/results ───► /solo/booking                                │
│   /group/setup ──► /group/results ──► /group/booking                               │
│                          │                                                          │
│                          ▼                                                          │
│   ┌─────────────────────────────────────────────────────────────────────┐          │
│   │                    API Client (lib/api.ts)                          │          │
│   │                                                                      │          │
│   │   POST /optimize/solo     →  Ranked itineraries by OOP              │          │
│   │   POST /optimize/group    →  Ranked itineraries + settlements       │          │
│   │   GET  /itinerary/:id/breakdown  →  AI cost breakdown               │          │
│   │                                                                      │          │
│   └─────────────────────────────────────────────────────────────────────┘          │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
                                          │
                                          ▼
┌─────────────────────────────────────────────────────────────────────────────────────┐
│                              BACKEND (FastAPI + Agents)                              │
├─────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                      │
│   🤖 Orchestrator Agent ──► 🛫 Flight Agent ──► AwardTool / SerpAPI                │
│          │                 └──► 🏨 Hotel Agent ──► AwardTool Hotels / SerpAPI      │
│          │                                                                          │
│          ▼                                                                          │
│   ⚡ ILP Optimizer (OOP Mode) ──► 📋 Ranking Engine (sort by OOP)                  │
│          │                                                                          │
│          ▼                                                                          │
│   🤖 Cost Breakdown Agent ──► Human-readable explanations                          │
│                                                                                      │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

---

## Implementation Phases

### Phase 1: API Schema Updates

#### 1.1 New Response Types

**File: `frontend/src/types/optimization.ts`**

```typescript
/**
 * OOP-optimized itinerary response from agentic backend
 */

// =============================================================================
// OOP METRICS
// =============================================================================

export interface OOPMetrics {
  /** Total price if paid entirely in cash */
  totalCashPrice: number;
  
  /** Actual cash you'll pay (surcharges + taxes + any cash segments) */
  totalOutOfPocket: number;
  
  /** Total points being redeemed */
  totalPointsUsed: number;
  
  /** Cash saved: totalCashPrice - totalOutOfPocket */
  cashSaved: number;
  
  /** Savings as percentage: (cashSaved / totalCashPrice) * 100 */
  savingsPercentage: number;
  
  /** Weighted average CPP across all point redemptions */
  averageCPP: number;
  
  /** Points used per program: { "United MileagePlus": 45000, ... } */
  pointsBreakdown: Record<string, number>;
}

// =============================================================================
// SEGMENT DETAILS
// =============================================================================

export interface FlightSegment {
  id: string;
  type: 'flight';
  
  // Route
  origin: string;
  destination: string;
  departureTime: string;
  arrivalTime: string;
  durationMinutes: number;
  
  // Flight info
  airline: string;
  flightNumber: string;
  cabinClass: 'Economy' | 'Premium Economy' | 'Business' | 'First';
  
  // Pricing
  cashPrice: number;
  
  // Payment decision
  payment: SegmentPayment;
  
  // Metadata
  bookingUrl?: string;
}

export interface HotelSegment {
  id: string;
  type: 'hotel';
  
  // Property
  name: string;
  brand?: string;
  starRating: number;
  city: string;
  
  // Dates
  checkIn: string;
  checkOut: string;
  nights: number;
  
  // Pricing
  cashPricePerNight: number;
  cashPriceTotal: number;
  
  // Payment decision
  payment: SegmentPayment;
  
  // Metadata
  bookingUrl?: string;
}

export type TripSegment = FlightSegment | HotelSegment;

// =============================================================================
// PAYMENT DECISIONS
// =============================================================================

export interface CashPayment {
  method: 'cash';
  amount: number;
  payer?: string; // For group trips
  reason?: string; // AI explanation
}

export interface PointsPayment {
  method: 'points';
  
  // Points details
  program: string; // e.g., "United MileagePlus"
  pointsUsed: number;
  surcharge: number; // Cash surcharge (taxes/fees)
  
  // Value metrics
  cppAchieved: number;
  cashSaved: number;
  
  // Transfer details (if transfer required)
  transfer?: TransferInstruction;
  
  // Payer (for group trips)
  payer?: string;
  
  // AI explanation
  reason?: string;
}

export type SegmentPayment = CashPayment | PointsPayment;

// =============================================================================
// TRANSFER INSTRUCTIONS
// =============================================================================

export interface TransferInstruction {
  /** Source program (bank points) */
  fromProgram: string; // e.g., "Chase Ultimate Rewards"
  
  /** Target program (airline/hotel) */
  toProgram: string; // e.g., "United MileagePlus"
  
  /** Points to transfer */
  pointsToTransfer: number;
  
  /** Transfer ratio (e.g., 1.0 = 1:1) */
  ratio: number;
  
  /** Portal URL for transfer */
  portalUrl: string;
  
  /** Estimated transfer time */
  transferTime: string; // e.g., "Instant", "1-2 days"
  
  /** Step-by-step instructions */
  steps: string[];
  
  /** Any warnings */
  warning?: string;
}

// =============================================================================
// RANKED ITINERARY
// =============================================================================

export interface RankedItinerary {
  id: string;
  rank: number; // 1 = best OOP
  name: string;
  
  // Route
  route: string[]; // ["JFK", "CDG", "FCO", "JFK"]
  
  // All segments
  segments: TripSegment[];
  
  // OOP metrics (the key data!)
  oopMetrics: OOPMetrics;
  
  // All transfers needed
  transfers: TransferInstruction[];
  
  // Constraint checks
  withinBudget: boolean;
  withinPoints: boolean;
  
  // AI-generated summary
  summary?: string;
}

// =============================================================================
// GROUP-SPECIFIC
// =============================================================================

export interface GroupMemberCost {
  memberId: string;
  memberName: string;
  
  /** Their share before points */
  baseCost: number;
  
  /** Value of points they contributed */
  pointsContribution: number;
  
  /** Final cash they owe */
  finalCost: number;
  
  /** Points they used */
  pointsUsed: number;
  
  /** Programs they used */
  programsUsed: string[];
}

export interface Settlement {
  from: string;
  fromName: string;
  to: string;
  toName: string;
  amount: number;
  reason: string;
}

export interface GroupOOPMetrics extends OOPMetrics {
  memberCosts: GroupMemberCost[];
  settlements: Settlement[];
  perPersonAverage: number;
}

// =============================================================================
// API RESPONSES
// =============================================================================

export interface OptimizeSoloResponse {
  tripId: string;
  itineraries: RankedItinerary[]; // Sorted by OOP (lowest first)
  
  // Best option summary
  bestOption: {
    outOfPocket: number;
    savingsPercentage: number;
    pointsUsed: number;
  };
  
  // Warnings
  warnings?: string[];
}

export interface OptimizeGroupResponse {
  tripId: string;
  itineraries: RankedItinerary[];
  
  // Group-specific metrics
  groupMetrics: GroupOOPMetrics;
  
  // Best option summary
  bestOption: {
    totalOutOfPocket: number;
    perPersonAverage: number;
    totalSavings: number;
  };
  
  warnings?: string[];
}

// =============================================================================
// COST BREAKDOWN (from AI agent)
// =============================================================================

export interface CostBreakdown {
  /** Trip summary */
  tripSummary: {
    route: string;
    totalCashPrice: number;
    totalOutOfPocket: number;
    totalSavings: number;
    savingsPercentage: number;
  };
  
  /** Per-segment breakdown */
  segments: SegmentBreakdown[];
  
  /** Transfer summary */
  transferSummary: {
    totalTransfers: number;
    bySource: Record<string, {
      totalTransferred: number;
      destinations: string[];
    }>;
    recommendedOrder: string[];
    timingAdvice: string;
  };
  
  /** Payment breakdown */
  paymentBreakdown: {
    cashPayments: Array<{ item: string; amount: number }>;
    totalCash: number;
    pointsUsed: Record<string, number>;
    totalPoints: number;
  };
  
  /** Value analysis */
  valueAnalysis: {
    averageCPP: number;
    bestRedemption: { segment: string; cpp: number; program: string };
    worstRedemption?: { segment: string; cpp: number; program: string; note: string };
  };
}

export interface SegmentBreakdown {
  segment: string; // "JFK → CDG (Business)"
  type: 'flight' | 'hotel';
  cashPrice: number;
  payment: {
    method: 'cash' | 'points';
    amount?: number; // For cash
    program?: string; // For points
    pointsUsed?: number;
    surcharge?: number;
    cppAchieved?: number;
    reason?: string;
  };
  transfer?: {
    required: boolean;
    from?: string;
    to?: string;
    pointsToTransfer?: number;
    ratio?: string;
    portalUrl?: string;
    transferTime?: string;
    instructions?: string[];
  };
}
```

#### 1.2 Update API Client

**File: `frontend/src/lib/api.ts` (additions)**

```typescript
// =============================================================================
// AGENTIC OPTIMIZATION API
// =============================================================================

export interface OptimizeSoloRequest {
  tripId: string;
  /** User's points balances: { "Chase UR": 100000, "Amex MR": 50000, ... } */
  points: Record<string, number>;
  /** Max cash budget */
  budget: number;
  /** Cabin class preferences */
  cabinClasses?: ('Economy' | 'Premium Economy' | 'Business' | 'First')[];
  /** Hotel star preferences */
  hotelStars?: (3 | 4 | 5)[];
  /** Include hotels in optimization */
  includeHotels?: boolean;
}

export interface OptimizeGroupRequest extends OptimizeSoloRequest {
  /** Per-member points: { "user123": { "Chase UR": 50000 }, ... } */
  memberPoints: Record<string, Record<string, number>>;
  /** Per-member budgets */
  memberBudgets: Record<string, number>;
  /** Cost splitting method */
  splitMethod?: 'equal' | 'by_usage' | 'proportional';
}

export const optimization = {
  /**
   * Optimize solo trip - returns itineraries ranked by OOP
   */
  solo: async (request: OptimizeSoloRequest): Promise<OptimizeSoloResponse> => {
    return apiRequest<OptimizeSoloResponse>('/optimize/solo', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Optimize group trip - returns itineraries with settlements
   */
  group: async (request: OptimizeGroupRequest): Promise<OptimizeGroupResponse> => {
    return apiRequest<OptimizeGroupResponse>('/optimize/group', {
      method: 'POST',
      body: JSON.stringify(request),
    });
  },

  /**
   * Get detailed cost breakdown for an itinerary (from Cost Breakdown Agent)
   */
  getCostBreakdown: async (itineraryId: string): Promise<CostBreakdown> => {
    return apiRequest<CostBreakdown>(`/optimize/breakdown/${itineraryId}`, {
      method: 'GET',
    });
  },

  /**
   * Compare OOP vs CPP strategies
   */
  compareStrategies: async (tripId: string): Promise<{
    oop: RankedItinerary;
    cpp: RankedItinerary;
    recommendation: 'oop' | 'cpp';
    explanation: string;
  }> => {
    return apiRequest(`/optimize/compare/${tripId}`, {
      method: 'GET',
    });
  },
};
```

---

### Phase 2: New UI Components

#### 2.1 OOP Summary Card

**File: `frontend/src/components/ui/OOPSummaryCard.tsx`**

```tsx
'use client';

import { DollarSign, Zap, TrendingDown, Sparkles } from 'lucide-react';
import { OOPMetrics } from '@/types/optimization';

interface OOPSummaryCardProps {
  metrics: OOPMetrics;
  rank?: number;
  isSelected?: boolean;
}

export function OOPSummaryCard({ metrics, rank, isSelected }: OOPSummaryCardProps) {
  return (
    <div className={`
      p-6 rounded-2xl border-2 transition-all
      ${isSelected 
        ? 'border-emerald-500 bg-gradient-to-br from-emerald-50 to-teal-50 shadow-lg shadow-emerald-500/10' 
        : 'border-slate-200 bg-white hover:border-emerald-300'
      }
    `}>
      {/* Rank Badge */}
      {rank === 1 && (
        <div className="flex items-center gap-2 mb-4">
          <span className="px-3 py-1 bg-emerald-100 text-emerald-800 rounded-full text-sm font-semibold flex items-center gap-1">
            <Sparkles className="w-3.5 h-3.5" />
            Lowest Out-of-Pocket
          </span>
        </div>
      )}

      {/* Main OOP Display */}
      <div className="flex items-baseline gap-3 mb-4">
        <span className="text-4xl font-bold text-slate-900">
          ${metrics.totalOutOfPocket.toLocaleString()}
        </span>
        <span className="text-slate-500 text-lg">you pay</span>
      </div>

      {/* Savings Highlight */}
      <div className="flex items-center gap-2 p-3 bg-emerald-100 rounded-xl mb-4">
        <TrendingDown className="w-5 h-5 text-emerald-600" />
        <span className="text-emerald-800 font-medium">
          Save ${metrics.cashSaved.toLocaleString()} ({metrics.savingsPercentage.toFixed(0)}% off)
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-3 gap-4">
        <div>
          <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
            <DollarSign className="w-3.5 h-3.5" />
            Cash Price
          </div>
          <div className="text-lg font-semibold text-slate-400 line-through">
            ${metrics.totalCashPrice.toLocaleString()}
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
            <Zap className="w-3.5 h-3.5" />
            Points Used
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {(metrics.totalPointsUsed / 1000).toFixed(0)}k
          </div>
        </div>

        <div>
          <div className="flex items-center gap-1.5 text-slate-500 text-xs mb-1">
            <TrendingDown className="w-3.5 h-3.5" />
            Avg CPP
          </div>
          <div className="text-lg font-semibold text-slate-900">
            {metrics.averageCPP.toFixed(1)}¢
          </div>
        </div>
      </div>

      {/* Points Breakdown */}
      {Object.keys(metrics.pointsBreakdown).length > 0 && (
        <div className="mt-4 pt-4 border-t border-slate-100">
          <div className="text-xs text-slate-500 mb-2">Points by program:</div>
          <div className="flex flex-wrap gap-2">
            {Object.entries(metrics.pointsBreakdown).map(([program, points]) => (
              <span 
                key={program}
                className="px-2 py-1 bg-blue-50 text-blue-700 rounded-lg text-xs font-medium"
              >
                {program}: {(points / 1000).toFixed(0)}k
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
```

#### 2.2 Segment Breakdown Component

**File: `frontend/src/components/ui/SegmentBreakdown.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { 
  Plane, Hotel, ChevronDown, ChevronUp, 
  DollarSign, Zap, ArrowRight, ExternalLink,
  Clock, AlertCircle
} from 'lucide-react';
import { TripSegment, TransferInstruction } from '@/types/optimization';

interface SegmentBreakdownProps {
  segments: TripSegment[];
  transfers: TransferInstruction[];
}

export function SegmentBreakdown({ segments, transfers }: SegmentBreakdownProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  return (
    <div className="space-y-3">
      <h3 className="text-lg font-semibold text-slate-900 mb-4">
        Cost Breakdown by Segment
      </h3>

      {segments.map((segment) => {
        const isExpanded = expandedId === segment.id;
        const isFlight = segment.type === 'flight';
        const isPoints = segment.payment.method === 'points';

        return (
          <div 
            key={segment.id}
            className="bg-white border border-slate-200 rounded-xl overflow-hidden"
          >
            {/* Summary Row */}
            <button
              onClick={() => setExpandedId(isExpanded ? null : segment.id)}
              className="w-full p-4 flex items-center justify-between hover:bg-slate-50 transition-colors"
            >
              <div className="flex items-center gap-3">
                {isFlight ? (
                  <div className="w-10 h-10 bg-blue-100 rounded-lg flex items-center justify-center">
                    <Plane className="w-5 h-5 text-blue-600" />
                  </div>
                ) : (
                  <div className="w-10 h-10 bg-amber-100 rounded-lg flex items-center justify-center">
                    <Hotel className="w-5 h-5 text-amber-600" />
                  </div>
                )}

                <div className="text-left">
                  <div className="font-medium text-slate-900">
                    {isFlight 
                      ? `${(segment as any).origin} → ${(segment as any).destination}`
                      : (segment as any).name
                    }
                  </div>
                  <div className="text-sm text-slate-500">
                    {isFlight 
                      ? `${(segment as any).cabinClass} · ${(segment as any).airline}`
                      : `${(segment as any).nights} nights · ${(segment as any).starRating}★`
                    }
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-4">
                {/* Payment Badge */}
                {isPoints ? (
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-blue-600 font-semibold">
                      <Zap className="w-4 h-4" />
                      {((segment.payment as any).pointsUsed / 1000).toFixed(0)}k pts
                    </div>
                    <div className="text-sm text-slate-500">
                      +${(segment.payment as any).surcharge} surcharge
                    </div>
                  </div>
                ) : (
                  <div className="text-right">
                    <div className="flex items-center gap-1 text-slate-900 font-semibold">
                      <DollarSign className="w-4 h-4" />
                      ${(segment.payment as any).amount?.toLocaleString()}
                    </div>
                    <div className="text-sm text-slate-500">cash</div>
                  </div>
                )}

                {isExpanded ? (
                  <ChevronUp className="w-5 h-5 text-slate-400" />
                ) : (
                  <ChevronDown className="w-5 h-5 text-slate-400" />
                )}
              </div>
            </button>

            {/* Expanded Details */}
            {isExpanded && (
              <div className="px-4 pb-4 pt-2 border-t border-slate-100 bg-slate-50">
                {/* Cash vs Points Comparison */}
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div className={`p-3 rounded-lg ${!isPoints ? 'bg-emerald-50 border-2 border-emerald-200' : 'bg-white border border-slate-200'}`}>
                    <div className="text-xs text-slate-500 mb-1">Cash Price</div>
                    <div className="text-lg font-semibold text-slate-900">
                      ${segment.cashPrice.toLocaleString()}
                    </div>
                    {!isPoints && (
                      <div className="text-xs text-emerald-600 mt-1">✓ Selected</div>
                    )}
                  </div>

                  {isPoints && (
                    <div className="p-3 rounded-lg bg-blue-50 border-2 border-blue-200">
                      <div className="text-xs text-slate-500 mb-1">Points + Surcharge</div>
                      <div className="text-lg font-semibold text-slate-900">
                        {((segment.payment as any).pointsUsed / 1000).toFixed(0)}k + ${(segment.payment as any).surcharge}
                      </div>
                      <div className="text-xs text-blue-600 mt-1">
                        ✓ Selected · {(segment.payment as any).cppAchieved?.toFixed(1)}¢/pt
                      </div>
                    </div>
                  )}
                </div>

                {/* AI Explanation */}
                {segment.payment.reason && (
                  <div className="p-3 bg-amber-50 rounded-lg mb-4">
                    <div className="text-sm text-amber-800">
                      <strong>Why this option:</strong> {segment.payment.reason}
                    </div>
                  </div>
                )}

                {/* Transfer Instructions (if points) */}
                {isPoints && (segment.payment as any).transfer && (
                  <TransferCard transfer={(segment.payment as any).transfer} />
                )}

                {/* Booking Link */}
                {segment.bookingUrl && (
                  <a
                    href={segment.bookingUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-center gap-2 w-full p-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
                  >
                    Book This {isFlight ? 'Flight' : 'Hotel'}
                    <ExternalLink className="w-4 h-4" />
                  </a>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TransferCard({ transfer }: { transfer: TransferInstruction }) {
  return (
    <div className="p-4 bg-white border border-slate-200 rounded-lg mb-4">
      <div className="flex items-center gap-2 mb-3">
        <Zap className="w-4 h-4 text-blue-600" />
        <span className="font-medium text-slate-900">Transfer Required</span>
      </div>

      {/* Transfer Flow */}
      <div className="flex items-center gap-3 mb-4 p-3 bg-blue-50 rounded-lg">
        <span className="font-medium text-blue-800">{transfer.fromProgram}</span>
        <ArrowRight className="w-4 h-4 text-blue-400" />
        <span className="font-medium text-blue-800">{transfer.toProgram}</span>
        <span className="text-sm text-blue-600 ml-auto">
          {transfer.pointsToTransfer.toLocaleString()} pts ({transfer.ratio}:1)
        </span>
      </div>

      {/* Transfer Time */}
      <div className="flex items-center gap-2 mb-3 text-sm text-slate-600">
        <Clock className="w-4 h-4" />
        Transfer time: {transfer.transferTime}
      </div>

      {/* Steps */}
      <div className="space-y-2 mb-4">
        {transfer.steps.map((step, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            <span className="w-5 h-5 bg-slate-200 rounded-full flex items-center justify-center text-xs font-medium flex-shrink-0">
              {i + 1}
            </span>
            <span className="text-slate-700">{step}</span>
          </div>
        ))}
      </div>

      {/* Warning */}
      {transfer.warning && (
        <div className="flex items-start gap-2 p-2 bg-amber-50 rounded text-sm text-amber-800">
          <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          {transfer.warning}
        </div>
      )}

      {/* Portal Link */}
      <a
        href={transfer.portalUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-2 w-full p-2 mt-3 border border-blue-200 text-blue-600 rounded-lg hover:bg-blue-50 transition-colors text-sm font-medium"
      >
        Open Transfer Portal
        <ExternalLink className="w-3.5 h-3.5" />
      </a>
    </div>
  );
}
```

#### 2.3 Group Settlement Component

**File: `frontend/src/components/ui/GroupSettlement.tsx`**

```tsx
'use client';

import { Users, ArrowRight, DollarSign, Zap, CheckCircle } from 'lucide-react';
import { GroupMemberCost, Settlement } from '@/types/optimization';

interface GroupSettlementProps {
  memberCosts: GroupMemberCost[];
  settlements: Settlement[];
  perPersonAverage: number;
}

export function GroupSettlement({ memberCosts, settlements, perPersonAverage }: GroupSettlementProps) {
  return (
    <div className="space-y-6">
      {/* Per-Person Costs */}
      <div>
        <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Users className="w-5 h-5" />
          Individual Costs
        </h3>
        
        <div className="text-sm text-slate-600 mb-3">
          Average per person: <strong className="text-slate-900">${perPersonAverage.toLocaleString()}</strong>
        </div>

        <div className="space-y-3">
          {memberCosts.map((member) => (
            <div 
              key={member.memberId}
              className="p-4 bg-white border border-slate-200 rounded-xl"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="font-medium text-slate-900">{member.memberName}</span>
                <span className="text-xl font-bold text-emerald-600">
                  ${member.finalCost.toLocaleString()}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-slate-500">Base share</div>
                  <div className="font-medium text-slate-900">
                    ${member.baseCost.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500 flex items-center gap-1">
                    <Zap className="w-3 h-3" /> Points value
                  </div>
                  <div className="font-medium text-blue-600">
                    -${member.pointsContribution.toLocaleString()}
                  </div>
                </div>
                <div>
                  <div className="text-slate-500">Points used</div>
                  <div className="font-medium text-slate-900">
                    {(member.pointsUsed / 1000).toFixed(0)}k
                  </div>
                </div>
              </div>

              {member.programsUsed.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1">
                  {member.programsUsed.map((prog) => (
                    <span 
                      key={prog}
                      className="px-2 py-0.5 bg-blue-50 text-blue-700 rounded text-xs"
                    >
                      {prog}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Settlements */}
      {settlements.length > 0 && (
        <div>
          <h3 className="text-lg font-semibold text-slate-900 mb-4 flex items-center gap-2">
            <DollarSign className="w-5 h-5" />
            Settlements
          </h3>
          
          <div className="space-y-2">
            {settlements.map((settlement, i) => (
              <div 
                key={i}
                className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-lg"
              >
                <span className="font-medium text-slate-900">{settlement.fromName}</span>
                <ArrowRight className="w-4 h-4 text-amber-600" />
                <span className="font-medium text-slate-900">{settlement.toName}</span>
                <span className="ml-auto font-bold text-amber-800">
                  ${settlement.amount.toLocaleString()}
                </span>
              </div>
            ))}
          </div>
          
          <p className="mt-3 text-sm text-slate-600">
            {settlements.length === 0 ? (
              <span className="flex items-center gap-1 text-emerald-600">
                <CheckCircle className="w-4 h-4" />
                All settled! No payments needed between members.
              </span>
            ) : (
              `${settlements.length} payment(s) needed to settle up.`
            )}
          </p>
        </div>
      )}
    </div>
  );
}
```

---

### Phase 3: Updated Results Pages

#### 3.1 Solo Results Page Updates

**File: `frontend/src/app/(app)/solo/results/page.tsx` (key changes)**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { optimization, type RankedItinerary, type OptimizeSoloResponse } from '@/lib/api';
import { OOPSummaryCard } from '@/components/ui/OOPSummaryCard';
import { SegmentBreakdown } from '@/components/ui/SegmentBreakdown';
import { Sparkles, TrendingDown, MapPin, Loader2 } from 'lucide-react';

export default function SoloResultsOOP() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('trip_id') || '';

  const [results, setResults] = useState<OptimizeSoloResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchResults = async () => {
      if (!tripId) {
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        
        // Call the new agentic optimization endpoint
        const response = await optimization.solo({
          tripId,
          points: {}, // Will be populated from trip data
          budget: 5000, // Will be populated from trip data
          includeHotels: true,
        });

        // Results are already sorted by OOP (lowest first) from backend
        setResults(response);
        
        if (response.itineraries.length > 0) {
          setSelectedId(response.itineraries[0].id);
        }
      } catch (err) {
        console.error('Error fetching optimized itineraries:', err);
        setError('Failed to generate optimized itineraries. Please try again.');
      } finally {
        setLoading(false);
      }
    };

    fetchResults();
  }, [tripId]);

  const selectedItinerary = results?.itineraries.find(i => i.id === selectedId);

  if (loading) {
    return (
      <div className="min-h-full flex items-center justify-center bg-gradient-to-br from-white via-emerald-50/20 to-white">
        <div className="text-center">
          <div className="w-16 h-16 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-2xl flex items-center justify-center mx-auto mb-6 animate-pulse shadow-xl shadow-emerald-600/20">
            <TrendingDown className="w-8 h-8 text-white" />
          </div>
          <h2 className="text-2xl mb-2 text-slate-900 font-semibold">Minimizing your costs</h2>
          <p className="text-slate-600">Finding the lowest out-of-pocket options...</p>
          <div className="mt-4 flex items-center justify-center gap-2 text-sm text-slate-500">
            <Loader2 className="w-4 h-4 animate-spin" />
            Searching flights · Checking award availability · Running optimization
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <div className="text-red-500 mb-4">{error}</div>
          <button
            onClick={() => router.push('/solo/setup')}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl"
          >
            Back to Setup
          </button>
        </div>
      </div>
    );
  }

  if (!results || results.itineraries.length === 0) {
    return (
      <div className="min-h-full flex items-center justify-center p-8">
        <div className="text-center max-w-md">
          <MapPin className="w-12 h-12 text-slate-300 mx-auto mb-4" />
          <h2 className="text-xl font-semibold mb-2">No routes found</h2>
          <p className="text-slate-600 mb-6">
            We couldn't find any routes within your budget and available points.
          </p>
          <button
            onClick={() => router.push('/solo/setup')}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl"
          >
            Adjust Trip Settings
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-full p-8 bg-gradient-to-br from-white via-emerald-50/20 to-white">
      <div className="max-w-7xl mx-auto">
        {/* Header with Best OOP */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="w-12 h-12 bg-gradient-to-br from-emerald-600 to-teal-600 rounded-xl flex items-center justify-center shadow-lg shadow-emerald-600/20">
              <TrendingDown className="w-6 h-6 text-white" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-slate-900">
                Best Options by Out-of-Pocket
              </h1>
              <p className="text-slate-600">
                Ranked by lowest cash you'll actually pay
              </p>
            </div>
          </div>

          {/* Best Option Highlight */}
          <div className="p-6 bg-gradient-to-br from-emerald-500 to-teal-600 rounded-2xl text-white shadow-xl shadow-emerald-500/20">
            <div className="flex items-center gap-2 mb-2 text-emerald-100">
              <Sparkles className="w-4 h-4" />
              <span className="text-sm font-medium uppercase tracking-wider">Best Deal</span>
            </div>
            <div className="flex items-baseline gap-3">
              <span className="text-5xl font-bold">
                ${results.bestOption.outOfPocket.toLocaleString()}
              </span>
              <span className="text-emerald-100 text-lg">total out-of-pocket</span>
            </div>
            <div className="mt-3 flex items-center gap-4 text-emerald-100">
              <span>Save {results.bestOption.savingsPercentage.toFixed(0)}%</span>
              <span>·</span>
              <span>Using {(results.bestOption.pointsUsed / 1000).toFixed(0)}k points</span>
            </div>
          </div>
        </div>

        {/* Warnings */}
        {results.warnings && results.warnings.length > 0 && (
          <div className="mb-6 space-y-2">
            {results.warnings.map((warning, i) => (
              <div key={i} className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-amber-800 text-sm">
                {warning}
              </div>
            ))}
          </div>
        )}

        {/* Results Grid */}
        <div className="grid lg:grid-cols-3 gap-6">
          {/* Itinerary List */}
          <div className="lg:col-span-2 space-y-4">
            {results.itineraries.map((itinerary, index) => (
              <div
                key={itinerary.id}
                onClick={() => setSelectedId(itinerary.id)}
                className={`cursor-pointer transition-all ${
                  selectedId === itinerary.id ? 'ring-2 ring-emerald-500' : ''
                }`}
              >
                <OOPSummaryCard
                  metrics={itinerary.oopMetrics}
                  rank={index + 1}
                  isSelected={selectedId === itinerary.id}
                />
                
                {/* Route Preview */}
                <div className="mt-2 px-4 py-2 bg-slate-50 rounded-lg text-sm text-slate-600">
                  {itinerary.route.join(' → ')}
                </div>
              </div>
            ))}
          </div>

          {/* Selected Itinerary Details */}
          {selectedItinerary && (
            <div className="lg:col-span-1">
              <div className="sticky top-8 space-y-6">
                {/* Segment Breakdown */}
                <SegmentBreakdown
                  segments={selectedItinerary.segments}
                  transfers={selectedItinerary.transfers}
                />

                {/* AI Summary */}
                {selectedItinerary.summary && (
                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-xl">
                    <div className="flex items-center gap-2 mb-2 text-blue-800">
                      <Sparkles className="w-4 h-4" />
                      <span className="font-medium">AI Analysis</span>
                    </div>
                    <p className="text-sm text-blue-700">{selectedItinerary.summary}</p>
                  </div>
                )}

                {/* Book Button */}
                <button
                  onClick={() => router.push(`/solo/booking?trip_id=${tripId}&itinerary_id=${selectedItinerary.id}`)}
                  className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-colors shadow-lg shadow-yellow-400/20 font-bold text-lg"
                >
                  Book for ${selectedItinerary.oopMetrics.totalOutOfPocket.toLocaleString()}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
```

---

### Phase 4: Custom Hooks

#### 4.1 useOOPOptimization Hook

**File: `frontend/src/lib/hooks/useOOPOptimization.ts`**

```typescript
'use client';

import { useState, useEffect, useCallback } from 'react';
import { 
  optimization, 
  OptimizeSoloResponse, 
  OptimizeGroupResponse,
  RankedItinerary,
  CostBreakdown 
} from '@/lib/api';

interface UseOOPOptimizationOptions {
  tripId: string;
  tripType: 'solo' | 'group';
  points: Record<string, number>;
  budget: number;
  memberPoints?: Record<string, Record<string, number>>;
  memberBudgets?: Record<string, number>;
  cabinClasses?: string[];
  hotelStars?: number[];
  includeHotels?: boolean;
  autoFetch?: boolean;
}

interface UseOOPOptimizationReturn {
  // State
  loading: boolean;
  error: string | null;
  results: OptimizeSoloResponse | OptimizeGroupResponse | null;
  
  // Selected itinerary
  selectedItinerary: RankedItinerary | null;
  setSelectedId: (id: string | null) => void;
  
  // Cost breakdown (lazy loaded)
  costBreakdown: CostBreakdown | null;
  loadingBreakdown: boolean;
  fetchCostBreakdown: (itineraryId: string) => Promise<void>;
  
  // Actions
  refetch: () => Promise<void>;
  
  // Computed
  bestOption: {
    outOfPocket: number;
    savingsPercentage: number;
    pointsUsed: number;
  } | null;
}

export function useOOPOptimization(options: UseOOPOptimizationOptions): UseOOPOptimizationReturn {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<OptimizeSoloResponse | OptimizeGroupResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [costBreakdown, setCostBreakdown] = useState<CostBreakdown | null>(null);
  const [loadingBreakdown, setLoadingBreakdown] = useState(false);

  const fetchResults = useCallback(async () => {
    if (!options.tripId) return;

    setLoading(true);
    setError(null);

    try {
      let response: OptimizeSoloResponse | OptimizeGroupResponse;

      if (options.tripType === 'solo') {
        response = await optimization.solo({
          tripId: options.tripId,
          points: options.points,
          budget: options.budget,
          cabinClasses: options.cabinClasses as any,
          hotelStars: options.hotelStars as any,
          includeHotels: options.includeHotels,
        });
      } else {
        response = await optimization.group({
          tripId: options.tripId,
          points: options.points,
          budget: options.budget,
          memberPoints: options.memberPoints || {},
          memberBudgets: options.memberBudgets || {},
          cabinClasses: options.cabinClasses as any,
          hotelStars: options.hotelStars as any,
          includeHotels: options.includeHotels,
        });
      }

      setResults(response);

      // Auto-select best (first) itinerary
      if (response.itineraries.length > 0) {
        setSelectedId(response.itineraries[0].id);
      }
    } catch (err) {
      console.error('OOP optimization error:', err);
      setError(err instanceof Error ? err.message : 'Failed to optimize');
    } finally {
      setLoading(false);
    }
  }, [options]);

  const fetchCostBreakdown = useCallback(async (itineraryId: string) => {
    setLoadingBreakdown(true);
    try {
      const breakdown = await optimization.getCostBreakdown(itineraryId);
      setCostBreakdown(breakdown);
    } catch (err) {
      console.error('Cost breakdown error:', err);
    } finally {
      setLoadingBreakdown(false);
    }
  }, []);

  // Auto-fetch on mount if enabled
  useEffect(() => {
    if (options.autoFetch !== false) {
      fetchResults();
    }
  }, [options.tripId, options.autoFetch]);

  // Find selected itinerary
  const selectedItinerary = results?.itineraries.find(i => i.id === selectedId) || null;

  // Compute best option
  const bestOption = results?.itineraries[0] 
    ? {
        outOfPocket: results.itineraries[0].oopMetrics.totalOutOfPocket,
        savingsPercentage: results.itineraries[0].oopMetrics.savingsPercentage,
        pointsUsed: results.itineraries[0].oopMetrics.totalPointsUsed,
      }
    : null;

  return {
    loading,
    error,
    results,
    selectedItinerary,
    setSelectedId,
    costBreakdown,
    loadingBreakdown,
    fetchCostBreakdown,
    refetch: fetchResults,
    bestOption,
  };
}
```

---

### Phase 5: Backend Endpoint Updates

#### 5.1 New Optimization Routes

**File: `backend/src/routes/optimize.py`**

```python
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import Optional, Literal
from ..agents.orchestrator import OrchestratorAgent
from ..agents.cost_breakdown_agent import CostBreakdownAgent

router = APIRouter(prefix="/optimize", tags=["optimization"])

orchestrator = OrchestratorAgent()
cost_agent = CostBreakdownAgent()


class OptimizeSoloRequest(BaseModel):
    trip_id: str
    points: dict[str, int]  # program -> balance
    budget: float
    cabin_classes: Optional[list[str]] = None
    hotel_stars: Optional[list[int]] = None
    include_hotels: Optional[bool] = True


class OptimizeGroupRequest(OptimizeSoloRequest):
    member_points: dict[str, dict[str, int]]  # member_id -> program -> balance
    member_budgets: dict[str, float]
    split_method: Optional[Literal["equal", "by_usage", "proportional"]] = "by_usage"


@router.post("/solo")
async def optimize_solo_trip(request: OptimizeSoloRequest):
    """
    Optimize a solo trip using the agentic architecture.
    
    Returns itineraries ranked by out-of-pocket (lowest first).
    Each itinerary includes:
    - OOP metrics (totalOutOfPocket, savings, CPP)
    - Per-segment payment decisions
    - Transfer instructions
    - AI-generated summary
    """
    try:
        results = await orchestrator.optimize_trip(
            trip_id=request.trip_id,
            trip_type="solo",
            points=request.points,
            budget=request.budget,
            cabin_classes=request.cabin_classes or ["Economy", "Business"],
            hotel_stars=request.hotel_stars or [4, 5],
            include_hotels=request.include_hotels,
        )
        
        # Results are already sorted by OOP from the ranking engine
        return {
            "tripId": request.trip_id,
            "itineraries": results,
            "bestOption": {
                "outOfPocket": results[0].oop_metrics.total_out_of_pocket if results else 0,
                "savingsPercentage": results[0].oop_metrics.savings_percentage if results else 0,
                "pointsUsed": results[0].oop_metrics.total_points_used if results else 0,
            },
            "warnings": [],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/group")
async def optimize_group_trip(request: OptimizeGroupRequest):
    """
    Optimize a group trip with cost splitting and settlements.
    """
    try:
        results = await orchestrator.optimize_trip(
            trip_id=request.trip_id,
            trip_type="group",
            points=request.points,
            budget=request.budget,
            member_points=request.member_points,
            member_budgets=request.member_budgets,
            split_method=request.split_method,
            cabin_classes=request.cabin_classes or ["Economy", "Business"],
            hotel_stars=request.hotel_stars or [4, 5],
            include_hotels=request.include_hotels,
        )
        
        return {
            "tripId": request.trip_id,
            "itineraries": results,
            "groupMetrics": results[0].group_metrics if results else None,
            "bestOption": {
                "totalOutOfPocket": results[0].oop_metrics.total_out_of_pocket if results else 0,
                "perPersonAverage": results[0].group_metrics.per_person_average if results else 0,
                "totalSavings": results[0].oop_metrics.cash_saved if results else 0,
            },
            "warnings": [],
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/breakdown/{itinerary_id}")
async def get_cost_breakdown(itinerary_id: str):
    """
    Get detailed, AI-generated cost breakdown for an itinerary.
    
    Uses the Cost Breakdown Agent to generate human-readable
    explanations of each transaction and transfer.
    """
    try:
        # Fetch itinerary from database
        itinerary = await get_itinerary_by_id(itinerary_id)
        
        if not itinerary:
            raise HTTPException(status_code=404, detail="Itinerary not found")
        
        # Generate breakdown using Cost Breakdown Agent
        breakdown = await cost_agent.generate_breakdown(itinerary)
        
        return breakdown
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/compare/{trip_id}")
async def compare_strategies(trip_id: str):
    """
    Compare OOP vs CPP optimization strategies for the same trip.
    """
    try:
        oop_results = await orchestrator.optimize_trip(
            trip_id=trip_id,
            optimization_mode="oop",
        )
        
        cpp_results = await orchestrator.optimize_trip(
            trip_id=trip_id,
            optimization_mode="cpp",
        )
        
        # Generate comparison explanation
        explanation = generate_comparison_explanation(
            oop_best=oop_results[0] if oop_results else None,
            cpp_best=cpp_results[0] if cpp_results else None,
        )
        
        return {
            "oop": oop_results[0] if oop_results else None,
            "cpp": cpp_results[0] if cpp_results else None,
            "recommendation": "oop",  # Always recommend OOP
            "explanation": explanation,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def generate_comparison_explanation(oop_best, cpp_best) -> str:
    """Generate AI explanation comparing the two strategies."""
    if not oop_best or not cpp_best:
        return "Unable to compare strategies."
    
    oop_cost = oop_best.oop_metrics.total_out_of_pocket
    cpp_cost = cpp_best.oop_metrics.total_out_of_pocket
    oop_cpp = oop_best.oop_metrics.average_cpp
    cpp_cpp = cpp_best.oop_metrics.average_cpp
    
    if oop_cost < cpp_cost:
        savings = cpp_cost - oop_cost
        return f"""The OOP (Out-of-Pocket) strategy saves you ${savings:.0f} more cash compared to 
CPP (Cents-Per-Point) optimization. While CPP achieves {cpp_cpp:.1f}¢/point vs OOP's {oop_cpp:.1f}¢/point, 
the OOP strategy uses points more aggressively to minimize what you actually pay. 
For most travelers, paying less cash now is more valuable than achieving marginally 
higher redemption values. We recommend OOP."""
    else:
        return f"""Both strategies result in similar out-of-pocket costs. The CPP strategy 
achieves {cpp_cpp:.1f}¢/point value, while OOP achieves {oop_cpp:.1f}¢/point. We still recommend 
OOP as it prioritizes minimizing your immediate cash expense."""
```

---

## Implementation Checklist

### Phase 1: API Schema & Types
- [ ] Create `frontend/src/types/optimization.ts` with all OOP types
- [ ] Update `frontend/src/lib/api.ts` with optimization endpoints
- [ ] Add TypeScript interfaces for all response types

### Phase 2: UI Components
- [ ] Create `OOPSummaryCard` component
- [ ] Create `SegmentBreakdown` component
- [ ] Create `TransferCard` component
- [ ] Create `GroupSettlement` component
- [ ] Add Tailwind styles for OOP-focused design

### Phase 3: Pages
- [ ] Update `/solo/results/page.tsx` to use OOP ranking
- [ ] Update `/group/results/page.tsx` to use OOP ranking
- [ ] Add cost breakdown expansion to itinerary cards
- [ ] Add transfer instructions display

### Phase 4: Hooks
- [ ] Create `useOOPOptimization` hook
- [ ] Update existing hooks to support new response format
- [ ] Add lazy loading for cost breakdowns

### Phase 5: Backend
- [ ] Create `/optimize/solo` endpoint
- [ ] Create `/optimize/group` endpoint
- [ ] Create `/optimize/breakdown/{id}` endpoint
- [ ] Create `/optimize/compare/{id}` endpoint
- [ ] Integrate with Orchestrator Agent

### Phase 6: Testing
- [ ] Unit tests for new components
- [ ] Integration tests for API endpoints
- [ ] E2E tests for full optimization flow
- [ ] Visual regression tests for OOP displays

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Results ranked by OOP | 100% of results sorted by `totalOutOfPocket` ascending |
| OOP visibility | `totalOutOfPocket` displayed 3x larger than other metrics |
| User understanding | >90% can identify cheapest cash option within 3 seconds |
| Savings clarity | Savings percentage shown on every itinerary card |
| Transfer completion | >80% of users complete transfers when instructed |
| Cost breakdown views | >50% of users expand at least one segment |

---

## Appendix: Color Palette for OOP UI

| Element | Color | Usage |
|---------|-------|-------|
| OOP Amount | `emerald-600` | Primary "You Pay" display |
| Savings | `emerald-500` | Savings badges and highlights |
| Points | `blue-600` | Points amounts and programs |
| Cash (struck) | `slate-400` | Original cash price (line-through) |
| Transfer | `amber-500` | Transfer required warnings |
| Best Option | `gradient emerald-500 → teal-600` | #1 ranked itinerary |
