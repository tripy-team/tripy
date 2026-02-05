'use client';

/**
 * Demo page for the TransferStrategyCard component.
 * Shows mock transfer instructions for testing purposes.
 * Access at: /demo/transfer-strategy
 */

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { TransferStrategyCard, type TransferItem } from '@/components/ui';

// Mock transfer data for demonstration
const mockTransfers: TransferItem[] = [
  {
    type: 'flight',
    fromBank: 'amex',
    fromBankName: 'Amex Membership Rewards',
    toProgram: 'DL',
    toProgramName: 'Delta SkyMiles',
    pointsToTransfer: 95000,
    transferTime: '1-2 business days',
    transferRatio: '1:1',
    flightNumber: 'DL158',
    origin: 'JFK',
    destination: 'ICN',
    departureDate: '2026-03-15',
    departureTime: '11:45 AM',
    surcharge: 75,
    cashAlternative: 4200,
  },
  {
    type: 'flight',
    fromBank: 'amex',
    fromBankName: 'Amex Membership Rewards',
    toProgram: 'DL',
    toProgramName: 'Delta SkyMiles',
    pointsToTransfer: 90000,
    transferTime: '1-2 business days',
    transferRatio: '1:1',
    flightNumber: 'DL159',
    origin: 'ICN',
    destination: 'JFK',
    departureDate: '2026-03-25',
    departureTime: '5:30 PM',
    surcharge: 70,
    cashAlternative: 4100,
  },
];

const mockSummary = {
  totalOutOfPocket: 145, // Sum of surcharges (75 + 70)
  allCashCost: 8300, // Sum of cash alternatives (4200 + 4100)
  savings: 8155,
  savingsPercentage: 98.3,
};

// European multi-city example
const europeTransfers: TransferItem[] = [
  {
    type: 'flight',
    fromBank: 'chase',
    fromBankName: 'Chase Ultimate Rewards',
    toProgram: 'AF',
    toProgramName: 'Air France Flying Blue',
    pointsToTransfer: 55000,
    transferTime: 'Instant',
    flightNumber: 'AF007',
    origin: 'JFK',
    destination: 'CDG',
    departureDate: '2026-06-01',
    departureTime: '7:00 PM',
    surcharge: 120,
    cashAlternative: 850,
  },
  {
    type: 'flight',
    fromBank: 'chase',
    fromBankName: 'Chase Ultimate Rewards',
    toProgram: 'IB',
    toProgramName: 'Iberia Plus',
    pointsToTransfer: 10000,
    transferTime: 'Instant',
    flightNumber: 'IB3260',
    origin: 'FCO',
    destination: 'BCN',
    departureDate: '2026-06-09',
    surcharge: 25,
    cashAlternative: 120,
  },
  {
    type: 'flight',
    fromBank: 'bilt',
    fromBankName: 'Bilt Rewards',
    toProgram: 'UA',
    toProgramName: 'United MileagePlus',
    pointsToTransfer: 60000,
    transferTime: 'Instant',
    flightNumber: 'UA63',
    origin: 'BCN',
    destination: 'JFK',
    departureDate: '2026-06-14',
    departureTime: '11:30 AM',
    surcharge: 45,
    cashAlternative: 780,
  },
];

const europeSummary = {
  totalOutOfPocket: 190, // Sum of surcharges (120 + 25 + 45)
  allCashCost: 1750, // Sum of cash alternatives (850 + 120 + 780)
  savings: 1560,
  savingsPercentage: 89.1,
};

export default function DemoTransferStrategy() {
  return (
    <div className="min-h-screen bg-slate-50 pb-20">
      {/* Header */}
      <div className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <Link
            href="/dashboard"
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-6 transition-colors"
          >
            <ArrowLeft className="w-5 h-5" />
            Back to Dashboard
          </Link>
          <h1 className="text-3xl font-bold text-slate-900">Transfer Strategy Demo</h1>
          <p className="text-slate-600 mt-2">
            Preview the transfer instructions component with mock data
          </p>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-6 py-12 space-y-16">
        {/* Example 1: Seoul Trip */}
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Example 1: Seoul Round Trip</h2>
          <p className="text-slate-600 mb-6">
            JFK → Seoul → JFK round trip flights
          </p>
          <TransferStrategyCard
            transfers={mockTransfers}
            summary={mockSummary}
          />
        </section>

        {/* Example 2: European Adventure */}
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Example 2: European Adventure</h2>
          <p className="text-slate-600 mb-6">
            JFK → Paris → Rome → Barcelona → JFK multi-city flights
          </p>
          <TransferStrategyCard
            transfers={europeTransfers}
            summary={europeSummary}
          />
        </section>

        {/* Example 3: Simple domestic without summary */}
        <section>
          <h2 className="text-2xl font-bold text-slate-900 mb-2">Example 3: Simple Domestic (No Summary)</h2>
          <p className="text-slate-600 mb-6">
            SFO → LAX round trip (shows card without summary)
          </p>
          <TransferStrategyCard
            transfers={[
              {
                type: 'flight',
                fromBank: 'chase',
                fromBankName: 'Chase Ultimate Rewards',
                toProgram: 'UA',
                toProgramName: 'United MileagePlus',
                pointsToTransfer: 12500,
                transferTime: 'Instant',
                flightNumber: 'UA234',
                origin: 'SFO',
                destination: 'LAX',
                departureDate: '2026-02-14',
                departureTime: '8:00 AM',
                surcharge: 5.60,
              },
              {
                type: 'flight',
                fromBank: 'amex',
                fromBankName: 'Amex Membership Rewards',
                toProgram: 'B6',
                toProgramName: 'JetBlue TrueBlue',
                pointsToTransfer: 8500,
                transferTime: '1-2 business days',
                flightNumber: 'B6789',
                origin: 'LAX',
                destination: 'SFO',
                departureDate: '2026-02-17',
                departureTime: '5:30 PM',
                surcharge: 5.60,
              },
            ]}
          />
        </section>

        {/* Usage notes */}
        <section className="bg-blue-50 border border-blue-200 rounded-2xl p-6">
          <h2 className="text-lg font-bold text-blue-900 mb-4">Developer Notes</h2>
          <div className="space-y-3 text-sm text-blue-800">
            <p>
              <strong>Component:</strong>{' '}
              <code className="bg-blue-100 px-1 rounded">
                {`<TransferStrategyCard transfers={[...]} summary={{...}} />`}
              </code>
            </p>
            <p>
              <strong>Import:</strong>{' '}
              <code className="bg-blue-100 px-1 rounded">
                {`import { TransferStrategyCard, type TransferItem } from '@/components/ui';`}
              </code>
            </p>
            <p>
              <strong>Features:</strong>
            </p>
            <ul className="list-disc list-inside ml-4 space-y-1">
              <li>Copy-paste ready one-liner transfer instructions</li>
              <li>Click to copy functionality</li>
              <li>Expandable step-by-step instructions</li>
              <li>Direct links to bank portals and airline booking sites</li>
              <li>Flight number, route, and date display</li>
              <li>Savings summary (optional)</li>
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}
