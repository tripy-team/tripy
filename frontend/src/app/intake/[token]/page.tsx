'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import {
  Loader2,
  CheckCircle,
  XCircle,
  Send,
  ArrowLeft,
  ArrowRight,
  Check,
  LayoutList,
} from 'lucide-react';
import { IntakeForm } from '@/app/(app)/clients/[clientId]/intake/_components/intake-form';
import type { Client, ClientIntake } from '@/lib/api-client';

// ---------------------------------------------------------------------------
// Types shared by both views
// ---------------------------------------------------------------------------

interface Question {
  id: string;
  label: string;
  type: 'text' | 'textarea' | 'select';
  options?: string[];
}

interface FormSection {
  id: string;
  title: string;
  questions: Question[];
}

interface FormData {
  status: 'pending' | 'completed' | 'expired';
  recipientName?: string;
  formVariant?: string;
  groupSize?: number;
  questions?: Question[];
  sections?: FormSection[];
}

interface ProfileFillData {
  status: 'pending' | 'completed' | 'expired';
  clientName?: string;
  clientFirstName?: string;
  advisorName?: string;
  intake?: Partial<ClientIntake> | null;
}

// ---------------------------------------------------------------------------
// Variant titles for non-individual forms
// ---------------------------------------------------------------------------

const VARIANT_TITLES: Record<string, string> = {
  individual: 'Your Travel Preferences',
  group_member: 'Your Trip Preferences',
  group_organizer: 'Group Trip Details',
  business_policy: 'Company Travel Policy',
  business_traveler: 'Your Business Travel Preferences',
  custom_form: 'Travel Questions',
};

const VARIANT_SUBTITLES: Record<string, string> = {
  individual: 'Help your trip hacker understand how you like to travel.',
  group_member: 'Tell your trip hacker how you prefer to travel for this trip.',
  group_organizer: 'A few logistics questions to help plan your group trip.',
  business_policy: 'Share your company travel guidelines so your trip hacker can book within policy.',
  business_traveler: 'Tell your trip hacker your preferences for business travel.',
  custom_form: 'Your trip hacker has a few questions to help plan your trip.',
};

// ---------------------------------------------------------------------------
// Sectioned form component (for custom forms with sections)
// ---------------------------------------------------------------------------

function SectionedForm({
  sections,
  recipientName,
  answers,
  setAnswers,
  onSubmit,
  submitting,
  error,
}: {
  sections: FormSection[];
  recipientName?: string;
  answers: Record<string, string>;
  setAnswers: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  onSubmit: () => void;
  submitting: boolean;
  error: string | null;
}) {
  const [activeSection, setActiveSection] = useState(0);
  const currentSection = sections[activeSection];
  if (!currentSection) return null;

  const canGoNext = activeSection < sections.length - 1;
  const canGoPrev = activeSection > 0;

  const filledSections = sections.map((s) =>
    s.questions.some((q) => answers[q.id]?.trim()),
  );
  const completedSectionCount = filledSections.filter(Boolean).length;
  const progressPct = Math.round((completedSectionCount / sections.length) * 100);

  const isLastSection = activeSection === sections.length - 1;

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-4xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-lg">
            T
          </div>
          <h1 className="text-2xl font-bold text-slate-900">
            {recipientName ? `Hi ${recipientName.split(' ')[0]},` : 'Hi there,'}
          </h1>
          <p className="mt-1 text-lg font-medium text-slate-700">Travel Questions</p>
          <p className="mt-2 text-sm text-slate-500">
            Your trip hacker has a few questions to help plan your trip.
          </p>
        </div>

        {/* Progress Bar */}
        <div className="mb-6">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
            <span>
              {completedSectionCount} of {sections.length} sections
            </span>
            <span>{progressPct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200">
            <div
              className="h-full rounded-full bg-blue-600 transition-all duration-500"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        <div className="flex gap-6">
          {/* Section sidebar */}
          <nav className="hidden w-52 shrink-0 md:block">
            <div className="space-y-1">
              {sections.map((s, i) => {
                const isCurrent = i === activeSection;
                const isFilled = filledSections[i];
                return (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => setActiveSection(i)}
                    className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                      isCurrent
                        ? 'bg-blue-50 text-blue-700'
                        : isFilled
                          ? 'text-slate-700 hover:bg-slate-50'
                          : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                    }`}
                  >
                    <LayoutList
                      className={`h-4 w-4 ${
                        isCurrent
                          ? 'text-blue-600'
                          : isFilled
                            ? 'text-green-500'
                            : 'text-slate-300'
                      }`}
                    />
                    <span className="flex-1 truncate">{s.title || `Section ${i + 1}`}</span>
                    {isFilled && !isCurrent && (
                      <Check className="ml-auto h-3.5 w-3.5 text-green-500" />
                    )}
                  </button>
                );
              })}
            </div>
          </nav>

          {/* Questions content */}
          <div className="min-w-0 flex-1">
            {/* Mobile step indicator */}
            <div className="mb-4 flex items-center gap-2 md:hidden">
              <span className="rounded-full bg-blue-100 px-2.5 py-0.5 text-xs font-semibold text-blue-700">
                {activeSection + 1}/{sections.length}
              </span>
              <span className="text-sm font-medium text-slate-700">
                {currentSection.title || `Section ${activeSection + 1}`}
              </span>
            </div>

            <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="mb-6 flex items-center gap-2 text-lg font-semibold text-slate-900">
                <LayoutList className="h-5 w-5 text-blue-600" />
                {currentSection.title || `Section ${activeSection + 1}`}
              </h2>

              <div className="space-y-4">
                {currentSection.questions.map((q) => (
                  <div key={q.id}>
                    <label className="mb-2 block text-sm font-medium text-slate-800">
                      {q.label}
                    </label>
                    {q.type === 'select' && q.options ? (
                      <div className="grid grid-cols-2 gap-2">
                        {q.options.map((opt) => (
                          <button
                            key={opt}
                            type="button"
                            onClick={() =>
                              setAnswers((a) => ({ ...a, [q.id]: opt }))
                            }
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
                        onChange={(e) =>
                          setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                        }
                        rows={3}
                        className="block w-full resize-none rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                        placeholder="Your answer..."
                      />
                    ) : (
                      <input
                        type="text"
                        value={answers[q.id] ?? ''}
                        onChange={(e) =>
                          setAnswers((a) => ({ ...a, [q.id]: e.target.value }))
                        }
                        className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                        placeholder="Your answer..."
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* Navigation */}
            <div className="mt-6 flex items-center justify-between">
              <button
                type="button"
                onClick={() => canGoPrev && setActiveSection((s) => s - 1)}
                disabled={!canGoPrev}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <ArrowLeft className="h-4 w-4" />
                Previous
              </button>

              {isLastSection ? (
                <button
                  type="button"
                  onClick={onSubmit}
                  disabled={submitting}
                  className="inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Submitting...
                    </>
                  ) : (
                    <>
                      <Send className="h-4 w-4" />
                      Submit Responses
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  onClick={() => canGoNext && setActiveSection((s) => s + 1)}
                  disabled={!canGoNext}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Next
                  <ArrowRight className="h-4 w-4" />
                </button>
              )}
            </div>

            <p className="mt-4 text-center text-xs text-slate-400">
              Your responses are shared only with your trip hacker.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function IntakeFormPage() {
  const params = useParams();
  const token = params.token as string;

  // Phase 1: quick metadata fetch to determine variant
  const [variant, setVariant] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // State for simple (non-individual) forms
  const [formData, setFormData] = useState<FormData | null>(null);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  // State for individual (rich IntakeForm) mode
  const [profileData, setProfileData] = useState<ProfileFillData | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // First fetch the form metadata to determine variant
    fetch(`/api/intake/form/${token}`)
      .then((r) => r.json())
      .then((data: FormData) => {
        const v = data.formVariant ?? 'individual';
        setVariant(v);

        if (data.status === 'completed') {
          setSubmitted(true);
          setFormData(data);
          setLoading(false);
          return;
        }

        if (v === 'individual') {
          // For individual variant, fetch from profile-fill endpoint to get
          // intake data so we can render the rich IntakeForm.
          fetch(`/api/intake/profile-fill/${token}`)
            .then((r) => r.json())
            .then((pfData: ProfileFillData) => {
              if (pfData.status === 'completed') {
                setSubmitted(true);
              }
              setProfileData(pfData);
            })
            .catch(() => setError('Unable to load the form. Please try again.'))
            .finally(() => setLoading(false));
        } else {
          setFormData(data);
          setLoading(false);
        }
      })
      .catch(() => {
        setError('Unable to load the form. Please try again.');
        setLoading(false);
      });
  }, [token]);

  // Save handler for rich IntakeForm (autosave via PATCH)
  const handleProfileSave = useCallback(
    async (data: Record<string, unknown>) => {
      setSaving(true);
      try {
        const res = await fetch(`/api/intake/profile-fill/${token}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        });
        if (!res.ok) throw new Error('Save failed');
      } finally {
        setSaving(false);
      }
    },
    [token],
  );

  // Submit handler for simple (non-individual) forms
  const handleSimpleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
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

  // ── Loading ──
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  // ── Error ──
  if (error && !formData && !profileData) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  // ── Submitted ──
  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <CheckCircle className="mx-auto mb-4 h-12 w-12 text-emerald-500" />
          <h1 className="mb-2 text-xl font-semibold text-slate-900">All done!</h1>
          <p className="text-slate-500">
            Your responses have been submitted. Your trip hacker will review them shortly.
          </p>
        </div>
      </div>
    );
  }

  // ── Expired ──
  if (formData?.status === 'expired' || profileData?.status === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-slate-400" />
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Link expired</h1>
          <p className="text-slate-500">This intake form link has expired. Please ask your trip hacker to send a new one.</p>
        </div>
      </div>
    );
  }

  // ── Individual variant → rich IntakeForm (same as advisor view) ──
  if (variant === 'individual' && profileData) {
    const nameParts = (profileData.clientName ?? '').split(' ');
    const firstName = profileData.clientFirstName ?? nameParts[0] ?? '';
    const lastName = nameParts.slice(1).join(' ');
    const clientStub = {
      id: '',
      firstName,
      lastName,
      email: null,
    } as unknown as Client;

    return (
      <div className="min-h-screen bg-slate-50 py-10">
        <div className="mx-auto max-w-5xl px-4">
          <IntakeForm
            client={clientStub}
            initialData={profileData.intake ?? undefined}
            intakeId={token}
            isNew={false}
            saving={saving}
            onSave={handleProfileSave}
            onComplete={async () => setSubmitted(true)}
            onAnalyzed={() => setSubmitted(true)}
            onCancel={() => {}}
            publicMode={{ token }}
          />
        </div>
      </div>
    );
  }

  // ── Custom form with sections → sectioned step-by-step UI ──
  if (formData?.sections && formData.sections.length > 0) {
    return (
      <SectionedForm
        sections={formData.sections}
        recipientName={formData.recipientName}
        answers={answers}
        setAnswers={setAnswers}
        onSubmit={() => handleSimpleSubmit()}
        submitting={submitting}
        error={error}
      />
    );
  }

  // ── Non-individual variants → simple question form (legacy + standard) ──
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

  const variantKey = formData.formVariant ?? 'individual';
  const formTitle = VARIANT_TITLES[variantKey] ?? 'Travel Preferences';
  const subtitle = VARIANT_SUBTITLES[variantKey] ?? '';

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-white font-bold text-lg">T</div>
          <h1 className="text-2xl font-bold text-slate-900">
            {formData.recipientName ? `Hi ${formData.recipientName.split(' ')[0]},` : 'Hi there,'}
          </h1>
          <p className="mt-1 text-lg font-medium text-slate-700">{formTitle}</p>
          <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
        </div>

        {error && (
          <div className="mb-6 rounded-lg bg-red-50 p-4 text-sm text-red-700">{error}</div>
        )}

        <form onSubmit={handleSimpleSubmit} className="space-y-4">
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
            Your responses are shared only with your trip hacker.
          </p>
        </form>
      </div>
    </div>
  );
}
