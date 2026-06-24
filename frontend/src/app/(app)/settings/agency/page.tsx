'use client';

import { useEffect, useState } from 'react';
import { orgs } from '@/lib/api';

interface AgencyPrefs {
  default_cabin_preference: string | null;
  acceptable_connection_mins: number;
  max_stops: number;
  self_transfer_policy: string;
  separate_ticket_policy: string;
  preferred_airlines: string[];
  blocked_airlines: string[];
  preferred_alliances: string[];
  min_savings_to_recommend_points: number;
  default_proposal_greeting: string;
  default_booking_disclaimer: string;
}

interface BrandingConfig {
  brand_name: string;
  brand_color: string;
  accent_color: string;
  logo_url: string;
  font_family: string;
  email_from_name: string;
  hide_tripy: boolean;
}

const CABIN_OPTIONS = ['economy', 'premium_economy', 'business', 'first', 'flexible'];
const POLICY_OPTIONS = ['never', 'warn', 'allow'];

export default function AgencySettingsPage() {
  const [prefs, setPrefs] = useState<AgencyPrefs>({
    default_cabin_preference: null,
    acceptable_connection_mins: 90,
    max_stops: 2,
    self_transfer_policy: 'warn',
    separate_ticket_policy: 'warn',
    preferred_airlines: [],
    blocked_airlines: [],
    preferred_alliances: [],
    min_savings_to_recommend_points: 50,
    default_proposal_greeting: '',
    default_booking_disclaimer: '',
  });

  const [branding, setBranding] = useState<BrandingConfig>({
    brand_name: '',
    brand_color: '#1a56db',
    accent_color: '',
    logo_url: '',
    font_family: '',
    email_from_name: '',
    hide_tripy: false,
  });

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    orgs.getMyOrg().then((org) => {
      const orgAny = org as unknown as Record<string, unknown>;
      const raw = orgAny.agencyPreferences as AgencyPrefs | undefined;
      if (raw) setPrefs({ ...prefs, ...raw });

      const b = orgAny.branding as BrandingConfig | undefined;
      if (b) setBranding({ ...branding, ...b });
    }).catch(console.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const prefsPayload: Record<string, unknown> = {};
      Object.entries(prefs).forEach(([k, v]) => {
        if (v !== null && v !== undefined && v !== '') prefsPayload[k] = v;
      });

      await fetch(`${process.env.NEXT_PUBLIC_BACKEND_URL}/orgs/preferences`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${sessionStorage.getItem('access_token') || localStorage.getItem('access_token')}`,
        },
        body: JSON.stringify(prefsPayload),
      });

      await orgs.updateBranding({
        brandName: branding.brand_name || undefined,
        brandColor: branding.brand_color || undefined,
        logoUrl: branding.logo_url || undefined,
      });

      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    } catch (e) {
      console.error('Save failed:', e);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-2xl font-bold text-gray-900 mb-2">Agency Settings</h1>
      <p className="text-sm text-gray-500 mb-8">
        Configure agency-wide defaults and branding for your practice
      </p>

      {/* Branding */}
      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Branding</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand Name</label>
            <input
              type="text"
              value={branding.brand_name}
              onChange={(e) => setBranding({ ...branding, brand_name: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Your Agency Name"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Brand Color</label>
            <div className="flex gap-2">
              <input
                type="color"
                value={branding.brand_color}
                onChange={(e) => setBranding({ ...branding, brand_color: e.target.value })}
                className="h-10 w-12 cursor-pointer rounded border border-gray-300"
              />
              <input
                type="text"
                value={branding.brand_color}
                onChange={(e) => setBranding({ ...branding, brand_color: e.target.value })}
                className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Logo URL</label>
            <input
              type="text"
              value={branding.logo_url}
              onChange={(e) => setBranding({ ...branding, logo_url: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="https://..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email From Name</label>
            <input
              type="text"
              value={branding.email_from_name}
              onChange={(e) => setBranding({ ...branding, email_from_name: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              placeholder="Your Travel Agency"
            />
          </div>
          <div className="col-span-2">
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={branding.hide_tripy}
                onChange={(e) => setBranding({ ...branding, hide_tripy: e.target.checked })}
                className="rounded border-gray-300"
              />
              <span className="text-gray-700">Hide "Powered by TripsHacker" on client-facing pages</span>
            </label>
          </div>
        </div>
      </section>

      {/* Operational preferences */}
      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Operational Defaults</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Cabin</label>
            <select
              value={prefs.default_cabin_preference || ''}
              onChange={(e) => setPrefs({ ...prefs, default_cabin_preference: e.target.value || null })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">No default</option>
              {CABIN_OPTIONS.map((c) => (
                <option key={c} value={c}>{c.replace('_', ' ')}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Max Stops</label>
            <select
              value={prefs.max_stops}
              onChange={(e) => setPrefs({ ...prefs, max_stops: Number(e.target.value) })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={0}>Nonstop only</option>
              <option value={1}>1 stop max</option>
              <option value={2}>2 stops max</option>
              <option value={3}>3 stops max</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min Connection Time</label>
            <select
              value={prefs.acceptable_connection_mins}
              onChange={(e) => setPrefs({ ...prefs, acceptable_connection_mins: Number(e.target.value) })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              <option value={60}>60 minutes</option>
              <option value={90}>90 minutes</option>
              <option value={120}>2 hours</option>
              <option value={180}>3 hours</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Min Savings for Points</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-gray-500">$</span>
              <input
                type="number"
                value={prefs.min_savings_to_recommend_points}
                onChange={(e) => setPrefs({ ...prefs, min_savings_to_recommend_points: Number(e.target.value) })}
                className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Self-Transfer Policy</label>
            <select
              value={prefs.self_transfer_policy}
              onChange={(e) => setPrefs({ ...prefs, self_transfer_policy: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {POLICY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Separate Ticket Policy</label>
            <select
              value={prefs.separate_ticket_policy}
              onChange={(e) => setPrefs({ ...prefs, separate_ticket_policy: e.target.value })}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            >
              {POLICY_OPTIONS.map((p) => (
                <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>
              ))}
            </select>
          </div>
        </div>
      </section>

      {/* Proposal defaults */}
      <section className="mb-8 rounded-xl border border-gray-200 bg-white p-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Proposal Defaults</h2>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Default Greeting</label>
            <textarea
              value={prefs.default_proposal_greeting}
              onChange={(e) => setPrefs({ ...prefs, default_proposal_greeting: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
              placeholder="Hi! Here are your travel recommendations..."
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Booking Disclaimer</label>
            <textarea
              value={prefs.default_booking_disclaimer}
              onChange={(e) => setPrefs({ ...prefs, default_booking_disclaimer: e.target.value })}
              rows={2}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm resize-none"
              placeholder="Prices are subject to availability..."
            />
          </div>
        </div>
      </section>

      {/* Save */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Settings'}
        </button>
        {saved && <span className="text-sm text-green-600">Settings saved!</span>}
      </div>
    </div>
  );
}
