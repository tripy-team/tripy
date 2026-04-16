'use client';

import { useState, useEffect } from 'react';
import { Plus, ClipboardList, FileQuestion, ChevronDown, ChevronRight, Loader2, ExternalLink, RefreshCw, Trash2, Check, Clock, AlertCircle, Mail, Send, X, Plane } from 'lucide-react';
import Link from 'next/link';
import {
  getIntakeInvitations,
  resendIntakeInvitation,
  revokeIntakeInvitation,
  deleteClientIntake,
  createClientIntake,
  sendIntakeInvitations,
  type IntakeInvitation,
  type ClientIntake,
  type Client,
  type TripRequest,
} from '@/lib/api-client';
import CustomFormPanel from './CustomFormPanel';
import TripIntakePanel from './TripIntakePanel';
import { IntakeForm } from '../intake/_components/intake-form';

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
  trips: TripRequest[];
  onTripCreated: (trip: TripRequest) => void;
}

// ---------------------------------------------------------------------------
// FormsTab
// ---------------------------------------------------------------------------

type SentForm = IntakeInvitation & { linkedTripId?: string };

export default function FormsTab({ client, clientId, intakes, setIntakes, trips, onTripCreated }: Props) {
  // Unified sent forms state (custom forms + trip intake forms)
  const [sentForms, setSentForms] = useState<SentForm[]>([]);
  const [sentFormsLoading, setSentFormsLoading] = useState(true);
  const [showNewCustomForm, setShowNewCustomForm] = useState(false);
  const [showNewTripForm, setShowNewTripForm] = useState(false);

  // Build profile modal state
  const [showBuildModal, setShowBuildModal] = useState(false);
  const [savingIntake, setSavingIntake] = useState(false);
  const [createdIntake, setCreatedIntake] = useState<ClientIntake | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareSuccess, setShareSuccess] = useState(false);

  // Collapse state
  const [sentOpen, setSentOpen] = useState(true);

  useEffect(() => {
    getIntakeInvitations(clientId)
      .then((all) => {
        setSentForms(
          all
            .filter((inv) => inv.formVariant === 'custom_form' || inv.formVariant === 'individual')
            .sort((a, b) => {
              const ta = a.sentAt ? new Date(a.sentAt).getTime() : 0;
              const tb = b.sentAt ? new Date(b.sentAt).getTime() : 0;
              return tb - ta;
            }),
        );
      })
      .finally(() => setSentFormsLoading(false));
  }, [clientId]);

  function handleTripFormCreated(inv: IntakeInvitation, trip?: TripRequest) {
    setSentForms((prev) => [{ ...inv, linkedTripId: trip?.id }, ...prev]);
    setShowNewTripForm(false);
    if (trip) onTripCreated(trip);
  }

  function handleCustomFormCreated(inv: IntakeInvitation) {
    setSentForms((prev) => [inv, ...prev]);
    setShowNewCustomForm(false);
  }

  function handleResend(id: string) {
    return resendIntakeInvitation(id).then((updated) =>
      setSentForms((prev) =>
        prev.map((f) => (f.id === id ? { ...updated, linkedTripId: f.linkedTripId } : f)),
      ),
    );
  }

  function handleRevoke(id: string) {
    return revokeIntakeInvitation(id).then(() =>
      setSentForms((prev) => prev.filter((f) => f.id !== id)),
    );
  }

  async function handleBuildIntakeSave(data: Record<string, unknown>) {
    setSavingIntake(true);
    try {
      const intake = await createClientIntake(clientId, data);
      setCreatedIntake(intake);
      setIntakes((prev) => [intake, ...prev]);
    } finally {
      setSavingIntake(false);
    }
  }

  async function handleShareWithClient() {
    if (!client.email) return;
    setSharing(true);
    try {
      await sendIntakeInvitations(clientId, [
        {
          email: client.email,
          name: `${client.firstName} ${client.lastName}`.trim() || undefined,
          formVariant: 'individual',
        },
      ]);
      setShareSuccess(true);
    } catch {
      // ignore
    } finally {
      setSharing(false);
    }
  }

  function handleCloseBuildModal() {
    setShowBuildModal(false);
    setCreatedIntake(null);
    setShareSuccess(false);
    setSavingIntake(false);
  }

  const pendingSent = sentForms.filter((f) => f.status === 'pending' || f.status === 'opened').length;

  return (
    <div className="space-y-5">

      {/* ── Build Profile Modal ── */}
      {showBuildModal && (
        <BuildProfileModal
          client={client}
          clientId={clientId}
          saving={savingIntake}
          createdIntake={createdIntake}
          sharing={sharing}
          shareSuccess={shareSuccess}
          onSave={handleBuildIntakeSave}
          onShare={handleShareWithClient}
          onClose={handleCloseBuildModal}
        />
      )}

      {/* ── Build Profiles Section ── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-50">
              <ClipboardList className="h-4.5 w-4.5 text-emerald-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Build Profiles</h2>
              <p className="text-xs text-slate-500">
                {intakes.length} profile{intakes.length !== 1 ? 's' : ''} built by advisor
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowBuildModal(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
          >
            <Plus className="h-4 w-4" />
            Build Profile
          </button>
        </div>

        {intakes.length === 0 ? (
          <div className="border-t border-slate-100 px-5 pb-8 pt-6 text-center">
            <ClipboardList className="mx-auto h-8 w-8 text-slate-300" />
            <p className="mt-2 text-sm text-slate-500">No profiles built yet</p>
            <p className="mt-1 text-xs text-slate-400">
              Build a reusable preference profile to power smarter trip planning
            </p>
            <button
              onClick={() => setShowBuildModal(true)}
              className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700"
            >
              <Plus className="h-4 w-4" />
              Build first profile
            </button>
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
                  <div
                    key={intake.id}
                    className="flex items-center justify-between rounded-lg border border-slate-200 bg-slate-50/50 p-4 transition-colors hover:border-slate-300"
                  >
                    <Link href={`/clients/${clientId}/intake/${intake.id}`} className="min-w-0 flex-1">
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${isDraft ? 'bg-amber-50' : 'bg-green-50'}`}
                        >
                          <ClipboardList className={`h-5 w-5 ${isDraft ? 'text-amber-500' : 'text-green-600'}`} />
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-slate-900">{profileLabel}</span>
                            <span
                              className={`rounded-full px-2 py-0.5 text-xs font-medium ${isDraft ? 'bg-amber-50 text-amber-700' : 'bg-green-50 text-green-700'}`}
                            >
                              {isDraft ? 'Draft' : 'Complete'}
                            </span>
                            {intake.isTemplate && (
                              <span className="rounded-full bg-purple-50 px-2 py-0.5 text-xs font-medium text-purple-700">
                                Template
                              </span>
                            )}
                          </div>
                          <p className="mt-0.5 truncate text-xs capitalize text-slate-500">{subtitle}</p>
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
                          } catch {
                            /* */
                          }
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

      {/* ── Trip Intake Modal ── */}
      {showNewTripForm && (
        <TripIntakePanel
          client={client}
          existingTrips={trips}
          onCreated={handleTripFormCreated}
          onCancel={() => setShowNewTripForm(false)}
        />
      )}

      {/* ── Custom Form Modal ── */}
      {showNewCustomForm && (
        <CustomFormPanel
          client={client}
          onCreated={handleCustomFormCreated}
          onCancel={() => setShowNewCustomForm(false)}
        />
      )}

      {/* ── Trip Intake Form Section ── */}
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-between p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
              <Plane className="h-4.5 w-4.5 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-slate-900">Trip Intake Forms</h2>
              <p className="text-xs text-slate-500">
                Send a trip intake to gather destinations, dates, and preferences — links to a trip in the Trips tab
              </p>
            </div>
          </div>
          <button
            onClick={() => setShowNewTripForm(true)}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700"
          >
            <Plus className="h-4 w-4" />
            New Trip Form
          </button>
        </div>
      </div>

      {/* ── Custom Forms Section ── */}
      <div className="space-y-5">
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between p-5">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
                <FileQuestion className="h-4.5 w-4.5 text-violet-600" />
              </div>
              <div>
                <h2 className="font-semibold text-slate-900">Custom Forms</h2>
                <p className="text-xs text-slate-500">
                  Build a form with your own questions or let AI generate them
                </p>
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

        {/* Sent forms list (unified: custom + trip intake) */}
        <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
          <button
            onClick={() => setSentOpen((v) => !v)}
            className="flex w-full items-center justify-between p-5 text-left"
          >
            <div>
              <h3 className="font-semibold text-slate-900">
                Sent Forms
                {pendingSent > 0 && (
                  <span className="ml-2 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-semibold text-violet-700">
                    {pendingSent}
                  </span>
                )}
              </h3>
              <p className="text-xs text-slate-500">
                {sentForms.length} form{sentForms.length !== 1 ? 's' : ''} sent
              </p>
            </div>
            {sentOpen ? (
              <ChevronDown className="h-4 w-4 text-slate-400" />
            ) : (
              <ChevronRight className="h-4 w-4 text-slate-400" />
            )}
          </button>

          {sentOpen && (
            <div className="border-t border-slate-100 p-5">
              {sentFormsLoading ? (
                <div className="flex justify-center py-6">
                  <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
                </div>
              ) : sentForms.length === 0 ? (
                <div className="rounded-lg border border-dashed border-slate-200 py-10 text-center">
                  <FileQuestion className="mx-auto h-8 w-8 text-slate-300" />
                  <p className="mt-2 text-sm text-slate-500">No forms sent yet</p>
                  <p className="mt-1 text-xs text-slate-400">
                    Send a trip intake or build a custom form above
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {sentForms.map((form) => (
                    <SentFormRow
                      key={form.id}
                      form={form}
                      trips={trips}
                      onResend={handleResend}
                      onRevoke={handleRevoke}
                    />
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Build Profile Modal
// ---------------------------------------------------------------------------

interface BuildProfileModalProps {
  client: Client;
  clientId: string;
  saving: boolean;
  createdIntake: ClientIntake | null;
  sharing: boolean;
  shareSuccess: boolean;
  onSave: (data: Record<string, unknown>) => Promise<void>;
  onShare: () => Promise<void>;
  onClose: () => void;
}

function BuildProfileModal({
  client,
  clientId,
  saving,
  createdIntake,
  sharing,
  shareSuccess,
  onSave,
  onShare,
  onClose,
}: BuildProfileModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8">
      <div className="relative flex w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-slate-900">Build Client Profile</h2>
          <div className="flex items-center gap-3">
            {createdIntake && !shareSuccess && (
              <button
                onClick={onShare}
                disabled={sharing || !client.email}
                title={!client.email ? 'No email on file for this client' : undefined}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
              >
                {sharing ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Send className="h-4 w-4" />
                )}
                {sharing ? 'Sharing…' : `Share with ${client.email || 'client'}`}
              </button>
            )}
            {shareSuccess && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-700">
                <Check className="h-4 w-4" />
                Shared with {client.email}
              </span>
            )}
            <button
              onClick={onClose}
              className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Modal body */}
        {createdIntake ? (
          <div className="flex flex-col items-center justify-center px-6 py-14">
            <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-100">
              <Check className="h-7 w-7 text-emerald-600" />
            </div>
            <h3 className="mt-5 text-lg font-semibold text-slate-900">Profile saved!</h3>
            <p className="mt-1 text-sm text-slate-500">
              {client.email
                ? 'Click "Share" above to email the intake form to the client.'
                : 'The profile has been saved.'}
            </p>
            <div className="mt-5 flex items-center gap-4">
              <Link
                href={`/clients/${clientId}/intake/${createdIntake.id}`}
                className="text-sm font-medium text-blue-600 hover:text-blue-700"
                onClick={onClose}
              >
                Open full editor →
              </Link>
              <button
                onClick={onClose}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
              >
                Done
              </button>
            </div>
          </div>
        ) : (
          <div className="overflow-y-auto px-18 pt-6 pb-18">
            <IntakeForm
              client={client}
              isNew
              saving={saving}
              onSave={onSave}
              onCancel={onClose}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Custom form row (with answers expansion)
// ---------------------------------------------------------------------------

function SentFormRow({
  form,
  trips,
  onResend,
  onRevoke,
}: {
  form: SentForm;
  trips: TripRequest[];
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  const cfg = STATUS_CONFIG[form.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const [showAnswers, setShowAnswers] = useState(false);

  const isTripIntake = form.formVariant === 'individual';
  const linkedTrip = form.linkedTripId ? trips.find((t) => t.id === form.linkedTripId) : undefined;

  const hasAnswers =
    form.status === 'completed' && form.formAnswers && Object.keys(form.formAnswers).length > 0;

  const formLink =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/intake/${form.token}`
      : `/intake/${form.token}`;

  const questionCount = form.customSections
    ? form.customSections.reduce((acc, s) => acc + s.questions.length, 0)
    : form.customQuestions?.length ?? 0;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-900">
              {form.recipientName || form.recipientEmail}
            </p>
            <span
              className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${
                isTripIntake ? 'bg-blue-50 text-blue-700' : 'bg-violet-50 text-violet-700'
              }`}
            >
              {isTripIntake ? <Plane className="h-3 w-3" /> : <FileQuestion className="h-3 w-3" />}
              {isTripIntake ? 'Trip intake' : 'Custom'}
            </span>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
              <Icon className="h-3 w-3" />
              {cfg.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
            {isTripIntake ? (
              <span>{linkedTrip ? `Trip: ${linkedTrip.title}` : 'No trip linked'}</span>
            ) : (
              <span>
                {questionCount} question{questionCount !== 1 ? 's' : ''}
              </span>
            )}
            <span>·</span>
            <span>Sent {formatDate(form.sentAt)}</span>
            {form.openedAt && (
              <>
                <span>·</span>
                <span>Opened {formatDate(form.openedAt)}</span>
              </>
            )}
            {form.completedAt && (
              <>
                <span>·</span>
                <span>Completed {formatDate(form.completedAt)}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {hasAnswers && (
            <button
              onClick={() => setShowAnswers((v) => !v)}
              title={showAnswers ? 'Hide answers' : 'View answers'}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              {showAnswers ? (
                <ChevronDown className="h-3.5 w-3.5" />
              ) : (
                <ChevronRight className="h-3.5 w-3.5" />
              )}
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
            {Object.entries(form.formAnswers!)
              .filter(([, v]) => v?.trim())
              .map(([key, value]) => {
                // Look up question label from flat array or sections
                let question = form.customQuestions?.find((q) => q.id === key);
                if (!question && form.customSections) {
                  for (const sec of form.customSections) {
                    const found = sec.questions.find((q) => q.id === key);
                    if (found) { question = found; break; }
                  }
                }
                const label =
                  question?.label ??
                  key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
                return (
                  <div key={key} className="grid grid-cols-[2fr,3fr] gap-3">
                    <span className="text-xs font-medium text-slate-500">{label}</span>
                    <span className="break-words text-xs text-slate-800">{value}</span>
                  </div>
                );
              })}
          </div>
        </div>
      )}
    </div>
  );
}
