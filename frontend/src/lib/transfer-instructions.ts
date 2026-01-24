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
};

export interface TransferTip {
  from_program?: string;
  to_program?: string;
  best_for?: string;
  note?: string;
  /** Points to transfer (from AwardTool); used when building step-by-step. */
  points?: number;
  /** Taxes/fees in dollars (from AwardTool). */
  surcharge?: number;
}

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
  category: string;
  icon: LucideIcon;
  steps: string[];
  warning?: string;
  status: 'pending' | 'completed';
}

export interface ExtractedTips {
  transfer_tips: TransferTip[];
  practical_tips: PracticalTip[];
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
  transferTiming?: string
): string[] {
  const amountStr = amount.toLocaleString();
  const steps: string[] = [
    `From ${program}, transfer ${amountStr} points to ${partner}.`,
    `Log in to your ${program} account.`,
    'Navigate to "Transfer to Travel Partners".',
    `Select "${partner}" from the airline list.`,
    `Enter your ${partner} membership number (create an account on the partner site if needed).`,
    `In the transfer amount field, enter ${amountStr} points and complete the transfer to ${partner} (1:1 ratio). Transfers are usually instant.${note ? ` ${note}` : ''}`,
  ];
  if (transferTiming) {
    steps.push(`Note: ${transferTiming}`);
  } else {
    steps.push(`Once points appear in ${partner}, book your flight on their website.`);
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
  items: Array<{ type?: string; totals?: { transfers?: Record<string, Record<string, Record<string, { source_points?: number }>>> }; [k: string]: unknown }>,
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

    for (const [source, byAirline] of Object.entries(bySource)) {
      if (!(byAirline && typeof byAirline === 'object')) continue;
      for (const [airline, data] of Object.entries(byAirline)) {
        const sp = typeof data?.source_points === 'number' ? data.source_points : 0;
        if (sp <= 0) continue;

        const program = programDisplay(source);
        const partner = partnerDisplay(airline);
        const note = findNote(transfer_tips, program, partner);
        const steps = buildSteps(program, partner, sp, note, timingTip);
        const warning = [timingTip, note].filter(Boolean).join(' ').trim()
          || 'Double check availability on the airline website before transferring.';

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
        });
        idx += 1;
      }
    }
  }

  return result;
}
