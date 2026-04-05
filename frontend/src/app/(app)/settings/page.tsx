'use client';

import { useState, useEffect } from 'react';
import {
  Loader2,
  Save,
  Plus,
  Building2,
  Users,
  ArrowRightLeft,
  RefreshCw,
} from 'lucide-react';
import {
  getOrganization,
  updateOrganization,
  createTransferBonus,
} from '@/lib/api-client';
import type { Organization, OrgUser, TransferBonus } from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

export default function SettingsPage() {
  const [org, setOrg] = useState<Organization | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Org form
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgSaved, setOrgSaved] = useState(false);

  // Transfer bonus form
  const [showBonusForm, setShowBonusForm] = useState(false);
  const [bonusForm, setBonusForm] = useState({
    fromProgram: '',
    toProgram: '',
    bonusPercentage: '',
    startDate: '',
    endDate: '',
    notes: '',
  });
  const [savingBonus, setSavingBonus] = useState(false);

  const load = () => {
    setLoading(true);
    setError(null);
    getOrganization()
      .then((data) => {
        setOrg(data);
        setOrgName(data.name);
        setOrgSlug(data.slug);
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  const handleSaveOrg = async () => {
    setSavingOrg(true);
    setOrgSaved(false);
    try {
      const updated = await updateOrganization({
        name: orgName.trim() || undefined,
        slug: orgSlug.trim() || undefined,
      });
      setOrg(updated);
      setOrgSaved(true);
      setTimeout(() => setOrgSaved(false), 3000);
    } catch (err) {
      console.error('Failed to update organization:', err);
    } finally {
      setSavingOrg(false);
    }
  };

  const handleAddBonus = async () => {
    if (!bonusForm.fromProgram || !bonusForm.toProgram || !bonusForm.bonusPercentage) return;
    setSavingBonus(true);
    try {
      await createTransferBonus({
        fromProgram: bonusForm.fromProgram,
        toProgram: bonusForm.toProgram,
        bonusPercentage: parseFloat(bonusForm.bonusPercentage),
        startDate: bonusForm.startDate,
        endDate: bonusForm.endDate,
        notes: bonusForm.notes || undefined,
      });
      setBonusForm({ fromProgram: '', toProgram: '', bonusPercentage: '', startDate: '', endDate: '', notes: '' });
      setShowBonusForm(false);
      load();
    } catch (err) {
      console.error('Failed to create transfer bonus:', err);
    } finally {
      setSavingBonus(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading settings...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error}</p>
        <button
          onClick={load}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <RefreshCw className="h-4 w-4" />
          Retry
        </button>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-slate-900">Settings</h1>
        <p className="mt-1 text-slate-500">Manage your organization, team, and transfer bonuses.</p>
      </div>

      <div className="space-y-6">
        {/* Organization Settings */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center gap-2">
            <Building2 className="h-5 w-5 text-slate-400" />
            <h2 className="font-semibold text-slate-900">Organization</h2>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">
                Organization Name
              </label>
              <input
                type="text"
                value={orgName}
                onChange={(e) => setOrgName(e.target.value)}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-slate-700">Slug</label>
              <input
                type="text"
                value={orgSlug}
                onChange={(e) => setOrgSlug(e.target.value)}
                className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={handleSaveOrg}
              disabled={savingOrg}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {savingOrg ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save Changes
            </button>
            {orgSaved && <span className="text-sm text-green-600">Saved!</span>}
          </div>
        </div>

        {/* Team Management */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users className="h-5 w-5 text-slate-400" />
              <h2 className="font-semibold text-slate-900">Team</h2>
            </div>
            <button className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
              <Plus className="h-4 w-4" />
              Invite User
            </button>
          </div>

          {org?.users && org.users.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-slate-600">Name</th>
                    <th className="px-4 py-2.5 text-left font-medium text-slate-600">Email</th>
                    <th className="px-4 py-2.5 text-left font-medium text-slate-600">Role</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {org.users.map((user: OrgUser) => (
                    <tr key={user.userId}>
                      <td className="px-4 py-3 font-medium text-slate-900">
                        {user.firstName} {user.lastName}
                      </td>
                      <td className="px-4 py-3 text-slate-600">{user.email}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                            user.role === 'admin'
                              ? 'bg-purple-50 text-purple-700'
                              : 'bg-slate-100 text-slate-600'
                          }`}
                        >
                          {user.role}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="text-sm text-slate-400">No team members found.</p>
          )}
        </div>

        {/* Transfer Bonuses */}
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-5 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ArrowRightLeft className="h-5 w-5 text-slate-400" />
              <h2 className="font-semibold text-slate-900">Transfer Bonuses</h2>
            </div>
            <button
              onClick={() => setShowBonusForm(!showBonusForm)}
              className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              Add Bonus
            </button>
          </div>

          {showBonusForm && (
            <div className="mb-5 rounded-lg border border-blue-200 bg-blue-50/50 p-4">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    From Program
                  </label>
                  <input
                    type="text"
                    value={bonusForm.fromProgram}
                    onChange={(e) => setBonusForm((f) => ({ ...f, fromProgram: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    placeholder="Chase UR"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    To Program
                  </label>
                  <input
                    type="text"
                    value={bonusForm.toProgram}
                    onChange={(e) => setBonusForm((f) => ({ ...f, toProgram: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    placeholder="United MileagePlus"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Bonus %
                  </label>
                  <input
                    type="number"
                    value={bonusForm.bonusPercentage}
                    onChange={(e) => setBonusForm((f) => ({ ...f, bonusPercentage: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    placeholder="25"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">Notes</label>
                  <input
                    type="text"
                    value={bonusForm.notes}
                    onChange={(e) => setBonusForm((f) => ({ ...f, notes: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    placeholder="Limited time offer"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Start Date
                  </label>
                  <SingleDatePicker
                    compact
                    value={bonusForm.startDate}
                    onChange={(v) => setBonusForm((f) => ({ ...f, startDate: v }))}
                    minDate={null}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    End Date
                  </label>
                  <SingleDatePicker
                    compact
                    value={bonusForm.endDate}
                    onChange={(v) => setBonusForm((f) => ({ ...f, endDate: v }))}
                    minDate={null}
                  />
                </div>
              </div>
              <div className="mt-3 flex gap-2">
                <button
                  onClick={handleAddBonus}
                  disabled={savingBonus}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {savingBonus ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  Save Bonus
                </button>
                <button
                  onClick={() => setShowBonusForm(false)}
                  className="rounded-lg bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {org?.transferBonuses && org.transferBonuses.length > 0 ? (
            <div className="overflow-hidden rounded-lg border border-slate-200">
              <table className="w-full text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left font-medium text-slate-600">From</th>
                    <th className="px-4 py-2.5 text-left font-medium text-slate-600">To</th>
                    <th className="px-4 py-2.5 text-right font-medium text-slate-600">Bonus</th>
                    <th className="px-4 py-2.5 text-left font-medium text-slate-600">Period</th>
                    <th className="px-4 py-2.5 text-left font-medium text-slate-600">Notes</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {org.transferBonuses.map((bonus: TransferBonus) => (
                    <tr key={bonus.id}>
                      <td className="px-4 py-3 font-medium text-slate-900">{bonus.fromProgram}</td>
                      <td className="px-4 py-3 text-slate-700">{bonus.toProgram}</td>
                      <td className="px-4 py-3 text-right font-medium text-green-600">
                        +{bonus.bonusPercentage}%
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {new Date(bonus.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                        {' – '}
                        {new Date(bonus.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      </td>
                      <td className="max-w-xs truncate px-4 py-3 text-slate-500">
                        {bonus.notes || '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="rounded-lg border border-slate-200 bg-slate-50 py-8 text-center">
              <ArrowRightLeft className="mx-auto h-8 w-8 text-slate-300" />
              <p className="mt-2 text-sm text-slate-500">No transfer bonuses configured.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
