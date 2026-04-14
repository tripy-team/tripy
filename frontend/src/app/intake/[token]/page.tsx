'use client';

import { useState, useEffect } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, CheckCircle, XCircle, Send } from 'lucide-react';

interface Question {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  options?: string[];
}

interface FormData {
  status: 'pending' | 'completed' | 'expired';
  recipientName?: string;
  formVariant?: string;
  groupSize?: number;
  questions?: Question[];
}

const VARIANT_TITLES: Record<string, string> = {
  individual: 'Your Travel Preferences',
  group_member: 'Your Trip Preferences',
  group_organizer: 'Group Trip Details',
  business_policy: 'Company Travel Policy',
  business_traveler: 'Your Business Travel Preferences',
  custom_form: 'Travel Questions',
};

const VARIANT_SUBTITLES: Record<string, string> = {
  individual: 'Help your advisor understand how you like to travel.',
  group_member: 'Tell your advisor how you prefer to travel for this trip.',
  group_organizer: 'A few logistics questions to help plan your group trip.',
  business_policy: 'Share your company travel guidelines so your advisor can book within policy.',
  business_traveler: 'Tell your advisor your preferences for business travel.',
  custom_form: 'Your advisor has a few questions to help plan your trip.',
};

export default function IntakeFormPage() {
  const params = useParams();
  const token = params.token as string;

  const [formData, setFormData] = useState<FormData | null>(null);
  const [loading, setLoading] = useState(true);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/intake/form/${token}`)
      .then((r) => r.json())
      .then((data: FormData) => {
        setFormData(data);
        if (data.status === 'completed') setSubmitted(true);
      })
      .catch(() => setError('Unable to load the form. Please try again.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/intake/form/${token}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? 'Submission failed');
      }
      setSubmitted(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Submission failed. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (submitted || formData?.status === 'completed') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
          <h1 className="mb-2 text-xl font-semibold text-slate-900">All done!</h1>
          <p className="text-slate-500">Your responses have been submitted. Your advisor will review them shortly.</p>
        </div>
      </div>
    );
  }

  if (formData?.status === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-slate-400" />
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Link expired</h1>
          <p className="text-slate-500">This intake form link has expired. Please ask your advisor to send a new one.</p>
        </div>
      </div>
    );
  }

  if (!formData || !formData.questions) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Form not found</h1>
          <p className="text-slate-500">This link is invalid or has been revoked.</p>
        </div>
      </div>
    );
  }

  const variant = formData.formVariant ?? 'individual';
  const title = VARIANT_TITLES[variant] ?? 'Travel Preferences';
  const subtitle = VARIANT_SUBTITLES[variant] ?? '';

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-lg">T</div>
          <h1 className="text-2xl font-bold text-slate-900">
            {formData.recipientName ? `Hi ${formData.recipientName.split(' ')[0]},` : 'Hi there,'}
          </h1>
          <p className="mt-1 text-lg font-medium text-slate-700">{title}</p>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {formData.questions.map((q) => (
            <div key={q.id} className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
              <label className="mb-2 block text-sm font-medium text-slate-800">{q.label}</label>
              {q.type === 'select' && q.options ? (
                <div className="grid grid-cols-2 gap-2">
                  {q.options.map((opt) => (
                    <button
                      key={opt}
                      type="button"
                      onClick={() => setAnswers((a) => ({ ...a, [q.id]: opt }))}
                      className={`rounded-lg border-2 px-3 py-2 text-left text-sm transition-all ${
                        answers[q.id] === opt
                          ? 'border-blue-600 bg-blue-50 font-medium text-blue-900'
                          : 'border-slate-200 text-slate-700 hover:border-slate-300'
                      }`}
                    >
                      {opt}
                    </button>
                  ))}
                </div>
              ) : q.type === 'textarea' ? (
                <textarea
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  rows={3}
                  className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="Your answer..."
                />
              ) : (
                <input
                  type="text"
                  value={answers[q.id] ?? ''}
                  onChange={(e) => setAnswers((a) => ({ ...a, [q.id]: e.target.value }))}
                  className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  placeholder="Your answer..."
                />
              )}
            </div>
          ))}

          <button
            type="submit"
            disabled={submitting}
            className="flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-3.5 font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 animate-spin" />Submitting...</>
            ) : (
              <><Send className="h-4 w-4" />Submit Responses</>
            )}
          </button>

          <p className="text-center text-xs text-slate-400">
            Your responses are shared only with your advisor.
          </p>
        </form>
      </div>
    </div>
  );
}
