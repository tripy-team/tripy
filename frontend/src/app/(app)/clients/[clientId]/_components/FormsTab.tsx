'use client';

import { useState, useEffect } from 'react';
import { Plus, ClipboardList, FileQuestion, ChevronDown, ChevronRight, Loader2, ExternalLink, RefreshCw, Trash2, Check, Clock, AlertCircle, Mail } from 'lucide-react';
import Link from 'next/link';
import {
  getIntakeInvitations,
  resendIntakeInvitation,
  revokeIntakeInvitation,
  deleteClientIntake,
  type IntakeInvitation,
  type ClientIntake,
  type Client,
} from '@/lib/api-client';
import IntakeInvitationsPanel from './IntakeInvitationsPanel';
import CustomFormPanel from './CustomFormPanel';

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Sent', color: 'text-amber-600 bg-amber-50', icon: Clock },
  opened: { label: 'Opened', color: 'text-blue-600 bg-blue-50', icon: Mail },
  completed: { label: 'Completed', color: 'text-emerald-600 bg-emerald-50', icon: Check },
  expired: { label: 'Expired', color: 'text-slate-500 bg-slate-100', icon: AlertCircle },
};

function formatDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  client: Client;
  clientId: string;
  intakes: ClientIntake[];
  setIntakes: (fn: (prev: ClientIntake[]) => ClientIntake[]) => void;
}

// ---------------------------------------------------------------------------
// FormsTab
// ---------------------------------------------------------------------------

export default function FormsTab({ client, clientId, intakes, setIntakes }: Props) {
  const [section, setSection] = useState<'profile' | 'custom'>('profile');

  // Custom form state
  const [customForms, setCustomForms] = useState<IntakeInvitation[]>([]);
  const [customLoading, setCustomLoading] = useState(true);
  const [showNewCustomForm, setShowNewCustomForm] = useState(false);

  // Profile intake collapse state
  const [profileOpen, setProfileOpen] = useState(true);
  const [customOpen, setCustomOpen] = useState(true);

  useEffect(() => {
    getIntakeInvitations(clientId)
      .then((all) => setCustomForms(all.filter((inv) => inv.formVariant === 'custom_form')))
      .finally(() => setCustomLoading(false));
  }, [clientId]);

  function handleCustomFormCreated(inv: IntakeInvitation) {
    setCustomForms((prev) => [inv, ...prev]);
    setShowNewCustomForm(false);
  }

  const pendingCustom = customForms.filter((f) => f.status === 'pending' || f.status === 'opened').length;

  return (
    <div className="space-y-5">

      {/* ── Section switcher tabs ── */}
      <div className="flex gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1">
        <button
          onClick={() => setSection('profile')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
            section === 'profile'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <ClipboardList className="h-4 w-4" />
          Profile Intake
        </button>
        <button
          onClick={() => setSection('custom')}
          className={`flex flex-1 items-center justify-center gap-2 rounded-lg py-2.5 text-sm font-medium transition-all ${
            section === 'custom'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-500 hover:text-slate-700'
          }`}
        >
          <FileQuestion className="h-4 w-4" />
          Custom Form
          {pendingCustom > 0 && (
            <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
              {pendingCustom}
            </span>
          )}
        </button>
      </div>

      {/* ── Profile Intake Section ── */}
      {section === 'profile' && (
        <div className="space-y-5">
          {/* Send invitations */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              onClick={() => setProfileOpen((v) => !v)}
              className="flex w-full items-center justify-between p-5 text-left"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                  <Mail className="h-4.5 w-4.5 text-blue-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900">Send Profile Form</h2>
                  <p className="text-xs text-slate-500">Email the standard preference intake to your client</p>
                </div>
              </div>
              {profileOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            </button>
            {profileOpen && (
              <div className="border-t border-slate-100 p-5">
                <IntakeInvitationsPanel client={client} />
              </div>
            )}
          </div>

          {/* Built profiles */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <div className="flex items-center justify-between p-5">
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
                  <ClipboardList className="h-4.5 w-4.5 text-emerald-600" />
                </div>
                <div>
                  <h2 className="font-semibold text-slate-900">Built Profiles</h2>
                  <p className="text-xs text-slate-500">{intakes.length} profile{intakes.length !== 1 ? 's' : ''} built by advisor</p>
                </div>
              </div>
              <Link
                href={`/clients/${clientId}/intake/new`}
                className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
              >
                <Plus className="h-4 w-4" />
                Build Profile
              </Link>
            </div>

            {intakes.length === 0 ? (
              <div className="border-t border-slate-100 px-5 pb-8 pt-6 text-center">
                <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No profiles built yet</p>
                <p className="mt-1 text-xs text-slate-400">Build a reusable preference profile to power smarter trip planning</p>
                <Link
                  href={`/clients/${clientId}/intake/new`}
                  className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  <Plus className="h-4 w-4" />Build first profile
                </Link>
              </div>
            ) : (
              <div className="border-t border-slate-100 px-5 pb-4 pt-4">
                <div className="space-y-3">
                  {intakes.map((intake) => {
                    const isDraft = intake.status === 'draft';
                    const profileLabel = intake.templateName || 'Client Profile';
                    const subtitleParts: string[] = [];
                    if (intake.travelPace) subtitleParts.push(intake.travelPace.replace(/_/g, ' '));
                    if (intake.luxuryPreference) subtitleParts.push(intake.luxuryPreference.replace(/_/g, ' '));
                    const subtitle = subtitleParts.length
                      ? subtitleParts.join(' · ')
                      : `Updated ${new Date(intake.updatedAt).toLocaleDateString()}`;
                    return (
                      <div key={intake.id} className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4 transition-colors hover:border-slate-300">
                        <Link href={`/clients/${clientId}/intake/${intake.id}`} className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isDraft ? 'bg-amber-50' : 'bg-green-50'}`}>
                              <ClipboardList className={`h-5 w-5 ${isDraft ? 'text-amber-500' : 'text-green-600'}`} />
                            </div>
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-slate-900">{profileLabel}</span>
                                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${isDraft ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}>
                                  {isDraft ? 'Draft' : 'Complete'}
                                </span>
                                {intake.isTemplate && (
                                  <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">Template</span>
                                )}
                              </div>
                              <p className="mt-0.5 truncate text-xs capitalize text-slate-500">
                                {subtitle}
                              </p>
                            </div>
                          </div>
                        </Link>
                        <div className="ml-3 flex items-center gap-1">
                          <button
                            onClick={async () => {
                              if (!confirm('Delete this profile?')) return;
                              try {
                                await deleteClientIntake(clientId, intake.id);
                                setIntakes((prev) => prev.filter((i) => i.id !== intake.id));
                              } catch { /* */ }
                            }}
                            title="Delete"
                            className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Custom Form Section ── */}
      {section === 'custom' && (
        <div className="space-y-5">
          {/* New custom form builder */}
          {showNewCustomForm ? (
            <CustomFormPanel
              client={client}
              onCreated={handleCustomFormCreated}
              onCancel={() => setShowNewCustomForm(false)}
            />
          ) : (
            <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
              <div className="flex items-center justify-between p-5">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
                    <FileQuestion className="h-4.5 w-4.5 text-violet-600" />
                  </div>
                  <div>
                    <h2 className="font-semibold text-slate-900">Custom Forms</h2>
                    <p className="text-xs text-slate-500">Build a form with your own questions or let AI generate them</p>
                  </div>
                </div>
                <button
                  onClick={() => setShowNewCustomForm(true)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
                >
                  <Plus className="h-4 w-4" />
                  New Form
                </button>
              </div>
            </div>
          )}

          {/* Sent custom forms list */}
          <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
            <button
              onClick={() => setCustomOpen((v) => !v)}
              className="flex w-full items-center justify-between p-5 text-left"
            >
              <div>
                <h3 className="font-semibold text-slate-900">Sent Forms</h3>
                <p className="text-xs text-slate-500">{customForms.length} custom form{customForms.length !== 1 ? 's' : ''} sent</p>
              </div>
              {customOpen ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
            </button>

            {customOpen && (
              <div className="border-t border-slate-100 p-5">
                {customLoading ? (
                  <div className="flex justify-center py-6">
                    <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                  </div>
                ) : customForms.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
                    <FileQuestion className="mx-auto h-8 w-8 text-slate-300" />
                    <p className="mt-2 text-sm text-slate-500">No custom forms sent yet</p>
                    <p className="mt-1 text-xs text-slate-400">Click "New Form" to build and send a custom form to your client</p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {customForms.map((form) => (
                      <CustomFormRow
                        key={form.id}
                        form={form}
                        onResend={(id) => resendIntakeInvitation(id).then((updated) =>
                          setCustomForms((prev) => prev.map((f) => f.id === id ? updated : f))
                        )}
                        onRevoke={(id) => revokeIntakeInvitation(id).then(() =>
                          setCustomForms((prev) => prev.filter((f) => f.id !== id))
                        )}
                      />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom form row (with answers expansion)
// ---------------------------------------------------------------------------

function CustomFormRow({
  form,
  onResend,
  onRevoke,
}: {
  form: IntakeInvitation;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  const cfg = STATUS_CONFIG[form.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const [showAnswers, setShowAnswers] = useState(false);

  const hasAnswers =
    form.status === 'completed' &&
    form.formAnswers &&
    Object.keys(form.formAnswers).length > 0;

  const formLink =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/intake/${form.token}`
      : `/intake/${form.token}`;

  const questionCount = form.customQuestions?.length ?? 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-900">
              {form.recipientName || form.recipientEmail}
            </p>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
              <Icon className="h-3 w-3" />{cfg.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
            <span>{questionCount} question{questionCount !== 1 ? 's' : ''}</span>
            <span>·</span>
            <span>Sent {formatDate(form.sentAt)}</span>
            {form.openedAt && <><span>·</span><span>Opened {formatDate(form.openedAt)}</span></>}
            {form.completedAt && <><span>·</span><span>Completed {formatDate(form.completedAt)}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {hasAnswers && (
            <button
              onClick={() => setShowAnswers((v) => !v)}
              title={showAnswers ? 'Hide answers' : 'View answers'}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              {showAnswers ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
          {form.status !== 'completed' && (
            <a
              href={formLink}
              target="_blank"
              rel="noopener noreferrer"
              title="Open form"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
          {form.status !== 'completed' && (
            <button
              onClick={() => onResend(form.id)}
              title="Resend"
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {form.status !== 'completed' && (
            <button
              onClick={() => onRevoke(form.id)}
              title="Revoke"
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Answers */}
      {hasAnswers && showAnswers && (
        <div className="border-t border-slate-100 px-4 py-4">
          <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Responses</p>
          <div className="space-y-2.5">
            {Object.entries(form.formAnswers!).filter(([, v]) => v?.trim()).map(([key, value]) => {
              const question = form.customQuestions?.find((q) => q.id === key);
              const label = question?.label ?? key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
              return (
                <div key={key} className="grid grid-cols-[2fr,3fr] gap-3">
                  <span className="text-xs font-medium text-slate-500">{label}</span>
                  <span className="text-xs text-slate-800 break-words">{value}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

