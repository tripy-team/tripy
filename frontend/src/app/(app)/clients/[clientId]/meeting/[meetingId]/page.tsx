'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
  XCircle,
  GitMerge,
  FileText,
  MessageSquare,
  HelpCircle,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  RefreshCw,
  Mic,
  Clock,
} from 'lucide-react';
import {
  getMeetingSession,
  appendMeetingEntry,
  generateMeetingQuestions,
  extractMeetingProfileSuggestions,
  updateMeetingProfileSuggestion,
  getMeetingCommitPreview,
  commitMeetingSuggestions,
  generateMeetingRecap,
  updateMeetingSession,
} from '@/lib/api-client';
import type {
  MeetingSession,
  MeetingEntryItem,
  MeetingQuestionSuggestion,
  MeetingProfileSuggestion,
  MeetingCommitPreviewItem,
  MeetingRecap,
} from '@/lib/api-client';

type Panel = 'questions' | 'suggestions' | 'recap';

export default function MeetingCopilotPage() {
  const params = useParams();
  const router = useRouter();
  const clientId = params.clientId as string;
  const meetingId = params.meetingId as string;

  const [session, setSession] = useState<MeetingSession | null>(null);
  const [entries, setEntries] = useState<MeetingEntryItem[]>([]);
  const [questions, setQuestions] = useState<MeetingQuestionSuggestion[]>([]);
  const [suggestions, setSuggestions] = useState<MeetingProfileSuggestion[]>([]);
  const [recap, setRecap] = useState<MeetingRecap | null>(null);

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

  const entriesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadSession = useCallback(async () => {
    try {
      const data = await getMeetingSession(clientId, meetingId);
      setSession(data);
      setEntries(data.entries || []);
      setQuestions(data.questionSuggestions || []);
      setSuggestions(data.profileSuggestions || []);
      setRecap(data.recap || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load meeting session');
    } finally {
      setLoading(false);
    }
  }, [clientId, meetingId]);

  useEffect(() => {
    loadSession();
  }, [loadSession]);

  useEffect(() => {
    entriesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

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

  const handleSendAnswer = async (questionText: string) => {
    const answer = prompt(`Record answer for: "${questionText}"`);
    if (!answer?.trim()) return;
    try {
      const entry = await appendMeetingEntry(clientId, meetingId, {
        role: 'question_answer',
        content: answer.trim(),
        metadata: { questionText },
      });
      setEntries((prev) => [...prev, entry]);
    } catch (err) {
      console.error('Failed to record answer:', err);
    }
  };

  const handleGenerateQuestions = async (followUp = false) => {
    setGeneratingQuestions(true);
    try {
      const lastEntry = entries[entries.length - 1];
      const result = await generateMeetingQuestions(clientId, meetingId, {
        followUp,
        latestAnswer: followUp ? lastEntry?.content : undefined,
      });
      setQuestions((prev) => [...result.questions, ...prev]);
      setActivePanel('questions');
      setQuestionsExpanded(true);
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
      setSuggestions((prev) => [...result.suggestions, ...prev]);
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

      {/* Main layout: two columns */}
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
                  <EntryBubble key={entry.id} entry={entry} />
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
                { key: 'suggestions' as Panel, label: 'Suggestions', icon: Brain, count: pendingCount + approvedCount },
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
                  {tab.count > 0 && (
                    <span className="ml-1 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-blue-100 px-1 text-[10px] font-bold text-blue-700">
                      {tab.count}
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>

          {/* Panel content */}
          <div className="flex-1 overflow-y-auto p-4">
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
                onApprove={(id) => handleApproveSuggestion(id, 'approved')}
                onReject={(id) => handleApproveSuggestion(id, 'rejected')}
                approvedCount={approvedCount}
                committedCount={committedCount}
                onShowCommit={handleShowCommitPreview}
              />
            )}

            {activePanel === 'recap' && (
              <RecapPanel recap={recap} />
            )}
          </div>
        </div>
      </div>

      {/* Commit Modal */}
      {showCommitModal && commitPreview && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="mx-4 max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <GitMerge className="h-5 w-5 text-blue-600" />
                <h2 className="text-lg font-bold text-slate-900">
                  Merge Preview
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
                No approved suggestions to commit.
              </p>
            ) : (
              <>
                <p className="mb-4 text-sm text-slate-600">
                  The following approved updates will be written to the client profile:
                </p>
                <div className="space-y-3">
                  {commitPreview.map((item) => (
                    <div
                      key={item.id}
                      className={`rounded-lg border p-3 ${
                        item.willOverwrite
                          ? 'border-amber-200 bg-amber-50'
                          : 'border-emerald-200 bg-emerald-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-semibold text-slate-700">
                          {fieldLabel(item.targetField)}
                        </span>
                        {item.willOverwrite && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-medium text-amber-700">
                            Overwrite
                          </span>
                        )}
                      </div>
                      {item.willOverwrite && (
                        <div className="mt-1 text-xs text-slate-500">
                          Current: {formatValue(item.currentValue)}
                        </div>
                      )}
                      <div className="mt-1 text-xs font-medium text-slate-800">
                        New: {formatValue(item.suggestedValue)}
                      </div>
                      <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
                        <span>Confidence: {Math.round(item.confidence * 100)}%</span>
                        <span>&middot;</span>
                        <span className="italic">{item.evidence}</span>
                      </div>
                    </div>
                  ))}
                </div>
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
                    Commit to Profile
                  </button>
                  <button
                    onClick={() => {
                      setShowCommitModal(false);
                      setCommitPreview(null);
                    }}
                    className="rounded-lg border border-slate-200 px-4 py-2.5 text-sm font-medium text-slate-600 hover:bg-slate-50"
                  >
                    Cancel
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

function EntryBubble({ entry }: { entry: MeetingEntryItem }) {
  const isQuestion = entry.role === 'question_answer';
  const isSystem = entry.role === 'system';
  const questionText = entry.metadata?.questionText as string | undefined;

  return (
    <div
      className={`rounded-xl p-3.5 ${
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
      <p className="whitespace-pre-wrap text-sm text-slate-700">{entry.content}</p>
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
  onUseQuestion: (questionText: string) => void;
  isActive: boolean;
}) {
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  const sorted = [...questions].sort(
    (a, b) =>
      (priorityOrder[a.priority as keyof typeof priorityOrder] ?? 1) -
      (priorityOrder[b.priority as keyof typeof priorityOrder] ?? 1),
  );
  const unused = sorted.filter((q) => !q.isUsed);
  const used = sorted.filter((q) => q.isUsed);

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

  return (
    <div className="space-y-3">
      <button
        onClick={onToggle}
        className="flex w-full items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500"
      >
        {expanded ? (
          <ChevronDown className="h-3.5 w-3.5" />
        ) : (
          <ChevronRight className="h-3.5 w-3.5" />
        )}
        AI-Suggested Questions ({unused.length} remaining)
      </button>

      {expanded && (
        <div className="space-y-2">
          {unused.map((q) => (
            <QuestionCard
              key={q.id}
              question={q}
              onUse={() => onUseQuestion(q.questionText)}
              isActive={isActive}
            />
          ))}
        </div>
      )}

      {used.length > 0 && (
        <>
          <p className="mt-4 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Previously Used
          </p>
          <div className="space-y-2 opacity-60">
            {used.map((q) => (
              <QuestionCard key={q.id} question={q} onUse={() => {}} isActive={false} />
            ))}
          </div>
        </>
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
  onUse: () => void;
  isActive: boolean;
}) {
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
      {isActive && (
        <button
          onClick={onUse}
          className="mt-2 inline-flex items-center gap-1 rounded-md bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700"
        >
          <MessageSquare className="h-3 w-3" />
          Record Answer
        </button>
      )}
    </div>
  );
}

function SuggestionsPanel({
  suggestions,
  updatingId,
  onApprove,
  onReject,
  approvedCount,
  committedCount,
  onShowCommit,
}: {
  suggestions: MeetingProfileSuggestion[];
  updatingId: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  approvedCount: number;
  committedCount: number;
  onShowCommit: () => void;
}) {
  const pending = suggestions.filter((s) => s.status === 'pending');
  const approved = suggestions.filter((s) => s.status === 'approved');
  const committed = suggestions.filter((s) => s.status === 'committed');
  const rejected = suggestions.filter((s) => s.status === 'rejected');

  if (suggestions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <Brain className="mx-auto h-10 w-10 text-slate-300" />
          <p className="mt-3 text-sm font-medium text-slate-500">
            No preferences extracted yet
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Record notes, then click &ldquo;Extract Preferences&rdquo; to analyze
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {approvedCount > 0 && (
        <button
          onClick={onShowCommit}
          className="flex w-full items-center gap-3 rounded-xl border border-blue-200 bg-blue-50 p-3 text-left transition-colors hover:bg-blue-100"
        >
          <GitMerge className="h-5 w-5 text-blue-600" />
          <div className="flex-1">
            <p className="text-sm font-medium text-blue-900">
              {approvedCount} approved update{approvedCount !== 1 ? 's' : ''} ready to commit
            </p>
            <p className="text-xs text-blue-600">
              Preview merge before writing to client profile
            </p>
          </div>
          <ChevronRight className="h-4 w-4 text-blue-400" />
        </button>
      )}

      {committedCount > 0 && (
        <div className="flex items-center gap-2 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
          <CheckCircle2 className="h-4 w-4" />
          {committedCount} update{committedCount !== 1 ? 's' : ''} committed to profile
        </div>
      )}

      {pending.length > 0 && (
        <SuggestionGroup
          title="Pending Review"
          suggestions={pending}
          updatingId={updatingId}
          onApprove={onApprove}
          onReject={onReject}
          showActions
        />
      )}

      {approved.length > 0 && (
        <SuggestionGroup
          title="Approved"
          suggestions={approved}
          updatingId={updatingId}
          onApprove={onApprove}
          onReject={onReject}
          showActions={false}
        />
      )}

      {committed.length > 0 && (
        <SuggestionGroup
          title="Committed"
          suggestions={committed}
          updatingId={null}
          onApprove={() => {}}
          onReject={() => {}}
          showActions={false}
        />
      )}

      {rejected.length > 0 && (
        <SuggestionGroup
          title="Rejected"
          suggestions={rejected}
          updatingId={null}
          onApprove={() => {}}
          onReject={() => {}}
          showActions={false}
        />
      )}
    </div>
  );
}

function SuggestionGroup({
  title,
  suggestions,
  updatingId,
  onApprove,
  onReject,
  showActions,
}: {
  title: string;
  suggestions: MeetingProfileSuggestion[];
  updatingId: string | null;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  showActions: boolean;
}) {
  return (
    <div>
      <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-400">
        {title} ({suggestions.length})
      </p>
      <div className="space-y-2">
        {suggestions.map((s) => {
          const isUpdating = updatingId === s.id;
          const confidenceColor =
            s.confidence >= 0.7
              ? 'text-emerald-600'
              : s.confidence >= 0.5
                ? 'text-amber-600'
                : 'text-slate-500';
          const statusBg: Record<string, string> = {
            pending: 'border-blue-100',
            approved: 'border-emerald-200 bg-emerald-50/50',
            committed: 'border-emerald-300 bg-emerald-50',
            rejected: 'border-slate-100 opacity-60',
          };

          return (
            <div
              key={s.id}
              className={`rounded-lg border p-3 ${statusBg[s.status] ?? 'border-slate-200'}`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-slate-700">
                  {fieldLabel(s.targetField)}
                </span>
                <span className={`text-[10px] font-medium ${confidenceColor}`}>
                  {Math.round(s.confidence * 100)}% confident
                </span>
              </div>
              <div className="mt-1 text-sm font-medium text-slate-900">
                {formatValue(s.suggestedValue)}
              </div>
              <p className="mt-1 text-xs italic text-slate-500">
                &ldquo;{s.evidence}&rdquo;
              </p>
              <p className="mt-0.5 text-xs text-slate-500">{s.rationale}</p>

              {showActions && (
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => onApprove(s.id)}
                    disabled={isUpdating}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
                  >
                    {isUpdating ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    Approve
                  </button>
                  <button
                    onClick={() => onReject(s.id)}
                    disabled={isUpdating}
                    className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600 hover:bg-slate-200 disabled:opacity-60"
                  >
                    <XCircle className="h-3 w-3" />
                    Reject
                  </button>
                </div>
              )}

              {s.status === 'committed' && (
                <div className="mt-2 flex items-center gap-1 text-[10px] text-emerald-600">
                  <CheckCircle2 className="h-3 w-3" />
                  Written to profile
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fieldLabel(field: string): string {
  const labels: Record<string, string> = {
    preferredCabin: 'Preferred Cabin',
    prefersNonstop: 'Prefers Nonstop',
    maxLayoverMinutes: 'Max Layover',
    willingToReposition: 'Willing to Reposition',
    avoidBasicEconomy: 'Avoid Basic Economy',
    preferredAirlines: 'Preferred Airlines',
    avoidedAirlines: 'Avoided Airlines',
    preferredHotelTypes: 'Hotel Types',
    roomPreferences: 'Room Preferences',
    locationPreferences: 'Location Preferences',
    redemptionStyle: 'Redemption Style',
    budgetSensitivity: 'Budget Sensitivity',
    pointsVsCash: 'Points vs Cash',
    accessibilityNeeds: 'Accessibility Needs',
    foodPreferences: 'Food Preferences',
    activityPreferences: 'Activity Preferences',
    familyConsiderations: 'Family Considerations',
    specialOccasions: 'Special Occasions',
    dislikes: 'Dislikes',
    dealbreakers: 'Dealbreakers',
    notes: 'Notes',
  };
  return labels[field] || field.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
