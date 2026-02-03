'use client';

/**
 * Settlement View Component (Task 19)
 * 
 * Displays the complete settlement breakdown for a group trip:
 * - What each passenger should owe
 * - What each member actually paid (points + cash)
 * - Net balance per member
 * - Reimbursement instructions
 * 
 * Uses "pay your own" policy - each person pays for their own travelers.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  ArrowRight, 
  Check, 
  AlertCircle,
  Info,
} from 'lucide-react';
import type { 
  SettlementResult, 
  MemberBalance,
  ReimbursementTransfer,
} from '@/lib/api';
import { settlement } from '@/lib/api';

interface SettlementViewProps {
  tripId: string;
}

export function SettlementView({ tripId }: SettlementViewProps) {
  const [result, setResult] = useState<SettlementResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Load settlement preview with "pay_your_own" policy
  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      
      // Always use "pay_your_own" policy - each person pays for their own travelers
      const previewData = await settlement.preview(tripId, 'pay_your_own', true);
      setResult(previewData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settlement');
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  if (loading) {
    return (
      <div className="p-6 text-center text-gray-500">
        <div className="animate-spin h-8 w-8 border-2 border-green-500 border-t-transparent rounded-full mx-auto mb-2" />
        Loading settlement...
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <AlertCircle className="w-8 h-8 text-red-500 mx-auto mb-2" />
        <p className="text-red-600">{error}</p>
        <button 
          onClick={loadData}
          className="mt-2 text-sm text-green-600 hover:underline"
        >
          Try again
        </button>
      </div>
    );
  }

  if (!result) {
    return null;
  }

  const netBalances = Object.values(result.net_balance_by_member);
  const transfers = result.reimbursement_transfers;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h2 className="text-xl font-semibold">Settlement</h2>
        <p className="text-sm text-gray-500">
          See who owes what and how to settle up
        </p>
      </div>

      {/* Summary Card */}
      <div className="bg-white rounded-lg border p-4">
        <h3 className="font-medium mb-4">Trip Cost Summary</h3>
        
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-2xl font-bold text-gray-900">
              ${result.summary.total_trip_cost.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Total Trip Cost</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-green-600">
              ${result.summary.total_cash_paid.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Cash Paid</p>
          </div>
          <div>
            <p className="text-2xl font-bold text-blue-600">
              ${result.summary.total_points_value.toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">Points Value</p>
          </div>
        </div>
      </div>

      {/* Member Balances */}
      <div className="bg-white rounded-lg border">
        <div className="p-4 border-b">
          <h3 className="font-medium">Member Balances</h3>
          <p className="text-sm text-gray-500">
            What each person owes vs what they paid
          </p>
        </div>
        
        <div className="divide-y">
          {netBalances.map((balance) => (
            <MemberBalanceRow key={balance.user_id} balance={balance} />
          ))}
        </div>
      </div>

      {/* Reimbursement Transfers */}
      {transfers.length > 0 && (
        <div className="bg-white rounded-lg border">
          <div className="p-4 border-b">
            <h3 className="font-medium">Who Owes Whom</h3>
            <p className="text-sm text-gray-500">
              Payments needed to settle up
            </p>
          </div>
          
          <div className="p-4 space-y-3">
            {transfers.map((transfer, idx) => (
              <TransferRow key={idx} transfer={transfer} />
            ))}
          </div>
        </div>
      )}

      {/* All Settled */}
      {transfers.length === 0 && netBalances.length > 0 && (
        <div className="bg-green-50 border border-green-200 rounded-lg p-4 text-center">
          <Check className="w-8 h-8 text-green-600 mx-auto mb-2" />
          <p className="font-medium text-green-800">All Settled!</p>
          <p className="text-sm text-green-600">
            Everyone has paid their fair share. No reimbursements needed.
          </p>
        </div>
      )}

      {/* Policy Explanation */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
        <div className="flex items-start gap-3">
          <Info className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
          <div>
            <p className="font-medium text-blue-900">Pay Your Own</p>
            <p className="text-sm text-blue-700 mt-1">
              Each person pays for their own travelers. Points used are valued at market rate.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Member Balance Row Component
function MemberBalanceRow({ balance }: { balance: MemberBalance }) {
  const statusColors = {
    owes: 'text-red-600 bg-red-50',
    owed: 'text-green-600 bg-green-50',
    settled: 'text-gray-600 bg-gray-50',
  };

  const statusText = {
    owes: `Owes $${Math.abs(balance.net_balance).toFixed(2)}`,
    owed: `Owed $${Math.abs(balance.net_balance).toFixed(2)}`,
    settled: 'Settled',
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-sm font-medium">
            {balance.name.charAt(0).toUpperCase()}
          </div>
          <div>
            <p className="font-medium">{balance.name}</p>
            <p className="text-xs text-gray-500">
              {balance.passengers.length} passenger{balance.passengers.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>
        <span className={`px-2 py-1 rounded text-sm font-medium ${statusColors[balance.status]}`}>
          {statusText[balance.status]}
        </span>
      </div>
      
      <div className="grid grid-cols-3 gap-2 text-sm">
        <div className="bg-gray-50 rounded p-2">
          <p className="text-xs text-gray-500">Should Pay</p>
          <p className="font-medium">${balance.obligation_usd.toFixed(2)}</p>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <p className="text-xs text-gray-500">Cash Paid</p>
          <p className="font-medium">${balance.cash_paid.toFixed(2)}</p>
        </div>
        <div className="bg-gray-50 rounded p-2">
          <p className="text-xs text-gray-500">Points Value</p>
          <p className="font-medium text-blue-600">${balance.points_value.toFixed(2)}</p>
        </div>
      </div>
    </div>
  );
}

// Transfer Row Component
function TransferRow({ transfer }: { transfer: ReimbursementTransfer }) {
  return (
    <div className="flex items-center justify-between bg-gray-50 rounded-lg p-3">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center text-sm font-medium">
          {transfer.from_name.charAt(0).toUpperCase()}
        </div>
        <ArrowRight className="w-4 h-4 text-gray-400" />
        <div className="w-8 h-8 rounded-full bg-green-100 text-green-600 flex items-center justify-center text-sm font-medium">
          {transfer.to_name.charAt(0).toUpperCase()}
        </div>
      </div>
      
      <div className="text-right">
        <p className="font-bold text-lg">${transfer.amount_usd.toFixed(2)}</p>
        <p className="text-xs text-gray-500">
          {transfer.from_name} → {transfer.to_name}
        </p>
      </div>
    </div>
  );
}

export default SettlementView;
