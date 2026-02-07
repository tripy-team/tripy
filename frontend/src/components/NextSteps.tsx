'use client';

import { ArrowRight, CreditCard, Plane, Camera, Bell } from 'lucide-react';

interface NextStepsProps {
  hasTransfers: boolean;
  isLocked?: boolean;
}

const STEPS_WITH_TRANSFERS = [
  {
    icon: CreditCard,
    title: 'Transfer your points',
    description: 'Move points from your bank to the airline program. This usually takes 1-3 days.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    icon: Plane,
    title: 'Book the flight',
    description: 'Once points arrive, search for the same flight on the airline\'s website and book with points.',
    color: 'text-indigo-600',
    bg: 'bg-indigo-50',
  },
  {
    icon: Camera,
    title: 'Save your confirmation',
    description: 'Screenshot your booking confirmation and transfer receipt. You\'ll need these if anything changes.',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    icon: Bell,
    title: 'We\'ll keep watching',
    description: 'If a better deal appears or prices drop, we\'ll let you know.',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
];

const STEPS_NO_TRANSFERS = [
  {
    icon: Plane,
    title: 'Book the flight',
    description: 'Head to the airline website and book your flight. Use the booking link we\'ve provided.',
    color: 'text-blue-600',
    bg: 'bg-blue-50',
  },
  {
    icon: Camera,
    title: 'Save your confirmation',
    description: 'Screenshot your booking confirmation number and payment receipt.',
    color: 'text-amber-600',
    bg: 'bg-amber-50',
  },
  {
    icon: Bell,
    title: 'We\'ll keep watching',
    description: 'If conditions change or a better option appears, we\'ll let you know.',
    color: 'text-emerald-600',
    bg: 'bg-emerald-50',
  },
];

export default function NextSteps({ hasTransfers, isLocked }: NextStepsProps) {
  const steps = hasTransfers ? STEPS_WITH_TRANSFERS : STEPS_NO_TRANSFERS;

  return (
    <div className="mt-8 p-6 bg-white border border-slate-200 rounded-2xl">
      <h3 className="text-lg font-semibold text-slate-900 mb-1">What happens next</h3>
      <p className="text-sm text-slate-500 mb-5">Follow these steps to complete your booking.</p>

      <div className="space-y-4">
        {steps.map((step, i) => (
          <div key={i} className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <div className={`p-2 ${step.bg} rounded-lg`}>
                <step.icon className={`w-5 h-5 ${step.color}`} />
              </div>
              {i < steps.length - 1 && (
                <div className="w-0.5 h-6 bg-slate-200 mt-1" />
              )}
            </div>
            <div className="flex-1 min-w-0 pb-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-400">STEP {i + 1}</span>
              </div>
              <h4 className="font-medium text-slate-900 mt-0.5">{step.title}</h4>
              <p className="text-sm text-slate-600 mt-0.5">{step.description}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
