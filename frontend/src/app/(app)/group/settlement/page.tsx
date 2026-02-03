'use client';

/**
 * Group Settlement Page
 * 
 * Displays settlement configuration and cost-splitting for group trips only.
 * Shows who owes what, reimbursement instructions, and allows policy configuration.
 */

import { Suspense, useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  ArrowLeft, 
  Users, 
  DollarSign, 
  Settings,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { trips as tripsAPI, Trip } from '@/lib/api';
import { SettlementView } from '@/components/group/SettlementView';

function GroupSettlementContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tripId = searchParams?.get('tripId') || searchParams?.get('trip_id') || '';
  
  const [trip, setTrip] = useState<Trip | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTrip = async () => {
      if (!tripId) {
        setError('No trip ID provided');
        setIsLoading(false);
        return;
      }

      try {
        const tripData = await tripsAPI.get(tripId);
        setTrip(tripData);
      } catch (err) {
        console.error('Error fetching trip:', err);
        setError(err instanceof Error ? err.message : 'Failed to load trip');
      } finally {
        setIsLoading(false);
      }
    };

    fetchTrip();
  }, [tripId]);

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading settlement...</p>
        </div>
      </div>
    );
  }

  if (error || !trip) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
        <div className="text-center max-w-md">
          <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <AlertCircle className="w-8 h-8 text-red-600" />
          </div>
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Unable to Load Settlement</h2>
          <p className="text-slate-600 mb-6">{error || 'Trip not found'}</p>
          <button
            onClick={() => router.push('/my-trips')}
            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
          >
            Go to My Trips
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-4xl mx-auto">
        {/* Header */}
        <div className="mb-8">
          <button
            onClick={() => router.push(`/group/dashboard?tripId=${tripId}`)}
            className="flex items-center gap-2 text-slate-600 hover:text-slate-900 mb-4"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Dashboard
          </button>
          
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
              <DollarSign className="w-5 h-5 text-green-600" />
            </div>
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-green-100 rounded-full text-sm text-green-700 font-medium">
                <Users className="w-4 h-4" />
                <span>Group Settlement</span>
              </div>
            </div>
          </div>
          
          <h1 className="text-3xl font-bold text-slate-900 mt-4">
            {trip.title || 'Group Trip'} - Settlement
          </h1>
          <p className="text-slate-600 mt-2">
            Configure how costs are split and see who owes what
          </p>
        </div>

        {/* Settlement View Component */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <SettlementView 
            tripId={tripId} 
            onConfigChange={() => {
              // Could refresh data or show notification
              console.log('Settlement config changed');
            }}
          />
        </div>

        {/* Help Section */}
        <div className="mt-8 bg-blue-50 border border-blue-200 rounded-2xl p-6">
          <div className="flex items-start gap-4">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center flex-shrink-0">
              <Settings className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900 mb-2">How Settlement Works</h3>
              <ul className="text-sm text-slate-600 space-y-2">
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">1</span>
                  <span><strong>Choose a policy</strong> - Decide how costs should be split (equally, per passenger, by household, etc.)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">2</span>
                  <span><strong>Points valuation</strong> - Toggle whether points used count as contributions (at market value)</span>
                </li>
                <li className="flex items-start gap-2">
                  <span className="w-5 h-5 bg-blue-200 text-blue-700 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0">3</span>
                  <span><strong>See who owes what</strong> - Tripy calculates exact reimbursement amounts</span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GroupSettlement() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
        <div className="text-center">
          <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
          <p className="text-slate-600">Loading...</p>
        </div>
      </div>
    }>
      <GroupSettlementContent />
    </Suspense>
  );
}
