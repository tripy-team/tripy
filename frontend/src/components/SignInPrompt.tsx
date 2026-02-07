'use client';

import { Bookmark, ArrowRight, X } from 'lucide-react';
import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface SignInPromptProps {
  trigger: 'lock' | 'save' | 'monitor';
  onDismiss: () => void;
  onContinueWithout?: () => void;
}

const PROMPT_COPY = {
  lock: {
    title: 'Want us to remember this and keep watching for you?',
    description: 'Sign in to lock your plan and get alerts if prices drop or better options appear.',
  },
  save: {
    title: 'Save this trip to your account',
    description: 'Sign in so you can access this plan later from any device.',
  },
  monitor: {
    title: 'Get notified about price changes',
    description: 'Sign in and we\'ll watch this route for you. We\'ll alert you if anything changes.',
  },
};

export default function SignInPrompt({ trigger, onDismiss, onContinueWithout }: SignInPromptProps) {
  const router = useRouter();
  const copy = PROMPT_COPY[trigger];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="relative p-6 pb-4">
          <button
            onClick={onDismiss}
            className="absolute top-4 right-4 p-1 text-slate-400 hover:text-slate-600 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
          <div className="flex items-center gap-3 mb-3">
            <div className="p-2 bg-blue-100 rounded-xl">
              <Bookmark className="w-5 h-5 text-blue-600" />
            </div>
          </div>
          <h2 className="text-xl font-bold text-slate-900 pr-8">{copy.title}</h2>
          <p className="text-sm text-slate-600 mt-2">{copy.description}</p>
        </div>

        {/* Actions */}
        <div className="p-6 pt-2 space-y-3">
          <button
            onClick={() => router.push('/login?redirect=' + encodeURIComponent(window.location.pathname + window.location.search))}
            className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-blue-600 text-white rounded-xl font-semibold hover:bg-blue-700 transition-colors"
          >
            Sign in to save
            <ArrowRight className="w-4 h-4" />
          </button>
          <button
            onClick={onContinueWithout || onDismiss}
            className="w-full px-5 py-3 text-sm text-slate-600 hover:text-slate-800 hover:bg-slate-50 rounded-xl transition-colors"
          >
            Continue without saving
          </button>
        </div>
      </div>
    </div>
  );
}
