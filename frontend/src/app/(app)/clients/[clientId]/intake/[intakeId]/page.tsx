'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { getClient, getClientIntake, updateClientIntake, mergeIntakeIntoPreferences } from '@/lib/api-client';
import type { Client, ClientIntake } from '@/lib/api-client';
import { IntakeForm } from '../_components/intake-form';

function mapIntakeToPreferences(data: Record<string, unknown>): Record<string, unknown> {
  const prefs: Record<string, unknown> = {};

  if (data.cabinPreference) prefs.preferredCabin = data.cabinPreference;
  if (data.hotelStyles) prefs.preferredHotelTypes = data.hotelStyles;
  if (data.accessibilityNeeds) prefs.accessibilityNeeds = data.accessibilityNeeds;
  if (data.dealbreakers) prefs.dealbreakers = data.dealbreakers;
  if (data.preferredAirlines) prefs.preferredAirlines = data.preferredAirlines;
  if (data.avoidedAirlines) prefs.avoidedAirlines = data.avoidedAirlines;
  if (data.notes) prefs.notes = data.notes;

  if (data.dietaryNeeds) {
    prefs.foodPreferences = Array.isArray(data.dietaryNeeds)
      ? data.dietaryNeeds
      : [data.dietaryNeeds as string];
  }
  if (data.desiredExperiences) prefs.activityPreferences = data.desiredExperiences;
  if (data.luxuryPreference) prefs.budgetSensitivity = data.luxuryPreference;

  if (data.layoverTolerance) {
    switch (data.layoverTolerance) {
      case 'nonstop_only':
        prefs.prefersNonstop = true;
        prefs.maxLayoverMinutes = 0;
        break;
      case 'prefer_nonstop':
        prefs.prefersNonstop = true;
        break;
      case 'no_preference':
      case 'layovers_ok':
        prefs.prefersNonstop = false;
        break;
    }
  }

  const familyParts: string[] = [];
  if (data.familyFriendly) familyParts.push('Family-friendly required');
  if (Array.isArray(data.childrenAges) && data.childrenAges.length > 0) {
    familyParts.push(`Children ages: ${(data.childrenAges as string[]).join(', ')}`);
  }
  if (familyParts.length > 0) prefs.familyConsiderations = familyParts.join('. ');

  return prefs;
}

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

        // Auto-merge intake answers into the client's preference profile
        try {
          const prefData = mapIntakeToPreferences(data);
          if (Object.keys(prefData).length > 0) {
            await mergeIntakeIntoPreferences(clientId, prefData, 'merge');
          }
        } catch {
          // Non-fatal: preferences merge failure should not block navigation
        }

        router.push(`/clients/${clientId}?tab=preferences`);
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
      intakeId={intakeId}
      saving={saving}
      onSave={handleSave}
      onComplete={handleComplete}
      onCancel={() => router.push(`/clients/${clientId}?tab=discovery`)}
    />
  );
}
