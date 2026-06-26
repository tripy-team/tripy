'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRightLeft,
  Briefcase,
  Building2,
  Calendar,
  CreditCard,
  FileText,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  UserPlus,
  Users,
} from 'lucide-react';
import { users as usersAPI } from '@/lib/api';
import {
  getOrganization,
  updateOrganization,
  createTransferBonus,
} from '@/lib/api-client';
import type { Organization, OrgUser, TransferBonus } from '@/lib/api-client';
import SingleDatePicker from '@/components/ui/SingleDatePicker';

interface ProfileSummary {
  name: string;
  email?: string;
  default_home_airport?: string;
  timezone?: string;
  total_savings?: number | null;
}

export default function ProfilePage() {
  const router = useRouter();

  // Profile
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);

  // Org / settings
  const [org, setOrg] = useState<Organization | null>(null);
  const [orgLoading, setOrgLoading] = useState(true);
  const [orgError, setOrgError] = useState<string | null>(null);
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [savingOrg, setSavingOrg] = useState(false);
  const [orgSaved, setOrgSaved] = useState(false);

  // Transfer bonus
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

  useEffect(() => {
    const load = async () => {
      try {
        setProfileLoading(true);
        const p = await usersAPI.getProfile();
        setProfile({
          name: p.name || 'Trip Hacker',
          email: p.email,
          default_home_airport: p.default_home_airport,
          timezone: p.timezone,
          total_savings: p.total_savings ?? 0,
        });
        usersAPI.calculateSavings().then((result) => {
          setProfile((prev) => prev ? { ...prev, total_savings: result.total_savings } : null);
        }).catch((err) => console.error('Error calculating savings:', err));
      } catch (e) {
        console.error('Error loading profile:', e);
      } finally {
        setProfileLoading(false);
      }
    };
    load();
  }, []);

  const loadOrg = () => {
    setOrgLoading(true);
    setOrgError(null);
    getOrganization()
      .then((data) => {
        setOrg(data);
        setOrgName(data.name);
        setOrgSlug(data.slug);
      })
      .catch((err) => setOrgError(err.message))
      .finally(() => setOrgLoading(false));
  };

  useEffect(loadOrg, []);

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
      loadOrg();
    } catch (err) {
      console.error('Failed to create transfer bonus:', err);
    } finally {
      setSavingBonus(false);
    }
  };

  const initials =
    profile?.name
      ?.split(' ')
      .map((n) => n[0])
      .join('')
      .toUpperCase()
      .slice(0, 2) || 'TA';

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-5xl mx-auto px-4 py-8 space-y-6">

        {/* Page header */}
        <div>
          <h1 className="text-3xl md:text-4xl font-bold text-slate-900 tracking-tight">
            Profile
          </h1>
          <p className="text-slate-500 mt-1">
            Manage your trip hacker account, organization, and workspace settings.
          </p>
        </div>

        {/* Profile card */}
        {profileLoading ? (
          <div className="bg-white border border-slate-200 rounded-2xl p-12 shadow-sm flex items-center justify-center">
            <div className="flex items-center gap-3 text-slate-500">
              <div className="w-5 h-5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
              Loading profile...
            </div>
          </div>
        ) : (
          <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
            <div className="flex flex-col md:flex-row md:items-center gap-6 mb-6">
              <div className="relative">
                <div className="w-20 h-20 rounded-2xl bg-slate-800 flex items-center justify-center text-white text-2xl font-semibold shadow-lg shadow-slate-800/20">
                  {initials}
                </div>
                <div className="absolute -bottom-2 -right-2 bg-white rounded-full p-1.5 shadow-lg border border-slate-200">
                  <Briefcase className="w-3.5 h-3.5 text-slate-700" />
                </div>
              </div>
              <div className="space-y-1">
                <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-700">
                  <Briefcase className="w-3 h-3" />
                  Trip Hacker
                </div>
                <h2 className="text-2xl font-semibold text-slate-900">
                  {profile?.name || 'Trip Hacker'}
                </h2>
                {profile?.email && (
                  <p className="text-slate-500 text-sm">{profile.email}</p>
                )}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-9 h-9 rounded-lg bg-blue-100 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-4 h-4 text-blue-600" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Home airport</div>
                  <div className="text-sm font-medium text-slate-900">{profile?.default_home_airport || 'Not set'}</div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-9 h-9 rounded-lg bg-emerald-100 flex items-center justify-center flex-shrink-0">
                  <CreditCard className="w-4 h-4 text-emerald-600" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Client savings</div>
                  <div className="text-sm font-medium text-slate-900">
                    {profile?.total_savings ? `$${profile.total_savings.toLocaleString()}` : '$0'}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 p-4 rounded-xl bg-slate-50 border border-slate-200">
                <div className="w-9 h-9 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0">
                  <Calendar className="w-4 h-4 text-violet-600" />
                </div>
                <div>
                  <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Timezone</div>
                  <div className="text-sm font-medium text-slate-900">{profile?.timezone || 'Not set'}</div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Quick actions */}
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
          <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-[0.18em] mb-3">
            Quick actions
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <button
              onClick={() => router.push('/clients')}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
            >
              <UserPlus className="w-5 h-5 text-blue-600 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-slate-900">My travel profile</div>
                <div className="text-xs text-slate-500">View and edit your preferences, points, and trips.</div>
              </div>
            </button>
            <button
              onClick={() => router.push('/solo/setup')}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
            >
              <MapPin className="w-5 h-5 text-emerald-600 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-slate-900">Plan a trip</div>
                <div className="text-xs text-slate-500">Find the cheapest way to book with cash or points.</div>
              </div>
            </button>
            <button
              onClick={() => router.push('/trip-requests/new')}
              className="flex items-center gap-3 px-4 py-3 rounded-xl border border-slate-200 bg-slate-50 hover:bg-slate-100 hover:border-slate-300 transition-colors text-left"
            >
              <FileText className="w-5 h-5 text-amber-500 flex-shrink-0" />
              <div>
                <div className="text-sm font-medium text-slate-900">New trip request</div>
                <div className="text-xs text-slate-500">Start a new trip request.</div>
              </div>
            </button>
          </div>
        </div>

        {/* Workspace settings */}
        <div className="pt-2">
          <div className="flex items-center gap-3 mb-6">
            <h2 className="text-lg font-semibold text-slate-900">Workspace</h2>
            <div className="flex-1 h-px bg-slate-200" />
          </div>

          {orgLoading ? (
            <div className="flex items-center gap-3 text-slate-500 py-8">
              <Loader2 className="h-5 w-5 animate-spin" />
              Loading workspace...
            </div>
          ) : orgError ? (
            <div className="py-8 text-center">
              <p className="mb-4 text-red-600">{orgError}</p>
              <button
                onClick={loadOrg}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                <RefreshCw className="h-4 w-4" />
                Retry
              </button>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Organization + Team side by side */}
              <div className="grid md:grid-cols-2 gap-6">
                {/* Organization */}
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-5 flex items-center gap-2">
                    <Building2 className="h-5 w-5 text-slate-400" />
                    <h3 className="font-semibold text-slate-900">Organization</h3>
                  </div>
                  <div className="space-y-3">
                    <div>
                      <label className="mb-1.5 block text-sm font-medium text-slate-700">
                        Organization name
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
                      {savingOrg ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                      Save
                    </button>
                    {orgSaved && <span className="text-sm text-green-600">Saved!</span>}
                  </div>
                </div>

                {/* Team */}
                <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                  <div className="mb-5 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Users className="h-5 w-5 text-slate-400" />
                      <h3 className="font-semibold text-slate-900">Team</h3>
                    </div>
                    <button className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
                      <Plus className="h-4 w-4" />
                      Invite
                    </button>
                  </div>
                  {org?.users && org.users.length > 0 ? (
                    <div className="overflow-hidden rounded-lg border border-slate-200">
                      <table className="w-full text-sm">
                        <thead className="border-b border-slate-200 bg-slate-50">
                          <tr>
                            <th className="px-3 py-2.5 text-left font-medium text-slate-600">Name</th>
                            <th className="px-3 py-2.5 text-left font-medium text-slate-600">Role</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {org.users.map((user: OrgUser) => (
                            <tr key={user.userId}>
                              <td className="px-3 py-2.5">
                                <div className="font-medium text-slate-900">{user.firstName} {user.lastName}</div>
                                <div className="text-xs text-slate-500">{user.email}</div>
                              </td>
                              <td className="px-3 py-2.5">
                                <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ${
                                  user.role === 'admin' ? 'bg-purple-50 text-purple-700' : 'bg-slate-100 text-slate-600'
                                }`}>
                                  {user.role}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-slate-400">No team members yet.</p>
                  )}
                </div>
              </div>

              {/* Transfer Bonuses */}
              <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <ArrowRightLeft className="h-5 w-5 text-slate-400" />
                    <h3 className="font-semibold text-slate-900">Transfer Bonuses</h3>
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
                        <label className="mb-1 block text-xs font-medium text-slate-600">From Program</label>
                        <input
                          type="text"
                          value={bonusForm.fromProgram}
                          onChange={(e) => setBonusForm((f) => ({ ...f, fromProgram: e.target.value }))}
                          className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                          placeholder="Chase UR"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">To Program</label>
                        <input
                          type="text"
                          value={bonusForm.toProgram}
                          onChange={(e) => setBonusForm((f) => ({ ...f, toProgram: e.target.value }))}
                          className="block w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                          placeholder="United MileagePlus"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">Bonus %</label>
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
                        <label className="mb-1 block text-xs font-medium text-slate-600">Start Date</label>
                        <SingleDatePicker
                          compact
                          value={bonusForm.startDate}
                          onChange={(v) => setBonusForm((f) => ({ ...f, startDate: v }))}
                          minDate={null}
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs font-medium text-slate-600">End Date</label>
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
                            <td className="px-4 py-3 text-right font-medium text-green-600">+{bonus.bonusPercentage}%</td>
                            <td className="px-4 py-3 text-slate-600">
                              {new Date(bonus.startDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                              {' – '}
                              {new Date(bonus.endDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                            </td>
                            <td className="max-w-xs truncate px-4 py-3 text-slate-500">{bonus.notes || '—'}</td>
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
          )}
        </div>

      </div>
    </div>
  );
}
