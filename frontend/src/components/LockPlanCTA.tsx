'use client';

import { Lock, Bookmark } from 'lucide-react';

interface LockPlanCTAProps {
  onLockPlan: () => void;
  isLocked?: boolean;
}

export default function LockPlanCTA({ onLockPlan, isLocked }: LockPlanCTAProps) {
  if (isLocked) {
    return (
      <div className="flex items-center gap-3 p-5 bg-emerald-50 border-2 border-emerald-200 rounded-xl">
        <div className="p-2 bg-emerald-100 rounded-lg">
          <Bookmark className="w-5 h-5 text-emerald-600" />
        </div>
        <div>
          <p className="font-semibold text-emerald-900">Plan locked</p>
          <p className="text-sm text-emerald-700">We&apos;ll remember this and watch for better options.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6">
      <button
        onClick={onLockPlan}
        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-slate-900 text-white rounded-xl font-semibold hover:bg-slate-800 transition-colors shadow-lg"
      >
        <Lock className="w-5 h-5" />
        Lock this plan
      </button>
      <p className="text-center text-xs text-slate-500 mt-2">
        We&apos;ll remember this decision and watch for better options.
      </p>
    </div>
  );
}
