'use client';

import { useState, useEffect } from 'react';
import {
  Send, RefreshCw, Trash2, Loader2, Plus, Check, Clock, AlertCircle,
  Mail, ChevronDown, ChevronRight, ExternalLink,
} from 'lucide-react';
import {
  getIntakeInvitations, sendIntakeInvitations, sendGroupBatchInvitations,
  resendIntakeInvitation, revokeIntakeInvitation,
  type IntakeInvitation, type Client, type IntakeFormVariant,
} from '@/lib/api-client';

const STATUS_CONFIG: Record<string, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: 'Sent', color: 'text-amber-600 bg-amber-50', icon: Clock },
  opened: { label: 'Opened', color: 'text-blue-600 bg-blue-50', icon: Mail },
  completed: { label: 'Completed', color: 'text-emerald-600 bg-emerald-50', icon: Check },
  expired: { label: 'Expired', color: 'text-slate-500 bg-slate-100', icon: AlertCircle },
};

const VARIANT_LABELS: Record<IntakeFormVariant, string> = {
  individual: 'Individual intake',
  group_member: 'Member form',
  group_organizer: 'Organizer form',
  business_policy: 'Policy intake',
  business_traveler: 'Traveler form',
  custom_form: 'Custom form',
};

function formatDate(s?: string | null) {
  if (!s) return '—';
  return new Date(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export default function IntakeInvitationsPanel({ client }: { client: Client }) {
  const [invitations, setInvitations] = useState<IntakeInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [showSend, setShowSend] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [recipientEmail, setRecipientEmail] = useState('');
  const [recipientName, setRecipientName] = useState('');
  const [organizerEmail, setOrganizerEmail] = useState('');
  const [organizerName, setOrganizerName] = useState('');
  const [memberRows, setMemberRows] = useState<{ email: string; name: string }[]>([{ email: '', name: '' }]);

  const isGroup = client.clientType === 'group';
  const isBusiness = client.clientType === 'business';

  useEffect(() => {
    getIntakeInvitations(client.id)
      .then(setInvitations)
      .finally(() => setLoading(false));
  }, [client.id]);

  const handleSendIndividual = async () => {
    if (!recipientEmail.trim()) return;
    setSending(true);
    setError(null);
    try {
      const variant: IntakeFormVariant = isBusiness ? 'business_policy' : 'individual';
      const created = await sendIntakeInvitations(client.id, [{
        email: recipientEmail.trim(),
        name: recipientName.trim() || undefined,
        formVariant: variant,
      }]);
      setInvitations((prev) => [...created, ...prev]);
      setShowSend(false);
      setRecipientEmail('');
      setRecipientName('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleSendGroupBatch = async () => {
    if (!organizerEmail.trim()) return;
    const validMembers = memberRows.filter((r) => r.email.trim());
    const groupSize = 1 + validMembers.length;
    setSending(true);
    setError(null);
    try {
      const created = await sendGroupBatchInvitations(client.id, {
        organizerEmail: organizerEmail.trim(),
        organizerName: organizerName.trim() || undefined,
        members: validMembers.map((m) => ({ email: m.email.trim(), name: m.name.trim() || undefined })),
        groupSize,
      });
      setInvitations((prev) => [...created, ...prev]);
      setShowSend(false);
      setOrganizerEmail('');
      setOrganizerName('');
      setMemberRows([{ email: '', name: '' }]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send');
    } finally {
      setSending(false);
    }
  };

  const handleResend = async (id: string) => {
    const updated = await resendIntakeInvitation(id);
    setInvitations((prev) => prev.map((i) => (i.id === id ? updated : i)));
  };

  const handleRevoke = async (id: string) => {
    await revokeIntakeInvitation(id);
    setInvitations((prev) => prev.filter((i) => i.id !== id));
  };

  if (loading) return <div className="flex items-center justify-center py-8"><Loader2 className="h-5 w-5 animate-spin text-slate-400" /></div>;

  const pending = invitations.filter((i) => i.formVariant !== 'custom_form' && (i.status === 'pending' || i.status === 'opened'));
  const done = invitations.filter((i) => i.formVariant !== 'custom_form' && (i.status === 'completed' || i.status === 'expired'));

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="font-semibold text-slate-900">Profile Intake Forms</h3>
        {!showSend && (
          <button onClick={() => setShowSend(true)} className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-700">
            <Plus className="h-4 w-4" />Send Form
          </button>
        )}
      </div>

      {error && <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>}

      {showSend && (
        <div className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-3">
          {isGroup ? (
            <>
              <p className="text-sm font-medium text-slate-700">Send forms to group members</p>
              <div className="grid grid-cols-2 gap-2">
                <input type="email" placeholder="Organizer email *" value={organizerEmail} onChange={(e) => setOrganizerEmail(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
                <input type="text" placeholder="Organizer name" value={organizerName} onChange={(e) => setOrganizerName(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <p className="text-xs font-medium text-slate-500 mt-2">Group members</p>
              {memberRows.map((row, i) => (
                <div key={i} className="grid grid-cols-2 gap-2">
                  <input type="email" placeholder={`Member ${i + 1} email`} value={row.email} onChange={(e) => setMemberRows((prev) => prev.map((r, j) => j === i ? { ...r, email: e.target.value } : r))}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
                  <input type="text" placeholder="Name" value={row.name} onChange={(e) => setMemberRows((prev) => prev.map((r, j) => j === i ? { ...r, name: e.target.value } : r))}
                    className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
                </div>
              ))}
              <button type="button" onClick={() => setMemberRows((prev) => [...prev, { email: '', name: '' }])}
                className="text-xs font-medium text-blue-600 hover:text-blue-700">+ Add another member</button>
              <div className="flex gap-2 pt-1">
                <button onClick={handleSendGroupBatch} disabled={sending || !organizerEmail.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send All
                </button>
                <button onClick={() => setShowSend(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <p className="text-sm font-medium text-slate-700">
                {isBusiness ? 'Send policy intake to travel coordinator' : 'Send profile intake to client'}
              </p>
              <div className="grid grid-cols-2 gap-2">
                <input type="email" placeholder="Email address *" value={recipientEmail} onChange={(e) => setRecipientEmail(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
                <input type="text" placeholder="Recipient name" value={recipientName} onChange={(e) => setRecipientName(e.target.value)}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600" />
              </div>
              <div className="flex gap-2 pt-1">
                <button onClick={handleSendIndividual} disabled={sending || !recipientEmail.trim()}
                  className="flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60">
                  {sending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}Send
                </button>
                <button onClick={() => setShowSend(false)} className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {pending.length === 0 && done.length === 0 && !showSend ? (
        <p className="text-sm text-slate-400">No profile intake forms sent yet.</p>
      ) : (
        <>
          {pending.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Awaiting Response</p>
              {pending.map((inv) => (
                <InvitationRow key={inv.id} inv={inv} onResend={handleResend} onRevoke={handleRevoke} />
              ))}
            </div>
          )}
          {done.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-400">Completed / Expired</p>
              {done.map((inv) => (
                <InvitationRow key={inv.id} inv={inv} onResend={handleResend} onRevoke={handleRevoke} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Invitation row with expandable answers
// ---------------------------------------------------------------------------

function InvitationRow({
  inv,
  onResend,
  onRevoke,
}: {
  inv: IntakeInvitation;
  onResend: (id: string) => void;
  onRevoke: (id: string) => void;
}) {
  const cfg = STATUS_CONFIG[inv.status] ?? STATUS_CONFIG.pending;
  const Icon = cfg.icon;
  const [showAnswers, setShowAnswers] = useState(false);

  const hasAnswers = inv.status === 'completed' && inv.formAnswers && Object.keys(inv.formAnswers).length > 0;

  const formLink = typeof window !== 'undefined'
    ? `${window.location.protocol}//${window.location.host}/intake/${inv.token}`
    : `/intake/${inv.token}`;

  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      {/* Main row */}
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate text-sm font-medium text-slate-900">
              {inv.recipientName ? `${inv.recipientName}` : inv.recipientEmail}
            </p>
            <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}>
              <Icon className="h-3 w-3" />{cfg.label}
            </span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-400">
            <span>{VARIANT_LABELS[inv.formVariant] ?? inv.formVariant}</span>
            <span>·</span>
            <span>Sent {formatDate(inv.sentAt)}</span>
            {inv.openedAt && <><span>·</span><span>Opened {formatDate(inv.openedAt)}</span></>}
            {inv.completedAt && <><span>·</span><span>Completed {formatDate(inv.completedAt)}</span></>}
          </div>
        </div>
        <div className="flex items-center gap-1">
          {/* View answers toggle */}
          {hasAnswers && (
            <button
              onClick={() => setShowAnswers((v) => !v)}
              title={showAnswers ? 'Hide answers' : 'View answers'}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
            >
              {showAnswers ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          )}
          {/* Open form link */}
          {inv.status !== 'completed' && (
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
          {inv.status !== 'completed' && (
            <button onClick={() => onResend(inv.id)} title="Resend" className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600">
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
          {inv.status !== 'completed' && (
            <button onClick={() => onRevoke(inv.id)} title="Revoke" className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Answers expansion */}
      {hasAnswers && showAnswers && (
        <AnswersViewer
          answers={inv.formAnswers!}
          questions={inv.customQuestions ?? undefined}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Answers viewer
// ---------------------------------------------------------------------------

function AnswersViewer({
  answers,
  questions,
}: {
  answers: Record<string, string>;
  questions?: Array<{ id: string; label: string }>;
}) {
  const entries = Object.entries(answers).filter(([, v]) => v && v.trim());

  const getLabel = (key: string): string => {
    if (questions) {
      const q = questions.find((q) => q.id === key);
      if (q) return q.label;
    }
    // Humanize key as fallback
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (entries.length === 0) {
    return (
      <div className="border-t border-slate-100 px-4 py-3">
        <p className="text-xs text-slate-400">No answers recorded.</p>
      </div>
    );
  }

  return (
    <div className="border-t border-slate-100 px-4 py-4">
      <p className="mb-3 text-xs font-medium uppercase tracking-wide text-slate-400">Form responses</p>
      <div className="space-y-2.5">
        {entries.map(([key, value]) => (
          <div key={key} className="grid grid-cols-[2fr,3fr] gap-3 text-sm">
            <span className="text-xs font-medium text-slate-500">{getLabel(key)}</span>
            <span className="text-xs text-slate-800 break-words">{value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Re-export for use in other panels
export { AnswersViewer };
export type { IntakeInvitation };
