'use client';

import { useState } from 'react';
import { Mail, X, Check, Loader2 } from 'lucide-react';
import { solo } from '@/lib/api';
import { trackEvent, EVENTS } from '@/lib/analytics';

interface EmailPlanModalProps {
  tripId: string;
  onClose: () => void;
}

export default function EmailPlanModal({ tripId, onClose }: EmailPlanModalProps) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const isValidEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValidEmail) return;

    setStatus('loading');
    trackEvent(EVENTS.EMAIL_PLAN_REQUESTED, { tripId, email });

    try {
      await solo.sharePlan(tripId, email);
      setStatus('success');
    } catch (err) {
      setStatus('error');
      setErrorMsg(err instanceof Error ? err.message : 'Failed to send. Try again.');
    }
  };

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-slate-100">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-100 rounded-xl flex items-center justify-center">
              <Mail className="w-5 h-5 text-blue-600" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-900">Email Me This Plan</h3>
              <p className="text-xs text-slate-500">Get a link to view this plan anytime</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        {/* Body */}
        <div className="p-5">
          {status === 'success' ? (
            <div className="text-center py-6">
              <div className="w-14 h-14 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-3">
                <Check className="w-7 h-7 text-green-600" />
              </div>
              <h4 className="font-semibold text-slate-900 mb-1">Link Sent!</h4>
              <p className="text-sm text-slate-600">
                Check your inbox at <strong>{email}</strong>. The link stays valid for 7 days.
              </p>
              <button
                onClick={onClose}
                className="mt-4 px-6 py-2.5 bg-slate-900 text-white rounded-xl font-medium text-sm hover:bg-slate-800 transition-colors"
              >
                Done
              </button>
            </div>
          ) : (
            <form onSubmit={handleSubmit}>
              <p className="text-sm text-slate-600 mb-4">
                No account needed. We&apos;ll send a link you can open on any device to see your plan.
              </p>
              <div className="relative">
                <input
                  type="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setStatus('idle'); }}
                  className="w-full px-4 py-3 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  autoFocus
                  disabled={status === 'loading'}
                />
              </div>
              {status === 'error' && (
                <p className="mt-2 text-xs text-red-600">{errorMsg}</p>
              )}
              <button
                type="submit"
                disabled={!isValidEmail || status === 'loading'}
                className="w-full mt-4 py-3 bg-blue-600 text-white rounded-xl font-medium text-sm hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center justify-center gap-2"
              >
                {status === 'loading' ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    Sending...
                  </>
                ) : (
                  <>
                    <Mail className="w-4 h-4" />
                    Send Link
                  </>
                )}
              </button>
              <p className="mt-3 text-xs text-slate-400 text-center">
                We only use your email for this link. No spam, ever.
              </p>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
