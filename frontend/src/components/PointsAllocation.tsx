'use client';

import { useState, useEffect } from 'react';
import { CreditCard, Plane, Hotel, TrendingUp, Zap, DollarSign } from 'lucide-react';
import { getProgramCategory, type ProgramCategory } from '@/lib/loyalty-programs';

interface PointsAllocationProps {
  availablePoints: Array<{
    program: string;
    points: number;
    id?: string;
  }>;
  allocatedPoints?: Record<string, number>; // program -> allocated amount
  onAllocationChange?: (allocations: Record<string, number>) => void;
  maxTotalPoints?: number; // Optional limit on total allocation
  showCategoryIcons?: boolean;
  className?: string;
}

const getCategoryIcon = (category: ProgramCategory) => {
  switch (category) {
    case 'credit':
      return CreditCard;
    case 'airline':
      return Plane;
    case 'hotel':
      return Hotel;
    default:
      return CreditCard;
  }
};

const getCategoryColor = (category: ProgramCategory) => {
  switch (category) {
    case 'credit':
      return 'bg-blue-50 border-blue-200 text-blue-900';
    case 'airline':
      return 'bg-purple-50 border-purple-200 text-purple-900';
    case 'hotel':
      return 'bg-orange-50 border-orange-200 text-orange-900';
    default:
      return 'bg-slate-50 border-slate-200 text-slate-900';
  }
};

export default function PointsAllocation({
  availablePoints,
  allocatedPoints: initialAllocatedPoints,
  onAllocationChange,
  maxTotalPoints,
  showCategoryIcons = true,
  className = '',
}: PointsAllocationProps) {
  const [allocatedPoints, setAllocatedPoints] = useState<Record<string, number>>(
    initialAllocatedPoints || {}
  );

  // Initialize allocations to 0 if not provided
  useEffect(() => {
    const initial: Record<string, number> = {};
    availablePoints.forEach(({ program }) => {
      initial[program] = initialAllocatedPoints?.[program] || 0;
    });
    setAllocatedPoints(initial);
  }, [availablePoints, initialAllocatedPoints]);

  const handleAllocationChange = (program: string, value: number) => {
    const programData = availablePoints.find((p) => p.program === program);
    if (!programData) return;

    // Clamp value between 0 and available points
    const maxPoints = programData.points;
    const clampedValue = Math.max(0, Math.min(value, maxPoints));

    // Check total allocation limit if set
    const currentTotal = Object.values(allocatedPoints).reduce((sum, val) => sum + val, 0);
    const newTotal = currentTotal - (allocatedPoints[program] || 0) + clampedValue;
    
    if (maxTotalPoints && newTotal > maxTotalPoints) {
      // Adjust to fit within limit
      const remaining = maxTotalPoints - (currentTotal - (allocatedPoints[program] || 0));
      const adjustedValue = Math.max(0, Math.min(clampedValue, remaining));
      setAllocatedPoints((prev) => {
        const updated = { ...prev, [program]: adjustedValue };
        onAllocationChange?.(updated);
        return updated;
      });
    } else {
      setAllocatedPoints((prev) => {
        const updated = { ...prev, [program]: clampedValue };
        onAllocationChange?.(updated);
        return updated;
      });
    }
  };

  const handleSliderChange = (program: string, value: string) => {
    handleAllocationChange(program, parseInt(value) || 0);
  };

  const handleInputChange = (program: string, value: string) => {
    const numValue = parseInt(value.replace(/,/g, '')) || 0;
    handleAllocationChange(program, numValue);
  };

  const totalAllocated = Object.values(allocatedPoints).reduce((sum, val) => sum + val, 0);
  const totalAvailable = availablePoints.reduce((sum, p) => sum + p.points, 0);

  // Group by category
  const groupedPoints = availablePoints.reduce((acc, point) => {
    const category = getProgramCategory(point.program) || 'credit';
    if (!acc[category]) {
      acc[category] = [];
    }
    acc[category].push(point);
    return acc;
  }, {} as Record<ProgramCategory, typeof availablePoints>);

  const categories: ProgramCategory[] = ['credit', 'airline', 'hotel'];

  return (
    <div className={`space-y-6 ${className}`}>
      {/* Summary Header */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6">
        <div className="grid md:grid-cols-3 gap-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <Zap className="w-5 h-5 text-slate-600" />
              <span className="text-sm text-slate-600">Total Allocated</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">
              {totalAllocated.toLocaleString()}
            </div>
            {maxTotalPoints && (
              <div className="text-sm text-slate-500 mt-1">
                of {maxTotalPoints.toLocaleString()} max
              </div>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-slate-600" />
              <span className="text-sm text-slate-600">Available</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">
              {totalAvailable.toLocaleString()}
            </div>
            <div className="text-sm text-slate-500 mt-1">
              {(totalAvailable - totalAllocated).toLocaleString()} remaining
            </div>
          </div>
          <div>
            <div className="flex items-center gap-2 mb-2">
              <DollarSign className="w-5 h-5 text-slate-600" />
              <span className="text-sm text-slate-600">Allocation %</span>
            </div>
            <div className="text-3xl font-bold text-slate-900">
              {totalAvailable > 0
                ? ((totalAllocated / totalAvailable) * 100).toFixed(1)
                : 0}%
            </div>
          </div>
        </div>
      </div>

      {/* Points by Category */}
      {categories.map((category) => {
        const points = groupedPoints[category] || [];
        if (points.length === 0) return null;

        const Icon = showCategoryIcons ? getCategoryIcon(category) : CreditCard;
        const categoryColor = getCategoryColor(category);

        return (
          <div key={category} className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className={`p-4 border-b border-slate-200 ${categoryColor}`}>
              <div className="flex items-center gap-3">
                <Icon className="w-5 h-5" />
                <h3 className="text-lg font-semibold capitalize">{category} Programs</h3>
                <span className="text-sm opacity-75">
                  ({points.reduce((sum, p) => sum + (allocatedPoints[p.program] || 0), 0).toLocaleString()} allocated)
                </span>
              </div>
            </div>

            <div className="divide-y divide-slate-200">
              {points.map((point) => {
                const allocated = allocatedPoints[point.program] || 0;
                const remaining = point.points - allocated;
                const percentage = point.points > 0 ? (allocated / point.points) * 100 : 0;

                return (
                  <div key={point.program} className="p-6 hover:bg-slate-50 transition-colors">
                    <div className="space-y-4">
                      {/* Program Header */}
                      <div className="flex items-start justify-between">
                        <div className="flex-1">
                          <h4 className="text-base font-semibold text-slate-900 mb-1">
                            {point.program}
                          </h4>
                          <div className="flex items-center gap-4 text-sm text-slate-600">
                            <span>Available: {point.points.toLocaleString()} pts</span>
                            <span>Allocated: {allocated.toLocaleString()} pts</span>
                            <span className="text-slate-500">
                              Remaining: {remaining.toLocaleString()} pts
                            </span>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold text-slate-900">
                            {allocated.toLocaleString()}
                          </div>
                          <div className="text-xs text-slate-500">points</div>
                        </div>
                      </div>

                      {/* Progress Bar */}
                      <div className="w-full bg-slate-200 rounded-full h-2">
                        <div
                          className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                          style={{ width: `${Math.min(percentage, 100)}%` }}
                        />
                      </div>

                      {/* Controls */}
                      <div className="grid md:grid-cols-2 gap-4">
                        {/* Slider */}
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-700">
                            Allocate Points
                          </label>
                          <input
                            type="range"
                            min="0"
                            max={point.points}
                            step={Math.max(1, Math.floor(point.points / 100))}
                            value={allocated}
                            onChange={(e) => handleSliderChange(point.program, e.target.value)}
                            className="w-full h-2 bg-slate-200 rounded-full appearance-none cursor-pointer accent-blue-600"
                          />
                          <div className="flex justify-between text-xs text-slate-500">
                            <span>0</span>
                            <span>{point.points.toLocaleString()}</span>
                          </div>
                        </div>

                        {/* Input */}
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-slate-700">
                            Enter Amount
                          </label>
                          <div className="relative">
                            <input
                              type="text"
                              value={allocated.toLocaleString()}
                              onChange={(e) => handleInputChange(point.program, e.target.value)}
                              className="w-full px-4 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-slate-900"
                              placeholder="0"
                            />
                            <div className="absolute right-3 top-1/2 -translate-y-1/2 text-sm text-slate-500">
                              pts
                            </div>
                          </div>
                        </div>
                      </div>

                      {/* Quick Actions */}
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleAllocationChange(point.program, 0)}
                          className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                          Clear
                        </button>
                        <button
                          onClick={() => handleAllocationChange(point.program, point.points)}
                          className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                        >
                          Use All
                        </button>
                        <button
                          onClick={() =>
                            handleAllocationChange(point.program, Math.floor(point.points * 0.5))
                          }
                          className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                          Use 50%
                        </button>
                        <button
                          onClick={() =>
                            handleAllocationChange(point.program, Math.floor(point.points * 0.25))
                          }
                          className="px-3 py-1.5 text-sm bg-slate-100 text-slate-700 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                          Use 25%
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Warning if over limit */}
      {maxTotalPoints && totalAllocated > maxTotalPoints && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4">
          <div className="flex items-center gap-2 text-red-800">
            <span className="font-semibold">Warning:</span>
            <span>
              Total allocation ({totalAllocated.toLocaleString()}) exceeds maximum (
              {maxTotalPoints.toLocaleString()})
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
