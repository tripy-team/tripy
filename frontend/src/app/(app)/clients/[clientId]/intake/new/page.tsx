'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getClient, createClientIntake, getClientIntake, duplicateClientIntake } from '@/lib/api-client';
import type { Client, ClientIntake } from '@/lib/api-client';
import { IntakeForm } from '../_components/intake-form';

export default function NewIntakePage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = params.clientId as string;
  const duplicateFrom = searchParams.get('duplicateFrom');

  const [client, setClient] = useState<Client | null>(null);
  const [sourceIntake, setSourceIntake] = useState<ClientIntake | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    Promise.all([
      getClient(clientId),
      duplicateFrom ? getClientIntake(clientId, duplicateFrom) : Promise.resolve(null),
    ])
      .then(([c, source]) => {
        setClient(c);
        setSourceIntake(source);
      })
      .catch(() => router.push(`/clients/${clientId}`))
      .finally(() => setLoading(false));
  }, [clientId, duplicateFrom, router]);

  const handleCreate = async (data: Record<string, unknown>) => {
    setCreating(true);
    try {
      let intake: ClientIntake;
      if (duplicateFrom) {
        intake = await duplicateClientIntake(clientId, duplicateFrom);
        intake = await (await import('@/lib/api-client')).updateClientIntake(clientId, intake.id, data);
      } else {
        intake = await createClientIntake(clientId, data);
      }
      router.push(`/clients/${clientId}/intake/${intake.id}`);
    } catch {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading...</span>
      </div>
    );
  }

  if (!client) return null;

  return (
    <IntakeForm
      client={client}
      initialData={sourceIntake || undefined}
      isNew
      saving={creating}
      onSave={handleCreate}
      onCancel={() => router.push(`/clients/${clientId}`)}
    />
  );
}
