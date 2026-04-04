'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getClient, getClientIntake, updateClientIntake } from '@/lib/api-client';
import type { Client, ClientIntake } from '@/lib/api-client';
import { IntakeForm } from '../_components/intake-form';

export default function EditIntakePage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;
  const intakeId = params.intakeId as string;

  const [client, setClient] = useState<Client | null>(null);
  const [intake, setIntake] = useState<ClientIntake | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([getClient(clientId), getClientIntake(clientId, intakeId)])
      .then(([c, i]) => {
        setClient(c);
        setIntake(i);
      })
      .catch(() => router.push(`/clients/${clientId}`))
      .finally(() => setLoading(false));
  }, [clientId, intakeId, router]);

  const handleSave = useCallback(
    async (data: Record<string, unknown>) => {
      setSaving(true);
      try {
        const updated = await updateClientIntake(clientId, intakeId, data);
        setIntake(updated);
      } finally {
        setSaving(false);
      }
    },
    [clientId, intakeId],
  );

  const handleComplete = useCallback(
    async (data: Record<string, unknown>) => {
      setSaving(true);
      try {
        const updated = await updateClientIntake(clientId, intakeId, {
          ...data,
          status: 'complete',
        });
        setIntake(updated);
        router.push(`/clients/${clientId}?tab=intake`);
      } finally {
        setSaving(false);
      }
    },
    [clientId, intakeId, router],
  );

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading intake...</span>
      </div>
    );
  }

  if (!client || !intake) return null;

  return (
    <IntakeForm
      client={client}
      initialData={intake}
      saving={saving}
      onSave={handleSave}
      onComplete={handleComplete}
      onCancel={() => router.push(`/clients/${clientId}?tab=intake`)}
    />
  );
}
