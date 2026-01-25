/**
 * TransferStrategyCard - Shows specific transfer instructions in copy-paste ready format.
 * Example: "Transfer 50,000 Amex points to Delta to book DL158 JFK→ICN"
 */
'use client';

import { useState } from 'react';
import {
  ArrowRightLeft,
  Plane,
  Building2,
  ExternalLink,
  Copy,
  Check,
  Clock,
  ChevronDown,
  ChevronUp,
  Wallet,
  CreditCard,
  Sparkles,
} from 'lucide-react';

// Bank portal URLs
const BANK_PORTALS: Record<string, string> = {
  amex: 'https://global.americanexpress.com/rewards',
  chase: 'https://ultimaterewardspoints.chase.com',
  citi: 'https://thankyou.citi.com',
  capitalone: 'https://www.capitalone.com/credit-cards/benefits/travel/',
  bilt: 'https://www.biltrewards.com',
};

// Bank transfer times
const BANK_TRANSFER_TIMES: Record<string, string> = {
  amex: '1-2 business days',
  chase: 'Instant',
  citi: 'Instant to 24h',
  capitalone: 'Instant to 2 days',
  bilt: 'Instant',
};

// Airline booking URLs
const AIRLINE_BOOKING_URLS: Record<string, string> = {
  UA: 'united.com',
  AA: 'aa.com',
  DL: 'delta.com',
  AS: 'alaskaair.com',
  B6: 'jetblue.com',
  WN: 'southwest.com',
  AF: 'airfrance.com',
  BA: 'britishairways.com',
  VS: 'virginatlantic.com',
  NH: 'ana.co.jp',
  SQ: 'singaporeair.com',
  CX: 'cathaypacific.com',
  EK: 'emirates.com',
  TK: 'turkishairlines.com',
};

export interface TransferItem {
  type: 'flight' | 'hotel';
  // Transfer details
  fromBank: string;
  fromBankName: string;
  toProgram: string;
  toProgramName: string;
  pointsToTransfer: number;
  transferRatio?: string;
  transferTime?: string;
  // Booking details
  flightNumber?: string;
  origin?: string;
  destination?: string;
  departureDate?: string;
  departureTime?: string;
  // Hotel details
  hotelName?: string;
  hotelLocation?: string;
  nights?: number;
  checkIn?: string;
  checkOut?: string;
  // Costs
  surcharge?: number;
  cashAlternative?: number;
}

interface TransferStrategyCardProps {
  transfers: TransferItem[];
  summary?: {
    totalOutOfPocket: number;
    allCashCost: number;
    savings: number;
    savingsPercentage: number;
  };
  className?: string;
}

export function TransferStrategyCard({
  transfers,
  summary,
  className = '',
}: TransferStrategyCardProps) {
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const copyToClipboard = async (text: string, index: number) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    } catch {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-9999px';
      document.body.appendChild(textArea);
      textArea.select();
      document.execCommand('copy');
      document.body.removeChild(textArea);
      setCopiedIndex(index);
      setTimeout(() => setCopiedIndex(null), 2000);
    }
  };

  const formatOneLiner = (transfer: TransferItem): string => {
    const points = transfer.pointsToTransfer.toLocaleString();
    const bank = transfer.fromBankName.split(' ')[0]; // "Amex" from "Amex Membership Rewards"
    const program = transfer.toProgramName;
    
    if (transfer.type === 'flight' && transfer.flightNumber) {
      const route = transfer.origin && transfer.destination 
        ? `${transfer.origin}→${transfer.destination}` 
        : '';
      const date = transfer.departureDate 
        ? ` on ${new Date(transfer.departureDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
        : '';
      return `Transfer ${points} ${bank} points to ${program} to book ${transfer.flightNumber} ${route}${date}`;
    }
    
    if (transfer.type === 'hotel' && transfer.hotelName) {
      const nights = transfer.nights ? ` (${transfer.nights} nights)` : '';
      return `Transfer ${points} ${bank} points to ${program} to book ${transfer.hotelName}${nights}`;
    }
    
    return `Transfer ${points} ${bank} points to ${program}`;
  };

  const getBankCode = (bankName: string): string => {
    const lower = bankName.toLowerCase();
    if (lower.includes('amex') || lower.includes('american express')) return 'amex';
    if (lower.includes('chase')) return 'chase';
    if (lower.includes('citi')) return 'citi';
    if (lower.includes('capital')) return 'capitalone';
    if (lower.includes('bilt')) return 'bilt';
    return '';
  };

  const getAirlineCode = (programName: string): string => {
    const lower = programName.toLowerCase();
    if (lower.includes('united')) return 'UA';
    if (lower.includes('american') && lower.includes('advantage')) return 'AA';
    if (lower.includes('delta')) return 'DL';
    if (lower.includes('alaska')) return 'AS';
    if (lower.includes('jetblue')) return 'B6';
    if (lower.includes('southwest')) return 'WN';
    if (lower.includes('air france') || lower.includes('flying blue')) return 'AF';
    if (lower.includes('british')) return 'BA';
    if (lower.includes('virgin')) return 'VS';
    if (lower.includes('ana')) return 'NH';
    if (lower.includes('singapore')) return 'SQ';
    if (lower.includes('cathay')) return 'CX';
    if (lower.includes('emirates')) return 'EK';
    if (lower.includes('turkish')) return 'TK';
    return '';
  };

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Summary Card */}
      {summary && (
        <div className="bg-gradient-to-br from-purple-600 to-indigo-700 rounded-2xl p-6 text-white shadow-lg">
          <div className="flex items-center gap-2 mb-4">
            <Sparkles className="w-5 h-5" />
            <h2 className="font-semibold text-lg">Your Optimized Strategy</h2>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <div className="text-purple-200 text-sm">You Pay</div>
              <div className="text-2xl font-bold">${summary.totalOutOfPocket.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-purple-200 text-sm">All Cash Would Be</div>
              <div className="text-lg font-medium line-through opacity-75">${summary.allCashCost.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-purple-200 text-sm">You Save</div>
              <div className="text-2xl font-bold text-green-300">${summary.savings.toLocaleString()}</div>
            </div>
            <div>
              <div className="text-purple-200 text-sm">Savings</div>
              <div className="text-lg font-medium">{summary.savingsPercentage.toFixed(0)}%</div>
            </div>
          </div>
        </div>
      )}

      {/* One-Liner Transfer Instructions */}
      <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
        <div className="p-4 border-b border-slate-200 bg-slate-50">
          <h3 className="font-semibold text-slate-900 flex items-center gap-2">
            <ArrowRightLeft className="w-5 h-5 text-purple-600" />
            Transfer Instructions (Copy-Paste Ready)
          </h3>
          <p className="text-sm text-slate-500 mt-1">
            Click to copy each instruction
          </p>
        </div>
        
        <div className="divide-y divide-slate-100">
          {transfers.map((transfer, index) => {
            const oneLiner = formatOneLiner(transfer);
            const bankCode = getBankCode(transfer.fromBankName);
            const airlineCode = getAirlineCode(transfer.toProgramName);
            const portalUrl = BANK_PORTALS[bankCode] || '';
            const transferTime = transfer.transferTime || BANK_TRANSFER_TIMES[bankCode] || 'varies';
            const bookingUrl = AIRLINE_BOOKING_URLS[airlineCode] || '';
            const isExpanded = expandedIndex === index;
            
            return (
              <div key={index} className="p-4">
                {/* One-liner with copy button */}
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-purple-100 text-purple-600 flex items-center justify-center font-bold flex-shrink-0">
                    {index + 1}
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <button
                      onClick={() => copyToClipboard(oneLiner, index)}
                      className="group w-full text-left"
                    >
                      <div className="flex items-start gap-2">
                        <p className="font-medium text-slate-900 group-hover:text-purple-600 transition-colors">
                          {oneLiner}
                        </p>
                        <div className="flex-shrink-0 mt-0.5">
                          {copiedIndex === index ? (
                            <Check className="w-4 h-4 text-green-600" />
                          ) : (
                            <Copy className="w-4 h-4 text-slate-400 group-hover:text-purple-600" />
                          )}
                        </div>
                      </div>
                    </button>
                    
                    {/* Quick info badges */}
                    <div className="flex flex-wrap gap-2 mt-2">
                      {transfer.type === 'flight' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 text-xs rounded-full">
                          <Plane className="w-3 h-3" /> Flight
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                          <Building2 className="w-3 h-3" /> Hotel
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-slate-100 text-slate-600 text-xs rounded-full">
                        <Clock className="w-3 h-3" /> {transferTime}
                      </span>
                      {transfer.surcharge !== undefined && transfer.surcharge > 0 && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full">
                          <CreditCard className="w-3 h-3" /> +${Math.round(transfer.surcharge)} fees
                        </span>
                      )}
                    </div>
                    
                    {/* Expand/collapse button */}
                    <button
                      onClick={() => setExpandedIndex(isExpanded ? null : index)}
                      className="mt-2 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
                    >
                      {isExpanded ? (
                        <>
                          <ChevronUp className="w-4 h-4" /> Hide details
                        </>
                      ) : (
                        <>
                          <ChevronDown className="w-4 h-4" /> Show step-by-step
                        </>
                      )}
                    </button>
                    
                    {/* Expanded details */}
                    {isExpanded && (
                      <div className="mt-4 space-y-4">
                        {/* Transfer details card */}
                        <div className="bg-slate-50 rounded-xl p-4 border border-slate-200">
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                            Transfer Details
                          </h4>
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <div className="text-xs text-slate-500">From</div>
                              <div className="font-medium text-slate-900">{transfer.fromBankName}</div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-500">To</div>
                              <div className="font-medium text-slate-900">{transfer.toProgramName}</div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-500">Points</div>
                              <div className="font-bold text-purple-600">
                                {transfer.pointsToTransfer.toLocaleString()}
                              </div>
                            </div>
                            <div>
                              <div className="text-xs text-slate-500">Transfer Time</div>
                              <div className="font-medium text-slate-900">{transferTime}</div>
                            </div>
                          </div>
                        </div>
                        
                        {/* Booking details card */}
                        {transfer.type === 'flight' && transfer.flightNumber && (
                          <div className="bg-blue-50 rounded-xl p-4 border border-blue-200">
                            <h4 className="text-xs font-bold text-blue-600 uppercase tracking-wider mb-3 flex items-center gap-1">
                              <Plane className="w-3 h-3" /> Flight Details
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <div className="text-xs text-blue-600">Flight</div>
                                <div className="font-bold text-slate-900">{transfer.flightNumber}</div>
                              </div>
                              <div>
                                <div className="text-xs text-blue-600">Route</div>
                                <div className="font-medium text-slate-900">
                                  {transfer.origin} → {transfer.destination}
                                </div>
                              </div>
                              {transfer.departureDate && (
                                <div>
                                  <div className="text-xs text-blue-600">Date</div>
                                  <div className="font-medium text-slate-900">
                                    {new Date(transfer.departureDate).toLocaleDateString('en-US', {
                                      weekday: 'short',
                                      month: 'short',
                                      day: 'numeric',
                                    })}
                                  </div>
                                </div>
                              )}
                              {transfer.departureTime && (
                                <div>
                                  <div className="text-xs text-blue-600">Time</div>
                                  <div className="font-medium text-slate-900">{transfer.departureTime}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {transfer.type === 'hotel' && transfer.hotelName && (
                          <div className="bg-amber-50 rounded-xl p-4 border border-amber-200">
                            <h4 className="text-xs font-bold text-amber-600 uppercase tracking-wider mb-3 flex items-center gap-1">
                              <Building2 className="w-3 h-3" /> Hotel Details
                            </h4>
                            <div className="grid grid-cols-2 gap-4">
                              <div className="col-span-2">
                                <div className="text-xs text-amber-600">Hotel</div>
                                <div className="font-bold text-slate-900">{transfer.hotelName}</div>
                              </div>
                              {transfer.hotelLocation && (
                                <div>
                                  <div className="text-xs text-amber-600">Location</div>
                                  <div className="font-medium text-slate-900">{transfer.hotelLocation}</div>
                                </div>
                              )}
                              {transfer.nights && (
                                <div>
                                  <div className="text-xs text-amber-600">Nights</div>
                                  <div className="font-medium text-slate-900">{transfer.nights}</div>
                                </div>
                              )}
                              {transfer.checkIn && (
                                <div>
                                  <div className="text-xs text-amber-600">Check-in</div>
                                  <div className="font-medium text-slate-900">{transfer.checkIn}</div>
                                </div>
                              )}
                              {transfer.checkOut && (
                                <div>
                                  <div className="text-xs text-amber-600">Check-out</div>
                                  <div className="font-medium text-slate-900">{transfer.checkOut}</div>
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                        
                        {/* Step-by-step instructions */}
                        <div className="bg-white rounded-xl p-4 border border-slate-200">
                          <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-3">
                            Step-by-Step Instructions
                          </h4>
                          <ol className="space-y-2 text-sm text-slate-600">
                            <li className="flex gap-2">
                              <span className="text-slate-400">1.</span>
                              <span>Log in to your {transfer.fromBankName} account</span>
                            </li>
                            {portalUrl && (
                              <li className="flex gap-2">
                                <span className="text-slate-400">2.</span>
                                <span>
                                  Go to{' '}
                                  <a
                                    href={portalUrl}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-blue-600 hover:underline inline-flex items-center gap-1"
                                  >
                                    {portalUrl.replace('https://', '')}
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </span>
                              </li>
                            )}
                            <li className="flex gap-2">
                              <span className="text-slate-400">{portalUrl ? '3' : '2'}.</span>
                              <span>Select &quot;Transfer Points&quot; → {transfer.toProgramName}</span>
                            </li>
                            <li className="flex gap-2">
                              <span className="text-slate-400">{portalUrl ? '4' : '3'}.</span>
                              <span>Enter your {transfer.toProgramName} member number</span>
                            </li>
                            <li className="flex gap-2">
                              <span className="text-slate-400">{portalUrl ? '5' : '4'}.</span>
                              <span>
                                Transfer{' '}
                                <strong className="text-purple-600">
                                  {transfer.pointsToTransfer.toLocaleString()} points
                                </strong>{' '}
                                ({transfer.transferRatio || '1:1'}, {transferTime})
                              </span>
                            </li>
                            <li className="flex gap-2">
                              <span className="text-slate-400">{portalUrl ? '6' : '5'}.</span>
                              <span>
                                {transfer.type === 'flight' ? (
                                  <>
                                    Book flight {transfer.flightNumber || ''} at{' '}
                                    {bookingUrl ? (
                                      <a
                                        href={`https://${bookingUrl}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                                      >
                                        {bookingUrl}
                                        <ExternalLink className="w-3 h-3" />
                                      </a>
                                    ) : (
                                      'the airline website'
                                    )}
                                  </>
                                ) : (
                                  <>Book {transfer.hotelName || 'hotel'} at the hotel program website</>
                                )}
                              </span>
                            </li>
                          </ol>
                        </div>
                        
                        {/* Action buttons */}
                        <div className="flex flex-wrap gap-3">
                          {portalUrl && (
                            <a
                              href={portalUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2 bg-purple-600 hover:bg-purple-700 text-white rounded-lg font-medium text-sm transition-colors"
                            >
                              <Wallet className="w-4 h-4" />
                              Open {transfer.fromBankName.split(' ')[0]} Portal
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {bookingUrl && transfer.type === 'flight' && (
                            <a
                              href={`https://${bookingUrl}`}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium text-sm transition-colors"
                            >
                              <Plane className="w-4 h-4" />
                              Book Flight
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export default TransferStrategyCard;
