'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { Loader2, CheckCircle } from 'lucide-react';
import { IntakeForm } from '@/app/(app)/clients/[clientId]/intake/_components/intake-form';
import type { Client, ClientIntake } from '@/lib/api-client';

interface LoadedForm {
  status: 'pending' | 'completed' | 'expired';
  clientName?: string;
  clientFirstName?: string;
  advisorName?: string;
  intake?: Partial<ClientIntake> | null;
}

export default function IntakeFillPage() {
  const params = useParams();
  const token = params.token as string;

  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState<LoadedForm | null>(null);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    fetch(`/api/intake/profile-fill/${token}`)
      .then((r) => r.json())
      .then((data: LoadedForm) => {
        setLoaded(data);
        if (data.status === 'completed') setSubmitted(true);
      })
      .catch(() => setError('Unable to load the form. Please try again.'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSave = useCallback(
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

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">Something went wrong</h1>
          <p className="mt-2 text-sm text-slate-600">{error}</p>
        </div>
      </div>
    );
  }

  if (loaded?.status === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-slate-900">This link has expired</h1>
          <p className="mt-2 text-sm text-slate-600">
            Please reach out to your trip hacker for a new invitation.
          </p>
        </div>
      </div>
    );
  }

  if (submitted) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 p-6">
        <div className="max-w-md rounded-2xl bg-white p-8 text-center shadow-sm">
          <CheckCircle className="mx-auto h-12 w-12 text-green-500" />
          <h1 className="mt-4 text-xl font-semibold text-slate-900">Form submitted</h1>
          <p className="mt-2 text-sm text-slate-600">
            Thanks! Your answers have been shared with {loaded?.advisorName || 'the trip organizer'}.
          </p>
        </div>
      </div>
    );
  }

  // Build a minimal Client stub for IntakeForm. It only reads display fields.
  const nameParts = (loaded?.clientName ?? '').split(' ');
  const firstName = loaded?.clientFirstName ?? nameParts[0] ?? '';
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
          initialData={loaded?.intake ?? undefined}
          intakeId={token}
          isNew={false}
          saving={saving}
          onSave={handleSave}
          onComplete={async () => setSubmitted(true)}
          onAnalyzed={() => setSubmitted(true)}
          onCancel={() => {}}
          publicMode={{ token }}
        />
      </div>
    </div>
  );
}
