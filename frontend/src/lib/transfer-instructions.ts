/**
 * Build tailored transfer instructions and strategies from itinerary data.
 * Uses totals.transfers, itinerary_smart_tips, and ai_route_suggestions.
 */

import type { LucideIcon } from 'lucide-react';
import { Plane } from 'lucide-react';

// Bank source (backend) -> display name
export const SOURCE_TO_DISPLAY: Record<string, string> = {
  amex: 'Amex Membership Rewards',
  chase: 'Chase Ultimate Rewards',
  citi: 'Citi ThankYou Points',
  capitalone: 'Capital One Miles',
  bilt: 'Bilt Rewards',
};

// Airline code (backend) -> partner display name
export const AIRLINE_TO_DISPLAY: Record<string, string> = {
  UA: 'United MileagePlus',
  AA: 'American Airlines AAdvantage',
  DL: 'Delta SkyMiles',
  AS: 'Alaska Mileage Plan',
  B6: 'JetBlue TrueBlue',
  AC: 'Aeroplan',
  BA: 'British Airways Avios',
  AF: 'Air France / KLM Flying Blue',
  KL: 'Air France / KLM Flying Blue',
  LH: 'Lufthansa Miles & More',
  LX: 'Swiss Miles & More',
  SQ: 'Singapore Airlines KrisFlyer',
  CX: 'Cathay Pacific Asia Miles',
  NH: 'ANA Mileage Club',
  JL: 'Japan Airlines Mileage Bank',
  EK: 'Emirates Skywards',
  QR: 'Qatar Privilege Club',
  EY: 'Etihad Guest',
  TK: 'Turkish Airlines Miles&Smiles',
  AV: 'Avianca LifeMiles',
  IB: 'Iberia Avios',
  QF: 'Qantas Frequent Flyer',
  VS: 'Virgin Atlantic Flying Club',
  KE: 'Korean Air',
  OZ: 'Asiana',
  CI: 'China Airlines',
  BR: 'EVA Air',
};


export interface TransferTip {
  from_program?: string;
  to_program?: string;
  best_for?: string;
  route_segment?: string; // Explicit route segment (e.g., "JFK→HND")
  departure?: string; // Origin airport code
  arrival?: string; // Destination airport code
  note?: string;
  /** Points to transfer (from AwardTool); used when building step-by-step. */
  points?: number;
  /** Taxes/fees in dollars (from AwardTool). */
  surcharge?: number;
  /** Cents per point value for this redemption. */
  cents_per_point?: number;
  /** Total cash value saved by using points. */
  points_value?: number;
  /** e.g. "Korean Air (codeshare)" from AwardTool operating carrier. */
  segment_description?: string;
  /** Booking airline code (e.g., "DL" for Delta). */
  booking_airline?: string;
  /** Booking airline display name (e.g., "Delta SkyMiles"). */
  booking_airline_name?: string;
  /** Operating carrier code (e.g., "KE" for Korean Air on codeshare). */
  operating_carrier?: string;
  /** Operating carrier display name (e.g., "Korean Air"). */
  operating_carrier_name?: string;
  /** True if this is a codeshare flight. */
  is_codeshare?: boolean;
  /** True if transfer is needed (false if using existing miles). */
  transfer_needed?: boolean;
  /** Transfer portal URL (e.g., Chase UR portal). */
  transfer_portal_url?: string;
  /** Transfer timing (e.g., "instant", "1-2 business days"). */
  transfer_time?: string;
  /** Transfer ratio (e.g., "1:1"). */
  transfer_ratio?: string;
  /** Minimum transfer amount (e.g., "1,000 points"). */
  min_transfer?: string;
  /** Airline booking URL. */
  booking_url?: string;
  /** Step-by-step transfer instructions. */
  transfer_steps?: string[];
  /** Strategy reasoning: why this transfer strategy was chosen (from backend). */
  strategy_reason?: string;
  /** Total points used across all transfers. */
  total_points_used?: number;
  /** Total cash saved by using points. */
  total_cash_saved?: number;
  /** Average cents per point across all redemptions. */
  average_cpp?: number;
}

// Bank portal URLs for easy access
export const BANK_PORTAL_URLS: Record<string, string> = {
  amex: 'https://global.americanexpress.com/rewards',
  chase: 'https://ultimaterewardspoints.chase.com',
  citi: 'https://thankyou.citi.com',
  capitalone: 'https://www.capitalone.com/credit-cards/benefits/travel/',
  bilt: 'https://www.biltrewards.com',
};

// Transfer time estimates by bank
export const BANK_TRANSFER_TIMES: Record<string, string> = {
  amex: '1-2 business days',
  chase: 'Instant',
  citi: 'Instant to 24 hours',
  capitalone: 'Instant to 2 days',
  bilt: 'Instant',
};

export interface PracticalTip {
  category?: string;
  tip?: string;
}

export interface TransferStepResult {
  id: string;
  member: string;
  initials: string;
  program: string;
  partner: string;
  amount: number;
  amountStr: string;
  category: string; // "Flights"
  icon: LucideIcon;
  steps: string[];
  warning?: string;
  status: 'pending' | 'completed';
  // Route segment details for flights (from totals.transfers - direct from backend)
  flightSegment?: string; // e.g., "SFO→HKG" or "SFO→HKG + HKG→NRT"
  departures?: string[]; // e.g., ["SFO", "HKG"]
  arrivals?: string[]; // e.g., ["HKG", "NRT"]
  routeSegments?: string[]; // e.g., ["SFO→HKG", "HKG→NRT"]
  // Additional transfer details
  surcharge?: number; // Taxes/fees in dollars
  isCodeshare?: boolean;
  operatingCarrier?: string;
  segmentDescription?: string;
  // Enhanced transfer details
  transferPortalUrl?: string;
  transferTime?: string;
  transferRatio?: string;
  bookingUrl?: string;
  centsPerPoint?: number;
  pointsValue?: number;
}

// Comprehensive transfer action for display
export interface TransferAction {
  id: string;
  order: number;
  type: 'transfer' | 'booking';
  // Transfer details
  fromProgram?: string;
  fromProgramName?: string;
  toProgram?: string;
  toProgramName?: string;
  pointsToTransfer?: number;
  resultingPoints?: number;
  transferRatio?: string;
  transferTime?: string;
  portalUrl?: string;
  // Booking details
  bookingUrl?: string;
  flightSegment?: string;
  surcharge?: number;
  // Flight details
  isCodeshare?: boolean;
  operatingCarrier?: string;
  operatingCarrierName?: string;
  bookingAirline?: string;
  bookingAirlineName?: string;
  // Value metrics
  centsPerPoint?: number;
  cashSaved?: number;
  // Step-by-step instructions
  steps?: string[];
}

export interface ExtractedTips {
  transfer_tips: TransferTip[];
  practical_tips: PracticalTip[];
}

export interface TransferStrategyOverview {
  totalPointsByProgram: Map<string, number>; // e.g., "Chase Ultimate Rewards" -> 60000
  transfersByProgram: Map<string, Array<{ partner: string; points: number; bestFor?: string }>>; // From -> To mapping
  memberStrategies: Array<{ memberName: string; totalPoints: number; transfers: Array<{ from: string; to: string; points: number }> }>;
  strategySummary: string; // Human-readable summary
  strategyReason?: string; // Why this strategy was chosen (from backend)
}

/** Get display name for a bank source (backend key). */
export function programDisplay(source: string): string {
  const s = (source || '').toLowerCase();
  return SOURCE_TO_DISPLAY[s] || source || 'Credit card points';
}

/** Get display name for an airline/partner (backend code). */
export function partnerDisplay(airline: string): string {
  const a = (airline || '').toUpperCase();
  return AIRLINE_TO_DISPLAY[a] || a || 'Travel partner';
}

/** Build instructional steps for a bank -> airline transfer. */
function buildSteps(
  program: string,
  partner: string,
  amount: number,
  note?: string,
  transferTiming?: string,
  segmentDescription?: string,
  transferTip?: TransferTip
): string[] {
  // If backend provided detailed transfer_steps, use those
  if (transferTip?.transfer_steps && transferTip.transfer_steps.length > 0) {
    return transferTip.transfer_steps;
  }

  // Otherwise, build generic steps
  const amountStr = amount.toLocaleString();
  const step1 = segmentDescription
    ? `Transfer ${amountStr} points from ${program} to ${partner} to book ${segmentDescription}.`
    : `Transfer ${amountStr} points from ${program} to ${partner}.`;
  const steps: string[] = [
    step1,
    `Log in to your ${program} account online or via their mobile app.`,
    'Find and navigate to "Transfer to Travel Partners" or "Transfer Points" section.',
    `Select "${partner}" from the list of airline partners.`,
    `Enter your ${partner} frequent flyer membership number. If you don't have one, create a free account on the ${partner} website first.`,
    `Enter ${amountStr} in the transfer amount field. Confirm the transfer (typically 1:1 ratio, instant transfer).${note ? ` ${note}` : ''}`,
  ];
  if (transferTiming) {
    steps.push(`⏱️ Transfer timing: ${transferTiming}`);
  } else {
    const lastStep = segmentDescription
      ? `Once the points appear in your ${partner} account (usually instant), log in to ${partner}'s website, search for your ${segmentDescription} flight, and complete the award booking.`
      : `Once the points appear in your ${partner} account, visit their website to search for and book your award flight.`;
    steps.push(lastStep);
  }
  return steps;
}

/** Extract transfer_tips and practical_tips from itinerary items. */
export function getTransferTipsFromItems(items: Array<{ type?: string; [k: string]: unknown }>): ExtractedTips {
  const out: ExtractedTips = { transfer_tips: [], practical_tips: [] };
  for (const it of items || []) {
    if (it.type === 'itinerary_smart_tips') {
      const tt = it.transfer_tips;
      const pt = it.practical_tips;
      if (Array.isArray(tt)) out.transfer_tips = tt.filter((x) => x && typeof x === 'object');
      if (Array.isArray(pt)) out.practical_tips = pt.filter((x) => x && typeof x === 'object');
      return out;
    }
    if (it.type === 'ai_route_suggestions') {
      const tt = it.transfer_tips;
      if (Array.isArray(tt)) out.transfer_tips = tt.filter((x) => x && typeof x === 'object');
      return out;
    }
  }
  return out;
}

/** Find a matching transfer_tip note for from_program -> to_program (fuzzy). */
function findNote(transferTips: TransferTip[], program: string, partner: string): string | undefined {
  const p = (program || '').toLowerCase();
  const r = (partner || '').toLowerCase();
  for (const t of transferTips) {
    const from = ((t.from_program || '') + '').toLowerCase();
    const to = ((t.to_program || '') + '').toLowerCase();
    const fromMatch = !from || p.includes(from) || from.includes(p);
    const toMatch = !to || r.includes(to) || to.includes(r);
    if (fromMatch && toMatch && t.note) return t.note;
  }
  return undefined;
}

/** Find segment_description from a matching transfer_tip (e.g. "Korean Air (codeshare)"). */
function findSegmentDescription(transferTips: TransferTip[], program: string, partner: string): string | undefined {
  const p = (program || '').toLowerCase();
  const r = (partner || '').toLowerCase();
  for (const t of transferTips) {
    const from = ((t.from_program || '') + '').toLowerCase();
    const to = ((t.to_program || '') + '').toLowerCase();
    const fromMatch = !from || p.includes(from) || from.includes(p);
    const toMatch = !to || r.includes(to) || to.includes(r);
    if (fromMatch && toMatch && t.segment_description) return t.segment_description;
  }
  return undefined;
}

/** Get transfer_timing tip from practical_tips. */
function getTransferTimingTip(practicalTips: PracticalTip[]): string | undefined {
  const t = practicalTips.find((p) => (p.category || '').toLowerCase() === 'transfer_timing');
  return t?.tip;
}

/**
 * Build transfer steps from itinerary items (totals.transfers) and optional tips.
 * members: { userId, name? }[] from trips.listMembers.
 */
export function buildTransferStepsFromItinerary(
  items: Array<{ type?: string; totals?: { transfers?: Record<string, Record<string, Record<string, { source_points?: number; segment_description?: string }>>> }; [k: string]: unknown }>,
  members: Array<{ userId: string; name?: string }>
): TransferStepResult[] {
  const result: TransferStepResult[] = [];
  const { transfer_tips, practical_tips } = getTransferTipsFromItems(items);
  const timingTip = getTransferTimingTip(practical_tips);

  const totalsItem = items.find((i) => i.type === 'totals');
  const transfers = totalsItem?.totals?.transfers;
  if (!transfers || typeof transfers !== 'object') return result;

  const getName = (userId: string): string => {
    const m = members.find((x) => x.userId === userId);
    return (m?.name || `Traveler`).trim() || `User ${(userId || '').slice(0, 8)}`;
  };

  const getInitials = (name: string): string => {
    const parts = name.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    return (name.slice(0, 2) || '??').toUpperCase();
  };

  let idx = 0;
  for (const [userId, bySource] of Object.entries(transfers)) {
    if (!bySource || typeof bySource !== 'object') continue;
    const memberName = getName(userId);
    const initials = getInitials(memberName);

    for (const [source, byPartner] of Object.entries(bySource)) {
      if (!(byPartner && typeof byPartner === 'object')) continue;
      for (const [partnerCode, data] of Object.entries(byPartner)) {
        const sp = typeof data?.source_points === 'number' ? data.source_points : 0;
        if (sp <= 0) continue;

        const program = programDisplay(source);
        
        // Type the data object with all fields from backend
        const transferData = data as {
          segment_description?: string;
          route_segments?: string[];
          route_display?: string;
          departures?: string[];
          arrivals?: string[];
          operating_carriers?: string[];
        };
        
        // Get partner display name for airline
        const partner = partnerDisplay(partnerCode);
        
        const note = findNote(transfer_tips, program, partner);
        
        const segmentDescription = transferData.segment_description
          ?? findSegmentDescription(transfer_tips, program, partner);

        // Find matching transfer tip for additional details (fallback for legacy data)
        const matchingTip = transfer_tips.find(t => 
          (t.to_program?.toLowerCase().includes(partner.toLowerCase()) ||
           partner.toLowerCase().includes(t.to_program?.toLowerCase() || '')) &&
          (t.from_program?.toLowerCase().includes(program.toLowerCase()) ||
           program.toLowerCase().includes(t.from_program?.toLowerCase() || ''))
        );

        // Use detailed steps from backend if available, otherwise build generic steps
        const steps = buildSteps(program, partner, sp, note, timingTip, segmentDescription, matchingTip);
        
        // Build enhanced warning with transfer details
        const warningParts: string[] = [];
        if (matchingTip?.transfer_time) {
          warningParts.push(`Transfer time: ${matchingTip.transfer_time}`);
        }
        if (matchingTip?.cents_per_point) {
          warningParts.push(`Value: ${matchingTip.cents_per_point.toFixed(2)} cpp`);
        }
        if (matchingTip?.is_codeshare && matchingTip?.operating_carrier_name) {
          warningParts.push(`Flying on ${matchingTip.operating_carrier_name} metal`);
        }
        if (timingTip) {
          warningParts.push(timingTip);
        }
        if (note && !matchingTip?.transfer_steps) {
          warningParts.push(note);
        }
        const defaultWarning = 'Double check availability on the airline website before transferring.';
        const warning = warningParts.join('. ').trim() || defaultWarning;

        // Get bank code for portal URL lookup
        const bankCode = source.toLowerCase();
        const portalUrl = matchingTip?.transfer_portal_url || BANK_PORTAL_URLS[bankCode] || '';
        const transferTime = matchingTip?.transfer_time || BANK_TRANSFER_TIMES[bankCode] || '';

        // Extract route segment info
        const routeDisplay = transferData.route_display;
        const routeSegments = transferData.route_segments;
        const departures = transferData.departures;
        const arrivals = transferData.arrivals;
        
        // Build flight segment string: prefer direct data, fall back to tip matching
        let flightSegment: string | undefined = routeDisplay 
          || (routeSegments?.length ? routeSegments.join(' + ') : undefined)
          || matchingTip?.route_segment 
          || matchingTip?.best_for;
        
        // If we have departures and arrivals but no display, build it
        if (!flightSegment && departures?.length && arrivals?.length) {
          flightSegment = `${departures.join('/')}→${arrivals.join('/')}`;
        }

        result.push({
          id: `t-${idx}`,
          member: memberName,
          initials,
          program,
          partner,
          amount: sp,
          amountStr: sp.toLocaleString(),
          category: 'Flights',
          icon: Plane,
          steps,
          warning,
          status: 'pending',
          // Route segment info - prefer direct backend data over tip matching
          flightSegment,
          departures,
          arrivals,
          routeSegments,
          // Additional details from transfer tips
          surcharge: matchingTip?.surcharge,
          isCodeshare: matchingTip?.is_codeshare,
          operatingCarrier: matchingTip?.operating_carrier_name,
          segmentDescription: segmentDescription || matchingTip?.segment_description,
          // Enhanced transfer details
          transferPortalUrl: portalUrl,
          transferTime: transferTime,
          transferRatio: matchingTip?.transfer_ratio || '1:1',
          bookingUrl: matchingTip?.booking_url,
          centsPerPoint: matchingTip?.cents_per_point,
          pointsValue: matchingTip?.points_value,
        });
        idx += 1;
      }
    }
  }

  return result;
}

/**
 * Build a high-level transfer strategy overview from itinerary data.
 * This summarizes: which credit cards are used, total points from each, where they're transferred to.
 */
/**
 * Build a list of transfer actions from transfer tips for a more detailed display.
 * Each action represents either a transfer step or a booking step.
 */
export function buildTransferActionsFromTips(
  transferTips: TransferTip[]
): TransferAction[] {
  const actions: TransferAction[] = [];
  let order = 1;

  // Group by from_program to consolidate transfers from the same bank
  const transfersByBank = new Map<string, TransferTip[]>();
  const nativeBookings: TransferTip[] = [];

  for (const tip of transferTips) {
    if (tip.transfer_needed === false) {
      nativeBookings.push(tip);
    } else {
      const bank = (tip.from_program || 'unknown').toLowerCase();
      if (!transfersByBank.has(bank)) {
        transfersByBank.set(bank, []);
      }
      transfersByBank.get(bank)!.push(tip);
    }
  }

  // Create transfer actions
  for (const [, tips] of transfersByBank) {
    for (const tip of tips) {
      // Get bank code for portal URL
      const bankKey = Object.keys(SOURCE_TO_DISPLAY).find(
        k => SOURCE_TO_DISPLAY[k].toLowerCase().includes((tip.from_program || '').toLowerCase().split(' ')[0])
      ) || '';

      actions.push({
        id: `transfer-${order}`,
        order: order++,
        type: 'transfer',
        fromProgram: bankKey,
        fromProgramName: tip.from_program,
        toProgram: tip.booking_airline,
        toProgramName: tip.to_program,
        pointsToTransfer: tip.points,
        resultingPoints: tip.points, // Assume 1:1 unless specified
        transferRatio: tip.transfer_ratio || '1:1',
        transferTime: tip.transfer_time || BANK_TRANSFER_TIMES[bankKey] || 'varies',
        portalUrl: tip.transfer_portal_url || BANK_PORTAL_URLS[bankKey],
        bookingUrl: tip.booking_url,
        flightSegment: tip.route_segment || tip.best_for,
        surcharge: tip.surcharge,
        isCodeshare: tip.is_codeshare,
        operatingCarrier: tip.operating_carrier,
        operatingCarrierName: tip.operating_carrier_name,
        bookingAirline: tip.booking_airline,
        bookingAirlineName: tip.booking_airline_name,
        centsPerPoint: tip.cents_per_point,
        cashSaved: tip.points_value,
        steps: tip.transfer_steps,
      });
    }
  }

  // Add native booking actions (no transfer needed)
  for (const tip of nativeBookings) {
    actions.push({
      id: `booking-${order}`,
      order: order++,
      type: 'booking',
      toProgramName: tip.to_program,
      bookingUrl: tip.booking_url,
      flightSegment: tip.route_segment || tip.best_for,
      surcharge: tip.surcharge,
      pointsToTransfer: tip.points,
      isCodeshare: tip.is_codeshare,
      operatingCarrier: tip.operating_carrier,
      operatingCarrierName: tip.operating_carrier_name,
      centsPerPoint: tip.cents_per_point,
      cashSaved: tip.points_value,
      steps: tip.transfer_steps,
    });
  }

  return actions;
}

/**
 * Calculate total savings and value metrics from transfer tips.
 */
export function calculateTransferMetrics(transferTips: TransferTip[]): {
  totalPoints: number;
  totalSurcharges: number;
  totalCashSaved: number;
  averageCpp: number;
  transferCount: number;
} {
  let totalPoints = 0;
  let totalSurcharges = 0;
  let totalCashSaved = 0;
  let transferCount = 0;

  for (const tip of transferTips) {
    if (tip.points) {
      totalPoints += tip.points;
      transferCount++;
    }
    if (tip.surcharge) {
      totalSurcharges += tip.surcharge;
    }
    if (tip.points_value) {
      totalCashSaved += tip.points_value;
    }
  }

  const averageCpp = totalPoints > 0 ? (totalCashSaved * 100) / totalPoints : 0;

  return {
    totalPoints,
    totalSurcharges,
    totalCashSaved,
    averageCpp,
    transferCount,
  };
}

export function buildTransferStrategyOverview(
  items: Array<{ type?: string; totals?: { transfers?: Record<string, Record<string, Record<string, { source_points?: number }>>> }; [k: string]: unknown }>,
  members: Array<{ userId: string; name?: string }>
): TransferStrategyOverview | null {
  const totalsItem = items.find((i) => i.type === 'totals');
  const transfers = totalsItem?.totals?.transfers;
  if (!transfers || typeof transfers !== 'object') return null;

  const totalPointsByProgram = new Map<string, number>();
  const transfersByProgram = new Map<string, Array<{ partner: string; points: number; bestFor?: string }>>();
  const memberStrategies: Array<{ memberName: string; totalPoints: number; transfers: Array<{ from: string; to: string; points: number }> }> = [];
  
  // Extract strategy reason from transfer_tips (if provided by backend)
  const { transfer_tips } = getTransferTipsFromItems(items);
  const strategyReason = transfer_tips.find(t => t.strategy_reason)?.strategy_reason;

  const getName = (userId: string): string => {
    const m = members.find((x) => x.userId === userId);
    return (m?.name || `Traveler`).trim() || `User ${(userId || '').slice(0, 8)}`;
  };

  // First pass: aggregate totals by program and by member
  for (const [userId, bySource] of Object.entries(transfers)) {
    if (!bySource || typeof bySource !== 'object') continue;
    const memberName = getName(userId);
    let memberTotal = 0;
    const memberTransfers: Array<{ from: string; to: string; points: number }> = [];

    for (const [source, byAirline] of Object.entries(bySource)) {
      if (!(byAirline && typeof byAirline === 'object')) continue;
      const program = programDisplay(source);
      
      for (const [airline, data] of Object.entries(byAirline)) {
        const sp = typeof data?.source_points === 'number' ? data.source_points : 0;
        if (sp <= 0) continue;

        const partner = partnerDisplay(airline);
        
        // Aggregate by program
        totalPointsByProgram.set(program, (totalPointsByProgram.get(program) || 0) + sp);
        
        // Track transfers from this program
        if (!transfersByProgram.has(program)) {
          transfersByProgram.set(program, []);
        }
        transfersByProgram.get(program)!.push({ partner, points: sp });
        
        // Track member-specific transfers
        memberTotal += sp;
        memberTransfers.push({ from: program, to: partner, points: sp });
      }
    }

    if (memberTotal > 0) {
      memberStrategies.push({ memberName, totalPoints: memberTotal, transfers: memberTransfers });
    }
  }

  // Build human-readable summary
  const programSummaries: string[] = [];
  for (const [program, total] of totalPointsByProgram) {
    const destinations = transfersByProgram.get(program) || [];
    const uniquePartners = [...new Set(destinations.map(d => d.partner))];
    
    if (uniquePartners.length === 1) {
      programSummaries.push(`${total.toLocaleString()} points from ${program} to ${uniquePartners[0]}`);
    } else if (uniquePartners.length > 1) {
      programSummaries.push(`${total.toLocaleString()} points from ${program} to ${uniquePartners.length} partners`);
    }
  }

  const strategySummary = programSummaries.length > 0
    ? `You'll transfer a total of ${programSummaries.join(', ')}.`
    : 'No transfers required for this itinerary.';

  return {
    totalPointsByProgram,
    transfersByProgram,
    memberStrategies,
    strategySummary,
    strategyReason,
  };
}
