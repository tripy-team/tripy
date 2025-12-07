'use client';

import { X, DollarSign, Zap, Clock, TrendingUp, Calendar } from 'lucide-react';
import { RouteMap } from '@/components/RouteMap';

interface ItineraryDetailModalProps {
  itinerary: {
    id: number;
    name: string;
    route: string[];
    totalCost: number;
    pointsCost: number;
    totalDays: number;
    score: number;
  };
  onClose: () => void;
}

export function ItineraryDetailModal({ itinerary, onClose }: ItineraryDetailModalProps) {
  const breakdown = [
    { category: 'Flights', cash: 1850, points: 45000 },
    { category: 'Hotels', cash: 1200, points: 32500 },
    { category: 'Activities', cash: 400, points: 10000 },
  ];

  const transferSuggestions = [
    { from: 'Chase UR', to: 'United MileagePlus', points: 45000, value: '$675' },
    { from: 'Amex MR', to: 'Air France', points: 42500, value: '$637' },
  ];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b border-gray-200 p-6 flex items-center justify-between">
          <div>
            <h2 className="text-gray-900 mb-1">{itinerary.name}</h2>
            <p className="text-gray-600">{itinerary.route.join(' → ')}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-6">
          {/* Route Visualization */}
          <div>
            <h3 className="text-gray-900 mb-3">Route Overview</h3>
            <RouteMap cities={itinerary.route} />
          </div>

          {/* Cost Breakdown */}
          <div>
            <h3 className="text-gray-900 mb-3">Cost Breakdown</h3>
            <div className="bg-gray-50 rounded-xl p-4">
              <table className="w-full">
                <thead>
                  <tr className="text-left text-sm text-gray-600">
                    <th className="pb-3">Category</th>
                    <th className="pb-3 text-right">Cash</th>
                    <th className="pb-3 text-right">Points</th>
                  </tr>
                </thead>
                <tbody className="text-gray-900">
                  {breakdown.map((item, index) => (
                    <tr key={index} className="border-t border-gray-200">
                      <td className="py-3">{item.category}</td>
                      <td className="py-3 text-right">${item.cash.toLocaleString()}</td>
                      <td className="py-3 text-right">{item.points.toLocaleString()}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-gray-300">
                    <td className="py-3">Total</td>
                    <td className="py-3 text-right">${itinerary.totalCost.toLocaleString()}</td>
                    <td className="py-3 text-right">{itinerary.pointsCost.toLocaleString()}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Transfer Suggestions */}
          <div>
            <h3 className="text-gray-900 mb-3">Points Transfer Suggestions</h3>
            <div className="space-y-3">
              {transferSuggestions.map((suggestion, index) => (
                <div key={index} className="p-4 bg-blue-50 rounded-xl border border-blue-200">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-blue-600" />
                      <span className="text-gray-900">{suggestion.from} → {suggestion.to}</span>
                    </div>
                    <span className="text-sm text-blue-600">{suggestion.value} value</span>
                  </div>
                  <div className="text-sm text-gray-600">{suggestion.points.toLocaleString()} points recommended</div>
                </div>
              ))}
            </div>
          </div>

          {/* Time Allocation */}
          <div>
            <h3 className="text-gray-900 mb-3">Recommended Time per City</h3>
            <div className="space-y-3">
              {itinerary.route.map((city, index) => (
                <div key={index} className="flex items-center gap-4">
                  <div className="w-32 text-gray-900">{city}</div>
                  <div className="flex-1">
                    <input
                      type="range"
                      min="1"
                      max="5"
                      defaultValue="2"
                      className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-blue-600"
                    />
                  </div>
                  <div className="w-20 text-right text-gray-600">2 days</div>
                </div>
              ))}
            </div>
          </div>

          {/* Route Score */}
          <div>
            <h3 className="text-gray-900 mb-3">Route Score Analysis</h3>
            <div className="grid grid-cols-2 gap-4">
              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <DollarSign className="w-4 h-4" />
                  <span className="text-sm">Value for Money</span>
                </div>
                <div className="text-2xl text-gray-900">95/100</div>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <Clock className="w-4 h-4" />
                  <span className="text-sm">Time Efficiency</span>
                </div>
                <div className="text-2xl text-gray-900">88/100</div>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <Zap className="w-4 h-4" />
                  <span className="text-sm">Points Optimization</span>
                </div>
                <div className="text-2xl text-gray-900">92/100</div>
              </div>
              <div className="p-4 bg-gray-50 rounded-xl">
                <div className="flex items-center gap-2 text-gray-600 mb-2">
                  <TrendingUp className="w-4 h-4" />
                  <span className="text-sm">Flexibility</span>
                </div>
                <div className="text-2xl text-gray-900">90/100</div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
