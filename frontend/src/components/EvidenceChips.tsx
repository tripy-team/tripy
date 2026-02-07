'use client';

import { Shield, Plane, ArrowRight, Clock } from 'lucide-react';
import type { SoloRankedItinerary, SoloOptimizeResponse } from '@/lib/api';

interface EvidenceChipsProps {
  itinerary: SoloRankedItinerary;
  response: SoloOptimizeResponse;
}

interface Chip {
  icon: React.ReactNode;
  label: string;
  variant: 'green' | 'blue' | 'amber' | 'slate';
}

const VARIANT_STYLES = {
  green: 'bg-green-50 text-green-800 border-green-200',
  blue: 'bg-blue-50 text-blue-800 border-blue-200',
  amber: 'bg-amber-50 text-amber-800 border-amber-200',
  slate: 'bg-slate-50 text-slate-700 border-slate-200',
} as const;

export default function EvidenceChips({ itinerary, response }: EvidenceChipsProps) {
  const chips: Chip[] = [];

  // Ticketing evidence
  const flightSegs = itinerary.segments?.filter((s) => s.type === 'flight') || [];
  const allSingleTicket = flightSegs.every((s) => s.ticketingConfirmed);
  const anyMultiTicket = flightSegs.some((s) => s.stops > 0 && !s.ticketingConfirmed);

  if (allSingleTicket && flightSegs.length > 0) {
    chips.push({
      icon: <Shield className="w-3 h-3" />,
      label: 'Single ticket (protected)',
      variant: 'green',
    });
  } else if (anyMultiTicket) {
    chips.push({
      icon: <Shield className="w-3 h-3" />,
      label: 'Separate tickets',
      variant: 'amber',
    });
  }

  // Stops count
  const totalStops = flightSegs.reduce((sum, s) => sum + (s.stops || 0), 0);
  if (totalStops === 0) {
    chips.push({
      icon: <Plane className="w-3 h-3" />,
      label: 'Nonstop',
      variant: 'green',
    });
  } else {
    chips.push({
      icon: <Plane className="w-3 h-3" />,
      label: `${totalStops} stop${totalStops > 1 ? 's' : ''}`,
      variant: totalStops > 1 ? 'amber' : 'slate',
    });
  }

  // Transfer evidence
  if (itinerary.transfers && itinerary.transfers.length > 0) {
    const transferLabels = itinerary.transfers
      .map((t) => `${t.sourceProgram} → ${t.targetProgram}`)
      .slice(0, 2);
    chips.push({
      icon: <ArrowRight className="w-3 h-3" />,
      label: `Transfer${itinerary.transfers.length > 1 ? 's' : ''}: ${transferLabels.join(', ')}`,
      variant: 'blue',
    });
  }

  // Freshness
  if (response.computedAt) {
    const computedDate = new Date(response.computedAt);
    const now = new Date();
    const diffMinutes = Math.floor((now.getTime() - computedDate.getTime()) / (1000 * 60));

    if (diffMinutes < 1) {
      chips.push({ icon: <Clock className="w-3 h-3" />, label: 'Just checked', variant: 'green' });
    } else if (diffMinutes < 60) {
      chips.push({ icon: <Clock className="w-3 h-3" />, label: `Checked ${diffMinutes} min ago`, variant: 'slate' });
    } else {
      const diffHours = Math.floor(diffMinutes / 60);
      chips.push({ icon: <Clock className="w-3 h-3" />, label: `Checked ${diffHours}h ago`, variant: 'amber' });
    }
  }

  if (chips.length === 0) return null;

  // Limit to 4 chips
  const visibleChips = chips.slice(0, 4);

  return (
    <div className="flex flex-wrap gap-2">
      {visibleChips.map((chip, i) => (
        <span
          key={i}
          className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium border ${VARIANT_STYLES[chip.variant]}`}
        >
          {chip.icon}
          {chip.label}
        </span>
      ))}
    </div>
  );
}
