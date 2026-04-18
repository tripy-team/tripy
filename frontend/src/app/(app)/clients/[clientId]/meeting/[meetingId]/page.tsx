'use client';

import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  ArrowLeft,
  Loader2,
  Send,
  Sparkles,
  Brain,
  Check,
  X,
  CheckCircle2,
  FileText,
  MessageSquare,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Mic,
  ArrowUp,
  User,
  AlertTriangle,
  CircleCheck,
  Pencil,
  Video,
  Mail,
  Copy,
  Clock,
  Trash2,
} from 'lucide-react';
import {
  getMeetingSession,
  appendMeetingEntry,
  updateMeetingEntry,
  generateMeetingQuestions,
  extractMeetingProfileSuggestions,
  updateMeetingProfileSuggestion,
  getMeetingCommitPreview,
  commitMeetingSuggestions,
  generateMeetingRecap,
  updateMeetingSession,
  getClientPreferences,
  startLiveCall,
  stopLiveCall,
  getClient,
  getMeetingInvitations,
  createMeetingInvitation,
  resendMeetingInvitation,
  revokeMeetingInvitation,
} from '@/lib/api-client';
import type {
  MeetingSession,
  MeetingEntryItem,
  MeetingQuestionSuggestion,
  MeetingProfileSuggestion,
  MeetingCommitPreviewItem,
  MeetingRecap,
  AnsweredQuestionPayload,
  ClientPreference,
  Client,
  MeetingInvitation,
} from '@/lib/api-client';
import { computeProfileCompleteness, type ProfileCompletenessResult } from '@/lib/profile-completeness';
import { getAllProfileFields, getCriticalFields, getFieldsByCategory, getFieldLabel } from '@/lib/profile-fields';
import LiveCallView from '@/components/live-call/LiveCallView';
import type { LiveCallConfig } from '@/components/live-call/LiveCallView';
import type { FinalEvent } from '@/lib/cactus-ws';

type Panel = 'questions' | 'suggestions' | 'recap' | 'profile';
type MeetingMode = 'notes' | 'live-call';

export default function MeetingCopilotPage() {
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const clientId = params.clientId as string;
  const meetingId = params.meetingId as string;

  // Trip context from URL params (when navigated from trips page)
  const tripId = searchParams.get('tripId');
  const tripDestinations = searchParams.get('destinations');
  const tripDates = searchParams.get('dates');

  const [session, setSession] = useState<MeetingSession | null>(null);
  const [entries, setEntries] = useState<MeetingEntryItem[]>([]);
  const [questions, setQuestions] = useState<MeetingQuestionSuggestion[]>([]);
  const [suggestions, setSuggestions] = useState<MeetingProfileSuggestion[]>([]);
  const [recap, setRecap] = useState<MeetingRecap | null>(null);
  const [clientPreferences, setClientPreferences] = useState<ClientPreference | null>(null);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteInput, setNoteInput] = useState('');
  const [sendingNote, setSendingNote] = useState(false);

  const [generatingQuestions, setGeneratingQuestions] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [generatingRecap, setGeneratingRecap] = useState(false);
  const [committingProfile, setCommittingProfile] = useState(false);
  const [updatingSuggestionId, setUpdatingSuggestionId] = useState<string | null>(null);

  const [commitPreview, setCommitPreview] = useState<MeetingCommitPreviewItem[] | null>(null);
  const [showCommitModal, setShowCommitModal] = useState(false);

  const [activePanel, setActivePanel] = useState<Panel>('questions');
  const [questionsExpanded, setQuestionsExpanded] = useState(true);

  const [newQuestionsToast, setNewQuestionsToast] = useState<number | null>(null);
  const [newExtractionsToast, setNewExtractionsToast] = useState<number | null>(null);

  // Live call state — auto-open live call when navigated from trips page
  const [meetingMode, setMeetingMode] = useState<MeetingMode>(tripId ? 'live-call' : 'notes');

  const cactusWsUrl = process.env.NEXT_PUBLIC_CACTUS_WS_URL || 'ws://localhost:8765/ws/live-transcribe';

  const liveCallConfig: LiveCallConfig | null = session
    ? {
        clientId,
        meetingId,
        clientName: session.title,
        existingPreferences: clientPreferences
          ? (JSON.parse(JSON.stringify(clientPreferences)) as Record<string, unknown>)
          : {},
        cactusWsUrl,
        tripContext: tripId
          ? {
              destinations: tripDestinations || '',
              travelDates: tripDates || '',
              travelerNames: session.title,
              status: 'planning',
            }
          : null,
      }
    : null;

  const handleLiveCallEnd = useCallback(
    async (finalData: FinalEvent) => {
      // Persist transcript and suggestions via the stop endpoint
      try {
        await stopLiveCall(clientId, meetingId, {
          transcript: finalData.transcript.map((c) => ({
            speaker: c.speaker,
            text: c.text,
            startMs: c.startMs,
            endMs: c.endMs,
            confidence: c.confidence,
          })),
          commitReady: finalData.commitReady,
        });
        // Reload the session to get new entries and suggestions
        loadSession();
      } catch (err) {
        console.error('Failed to save live call data:', err);
      }
    },
    [clientId, meetingId],
  );

  const handleCommitLiveSuggestions = useCallback(
    async (commitReadySuggestions: FinalEvent['commitReady']) => {
      // The suggestions were already persisted by stopLiveCall.
      // Now commit them via the existing commit flow.
      try {
        await commitMeetingSuggestions(clientId, meetingId);
        // Refresh preferences
        const prefs = await getClientPreferences(clientId).catch(() => null);
        setClientPreferences(prefs);
        // Switch back to notes mode to see the updated state
        setMeetingMode('notes');
        loadSession();
      } catch (err) {
        console.error('Failed to commit live call suggestions:', err);
      }
    },
    [clientId, meetingId],
  );
  const [profileAutoSavedToast, setProfileAutoSavedToast] = useState<string[] | null>(null);

  // Client invitation modal state
  const [client, setClient] = useState<Client | null>(null);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [invitations, setInvitations] = useState<MeetingInvitation[]>([]);
  const [invitationsLoading, setInvitationsLoading] = useState(false);
  const [sendingInvite, setSendingInvite] = useState(false);

  const entriesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const aiPanelScrollRef = useRef<HTMLDivElement>(null);

  // Compute profile completeness from committed prefs + session suggestions
  const profileCompleteness = useMemo<ProfileCompletenessResult>(() => {
    const prefsRecord = clientPreferences
      ? (JSON.parse(JSON.stringify(clientPreferences)) as Record<string, unknown>)
      : null;
    return computeProfileCompleteness(
      prefsRecord,
      suggestions.map((s) => ({
        targetField: s.targetField,
        suggestedValue: s.suggestedValue,
        status: s.status,
      })),
    );
  }, [clientPreferences, suggestions]);

  const loadSession = useCallback(async () => {
    try {
      const [data, prefs, clientData] = await Promise.all([
        getMeetingSession(clientId, meetingId),
        getClientPreferences(clientId).catch(() => null),
        getClient(clientId).catch(() => null),
      ]);
      setSession(data);
      setEntries(data.entries || []);
      setQuestions(data.questionSuggestions || []);
      setSuggestions(data.profileSuggestions || []);
      setRecap(data.recap || null);
      setClientPreferences(prefs);
      setClient(clientData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meeting session');
    } finally {
      setLoading(false);
    }
  }, [clientId, meetingId]);

  const loadInvitations = useCallback(async () => {
    setInvitationsLoading(true);
    try {
      const list = await getMeetingInvitations(clientId, meetingId);
      setInvitations(list);
    } catch (err) {
      console.error('Failed to load meeting invitations:', err);
    } finally {
      setInvitationsLoading(false);
    }
  }, [clientId, meetingId]);

  const handleOpenInviteModal = useCallback(() => {
    setShowInviteModal(true);
    loadInvitations();
  }, [loadInvitations]);

  const handleSendInvite = useCallback(
    async (recipientEmail: string, recipientName?: string) => {
      setSendingInvite(true);
      try {
        const created = await createMeetingInvitation(clientId, meetingId, {
          recipientEmail,
          recipientName,
        });
        setInvitations((prev) => [created, ...prev]);
        return created;
      } finally {
        setSendingInvite(false);
      }
    },
    [clientId, meetingId],
  );

  const handleResendInvite = useCallback(
    async (invitationId: string) => {
      const updated = await resendMeetingInvitation(clientId, meetingId, invitationId);
      setInvitations((prev) => prev.map((i) => (i.id === invitationId ? updated : i)));
    },
    [clientId, meetingId],
  );

  const handleRevokeInvite = useCallback(
    async (invitationId: string) => {
      await revokeMeetingInvitation(clientId, meetingId, invitationId);
      setInvitations((prev) => prev.filter((i) => i.id !== invitationId));
    },
    [clientId, meetingId],
  );

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    entriesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  useEffect(() => {
    if (newQuestionsToast === null) return;
    const timer = setTimeout(() => setNewQuestionsToast(null), 6000);
    return () => clearTimeout(timer);
  }, [newQuestionsToast]);

  useEffect(() => {
    if (newExtractionsToast === null) return;
    const timer = setTimeout(() => setNewExtractionsToast(null), 5000);
    return () => clearTimeout(timer);
  }, [newExtractionsToast]);

  useEffect(() => {
    if (profileAutoSavedToast === null) return;
    const timer = setTimeout(() => setProfileAutoSavedToast(null), 5000);
    return () => clearTimeout(timer);
  }, [profileAutoSavedToast]);

  const handleSendNote = async () => {
    if (!noteInput.trim() || sendingNote) return;
    setSendingNote(true);
    try {
      const entry = await appendMeetingEntry(clientId, meetingId, {
        role: 'advisor_note',
        content: noteInput.trim(),
      });
      setEntries((prev) => [...prev, entry]);
      setNoteInput('');
      textareaRef.current?.focus();
    } catch (err) {
      console.error('Failed to send note:', err);
    } finally {
      setSendingNote(false);
    }
  };

  const handleSendAnswer = async (questionId: string, questionText: string, answer: string, category?: string, targetFields?: string[]) => {
    if (!answer.trim()) return;
    try {
      const result = await appendMeetingEntry(clientId, meetingId, {
        role: 'question_answer',
        content: answer.trim(),
        metadata: { questionText, targetFields },
      });
      setEntries((prev) => [...prev, result]);
      setQuestions((prev) =>
        prev.map((q) => (q.id === questionId ? { ...q, isUsed: true } : q)),
      );

      // Auto-committed suggestions come back already committed to the profile
      if (result.extractedSuggestions && result.extractedSuggestions.length > 0) {
        setSuggestions((prev) => [...result.extractedSuggestions!, ...prev]);
      }

      // Show auto-save toast with field names
      if (result.autoCommittedFields && result.autoCommittedFields.length > 0) {
        setProfileAutoSavedToast(result.autoCommittedFields);
        getClientPreferences(clientId).then((prefs) => setClientPreferences(prefs)).catch(() => {});
      }

      // After answer + extraction, auto-generate 2-4 follow-up questions
      try {
        const followUpResult = await generateMeetingQuestions(clientId, meetingId, {
          followUp: true,
          answeredQuestions: [{ questionText, answer: answer.trim(), category }],
        });
        if (followUpResult.questions.length > 0) {
          setQuestions((prev) => [...followUpResult.questions, ...prev]);
          setNewQuestionsToast(followUpResult.questions.length);
        }
      } catch (followUpErr) {
        console.error('Follow-up question generation failed (non-blocking):', followUpErr);
      }
    } catch (err) {
      console.error('Failed to record answer:', err);
    }
  };

  const handleEditAnswer = async (entryId: string, newContent: string) => {
    if (!newContent.trim()) return;
    try {
      const result = await updateMeetingEntry(clientId, meetingId, entryId, newContent.trim());

      // Update the entry in local state
      setEntries((prev) =>
        prev.map((e) => (e.id === entryId ? { ...e, content: newContent.trim() } : e)),
      );

      // Remove old suggestions from this entry and add new ones
      if (result.extractedSuggestions && result.extractedSuggestions.length > 0) {
        setSuggestions((prev) => {
          const oldEntryTag = `[entry:${entryId}]`;
          const withoutOld = prev.filter((s) => !s.rationale?.includes(oldEntryTag));
          return [...result.extractedSuggestions!, ...withoutOld];
        });
      } else {
        setSuggestions((prev) => {
          const oldEntryTag = `[entry:${entryId}]`;
          return prev.filter((s) => !s.rationale?.includes(oldEntryTag));
        });
      }

      // Show auto-save toast
      if (result.autoCommittedFields && result.autoCommittedFields.length > 0) {
        setProfileAutoSavedToast(result.autoCommittedFields);
        getClientPreferences(clientId).then((prefs) => setClientPreferences(prefs)).catch(() => {});
      }

      // Re-generate follow-up questions based on updated answer
      const entryMeta = entries.find((e) => e.id === entryId)?.metadata;
      const questionText = entryMeta?.questionText as string | undefined;
      if (questionText) {
        try {
          const followUpResult = await generateMeetingQuestions(clientId, meetingId, {
            followUp: true,
            answeredQuestions: [{ questionText, answer: newContent.trim() }],
          });
          if (followUpResult.questions.length > 0) {
            setQuestions((prev) => [...followUpResult.questions, ...prev]);
            setNewQuestionsToast(followUpResult.questions.length);
          }
        } catch (followUpErr) {
          console.error('Follow-up question re-generation failed (non-blocking):', followUpErr);
        }
      }
    } catch (err) {
      console.error('Failed to edit answer:', err);
    }
  };

  const handleGenerateQuestions = async (followUp = false) => {
    setGeneratingQuestions(true);
    try {
      let answeredQuestions: AnsweredQuestionPayload[] | undefined;
      if (followUp) {
        const qaEntries = entries.filter(
          (e) => e.role === 'question_answer' && e.metadata?.questionText,
        );
        answeredQuestions = qaEntries.map((e) => ({
          questionText: e.metadata!.questionText as string,
          answer: e.content,
        }));
      }
      const result = await generateMeetingQuestions(clientId, meetingId, {
        followUp,
        answeredQuestions: followUp ? answeredQuestions : undefined,
      });
      const count = result.questions.length;
      setQuestions((prev) => [...result.questions, ...prev]);
      setActivePanel('questions');
      setQuestionsExpanded(true);
      if (count > 0) {
        setNewQuestionsToast(count);
      }
    } catch (err) {
      console.error('Failed to generate questions:', err);
    } finally {
      setGeneratingQuestions(false);
    }
  };

  const handleExtractSuggestions = async () => {
    setExtracting(true);
    try {
      const result = await extractMeetingProfileSuggestions(clientId, meetingId);
      setSuggestions(result.suggestions);
      setActivePanel('suggestions');
    } catch (err) {
      console.error('Failed to extract suggestions:', err);
    } finally {
      setExtracting(false);
    }
  };

  const handleApproveSuggestion = async (id: string, status: 'approved' | 'rejected') => {
    setUpdatingSuggestionId(id);
    try {
      const updated = await updateMeetingProfileSuggestion(
        clientId,
        meetingId,
        id,
        status,
      );
      setSuggestions((prev) =>
        prev.map((s) => (s.id === id ? { ...s, ...updated } : s)),
      );
    } catch (err) {
      console.error('Failed to update suggestion:', err);
    } finally {
      setUpdatingSuggestionId(null);
    }
  };

  const handleShowCommitPreview = async () => {
    try {
      const pendingIds = suggestions
        .filter((s) => s.status === 'pending')
        .map((s) => s.id);
      for (const id of pendingIds) {
        await updateMeetingProfileSuggestion(clientId, meetingId, id, 'approved');
      }
      if (pendingIds.length > 0) {
        setSuggestions((prev) =>
          prev.map((s) =>
            pendingIds.includes(s.id) ? { ...s, status: 'approved' as const } : s,
          ),
        );
      }
      const result = await getMeetingCommitPreview(clientId, meetingId);
      setCommitPreview(result.preview);
      setShowCommitModal(true);
    } catch (err) {
      console.error('Failed to load commit preview:', err);
    }
  };

  const handleCommit = async () => {
    setCommittingProfile(true);
    try {
      await commitMeetingSuggestions(clientId, meetingId);
      setSuggestions((prev) =>
        prev.map((s) =>
          s.status === 'approved' ? { ...s, status: 'committed' as const } : s,
        ),
      );
      setShowCommitModal(false);
      setCommitPreview(null);
    } catch (err) {
      console.error('Failed to commit suggestions:', err);
    } finally {
      setCommittingProfile(false);
    }
  };

  const handleGenerateRecap = async () => {
    setGeneratingRecap(true);
    try {
      const result = await generateMeetingRecap(clientId, meetingId);
      setRecap(result);
      setActivePanel('recap');
    } catch (err) {
      console.error('Failed to generate recap:', err);
    } finally {
      setGeneratingRecap(false);
    }
  };

  const handleEndMeeting = async () => {
    if (!confirm('End this meeting session? You can still review suggestions afterward.')) return;
    try {
      await updateMeetingSession(clientId, meetingId, { status: 'completed' });
      setSession((prev) => (prev ? { ...prev, status: 'completed' } : prev));
    } catch (err) {
      console.error('Failed to end meeting:', err);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendNote();
    }
  };

  const approvedCount = suggestions.filter(
    (s) => s.status === 'approved',
  ).length;
  const pendingCount = suggestions.filter(
    (s) => s.status === 'pending',
  ).length;
  const committedCount = suggestions.filter(
    (s) => s.status === 'committed',
  ).length;
  const isActive = session?.status === 'active';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading meeting...</span>
      </div>
    );
  }

  if (error || !session) {
    return (
      <div className="py-32 text-center">
        <p className="mb-4 text-red-600">{error || 'Meeting not found'}</p>
        <Link
          href={`/clients/${clientId}`}
          className="font-medium text-blue-600 hover:text-blue-700"
        >
          Back to client
        </Link>
      </div>
    );
  }

  return (
    <div className="flex h-[calc(100vh-4rem)] flex-col">
      {/* Invite Client Modal */}
      {showInviteModal && client && session && (
        <InviteClientModal
          client={client}
          meetingTitle={session.title}
          invitations={invitations}
          invitationsLoading={invitationsLoading}
          sending={sendingInvite}
          onSend={handleSendInvite}
          onResend={handleResendInvite}
          onRevoke={handleRevokeInvite}
          onClose={() => setShowInviteModal(false)}
        />
      )}

      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
        <div className="flex items-center gap-4">
          <Link
            href={`/clients/${clientId}`}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-lg font-bold text-slate-900">{session.title}</h1>
              <span
                className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                  isActive
                    ? 'bg-green-50 text-green-700'
                    : 'bg-slate-100 text-slate-600'
                }`}
              >
                {session.status}
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Meeting Copilot &middot; {entries.length} note{entries.length !== 1 ? 's' : ''} recorded
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isActive && (
            <button
              onClick={handleOpenInviteModal}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
            >
              <Mail className="h-3.5 w-3.5" />
              Invite Client
            </button>
          )}
          {isActive && meetingMode === 'notes' && (
            <button
              onClick={() => {
                startLiveCall(clientId, meetingId).catch(console.error);
                setMeetingMode('live-call');
              }}
              className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700"
            >
              <Video className="h-3.5 w-3.5" />
              Start Live Call
            </button>
          )}
          {isActive && meetingMode === 'live-call' && (
            <button
              onClick={() => setMeetingMode('notes')}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              Back to Notes
            </button>
          )}
          {isActive && (
            <button
              onClick={handleEndMeeting}
              className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              End Meeting
            </button>
          )}
          <button
            onClick={handleGenerateRecap}
            disabled={generatingRecap || entries.length === 0}
            className="inline-flex items-center gap-1.5 rounded-lg bg-purple-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-purple-700 disabled:opacity-60"
          >
            {generatingRecap ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <FileText className="h-3.5 w-3.5" />
            )}
            Generate Recap
          </button>
        </div>
      </div>

      {/* Live Call Mode */}
      {meetingMode === 'live-call' && liveCallConfig && (
        <div className="flex-1 overflow-hidden">
          <LiveCallView
            config={liveCallConfig}
            onCallEnd={handleLiveCallEnd}
            onCommitSuggestions={handleCommitLiveSuggestions}
          />
        </div>
      )}

      {/* Notes Mode: Main layout two columns */}
      {meetingMode === 'notes' && (
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Conversation */}
        <div className="flex w-1/2 flex-col border-r border-slate-200">
          {/* Conversation entries */}
          <div className="flex-1 overflow-y-auto px-6 py-4">
            {entries.length === 0 ? (
              <div className="flex h-full items-center justify-center">
                <div className="text-center">
                  <Mic className="mx-auto h-10 w-10 text-slate-300" />
                  <p className="mt-3 text-sm font-medium text-slate-500">
                    Start recording meeting notes
                  </p>
                  <p className="mt-1 text-xs text-slate-400">
                    Type what the client says, then let AI generate smart follow-up questions
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {entries.map((entry) => (
                  <EntryBubble
                    key={entry.id}
                    entry={entry}
                    isActive={isActive}
                    onEdit={handleEditAnswer}
                  />
                ))}
                <div ref={entriesEndRef} />
              </div>
            )}
          </div>

          {/* Action bar */}
          {isActive && (
            <div className="border-t border-slate-200 bg-white px-4 py-2">
              <div className="mb-2 flex gap-2">
                <button
                  onClick={() => handleGenerateQuestions(false)}
                  disabled={generatingQuestions}
                  className="inline-flex items-center gap-1 rounded-lg bg-blue-50 px-3 py-1.5 text-xs font-medium text-blue-700 hover:bg-blue-100 disabled:opacity-60"
                >
                  {generatingQuestions ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Sparkles className="h-3 w-3" />
                  )}
                  Generate Questions
                </button>
                {entries.length > 0 && (
                  <button
                    onClick={() => handleGenerateQuestions(true)}
                    disabled={generatingQuestions}
                    className="inline-flex items-center gap-1 rounded-lg bg-indigo-50 px-3 py-1.5 text-xs font-medium text-indigo-700 hover:bg-indigo-100 disabled:opacity-60"
                  >
                    {generatingQuestions ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <RefreshCw className="h-3 w-3" />
                    )}
                    Follow-Up Questions
                  </button>
                )}
                <button
                  onClick={handleExtractSuggestions}
                  disabled={extracting || entries.length === 0}
                  className="inline-flex items-center gap-1 rounded-lg bg-emerald-50 px-3 py-1.5 text-xs font-medium text-emerald-700 hover:bg-emerald-100 disabled:opacity-60"
                >
                  {extracting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <Brain className="h-3 w-3" />
                  )}
                  Extract Preferences
                </button>
              </div>
              <div className="flex gap-2">
                <textarea
                  ref={textareaRef}
                  value={noteInput}
                  onChange={(e) => setNoteInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Record what the client said... (Enter to send, Shift+Enter for new line)"
                  rows={2}
                  className="flex-1 resize-none rounded-lg border border-slate-200 px-3 py-2 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <button
                  onClick={handleSendNote}
                  disabled={sendingNote || !noteInput.trim()}
                  className="self-end rounded-lg bg-blue-600 p-2.5 text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {sendingNote ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right: AI panel */}
        <div className="flex w-1/2 flex-col bg-slate-50">
          {/* Panel tabs */}
          <div className="flex border-b border-slate-200 bg-white">
            {(
              [
                { key: 'questions' as Panel, label: 'Questions', icon: HelpCircle, count: questions.length },
                { key: 'suggestions' as Panel, label: 'Insights', icon: Brain, count: suggestions.filter((s) => s.status !== 'rejected').length },
                { key: 'profile' as Panel, label: 'Profile', icon: User, count: profileCompleteness.overallPercent },
                { key: 'recap' as Panel, label: 'Recap', icon: FileText, count: recap ? 1 : 0 },
              ] as const
            ).map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActivePanel(tab.key)}
                className={`flex-1 border-b-2 px-4 py-3 text-xs font-medium transition-colors ${
                  activePanel === tab.key
                    ? 'border-blue-600 text-blue-700'
                    : 'border-transparent text-slate-500 hover:text-slate-700'
                }`}
              >
                <tab.icon className={`mx-auto h-4 w-4 ${activePanel === tab.key ? 'text-blue-600' : 'text-slate-400'}`} />
                <span className="mt-1 block">
                  {tab.label}
                  {tab.key === 'profile' ? (
                    <span className={`ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-bold ${
                      profileCompleteness.readyForTripPlanning
                        ? 'bg-emerald-100 text-emerald-700'
                        : profileCompleteness.overallPercent > 50
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}>
                      {tab.count}%
                    </span>
                  ) : tab.count > 0 ? (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-100 px-1 text-[10px] font-bold text-blue-700">
                      {tab.count}
                    </span>
                  ) : null}
                </span>
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="relative flex-1 overflow-y-auto p-4" ref={aiPanelScrollRef}>
            {activePanel === 'questions' && (
              <QuestionsPanel
                questions={questions}
                expanded={questionsExpanded}
                onToggle={() => setQuestionsExpanded(!questionsExpanded)}
                onUseQuestion={handleSendAnswer}
                isActive={isActive}
              />
            )}

            {activePanel === 'suggestions' && (
              <SuggestionsPanel
                suggestions={suggestions}
                updatingId={updatingSuggestionId}
                onDismiss={(id) => handleApproveSuggestion(id, 'rejected')}
                onRestore={(id) => handleApproveSuggestion(id, 'approved')}
                approvedCount={approvedCount}
                committedCount={committedCount}
                onSaveToProfile={handleShowCommitPreview}
              />
            )}

            {activePanel === 'profile' && (
              <ProfilePanel
                completeness={profileCompleteness}
                preferences={clientPreferences}
                suggestions={suggestions}
              />
            )}

            {activePanel === 'recap' && (
              <RecapPanel recap={recap} />
            )}

            {newExtractionsToast !== null && (
              <div className="sticky bottom-14 z-10 flex justify-center">
                <button
                  onClick={() => {
                    setActivePanel('suggestions');
                    setNewExtractionsToast(null);
                  }}
                  className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-700 animate-in slide-in-from-bottom-4 fade-in duration-300"
                >
                  <Brain className="h-3.5 w-3.5" />
                  {newExtractionsToast} new insight{newExtractionsToast !== 1 ? 's' : ''} extracted
                </button>
              </div>
            )}

            {newQuestionsToast !== null && (
              <div className="sticky bottom-4 z-10 flex justify-center">
                <button
                  onClick={() => {
                    aiPanelScrollRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
                    setActivePanel('questions');
                    setQuestionsExpanded(true);
                    setNewQuestionsToast(null);
                  }}
                  className="flex items-center gap-2 rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-blue-600/25 transition-all hover:bg-blue-700 hover:shadow-xl hover:shadow-blue-600/30 animate-in slide-in-from-bottom-4 fade-in duration-300"
                >
                  <ArrowUp className="h-3.5 w-3.5" />
                  {newQuestionsToast} new question{newQuestionsToast !== 1 ? 's' : ''} added
                </button>
              </div>
            )}

            {profileAutoSavedToast !== null && (
              <div className="sticky bottom-24 z-10 flex justify-center">
                <button
                  onClick={() => {
                    setActivePanel('profile');
                    setProfileAutoSavedToast(null);
                  }}
                  className="flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-lg shadow-emerald-600/25 transition-all hover:bg-emerald-700 animate-in slide-in-from-bottom-4 fade-in duration-300"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  Profile auto-saved: {profileAutoSavedToast.map((f) => fieldLabel(f)).join(', ')}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Save to Profile Modal */}
      {showCommitModal && commitPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-900">
                  Save to Client Profile
                </h2>
              </div>
              <button
                onClick={() => {
                  setShowCommitModal(false);
                  setCommitPreview(null);
                }}
                className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {commitPreview.length === 0 ? (
              <p className="py-8 text-center text-sm text-slate-500">
                No insights ready to save. Dismiss any you disagree with first.
              </p>
            ) : (
              <>
                {(() => {
                  const primaryItems = commitPreview.filter((i) => !i.targetClientId);
                  const crossClientItems = commitPreview.filter((i) => i.targetClientId);
                  const crossGrouped = new Map<string, { name: string; items: typeof commitPreview }>();
                  for (const item of crossClientItems) {
                    const id = item.targetClientId!;
                    if (!crossGrouped.has(id)) {
                      crossGrouped.set(id, { name: item.targetClientName || 'Other client', items: [] });
                    }
                    crossGrouped.get(id)!.items.push(item);
                  }

                  return (
                    <>
                      {primaryItems.length > 0 && (
                        <>
                          <p className="mb-3 text-sm text-slate-600">
                            For this client&apos;s profile:
                          </p>
                          <div className="space-y-2">
                            {primaryItems.map((item) => (
                              <CommitPreviewRow key={item.id} item={item} />
                            ))}
                          </div>
                        </>
                      )}

                      {crossGrouped.size > 0 && (
                        <div className={primaryItems.length > 0 ? 'mt-4' : ''}>
                          {[...crossGrouped.entries()].map(([id, { name, items }]) => (
                            <div key={id} className="mb-3">
                              <div className="mb-2 flex items-center gap-2">
                                <User className="h-3.5 w-3.5 text-indigo-500" />
                                <span className="text-sm font-semibold text-indigo-700">
                                  {name}&apos;s profile
                                </span>
                                <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                                  cross-client
                                </span>
                              </div>
                              <div className="space-y-2">
                                {items.map((item) => (
                                  <CommitPreviewRow key={item.id} item={item} isCrossClient />
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </>
                  );
                })()}

                <div className="mt-6 flex gap-3">
                  <button
                    onClick={handleCommit}
                    disabled={committingProfile}
                    className="flex-1 inline-flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {committingProfile ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <CheckCircle2 className="h-4 w-4" />
                    )}
                    Save {commitPreview.length} Insight{commitPreview.length !== 1 ? 's' : ''}
                  </button>
                  <button
                    onClick={() => {
                      setShowCommitModal(false);
                      setCommitPreview(null);
                    }}
                    className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Not Yet
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function EntryBubble({
  entry,
  isActive,
  onEdit,
}: {
  entry: MeetingEntryItem;
  isActive: boolean;
  onEdit: (entryId: string, newContent: string) => Promise<void>;
}) {
  const isQuestion = entry.role === 'question_answer';
  const isSystem = entry.role === 'system';
  const questionText = entry.metadata?.questionText as string | undefined;

  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState(entry.content);
  const [saving, setSaving] = useState(false);
  const editRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing) editRef.current?.focus();
  }, [editing]);

  const handleSaveEdit = async () => {
    if (!editText.trim() || editText.trim() === entry.content) {
      setEditing(false);
      setEditText(entry.content);
      return;
    }
    setSaving(true);
    try {
      await onEdit(entry.id, editText.trim());
      setEditing(false);
    } catch {
      // keep editing open on error
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className={`group rounded-xl p-3.5 ${
        isSystem
          ? 'bg-slate-100 text-slate-500'
          : isQuestion
            ? 'border border-indigo-100 bg-indigo-50'
            : 'border border-slate-200 bg-white'
      }`}
    >
      <div className="mb-1 flex items-center gap-2">
        {isQuestion ? (
          <MessageSquare className="h-3.5 w-3.5 text-indigo-500" />
        ) : isSystem ? (
          <Sparkles className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <Mic className="h-3.5 w-3.5 text-blue-500" />
        )}
        <span className="text-[10px] font-medium uppercase tracking-wider text-slate-400">
          {isQuestion ? 'Q&A' : isSystem ? 'System' : 'Advisor Note'}
        </span>
        {isActive && isQuestion && !editing && (
          <button
            onClick={() => { setEditText(entry.content); setEditing(true); }}
            className="rounded p-0.5 text-slate-300 opacity-0 transition-opacity hover:bg-indigo-100 hover:text-indigo-500 group-hover:opacity-100"
            title="Edit answer"
          >
            <Pencil className="h-3 w-3" />
          </button>
        )}
        <span className="ml-auto text-[10px] text-slate-400">
          {new Date(entry.createdAt).toLocaleTimeString([], {
            hour: '2-digit',
            minute: '2-digit',
          })}
        </span>
      </div>
      {questionText && (
        <p className="mb-1 text-xs font-medium text-indigo-600">
          Q: {questionText}
        </p>
      )}
      {editing ? (
        <div className="mt-1 space-y-2">
          <textarea
            ref={editRef}
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSaveEdit();
              }
              if (e.key === 'Escape') {
                setEditText(entry.content);
                setEditing(false);
              }
            }}
            rows={3}
            className="w-full resize-none rounded-md border border-indigo-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-indigo-400 focus:outline-none focus:ring-1 focus:ring-indigo-400"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSaveEdit}
              disabled={saving || !editText.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-700 disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />}
              Save &amp; Re-analyze
            </button>
            <button
              onClick={() => { setEditText(entry.content); setEditing(false); }}
              disabled={saving}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
            <span className="text-[10px] text-slate-400">
              AI will re-extract preferences from updated answer
            </span>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-sm text-slate-700">{entry.content}</p>
      )}
    </div>
  );
}

function QuestionsPanel({
  questions,
  expanded,
  onToggle,
  onUseQuestion,
  isActive,
}: {
  questions: MeetingQuestionSuggestion[];
  expanded: boolean;
  onToggle: () => void;
  onUseQuestion: (questionId: string, questionText: string, answer: string, category?: string, targetFields?: string[]) => void;
  isActive: boolean;
}) {
  if (questions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <HelpCircle className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-500">
            No questions generated yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Click &ldquo;Generate Questions&rdquo; to get smart discovery questions
          </p>
        </div>
      </div>
    );
  }

  const getRound = (q: MeetingQuestionSuggestion) => q.round ?? 1;
  const rounds = Array.from(new Set(questions.map(getRound))).sort(
    (a, b) => b - a,
  );

  const unusedCount = questions.filter((q) => !q.isUsed).length;

  return (
    <div className="space-y-4">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        AI-Suggested Questions ({unusedCount} remaining)
      </button>

      {expanded && rounds.map((round) => {
        const roundQuestions = questions.filter((q) => getRound(q) === round);
        const roundUnused = roundQuestions.filter((q) => !q.isUsed);
        const roundUsed = roundQuestions.filter((q) => q.isUsed);

        return (
          <RoundGroup
            key={`round-${round}`}
            round={round}
            latestRound={rounds[0]}
            unused={roundUnused}
            used={roundUsed}
            onUseQuestion={onUseQuestion}
            isActive={isActive}
          />
        );
      })}
    </div>
  );
}

function RoundGroup({
  round,
  latestRound,
  unused,
  used,
  onUseQuestion,
  isActive,
}: {
  round: number;
  latestRound: number;
  unused: MeetingQuestionSuggestion[];
  used: MeetingQuestionSuggestion[];
  onUseQuestion: (questionId: string, questionText: string, answer: string, category?: string, targetFields?: string[]) => void;
  isActive: boolean;
}) {
  const [collapsed, setCollapsed] = useState(round !== latestRound && unused.length === 0);
  const isLatest = round === latestRound;
  const label = round === 1 ? 'Initial Questions' : `Follow-Up Round ${round - 1}`;

  return (
    <div className={`rounded-xl border p-3 ${isLatest ? 'border-blue-200 bg-blue-50/30' : 'border-slate-200 bg-white'}`}>
      <button
        onClick={() => setCollapsed(!collapsed)}
        className="flex w-full items-center gap-2"
      >
        {collapsed ? (
          <ChevronRight className="h-3.5 w-3.5 text-slate-400" />
        ) : (
          <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
        )}
        <span className="text-xs font-semibold text-slate-700">{label}</span>
        {isLatest && (
          <span className="rounded-full bg-blue-100 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700">
            Latest
          </span>
        )}
        <span className="ml-auto text-[10px] text-slate-400">
          {unused.length} remaining &middot; {used.length} answered
        </span>
      </button>

      {!collapsed && (
        <div className="mt-3 space-y-2">
          {unused.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              onUse={(answer) => onUseQuestion(q.id, q.questionText, answer, q.category, q.targetFields as string[])}
              isActive={isActive}
            />
          ))}
          {used.length > 0 && (
            <div className="space-y-2 opacity-50">
              {used.map((q) => (
                <QuestionCard key={q.id} question={q} onUse={() => {}} isActive={false} />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function QuestionCard({
  question,
  onUse,
  isActive,
}: {
  question: MeetingQuestionSuggestion;
  onUse: (answer: string) => void;
  isActive: boolean;
}) {
  const [recording, setRecording] = useState(false);
  const [answerText, setAnswerText] = useState('');
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (recording) inputRef.current?.focus();
  }, [recording]);

  const handleSubmit = () => {
    if (!answerText.trim()) return;
    onUse(answerText.trim());
    setAnswerText('');
    setRecording(false);
  };

  const priorityStyles: Record<string, string> = {
    high: 'border-red-200 bg-red-50',
    medium: 'border-amber-200 bg-amber-50',
    low: 'border-slate-200 bg-slate-50',
  };
  const priorityBadge: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-amber-100 text-amber-700',
    low: 'bg-slate-100 text-slate-600',
  };
  const categoryBadge: Record<string, string> = {
    flight: 'bg-sky-50 text-sky-700',
    hotel: 'bg-violet-50 text-violet-700',
    budget: 'bg-green-50 text-green-700',
    experience: 'bg-orange-50 text-orange-700',
    logistics: 'bg-slate-100 text-slate-600',
    family: 'bg-pink-50 text-pink-700',
    dealbreakers: 'bg-red-50 text-red-700',
    emotional: 'bg-purple-50 text-purple-700',
  };

  return (
    <div className={`rounded-lg border p-3 ${priorityStyles[question.priority] ?? 'border-slate-200 bg-white'}`}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5">
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase ${priorityBadge[question.priority] ?? 'bg-slate-100 text-slate-600'}`}>
          {question.priority}
        </span>
        <span className={`rounded-full px-1.5 py-0.5 text-[10px] font-medium ${categoryBadge[question.category] ?? 'bg-slate-100 text-slate-600'}`}>
          {question.category}
        </span>
      </div>
      <p className="text-sm font-medium text-slate-800">{question.questionText}</p>
      <p className="mt-1 text-xs text-slate-500">{question.reason}</p>
      {question.targetFields.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1">
          {(question.targetFields as string[]).map((f) => (
            <span
              key={f}
              className="rounded bg-white/70 px-1.5 py-0.5 text-[10px] text-slate-500"
            >
              {f}
            </span>
          ))}
        </div>
      )}
      {isActive && !recording && (
        <button
          onClick={() => setRecording(true)}
          className="mt-2 inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          <MessageSquare className="h-3 w-3" />
          Record Answer
        </button>
      )}
      {isActive && recording && (
        <div className="mt-2 space-y-2">
          <textarea
            ref={inputRef}
            value={answerText}
            onChange={(e) => setAnswerText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                handleSubmit();
              }
              if (e.key === 'Escape') {
                setAnswerText('');
                setRecording(false);
              }
            }}
            placeholder="Type the client's answer..."
            rows={2}
            className="w-full resize-none rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-slate-800 placeholder:text-slate-400 focus:border-blue-400 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={handleSubmit}
              disabled={!answerText.trim()}
              className="inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
            >
              <Check className="h-3 w-3" />
              Save
            </button>
            <button
              onClick={() => { setAnswerText(''); setRecording(false); }}
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3 w-3" />
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

const INSIGHT_CATEGORIES: { key: string; label: string; icon: string; color: string; bg: string; border: string }[] = [
  { key: 'flights', label: 'Flights', icon: '✈', color: 'text-sky-700', bg: 'bg-sky-50', border: 'border-sky-200' },
  { key: 'hotels', label: 'Hotels', icon: '🏨', color: 'text-violet-700', bg: 'bg-violet-50', border: 'border-violet-200' },
  { key: 'budget', label: 'Budget & Points', icon: '💰', color: 'text-emerald-700', bg: 'bg-emerald-50', border: 'border-emerald-200' },
  { key: 'experiences', label: 'Experiences', icon: '🎯', color: 'text-orange-700', bg: 'bg-orange-50', border: 'border-orange-200' },
  { key: 'food_and_dining', label: 'Food & Dining', icon: '🍽', color: 'text-amber-700', bg: 'bg-amber-50', border: 'border-amber-200' },
  { key: 'lifestyle', label: 'Lifestyle & Personality', icon: '🧭', color: 'text-teal-700', bg: 'bg-teal-50', border: 'border-teal-200' },
  { key: 'emotional', label: 'Emotional Drivers', icon: '💜', color: 'text-purple-700', bg: 'bg-purple-50', border: 'border-purple-200' },
  { key: 'family', label: 'Family & Group', icon: '👥', color: 'text-pink-700', bg: 'bg-pink-50', border: 'border-pink-200' },
  { key: 'dealbreakers', label: 'Dealbreakers & Dislikes', icon: '🚫', color: 'text-red-700', bg: 'bg-red-50', border: 'border-red-200' },
  { key: 'logistics', label: 'Logistics', icon: '📋', color: 'text-slate-700', bg: 'bg-slate-50', border: 'border-slate-200' },
];

function isCrossClient(s: MeetingProfileSuggestion): boolean {
  return !!s.targetClientId;
}

function getCrossClientName(s: MeetingProfileSuggestion): string {
  if (s.targetClient) return `${s.targetClient.firstName} ${s.targetClient.lastName}`;
  return 'Another client';
}

function inferCategory(s: MeetingProfileSuggestion): string {
  const field = s.targetField.toLowerCase();
  const value = String(s.suggestedValue ?? '').toLowerCase();
  const combined = `${field} ${value} ${s.rationale}`.toLowerCase();

  if (field.match(/cabin|nonstop|layover|airline|reposition|basiceconomy|seat|legroom|lieflat|redeye|premiumeconomy/)) return 'flights';
  if (field.match(/hotel|room|location/)) return 'hotels';
  if (field.match(/budget|redemption|pointsvscash|splurge/)) return 'budget';
  if (field.match(/food|dietary|dining/)) return 'food_and_dining';
  if (field.match(/family|children/)) return 'family';
  if (field.match(/accessibility|maxacceptable|travelpace|traveltime/)) return 'logistics';
  if (field.match(/dealbreaker|dislike|avoid|badpast/)) return 'dealbreakers';
  if (field.match(/activity|specialoccasion/)) return 'experiences';
  if (field.match(/whatmakestrip|emotional/)) return 'emotional';
  if (combined.match(/personality|style|spontaneous|planner/)) return 'lifestyle';
  if (field === 'notes') {
    if (combined.match(/deal.?break|avoid|hate|never|dislike/)) return 'dealbreakers';
    if (combined.match(/family|partner|kids|spouse|group/)) return 'family';
    if (combined.match(/food|dining|restaurant|eat|cuisine/)) return 'food_and_dining';
    if (combined.match(/budget|cost|price|splurge|points/)) return 'budget';
    if (combined.match(/flight|airline|cabin|seat/)) return 'flights';
    if (combined.match(/hotel|room|resort|property/)) return 'hotels';
    if (combined.match(/feel|emotion|dream|aspir|nostalg|escape/)) return 'emotional';
    if (combined.match(/personal|lifestyle|pace|schedule/)) return 'lifestyle';
    return 'experiences';
  }
  return 'experiences';
}

function SuggestionsPanel({
  suggestions,
  updatingId,
  onDismiss,
  onRestore,
  approvedCount,
  committedCount,
  onSaveToProfile,
}: {
  suggestions: MeetingProfileSuggestion[];
  updatingId: string | null;
  onDismiss: (id: string) => void;
  onRestore: (id: string) => void;
  approvedCount: number;
  committedCount: number;
  onSaveToProfile: () => void;
}) {
  const [showDismissed, setShowDismissed] = useState(false);

  const primaryActive = suggestions.filter((s) => s.status !== 'rejected' && !isCrossClient(s));
  const crossClientActive = suggestions.filter((s) => s.status !== 'rejected' && isCrossClient(s));
  const active = suggestions.filter((s) => s.status !== 'rejected');
  const dismissed = suggestions.filter((s) => s.status === 'rejected');
  const savedCount = suggestions.filter((s) => s.status === 'committed').length;
  const readyToSave = suggestions.filter((s) => s.status === 'pending' || s.status === 'approved').length;

  if (suggestions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Brain className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-500">
            No insights extracted yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Record notes, then click &ldquo;Extract Preferences&rdquo; to build the client picture
          </p>
        </div>
      </div>
    );
  }

  const grouped = new Map<string, MeetingProfileSuggestion[]>();
  for (const s of primaryActive) {
    const cat = inferCategory(s);
    if (!grouped.has(cat)) grouped.set(cat, []);
    grouped.get(cat)!.push(s);
  }

  const orderedCategories = INSIGHT_CATEGORIES.filter((c) => grouped.has(c.key));

  // Group cross-client by target client
  const crossClientGrouped = new Map<string, { name: string; suggestions: MeetingProfileSuggestion[] }>();
  for (const s of crossClientActive) {
    const clientId = s.targetClientId!;
    if (!crossClientGrouped.has(clientId)) {
      crossClientGrouped.set(clientId, { name: getCrossClientName(s), suggestions: [] });
    }
    crossClientGrouped.get(clientId)!.suggestions.push(s);
  }

  return (
    <div className="space-y-4">
      {/* Summary bar */}
      <div className="flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-slate-800">
            {active.length} insight{active.length !== 1 ? 's' : ''} discovered
          </p>
          <p className="text-xs text-slate-500">
            {orderedCategories.length} categor{orderedCategories.length !== 1 ? 'ies' : 'y'}
            {crossClientActive.length > 0 && (
              <span className="text-indigo-600"> · {crossClientActive.length} for other client{crossClientActive.length !== 1 ? 's' : ''}</span>
            )}
            {savedCount > 0 && <span className="text-emerald-600"> · {savedCount} saved</span>}
            {dismissed.length > 0 && <span className="text-slate-400"> · {dismissed.length} dismissed</span>}
          </p>
        </div>
        {readyToSave > 0 && (
          <button
            onClick={onSaveToProfile}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
          >
            <CheckCircle2 className="h-3.5 w-3.5" />
            Save to Profile
          </button>
        )}
      </div>

      {/* Primary client category groups */}
      {orderedCategories.map((cat) => {
        const items = grouped.get(cat.key)!;
        return (
          <InsightCategoryGroup
            key={cat.key}
            category={cat}
            items={items}
            updatingId={updatingId}
            onDismiss={onDismiss}
          />
        );
      })}

      {/* Cross-client insights */}
      {crossClientGrouped.size > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-indigo-200" />
            <span className="text-[10px] font-semibold uppercase tracking-wider text-indigo-500">
              Insights for Other Clients
            </span>
            <div className="h-px flex-1 bg-indigo-200" />
          </div>

          {[...crossClientGrouped.entries()].map(([targetId, { name, suggestions: crossSuggestions }]) => (
            <div key={targetId} className="rounded-xl border border-indigo-200 bg-indigo-50/50 p-3">
              <div className="mb-2.5 flex items-center gap-2">
                <User className="h-3.5 w-3.5 text-indigo-500" />
                <span className="text-xs font-semibold text-indigo-700">{name}</span>
                <span className="ml-auto rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-600">
                  {crossSuggestions.length} insight{crossSuggestions.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="space-y-1.5">
                {crossSuggestions.map((s) => (
                  <InsightCard
                    key={s.id}
                    suggestion={s}
                    updatingId={updatingId}
                    onDismiss={onDismiss}
                    isCrossClientInsight
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Dismissed section */}
      {dismissed.length > 0 && (
        <div>
          <button
            onClick={() => setShowDismissed(!showDismissed)}
            className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-wider text-slate-400 hover:text-slate-500"
          >
            {showDismissed ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
            {dismissed.length} dismissed insight{dismissed.length !== 1 ? 's' : ''}
          </button>
          {showDismissed && (
            <div className="mt-2 space-y-1.5">
              {dismissed.map((s) => (
                <div
                  key={s.id}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 opacity-60 ${
                    isCrossClient(s) ? 'border-indigo-100 bg-indigo-50/30' : 'border-slate-100 bg-slate-50/50'
                  }`}
                >
                  <div className="flex-1 min-w-0">
                    {isCrossClient(s) && (
                      <span className="mr-1.5 text-[10px] font-medium text-indigo-500">
                        [{getCrossClientName(s)}]
                      </span>
                    )}
                    <span className="text-xs font-medium text-slate-500">{fieldLabel(s.targetField)}</span>
                    <span className="mx-1.5 text-slate-300">·</span>
                    <span className="text-xs text-slate-400">{formatValue(s.suggestedValue)}</span>
                  </div>
                  <button
                    onClick={() => onRestore(s.id)}
                    disabled={updatingId === s.id}
                    className="shrink-0 rounded px-2 py-0.5 text-[10px] font-medium text-blue-600 hover:bg-blue-50"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function InsightCategoryGroup({
  category,
  items,
  updatingId,
  onDismiss,
}: {
  category: { key: string; label: string; icon: string; color: string; bg: string; border: string };
  items: MeetingProfileSuggestion[];
  updatingId: string | null;
  onDismiss: (id: string) => void;
}) {
  const saved = items.filter((s) => s.status === 'committed');
  const active = items.filter((s) => s.status !== 'committed');

  return (
    <div className={`rounded-xl border ${category.border} ${category.bg} p-3`}>
      <div className="mb-2.5 flex items-center gap-2">
        <span className="text-base">{category.icon}</span>
        <span className={`text-xs font-semibold ${category.color}`}>{category.label}</span>
        <span className="ml-auto text-[10px] text-slate-400">{items.length} insight{items.length !== 1 ? 's' : ''}</span>
      </div>
      <div className="space-y-1.5">
        {active.map((s) => (
          <InsightCard
            key={s.id}
            suggestion={s}
            updatingId={updatingId}
            onDismiss={onDismiss}
          />
        ))}
        {saved.map((s) => (
          <div
            key={s.id}
            className="flex items-center gap-2 rounded-lg bg-white/60 px-3 py-2"
          >
            <CheckCircle2 className="h-3 w-3 shrink-0 text-emerald-500" />
            <span className="text-xs font-medium text-slate-600">{fieldLabel(s.targetField)}</span>
            <span className="text-xs text-slate-500">{formatValue(s.suggestedValue)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function InsightCard({
  suggestion: s,
  updatingId,
  onDismiss,
  isCrossClientInsight = false,
}: {
  suggestion: MeetingProfileSuggestion;
  updatingId: string | null;
  onDismiss: (id: string) => void;
  isCrossClientInsight?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isUpdating = updatingId === s.id;
  const confidenceWidth = Math.round(s.confidence * 100);

  return (
    <div className={`group rounded-lg border p-2.5 shadow-sm transition-shadow hover:shadow-md ${
      isCrossClientInsight ? 'border-indigo-100 bg-white' : 'border-white/80 bg-white'
    }`}>
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold text-slate-700">
              {fieldLabel(s.targetField)}
            </span>
            <div className="h-1 w-10 overflow-hidden rounded-full bg-slate-100" title={`${confidenceWidth}% confidence`}>
              <div
                className={`h-full rounded-full ${
                  s.confidence >= 0.7 ? 'bg-emerald-400' : s.confidence >= 0.5 ? 'bg-amber-400' : 'bg-slate-300'
                }`}
                style={{ width: `${confidenceWidth}%` }}
              />
            </div>
            {isCrossClientInsight && (
              <span className="rounded bg-indigo-100 px-1 py-0.5 text-[9px] font-medium text-indigo-600">
                second-hand
              </span>
            )}
          </div>
          <p className="mt-0.5 text-sm text-slate-900">{formatValue(s.suggestedValue)}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            onClick={() => setExpanded(!expanded)}
            className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-slate-100 hover:text-slate-500 group-hover:opacity-100"
            title="Show evidence"
          >
            <HelpCircle className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDismiss(s.id)}
            disabled={isUpdating}
            className="rounded p-1 text-slate-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-500 group-hover:opacity-100 disabled:opacity-30"
            title="Dismiss this insight"
          >
            {isUpdating ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <X className="h-3.5 w-3.5" />}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-2 space-y-1 border-t border-slate-100 pt-2">
          <p className="text-[11px] italic text-slate-500">&ldquo;{s.evidence}&rdquo;</p>
          <p className="text-[11px] text-slate-400">{s.rationale}</p>
          {s.sourceDescription && (
            <p className="text-[10px] text-indigo-500">{s.sourceDescription}</p>
          )}
          <p className="text-[10px] text-slate-300">{Math.round(s.confidence * 100)}% confidence</p>
        </div>
      )}
    </div>
  );
}

function ProfilePanel({
  completeness,
  preferences,
  suggestions,
}: {
  completeness: ProfileCompletenessResult;
  preferences: ClientPreference | null;
  suggestions: MeetingProfileSuggestion[];
}) {
  const criticalFields = getCriticalFields();
  const categorized = getFieldsByCategory();
  const sessionPending = suggestions.filter((s) => s.status === 'pending' || s.status === 'approved');

  const prefsRecord = preferences
    ? (JSON.parse(JSON.stringify(preferences)) as Record<string, unknown>)
    : {};

  const sessionValuesByField = new Map<string, unknown>();
  for (const s of sessionPending) {
    sessionValuesByField.set(s.targetField, s.suggestedValue);
  }

  return (
    <div className="space-y-4">
      {/* Readiness banner */}
      <div className={`rounded-xl border p-4 ${
        completeness.readyForTripPlanning
          ? 'border-emerald-200 bg-emerald-50'
          : 'border-amber-200 bg-amber-50'
      }`}>
        <div className="flex items-center gap-3">
          {completeness.readyForTripPlanning ? (
            <CircleCheck className="h-6 w-6 text-emerald-600" />
          ) : (
            <AlertTriangle className="h-6 w-6 text-amber-600" />
          )}
          <div>
            <p className={`text-sm font-semibold ${
              completeness.readyForTripPlanning ? 'text-emerald-800' : 'text-amber-800'
            }`}>
              {completeness.readyForTripPlanning
                ? 'Ready for trip planning'
                : 'Not yet ready for trip planning'}
            </p>
            <p className="text-xs text-slate-600">
              {completeness.overallPercent}% profile completeness
              {completeness.emptyCriticalFields.length > 0 &&
                ` · ${completeness.emptyCriticalFields.length} critical gap${completeness.emptyCriticalFields.length !== 1 ? 's' : ''}`}
            </p>
          </div>
        </div>
        {/* Progress bar */}
        <div className="mt-3 h-2 overflow-hidden rounded-full bg-white/60">
          <div
            className={`h-full rounded-full transition-all duration-500 ${
              completeness.readyForTripPlanning ? 'bg-emerald-500' : completeness.overallPercent > 50 ? 'bg-amber-500' : 'bg-red-400'
            }`}
            style={{ width: `${completeness.overallPercent}%` }}
          />
        </div>
      </div>

      {/* Critical gaps */}
      {completeness.emptyCriticalFields.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-red-700">
            Critical Gaps
          </p>
          <div className="space-y-1.5">
            {criticalFields
              .filter((f) => completeness.emptyCriticalFields.includes(f.key))
              .map((f) => (
                <div key={f.key} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-2">
                  <AlertTriangle className="h-3 w-3 text-red-500" />
                  <span className="text-xs font-medium text-red-800">{f.label}</span>
                  <span className="ml-auto text-[10px] text-red-500">{f.description}</span>
                </div>
              ))}
          </div>
        </div>
      )}

      {/* Category breakdown */}
      {Object.entries(categorized).map(([cat, fields]) => {
        const breakdown = completeness.categoryBreakdown[cat as keyof typeof completeness.categoryBreakdown];
        if (!breakdown) return null;

        return (
          <div key={cat} className="rounded-xl border border-slate-200 bg-white p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold capitalize text-slate-700">{cat}</span>
              <span className="text-[10px] text-slate-400">
                {breakdown.filled}/{breakdown.total} filled
              </span>
            </div>
            <div className="space-y-1.5">
              {fields.map((f) => {
                const committed = prefsRecord[f.key];
                const sessionVal = sessionValuesByField.get(f.key);
                const isFilled = completeness.filledFields.includes(f.key);
                const isSessionOnly = !isValuePresent(committed) && isValuePresent(sessionVal);

                return (
                  <div key={f.key} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5">
                    {isFilled ? (
                      <CircleCheck className="h-3 w-3 shrink-0 text-emerald-500" />
                    ) : (
                      <div className="h-3 w-3 shrink-0 rounded-full border border-slate-300" />
                    )}
                    <span className={`text-xs font-medium ${isFilled ? 'text-slate-700' : 'text-slate-400'}`}>
                      {f.label}
                    </span>
                    {isFilled && (
                      <span className="ml-auto truncate text-[11px] text-slate-500" style={{ maxWidth: '45%' }}>
                        {formatProfileValue(committed ?? sessionVal)}
                        {isSessionOnly && (
                          <span className="ml-1 text-[9px] text-amber-600">(session)</span>
                        )}
                      </span>
                    )}
                    {f.tripBlocking && !isFilled && (
                      <span className="ml-auto rounded bg-red-100 px-1 py-0.5 text-[9px] font-medium text-red-600">
                        required
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}

      {/* Session insights not yet committed */}
      {sessionPending.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-700">
            Session Insights (not yet saved)
          </p>
          <div className="space-y-1">
            {sessionPending.slice(0, 10).map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg bg-white/70 px-3 py-1.5">
                <span className="text-xs font-medium text-slate-700">{getFieldLabel(s.targetField)}</span>
                <span className="ml-auto truncate text-[11px] text-slate-500" style={{ maxWidth: '50%' }}>
                  {formatProfileValue(s.suggestedValue)}
                </span>
              </div>
            ))}
            {sessionPending.length > 10 && (
              <p className="text-center text-[10px] text-amber-600">
                +{sessionPending.length - 10} more
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function isValuePresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

function formatProfileValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function RecapPanel({ recap }: { recap: MeetingRecap | null }) {
  if (!recap) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <FileText className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-500">
            No recap generated yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Click &ldquo;Generate Recap&rdquo; to create a meeting summary
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <RecapSection title="Traveler Summary" content={recap.travelerSummary} />
      <RecapSection
        title="New Preferences Learned"
        content={recap.newPreferencesLearned}
      />
      <RecapSection
        title="Unresolved Questions"
        content={recap.unresolvedQuestions}
      />
      <RecapSection title="Next Steps" content={recap.nextSteps} />
      <div className="text-right text-[10px] text-slate-400">
        Generated {new Date(recap.createdAt).toLocaleString()}
      </div>
    </div>
  );
}

function RecapSection({ title, content }: { title: string; content: string }) {
  return (
    <div>
      <h3 className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-slate-500">
        {title}
      </h3>
      <div className="rounded-lg border border-slate-200 bg-white p-3">
        <p className="whitespace-pre-wrap text-sm text-slate-700">{content}</p>
      </div>
    </div>
  );
}

function CommitPreviewRow({
  item,
  isCrossClient = false,
}: {
  item: MeetingCommitPreviewItem;
  isCrossClient?: boolean;
}) {
  return (
    <div
      className={`rounded-lg border p-3 ${
        isCrossClient
          ? item.willOverwrite
            ? 'border-indigo-200 bg-indigo-50'
            : 'border-indigo-100 bg-indigo-50/50'
          : item.willOverwrite
            ? 'border-amber-200 bg-amber-50'
            : 'border-slate-100 bg-slate-50'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-700">
          {fieldLabel(item.targetField)}
        </span>
        {item.willOverwrite && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${
            isCrossClient ? 'bg-indigo-100 text-indigo-700' : 'bg-amber-100 text-amber-700'
          }`}>
            Updates existing
          </span>
        )}
      </div>
      {item.willOverwrite && (
        <div className="mt-1 text-xs text-slate-500">
          Currently: {formatValue(item.currentValue)}
        </div>
      )}
      <div className="mt-1 text-sm font-medium text-slate-900">
        {formatValue(item.suggestedValue)}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldLabel(field: string): string {
  return getFieldLabel(field);
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

// ---------------------------------------------------------------------------
// Invite Client Modal — styled to match FormsTab.BuildProfileModal
// ---------------------------------------------------------------------------

const INVITE_STATUS_CONFIG: Record<
  MeetingInvitation['status'],
  { label: string; color: string; Icon: React.ElementType }
> = {
  pending: { label: 'Sent', color: 'bg-amber-50 text-amber-700', Icon: Clock },
  opened: { label: 'Opened', color: 'bg-blue-50 text-blue-700', Icon: Mail },
  joined: { label: 'Joined', color: 'bg-emerald-50 text-emerald-700', Icon: Check },
  expired: { label: 'Expired', color: 'bg-slate-100 text-slate-600', Icon: AlertTriangle },
};

function formatInviteDate(s?: string | null): string {
  if (!s) return '—';
  return new Date(s).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function InviteClientModal({
  client,
  meetingTitle,
  invitations,
  invitationsLoading,
  sending,
  onSend,
  onResend,
  onRevoke,
  onClose,
}: {
  client: Client;
  meetingTitle: string;
  invitations: MeetingInvitation[];
  invitationsLoading: boolean;
  sending: boolean;
  onSend: (email: string, name?: string) => Promise<MeetingInvitation>;
  onResend: (id: string) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const defaultName = `${client.firstName} ${client.lastName}`.trim();
  const [email, setEmail] = useState(client.email ?? '');
  const [name, setName] = useState(defaultName);
  const [sendError, setSendError] = useState<string | null>(null);
  const [lastSent, setLastSent] = useState<MeetingInvitation | null>(null);
  const [copied, setCopied] = useState(false);

  const inviteLink = lastSent
    ? typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/meeting/${lastSent.token}`
      : `/meeting/${lastSent.token}`
    : '';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSendError(null);
    if (!email.trim()) {
      setSendError('Enter a recipient email');
      return;
    }
    try {
      const created = await onSend(email.trim(), name.trim() || undefined);
      setLastSent(created);
    } catch (err) {
      setSendError(err instanceof Error ? err.message : 'Failed to send invitation');
    }
  }

  async function handleCopy() {
    if (!inviteLink) return;
    try {
      await navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8">
      <div className="relative flex w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">Invite Client to Meeting</h2>
            <p className="text-xs text-slate-500">{meetingTitle}</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal body */}
        <div className="space-y-6 px-6 py-6">
          {/* Send form */}
          <div className="rounded-xl border border-slate-200 bg-slate-50/50 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-50">
                <Mail className="h-4.5 w-4.5 text-blue-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-900">Email a join link</h3>
                <p className="text-xs text-slate-500">
                  The client receives a link that opens the call directly.
                </p>
              </div>
            </div>
            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr,1.5fr]">
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Recipient name
                  </label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder={defaultName || 'Client'}
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-xs font-medium text-slate-600">
                    Recipient email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="client@example.com"
                    required
                    className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>
              {sendError && (
                <div className="rounded-lg bg-red-50 px-3 py-2 text-xs text-red-700">
                  {sendError}
                </div>
              )}
              <div className="flex items-center justify-end gap-2">
                <button
                  type="submit"
                  disabled={sending || !email.trim()}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                >
                  {sending ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                  {sending ? 'Sending…' : 'Send Invitation'}
                </button>
              </div>
            </form>

            {/* Success panel with copyable link */}
            {lastSent && (
              <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
                <div className="flex items-start gap-2">
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-emerald-900">
                      Invitation sent to {lastSent.recipientEmail}
                    </p>
                    <div className="mt-2 flex items-center gap-2">
                      <code className="min-w-0 flex-1 truncate rounded bg-white px-2 py-1 text-xs text-slate-700">
                        {inviteLink}
                      </code>
                      <button
                        onClick={handleCopy}
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1 text-xs font-medium text-emerald-700 hover:bg-emerald-50"
                      >
                        {copied ? (
                          <>
                            <Check className="h-3 w-3" />
                            Copied
                          </>
                        ) : (
                          <>
                            <Copy className="h-3 w-3" />
                            Copy
                          </>
                        )}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Existing invitations list */}
          <div>
            <h3 className="mb-3 text-sm font-semibold text-slate-900">
              Sent invitations
              {invitations.length > 0 && (
                <span className="ml-2 text-xs font-normal text-slate-500">
                  {invitations.length}
                </span>
              )}
            </h3>
            {invitationsLoading ? (
              <div className="flex justify-center py-6">
                <Loader2 className="h-5 w-5 animate-spin text-slate-400" />
              </div>
            ) : invitations.length === 0 ? (
              <div className="rounded-lg border border-dashed border-slate-200 py-8 text-center">
                <Mail className="mx-auto h-7 w-7 text-slate-300" />
                <p className="mt-2 text-sm text-slate-500">No invitations sent yet</p>
              </div>
            ) : (
              <div className="space-y-2">
                {invitations.map((inv) => (
                  <InvitationRow
                    key={inv.id}
                    invitation={inv}
                    onResend={onResend}
                    onRevoke={onRevoke}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function InvitationRow({
  invitation,
  onResend,
  onRevoke,
}: {
  invitation: MeetingInvitation;
  onResend: (id: string) => Promise<void>;
  onRevoke: (id: string) => Promise<void>;
}) {
  const cfg = INVITE_STATUS_CONFIG[invitation.status] ?? INVITE_STATUS_CONFIG.pending;
  const StatusIcon = cfg.Icon;
  const [working, setWorking] = useState<'resend' | 'revoke' | null>(null);

  const meetingLink =
    typeof window !== 'undefined'
      ? `${window.location.protocol}//${window.location.host}/meeting/${invitation.token}`
      : `/meeting/${invitation.token}`;

  async function handleResend() {
    setWorking('resend');
    try {
      await onResend(invitation.id);
    } finally {
      setWorking(null);
    }
  }

  async function handleRevoke() {
    if (!confirm('Revoke this invitation? The link will stop working.')) return;
    setWorking('revoke');
    try {
      await onRevoke(invitation.id);
    } finally {
      setWorking(null);
    }
  }

  const canAct = invitation.status !== 'joined';

  return (
    <div className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium text-slate-900">
            {invitation.recipientName || invitation.recipientEmail}
          </p>
          <span
            className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${cfg.color}`}
          >
            <StatusIcon className="h-3 w-3" />
            {cfg.label}
          </span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-400">
          <span>Sent {formatInviteDate(invitation.sentAt)}</span>
          {invitation.openedAt && (
            <>
              <span>·</span>
              <span>Opened {formatInviteDate(invitation.openedAt)}</span>
            </>
          )}
          {invitation.joinedAt && (
            <>
              <span>·</span>
              <span>Joined {formatInviteDate(invitation.joinedAt)}</span>
            </>
          )}
        </div>
      </div>
      <div className="flex items-center gap-1">
        <a
          href={meetingLink}
          target="_blank"
          rel="noopener noreferrer"
          title="Open link"
          className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <Copy className="h-3.5 w-3.5" />
        </a>
        {canAct && (
          <button
            onClick={handleResend}
            disabled={working !== null}
            title="Resend"
            className="rounded p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 disabled:opacity-60"
          >
            {working === 'resend' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
          </button>
        )}
        {canAct && (
          <button
            onClick={handleRevoke}
            disabled={working !== null}
            title="Revoke"
            className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-60"
          >
            {working === 'revoke' ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Trash2 className="h-3.5 w-3.5" />
            )}
          </button>
        )}
      </div>
    </div>
  );
}
