'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Users,
  DollarSign,
  CreditCard,
  ArrowRight,
  ChevronDown,
  ChevronUp,
  PlusCircle,
  Plane,
  Building2,
  Receipt,
  Scale,
  TrendingUp,
  TrendingDown,
  Check,
  MapPin,
  Calendar,
  RefreshCw,
  X,
  AlertCircle,
  Loader2,
} from 'lucide-react';
import {
  groupPlanning,
  type GroupTripDetail,
  type SettlementSummary,
  type TravelerProfileResponse,
  type HotelRecommendation,
  type LoyaltyBalanceResponse,
} from '@/lib/api';
import HotelRecommendationCard from '@/components/HotelRecommendationCard';

function formatCurrency(value: number): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

type SettlementStatus = 'credit' | 'owes' | 'settled';

function getSettlementStatus(s: SettlementSummary): SettlementStatus {
  if (s.netCreditUsd > 0.01) return 'credit';
  if (s.netOwedUsd > 0.01) return 'owes';
  return 'settled';
}

const statusConfig: Record<SettlementStatus, { label: string; color: string; bg: string; border: string; icon: typeof TrendingUp }> = {
  credit: { label: 'Owed to you', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200', icon: TrendingUp },
  owes: { label: 'You owe', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200', icon: TrendingDown },
  settled: { label: 'Settled', color: 'text-slate-600', bg: 'bg-slate-50', border: 'border-slate-200', icon: Check },
};

interface SettlementTransfer {
  from: string;
  to: string;
  amount: number;
}

function computeTransfers(settlements: SettlementSummary[]): SettlementTransfer[] {
  const debtors = settlements
    .filter(s => s.netOwedUsd > 0.01)
    .map(s => ({ name: s.travelerName, amount: s.netOwedUsd }))
    .sort((a, b) => b.amount - a.amount);

  const creditors = settlements
    .filter(s => s.netCreditUsd > 0.01)
    .map(s => ({ name: s.travelerName, amount: s.netCreditUsd }))
    .sort((a, b) => b.amount - a.amount);

  const transfers: SettlementTransfer[] = [];
  let di = 0;
  let ci = 0;

  while (di < debtors.length && ci < creditors.length) {
    const payment = Math.min(debtors[di].amount, creditors[ci].amount);
    if (payment > 0.01) {
      transfers.push({
        from: debtors[di].name,
        to: creditors[ci].name,
        amount: Math.round(payment * 100) / 100,
      });
    }
    debtors[di].amount -= payment;
    creditors[ci].amount -= payment;
    if (debtors[di].amount < 0.01) di++;
    if (creditors[ci].amount < 0.01) ci++;
  }

  return transfers;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function LoadingState() {
  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center gap-4">
      <div className="relative">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center shadow-lg shadow-blue-500/25">
          <Scale className="w-7 h-7 text-white animate-pulse" />
        </div>
      </div>
      <div className="text-center">
        <p className="text-lg font-semibold text-slate-900">Loading settlement...</p>
        <p className="text-sm text-slate-500 mt-1">Crunching the numbers for your group trip</p>
      </div>
    </div>
  );
}

function EmptyState({ onOptimize, optimizing }: { onOptimize: () => void; optimizing: boolean }) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="w-20 h-20 rounded-3xl bg-gradient-to-br from-slate-100 to-slate-200 flex items-center justify-center">
        <Receipt className="w-9 h-9 text-slate-400" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">No settlement yet</h2>
        <p className="text-slate-500 max-w-md">
          Run the optimizer to assign flights and hotels, then see a fair cost split across your group.
        </p>
      </div>
      <button
        onClick={onOptimize}
        disabled={optimizing}
        className="inline-flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20 disabled:opacity-60"
      >
        {optimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Scale className="w-4 h-4" />}
        {optimizing ? 'Optimizing...' : 'Run Optimizer'}
      </button>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="min-h-[50vh] flex flex-col items-center justify-center gap-6 text-center px-4">
      <div className="w-20 h-20 rounded-3xl bg-red-50 flex items-center justify-center">
        <AlertCircle className="w-9 h-9 text-red-400" />
      </div>
      <div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Something went wrong</h2>
        <p className="text-slate-500 max-w-md">{message}</p>
      </div>
      <button
        onClick={onRetry}
        className="inline-flex items-center gap-2 px-6 py-3 bg-slate-900 text-white rounded-xl font-medium hover:bg-slate-800 transition-colors"
      >
        <RefreshCw className="w-4 h-4" />
        Try Again
      </button>
    </div>
  );
}

function TripHeader({ trip }: { trip: GroupTripDetail['trip'] }) {
  const statusLabels: Record<string, string> = {
    draft: 'Draft',
    collecting_info: 'Collecting Info',
    optimizing: 'Optimizing',
    optimized: 'Optimized',
    settled: 'Settled',
  };

  const statusColors: Record<string, string> = {
    draft: 'bg-slate-100 text-slate-700',
    collecting_info: 'bg-amber-50 text-amber-700',
    optimizing: 'bg-blue-50 text-blue-700',
    optimized: 'bg-emerald-50 text-emerald-700',
    settled: 'bg-indigo-50 text-indigo-700',
  };

  return (
    <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 rounded-2xl p-6 sm:p-8 text-white shadow-xl">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center">
              <Users className="w-5 h-5 text-white/90" />
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">{trip.name}</h1>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-white/70">
            <span className="inline-flex items-center gap-1.5">
              <MapPin className="w-3.5 h-3.5" />
              {trip.destination}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Calendar className="w-3.5 h-3.5" />
              {formatDate(trip.startDate)} – {formatDate(trip.endDate)}
            </span>
            <span className="inline-flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" />
              {trip.travelerCount} travelers
            </span>
          </div>
        </div>
        <span className={`self-start px-3 py-1.5 rounded-lg text-xs font-semibold tracking-wide uppercase ${statusColors[trip.status] ?? 'bg-slate-100 text-slate-700'}`}>
          {statusLabels[trip.status] ?? trip.status}
        </span>
      </div>
    </div>
  );
}

function TravelerCards({ travelers, balances, settlements, assignments, onSelect }: {
  travelers: TravelerProfileResponse[];
  balances: GroupTripDetail['balances'];
  settlements: SettlementSummary[];
  assignments: FlightAssignment[];
  onSelect: (travelerId: string) => void;
}) {
  const settlementMap = new Map(settlements.map(s => [s.travelerProfileId, s]));

  // Flight count per traveler, so each card hints at their itinerary.
  const flightCountByTraveler = new Map<string, number>();
  for (const a of assignments) {
    if (a.itemType === 'flight' && a.travelerProfileId) {
      flightCountByTraveler.set(
        a.travelerProfileId,
        (flightCountByTraveler.get(a.travelerProfileId) ?? 0) + 1,
      );
    }
  }

  // Collect connection warnings (e.g. self-transfers) per traveler.
  const warningsByTraveler = new Map<string, ConnectionWarning[]>();
  for (const a of assignments) {
    const w = a.connection?.warnings;
    if (a.travelerProfileId && w && w.length) {
      warningsByTraveler.set(
        a.travelerProfileId,
        [...(warningsByTraveler.get(a.travelerProfileId) ?? []), ...w],
      );
    }
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">Traveler Assignments</h2>
      </div>
      <p className="text-sm text-slate-500 mb-4 -mt-2">Select a traveler to see their full travel plan.</p>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {travelers.map(t => {
          const settlement = settlementMap.get(t.id);
          const travelerBalances = balances[t.id] || [];
          const flightCount = flightCountByTraveler.get(t.id) ?? 0;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => onSelect(t.id)}
              className="text-left bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md hover:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-500 transition-all group"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <h3 className="font-semibold text-slate-900">{t.displayName}</h3>
                  {t.originCity && (
                    <p className="text-xs text-slate-500 mt-0.5 flex items-center gap-1">
                      <MapPin className="w-3 h-3" />
                      {t.originCity}
                    </p>
                  )}
                </div>
                {settlement && <SettlementChip settlement={settlement} />}
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex items-center gap-2 text-slate-600">
                  <Plane className="w-3.5 h-3.5 text-blue-500" />
                  <span>
                    {flightCount > 0
                      ? `${flightCount} flight${flightCount > 1 ? 's' : ''}`
                      : 'No flights yet'}
                    {t.cabinPreference ? ` · ${t.cabinPreference.replace('_', ' ')} class` : ''}
                  </span>
                </div>
                {t.hotelPreference && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <Building2 className="w-3.5 h-3.5 text-indigo-500" />
                    <span className="capitalize">{t.hotelPreference} hotel</span>
                  </div>
                )}
                {travelerBalances.length > 0 && (
                  <div className="flex items-center gap-2 text-slate-600">
                    <CreditCard className="w-3.5 h-3.5 text-purple-500" />
                    <span>{travelerBalances.length} loyalty program{travelerBalances.length > 1 ? 's' : ''}</span>
                  </div>
                )}
                {(warningsByTraveler.get(t.id) ?? []).map((w, i) => {
                  const info = w.severity === 'info';
                  return (
                    <div
                      key={i}
                      className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                        info
                          ? 'border-sky-200 bg-sky-50 text-sky-800'
                          : 'border-amber-200 bg-amber-50 text-amber-800'
                      }`}
                    >
                      <AlertCircle
                        className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${info ? 'text-sky-500' : 'text-amber-500'}`}
                      />
                      <span>{w.message}</span>
                    </div>
                  );
                })}
              </div>

              <div className="mt-4 flex items-center gap-1 text-sm font-medium text-blue-600 group-hover:gap-2 transition-all">
                View travel plan
                <ArrowRight className="w-4 h-4" />
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function SettlementChip({ settlement }: { settlement: SettlementSummary }) {
  const status = getSettlementStatus(settlement);
  const cfg = statusConfig[status];
  const Icon = cfg.icon;
  const amount = status === 'credit' ? settlement.netCreditUsd : status === 'owes' ? settlement.netOwedUsd : 0;

  return (
    <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold ${cfg.bg} ${cfg.color} ${cfg.border} border`}>
      <Icon className="w-3 h-3" />
      {status === 'settled' ? 'Even' : formatCurrency(amount)}
    </span>
  );
}

function ContributionBar({ grossShare, contributed, name }: { grossShare: number; contributed: number; name: string }) {
  const maxVal = Math.max(grossShare, contributed, 1);
  const sharePercent = (grossShare / maxVal) * 100;
  const contribPercent = (contributed / maxVal) * 100;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{name}&rsquo;s share vs. contribution</span>
      </div>
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <span className="w-20 text-xs text-slate-500 text-right shrink-0">Share</span>
          <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-slate-400 rounded-full transition-all duration-500"
              style={{ width: `${sharePercent}%` }}
            />
          </div>
          <span className="w-20 text-xs font-medium text-slate-700 shrink-0">{formatCurrency(grossShare)}</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-20 text-xs text-slate-500 text-right shrink-0">Contributed</span>
          <div className="flex-1 h-3 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-500"
              style={{ width: `${contribPercent}%` }}
            />
          </div>
          <span className="w-20 text-xs font-medium text-slate-700 shrink-0">{formatCurrency(contributed)}</span>
        </div>
      </div>
    </div>
  );
}

function SettlementSummarySection({ settlements }: { settlements: SettlementSummary[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const totalTripCost = settlements.reduce((sum, s) => sum + s.grossShareUsd, 0);

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <Scale className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">Settlement Summary</h2>
      </div>
      <p className="text-sm text-slate-500 mb-5">
        Total trip cost: <span className="font-semibold text-slate-900">{formatCurrency(totalTripCost)}</span>.
        TripsHacker values your points based on the booking they covered.
      </p>

      <div className="space-y-3">
        {settlements.map(s => {
          const status = getSettlementStatus(s);
          const cfg = statusConfig[status];
          const isExpanded = expandedId === s.id;

          return (
            <div key={s.id} className={`rounded-xl border ${cfg.border} overflow-hidden transition-all`}>
              <button
                onClick={() => setExpandedId(isExpanded ? null : s.id)}
                className={`w-full flex items-center gap-4 p-4 sm:p-5 text-left hover:bg-slate-50/60 transition-colors ${isExpanded ? 'bg-slate-50/40' : ''}`}
              >
                <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-slate-100 to-slate-50 flex items-center justify-center shrink-0 border border-slate-200">
                  <span className="text-sm font-bold text-slate-700">
                    {s.travelerName.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-slate-900 truncate">{s.travelerName}</span>
                    <SettlementChip settlement={s} />
                  </div>
                  <ContributionBar
                    grossShare={s.grossShareUsd}
                    contributed={s.contributedValueUsd}
                    name={s.travelerName.split(' ')[0]}
                  />
                </div>

                <div className="shrink-0 text-slate-400">
                  {isExpanded ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
                </div>
              </button>

              {isExpanded && (
                <div className="border-t border-slate-100 bg-slate-50/50 px-4 sm:px-5 py-4 space-y-4">
                  <div className="grid grid-cols-3 gap-3">
                    <div className="text-center p-3 bg-white rounded-lg border border-slate-100">
                      <p className="text-xs text-slate-500 mb-1">Gross share</p>
                      <p className="text-sm font-bold text-slate-900">{formatCurrency(s.grossShareUsd)}</p>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-slate-100">
                      <p className="text-xs text-slate-500 mb-1">Contributed</p>
                      <p className="text-sm font-bold text-blue-700">{formatCurrency(s.contributedValueUsd)}</p>
                    </div>
                    <div className="text-center p-3 bg-white rounded-lg border border-slate-100">
                      <p className="text-xs text-slate-500 mb-1">Net</p>
                      <p className={`text-sm font-bold ${status === 'credit' ? 'text-emerald-700' : status === 'owes' ? 'text-red-700' : 'text-slate-600'}`}>
                        {status === 'credit' ? `+${formatCurrency(s.netCreditUsd)}` : status === 'owes' ? `-${formatCurrency(s.netOwedUsd)}` : formatCurrency(0)}
                      </p>
                    </div>
                  </div>

                  {s.explanationLines.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">How we calculated this</p>
                      <ul className="space-y-1.5">
                        {s.explanationLines.map((line, i) => (
                          <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                            <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                            {line}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {status !== 'settled' && (
                    <div className={`p-3 rounded-lg ${cfg.bg} ${cfg.border} border`}>
                      <p className={`text-sm ${cfg.color}`}>
                        {status === 'owes'
                          ? `${s.travelerName.split(' ')[0]} used more points, so their cash share went down — but they still owe ${formatCurrency(s.netOwedUsd)} in cash.`
                          : `${s.travelerName.split(' ')[0]} contributed more than their fair share. They're owed ${formatCurrency(s.netCreditUsd)}.`}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function WhoOwesWhom({ settlements }: { settlements: SettlementSummary[] }) {
  const transfers = computeTransfers(settlements);

  if (transfers.length === 0) {
    return (
      <section>
        <div className="flex items-center gap-2 mb-4">
          <DollarSign className="w-5 h-5 text-slate-700" />
          <h2 className="text-lg font-semibold text-slate-900">Who Owes Whom</h2>
        </div>
        <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-6 text-center">
          <Check className="w-8 h-8 text-emerald-500 mx-auto mb-2" />
          <p className="font-semibold text-emerald-800">All settled up!</p>
          <p className="text-sm text-emerald-600 mt-1">No transfers needed — everyone&rsquo;s contribution matches their share.</p>
        </div>
      </section>
    );
  }

  return (
    <section>
      <div className="flex items-center gap-2 mb-2">
        <DollarSign className="w-5 h-5 text-slate-700" />
        <h2 className="text-lg font-semibold text-slate-900">Who Owes Whom</h2>
      </div>
      <p className="text-sm text-slate-500 mb-4">
        These {transfers.length} transfer{transfers.length > 1 ? 's' : ''} will settle everyone up.
      </p>
      <div className="space-y-3">
        {transfers.map((t, i) => (
          <div
            key={i}
            className="flex items-center gap-3 bg-white border border-slate-200 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow"
          >
            <div className="w-9 h-9 rounded-lg bg-red-50 flex items-center justify-center shrink-0">
              <span className="text-xs font-bold text-red-700">
                {t.from.split(' ').map(p => p[0]).join('').toUpperCase().slice(0, 2)}
              </span>
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-medium text-slate-900 truncate">{t.from}</span>
                <ArrowRight className="w-4 h-4 text-slate-400 shrink-0" />
                <span className="font-medium text-slate-900 truncate">{t.to}</span>
              </div>
              <p className="text-xs text-slate-500 mt-0.5">pays {t.to.split(' ')[0]}</p>
            </div>
            <span className="text-lg font-bold text-slate-900 shrink-0">{formatCurrency(t.amount)}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function ManualAdjustmentModal({
  travelers,
  tripId,
  onClose,
  onSaved,
}: {
  travelers: TravelerProfileResponse[];
  tripId: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [travelerId, setTravelerId] = useState('');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!travelerId || !amount || !description) return;

    setSaving(true);
    setError('');
    try {
      await groupPlanning.addManualAdjustment(tripId, travelerId, parseFloat(amount), description);
      onSaved();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to save adjustment');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 sm:p-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-2">
            <PlusCircle className="w-5 h-5 text-blue-600" />
            <h3 className="text-lg font-semibold text-slate-900">Manual Adjustment</h3>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors text-slate-400 hover:text-slate-600">
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Traveler</label>
            <select
              value={travelerId}
              onChange={e => setTravelerId(e.target.value)}
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none bg-white"
            >
              <option value="">Select a traveler</option>
              {travelers.map(t => (
                <option key={t.id} value={t.id}>{t.displayName}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Amount (USD)</label>
            <div className="relative">
              <DollarSign className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="number"
                step="0.01"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder="0.00"
                className="w-full pl-9 pr-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
              />
            </div>
            <p className="text-xs text-slate-500 mt-1">Positive = they owe more, negative = they get credit</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1.5">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder='e.g. "Paid for group dinner"'
              className="w-full px-3.5 py-2.5 border border-slate-300 rounded-xl text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 outline-none"
            />
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0" />
              {error}
            </div>
          )}

          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!travelerId || !amount || !description || saving}
              className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
              {saving ? 'Saving...' : 'Save Adjustment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Arrival coordination ("Arrive Together")
// ---------------------------------------------------------------------------

interface ConnectionWarning {
  severity?: string;
  category?: string;
  message: string;
}

interface ConnectionInfo {
  numStops?: number;
  airlines?: string[];
  hasSelfTransfer?: boolean;
  warnings?: ConnectionWarning[];
}

// Schedule/route snapshot persisted on each flight assignment so a traveler's
// plan renders even when arrival coordination didn't run (single-traveler trips).
interface FlightDetails {
  flightId?: string;
  origin?: string;
  destination?: string;
  date?: string;
  departureTime?: string; // HH:MM, origin-local
  durationMinutes?: number;
  airline?: string;
  description?: string;
}

interface FlightAssignment {
  travelerProfileId?: string;
  travelerName?: string;
  itineraryItemId?: string;
  itemType?: string;
  cashCost?: number;
  pointsCost?: number;
  pointsProgram?: string | null;
  imputedPointsValueUsd?: number;
  connection?: ConnectionInfo | null;
  flightDetails?: FlightDetails | null;
  cabin?: string | null;
  // Multi-city: which itinerary leg this flight belongs to (0-based; the return
  // leg is the highest index). Absent on trips optimized before multi-city.
  legIndex?: number;
  legLabel?: string;
}

interface CoordinationScheduleEntry {
  flightId?: string;
  origin?: string;
  departureLocal?: string;
  departureUtc?: string;
  arrivalUtc?: string;
  durationMinutes?: number;
}

interface ArrivalCoordination {
  enabled?: boolean;
  withinTarget?: boolean;
  windowMinutes?: number;
  spreadMinutes?: number;
  reason?: string;
  schedule?: Record<string, CoordinationScheduleEntry>;
}

function formatUtc(iso?: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    hour12: false, timeZone: 'UTC',
  }).format(d) + ' UTC';
}

function formatDuration(min?: number): string {
  if (!min || min <= 0) return '';
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

function ArrivalCoordinationSection({
  coordination,
  travelers,
}: {
  coordination: ArrivalCoordination;
  travelers: TravelerProfileResponse[];
}) {
  const entries = Object.values(coordination.schedule ?? {});
  if (entries.length === 0) return null;

  // Map an origin airport to a traveler display name (best-effort).
  const nameByOrigin = new Map<string, string>();
  for (const t of travelers) {
    const code = (t.originAirport || '').toUpperCase();
    if (code && !nameByOrigin.has(code)) nameByOrigin.set(code, t.displayName || code);
  }

  const sorted = [...entries].sort((a, b) =>
    (a.departureUtc || '').localeCompare(b.departureUtc || ''),
  );
  const within = coordination.withinTarget;
  const spread = Math.round(coordination.spreadMinutes ?? 0);

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Plane className="w-5 h-5 text-emerald-600" />
        <h2 className="text-xl font-semibold text-slate-900">Arrive Together</h2>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
        <div
          className={`flex items-start gap-2.5 px-5 py-3 text-sm ${
            within ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
          }`}
        >
          {within ? <Check className="w-4 h-4 mt-0.5 shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />}
          <p>
            {within
              ? `Everyone lands within ${formatDuration(spread) || 'minutes'} of each other. Departures are staggered by flight time and time zone so the group arrives together.`
              : `Flights couldn't all fit the target window — the closest we found has arrivals about ${formatDuration(spread)} apart.`}
          </p>
        </div>

        <div className="divide-y divide-slate-100">
          {sorted.map((e, i) => {
            const name = (e.origin && nameByOrigin.get(e.origin.toUpperCase())) || e.origin || 'Traveler';
            return (
              <div key={e.flightId || i} className="flex flex-wrap items-center gap-x-6 gap-y-1 px-5 py-3 text-sm">
                <div className="flex items-center gap-2 min-w-[140px]">
                  <MapPin className="w-3.5 h-3.5 text-slate-400" />
                  <span className="font-medium text-slate-800">{name}</span>
                  {e.origin && <span className="text-slate-400">({e.origin})</span>}
                </div>
                <div className="text-slate-600">
                  <span className="text-slate-400">Departs</span>{' '}
                  {e.departureLocal ? `${e.departureLocal} local` : formatUtc(e.departureUtc)}
                </div>
                <div className="text-slate-600">
                  <span className="text-slate-400">Arrives</span> {formatUtc(e.arrivalUtc)}
                </div>
                {e.durationMinutes ? (
                  <div className="text-slate-400">{formatDuration(e.durationMinutes)} flight</div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function formatFlightDate(dateStr?: string): string {
  if (!dateStr) return '';
  const d = new Date(`${dateStr}T00:00:00`);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

function FlightCard({
  f,
  schedule,
}: {
  f: FlightAssignment;
  // Coordination entry for this traveler (only present on multi-traveler trips
  // where arrival coordination ran). Supplies absolute UTC arrival on leg 0.
  schedule?: CoordinationScheduleEntry;
}) {
  const details = f.flightDetails ?? undefined;
  // Coordination times only describe the outbound (leg 0) flight.
  const sched = f.legIndex === 0 ? schedule : undefined;

  const origin = details?.origin || sched?.origin;
  const destination = details?.destination;
  const route =
    origin && destination ? `${origin} → ${destination}` : origin || destination || 'Flight';
  const departLocal = details?.departureTime || sched?.departureLocal;
  const durationMin = details?.durationMinutes || sched?.durationMinutes;

  const airlines = f.connection?.airlines ?? (details?.airline ? [details.airline] : []);
  const numStops = f.connection?.numStops;
  const usesPoints = (f.pointsCost ?? 0) > 0;
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between mb-3 gap-3">
        <div className="min-w-0">
          <h3 className="font-semibold text-slate-900 flex items-center gap-1.5">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            {route}
          </h3>
          {details?.date && (
            <p className="text-xs text-slate-500 mt-0.5">{formatFlightDate(details.date)}</p>
          )}
        </div>
        {usesPoints ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-purple-50 px-2.5 py-1 text-xs font-medium text-purple-700 shrink-0">
            <CreditCard className="w-3.5 h-3.5" />
            {f.pointsCost?.toLocaleString()} pts
            {f.pointsProgram ? ` · ${f.pointsProgram}` : ''}
          </span>
        ) : (
          <span className="text-sm font-semibold text-slate-900 shrink-0">
            {formatCurrency(f.cashCost ?? 0)}
          </span>
        )}
      </div>

      <div className="space-y-2 text-sm text-slate-600">
        {(departLocal || durationMin || sched?.arrivalUtc) && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            {departLocal && (
              <span>
                <span className="text-slate-400">Departs</span> {departLocal} local
              </span>
            )}
            {sched?.arrivalUtc && (
              <span>
                <span className="text-slate-400">Arrives</span> {formatUtc(sched.arrivalUtc)}
              </span>
            )}
            {durationMin ? (
              <span className="text-slate-400">{formatDuration(durationMin)}</span>
            ) : null}
          </div>
        )}

        <div className="flex items-center gap-2">
          <Plane className="w-3.5 h-3.5 text-blue-500" />
          <span>
            {numStops === 0
              ? 'Nonstop'
              : numStops != null
              ? `${numStops} stop${numStops > 1 ? 's' : ''}`
              : 'Itinerary'}
            {airlines.length > 0 ? ` · ${airlines.join(', ')}` : ''}
            {f.cabin ? ` · ${f.cabin.replace('_', ' ')} class` : ''}
          </span>
        </div>

        {usesPoints && (f.cashCost ?? 0) > 0 && (
          <div className="text-xs text-slate-400">
            + {formatCurrency(f.cashCost ?? 0)} in taxes &amp; fees
          </div>
        )}

        {(f.connection?.warnings ?? []).map((w, wi) => {
          const info = w.severity === 'info';
          return (
            <div
              key={wi}
              className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 text-xs ${
                info
                  ? 'border-sky-200 bg-sky-50 text-sky-800'
                  : 'border-amber-200 bg-amber-50 text-amber-800'
              }`}
            >
              <AlertCircle
                className={`mt-0.5 h-3.5 w-3.5 flex-shrink-0 ${info ? 'text-sky-500' : 'text-amber-500'}`}
              />
              <span>{w.message}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Render one traveler's flights, grouped by itinerary leg (Outbound / city legs
// / Return). `scheduleEntry` is this traveler's arrival-coordination entry, if
// any — it supplies an absolute UTC arrival on the outbound leg.
function TravelerFlights({
  flights,
  scheduleEntry,
}: {
  flights: FlightAssignment[];
  scheduleEntry?: CoordinationScheduleEntry;
}) {
  if (flights.length === 0) return null;

  const groups = new Map<number, FlightAssignment[]>();
  for (const f of flights) {
    const k = f.legIndex ?? 0;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(f);
  }
  const sortedKeys = [...groups.keys()].sort((a, b) => a - b);
  const maxKey = sortedKeys[sortedKeys.length - 1];
  const labelFor = (k: number, group: FlightAssignment[]) =>
    group.find((f) => f.legLabel)?.legLabel || (k === maxKey ? 'Return' : `Leg ${k + 1}`);

  return (
    <div className="space-y-5">
      {sortedKeys.map((k) => {
        const group = groups.get(k)!;
        return (
          <div key={k}>
            <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">
              {labelFor(k, group)}
            </h4>
            <div className="space-y-3">
              {group.map((f, i) => (
                <FlightCard
                  key={f.itineraryItemId || `${f.travelerProfileId}-${k}-${i}`}
                  f={f}
                  schedule={k === 0 ? scheduleEntry : undefined}
                />
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One traveler's complete plan: flights, hotel, and cost/settlement breakdown.
// Opened from their card on the results page.
function TravelerPlanModal({
  traveler,
  flights,
  settlement,
  scheduleEntry,
  hotelRecommendations,
  optimizationStatus,
  balances,
  onClose,
}: {
  traveler: TravelerProfileResponse;
  flights: FlightAssignment[];
  settlement?: SettlementSummary;
  scheduleEntry?: CoordinationScheduleEntry;
  hotelRecommendations: HotelRecommendation[];
  optimizationStatus?: string | null;
  balances: LoyaltyBalanceResponse[];
  onClose: () => void;
}) {
  const status = settlement ? getSettlementStatus(settlement) : null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-slate-50 shadow-2xl w-full max-w-lg h-full overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 z-10 bg-gradient-to-br from-slate-900 to-slate-800 text-white px-6 py-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-xl font-bold tracking-tight">{traveler.displayName}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/70">
                {traveler.originCity && (
                  <span className="inline-flex items-center gap-1.5">
                    <MapPin className="w-3.5 h-3.5" />
                    {traveler.originCity}
                    {traveler.originAirport ? ` (${traveler.originAirport})` : ''}
                  </span>
                )}
                {traveler.cabinPreference && (
                  <span className="inline-flex items-center gap-1.5 capitalize">
                    <Plane className="w-3.5 h-3.5" />
                    {traveler.cabinPreference.replace('_', ' ')} class
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg hover:bg-white/10 transition-colors text-white/70 hover:text-white"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="px-6 py-6 space-y-7">
          {/* Flights */}
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Plane className="w-5 h-5 text-blue-600" />
              <h3 className="text-lg font-semibold text-slate-900">Flights</h3>
            </div>
            {flights.length > 0 ? (
              <TravelerFlights flights={flights} scheduleEntry={scheduleEntry} />
            ) : optimizationStatus === 'no_flights' ? (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
                No flights were found for this traveler. Check the origin/return airports
                and dates, then re-optimize.
              </div>
            ) : (
              <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-500">
                No flight assignments yet. Re-optimize to generate this traveler&rsquo;s
                flights.
              </div>
            )}
          </section>

          {/* Hotel */}
          {hotelRecommendations.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Building2 className="w-5 h-5 text-indigo-600" />
                <h3 className="text-lg font-semibold text-slate-900">Hotel</h3>
              </div>
              <p className="text-xs text-slate-500 mb-3">
                Shared recommendations for the group&rsquo;s stay.
              </p>
              <div className="space-y-3">
                {hotelRecommendations.map((rec) => (
                  <HotelRecommendationCard key={rec.hotelId} recommendation={rec} />
                ))}
              </div>
            </section>
          )}

          {/* Cost summary */}
          {settlement && status && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <Receipt className="w-5 h-5 text-slate-700" />
                <h3 className="text-lg font-semibold text-slate-900">Cost summary</h3>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white p-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-1">Fair share</p>
                    <p className="text-sm font-bold text-slate-900">{formatCurrency(settlement.grossShareUsd)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-1">Contributed</p>
                    <p className="text-sm font-bold text-blue-700">{formatCurrency(settlement.contributedValueUsd)}</p>
                  </div>
                  <div className="text-center">
                    <p className="text-xs text-slate-500 mb-1">Net</p>
                    <p className={`text-sm font-bold ${status === 'credit' ? 'text-emerald-700' : status === 'owes' ? 'text-red-700' : 'text-slate-600'}`}>
                      {status === 'credit' ? `+${formatCurrency(settlement.netCreditUsd)}` : status === 'owes' ? `-${formatCurrency(settlement.netOwedUsd)}` : formatCurrency(0)}
                    </p>
                  </div>
                </div>
                {settlement.explanationLines.length > 0 && (
                  <ul className="mt-4 space-y-1.5 border-t border-slate-100 pt-3">
                    {settlement.explanationLines.map((line, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
                        <span className="w-1.5 h-1.5 rounded-full bg-slate-300 mt-1.5 shrink-0" />
                        {line}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </section>
          )}

          {/* Loyalty programs */}
          {balances.length > 0 && (
            <section>
              <div className="flex items-center gap-2 mb-3">
                <CreditCard className="w-5 h-5 text-purple-600" />
                <h3 className="text-lg font-semibold text-slate-900">Loyalty programs</h3>
              </div>
              <div className="rounded-xl border border-slate-200 bg-white divide-y divide-slate-100">
                {balances.map((b) => (
                  <div key={b.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                    <span className="font-medium text-slate-800">{b.program}</span>
                    <span className="text-slate-600">{b.balance.toLocaleString()} pts</span>
                  </div>
                ))}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

export default function GroupPlanningResults() {
  const params = useParams();
  const router = useRouter();
  const groupTripId = params?.groupTripId as string;

  const [detail, setDetail] = useState<GroupTripDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [optimizing, setOptimizing] = useState(false);
  const [showAdjustmentModal, setShowAdjustmentModal] = useState(false);
  const [hotelRecommendations, setHotelRecommendations] = useState<HotelRecommendation[]>([]);
  const [coordination, setCoordination] = useState<ArrivalCoordination | null>(null);
  const [assignments, setAssignments] = useState<FlightAssignment[]>([]);
  const [optimizationStatus, setOptimizationStatus] = useState<string | null>(null);
  const [selectedTravelerId, setSelectedTravelerId] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    if (!groupTripId) return;
    setLoading(true);
    setError('');
    try {
      const data = await groupPlanning.getTripDetail(groupTripId);
      setDetail(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load trip details');
    } finally {
      setLoading(false);
    }
  }, [groupTripId]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  // Load the persisted optimization result (flight assignments, arrival
  // coordination, hotel recs). The optimize endpoint returns raw allocations,
  // not the persisted assignment shape, so we always re-read this after
  // optimizing — otherwise flights and "Arrive Together" only appear on a full
  // page reload.
  const loadOptimizationResult = useCallback(async () => {
    if (!groupTripId) return;
    try {
      const result = await groupPlanning.getOptimizationResult(groupTripId);
      const r = result as Record<string, unknown>;
      const recs = r?.hotelRecommendations;
      if (Array.isArray(recs)) setHotelRecommendations(recs as HotelRecommendation[]);
      const coord = r?.arrivalCoordination;
      if (coord && typeof coord === 'object') setCoordination(coord as ArrivalCoordination);
      const asgs = r?.assignments;
      if (Array.isArray(asgs)) setAssignments(asgs as FlightAssignment[]);
      const optStatus = r?.optimizationStatus;
      if (typeof optStatus === 'string') setOptimizationStatus(optStatus);
    } catch {
      // Non-fatal: the page still renders without the optimization detail.
    }
  }, [groupTripId]);

  const handleOptimize = async () => {
    setOptimizing(true);
    try {
      await groupPlanning.optimize(groupTripId);
      await groupPlanning.calculateSplit(groupTripId);
      await Promise.all([fetchData(), loadOptimizationResult()]);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Optimization failed');
    } finally {
      setOptimizing(false);
    }
  };

  useEffect(() => {
    loadOptimizationResult();
  }, [loadOptimizationResult]);

  const handleAdjustmentSaved = async () => {
    setShowAdjustmentModal(false);
    await fetchData();
  };

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-20">
        <LoadingState />
      </div>
    );
  }

  if (error && !detail) {
    return (
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-20">
        <ErrorState message={error} onRetry={fetchData} />
      </div>
    );
  }

  if (!detail) return null;

  const { trip, travelers, balances, settlements } = detail;
  const hasSettlements = settlements.length > 0;

  const selectedTraveler = travelers.find((t) => t.id === selectedTravelerId) || null;
  const selectedFlights = selectedTraveler
    ? assignments.filter((a) => a.itemType === 'flight' && a.travelerProfileId === selectedTraveler.id)
    : [];
  const selectedSettlement = selectedTraveler
    ? settlements.find((s) => s.travelerProfileId === selectedTraveler.id)
    : undefined;
  const selectedScheduleEntry = selectedTraveler
    ? coordination?.schedule?.[selectedTraveler.id]
    : undefined;

  return (
    <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-8 mt-20 pb-24">
      <div className="space-y-8">
        <TripHeader trip={trip} />

        <TravelerCards
          travelers={travelers}
          balances={balances}
          settlements={settlements}
          assignments={assignments}
          onSelect={setSelectedTravelerId}
        />

        {/* Group-level arrival coordination (only runs for 2+ travelers). */}
        {coordination?.enabled && travelers.length > 1 && (
          <ArrivalCoordinationSection coordination={coordination} travelers={travelers} />
        )}

        {/* Hotel Recommendations */}
        {hotelRecommendations.length > 0 && (
          <div>
            <div className="flex items-center gap-2 mb-4">
              <Building2 className="w-5 h-5 text-indigo-600" />
              <h2 className="text-xl font-semibold text-slate-900">Recommended Hotels</h2>
            </div>
            <div className="grid md:grid-cols-2 gap-4">
              {hotelRecommendations.map((rec) => (
                <HotelRecommendationCard key={rec.hotelId} recommendation={rec} />
              ))}
            </div>
          </div>
        )}

        {!hasSettlements ? (
          <EmptyState onOptimize={handleOptimize} optimizing={optimizing} />
        ) : (
          <>
            <SettlementSummarySection settlements={settlements} />

            <WhoOwesWhom settlements={settlements} />

            {/* Actions bar */}
            <div className="flex flex-wrap gap-3">
              <button
                onClick={() => setShowAdjustmentModal(true)}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-white border border-slate-300 rounded-xl text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors shadow-sm"
              >
                <PlusCircle className="w-4 h-4" />
                Add Manual Adjustment
              </button>
              <button
                onClick={handleOptimize}
                disabled={optimizing}
                className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors shadow-lg shadow-blue-600/20 disabled:opacity-60"
              >
                {optimizing ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                {optimizing ? 'Re-optimizing...' : 'Re-optimize'}
              </button>
            </div>

            {/* Trust footer */}
            <div className="bg-gradient-to-br from-slate-50 to-slate-100 border border-slate-200 rounded-xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-white border border-slate-200 flex items-center justify-center shrink-0">
                  <Receipt className="w-4 h-4 text-slate-500" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-800 mb-1">How does the split work?</p>
                  <p className="text-sm text-slate-600 leading-relaxed">
                    Each person&rsquo;s share is based on the actual bookings assigned to them. If you used more points,
                    your cash share went down. TripsHacker values your points based on the booking they covered &mdash;
                    so everyone pays their fair share, whether in points or cash.
                  </p>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {showAdjustmentModal && (
        <ManualAdjustmentModal
          travelers={travelers}
          tripId={groupTripId}
          onClose={() => setShowAdjustmentModal(false)}
          onSaved={handleAdjustmentSaved}
        />
      )}

      {selectedTraveler && (
        <TravelerPlanModal
          traveler={selectedTraveler}
          flights={selectedFlights}
          settlement={selectedSettlement}
          scheduleEntry={selectedScheduleEntry}
          hotelRecommendations={hotelRecommendations}
          optimizationStatus={optimizationStatus}
          balances={balances[selectedTraveler.id] || []}
          onClose={() => setSelectedTravelerId(null)}
        />
      )}
    </div>
  );
}
