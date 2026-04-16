'use client';

import { useState } from 'react';
import {
  Plus,
  Trash2,
  Send,
  Sparkles,
  Loader2,
  GripVertical,
  ChevronDown,
  Check,
  Eye,
  X,
  ArrowLeft,
  ArrowRight,
  Pencil,
  LayoutList,
  FileQuestion,
} from 'lucide-react';
import {
  createCustomForm,
  generateCustomFormQuestions,
  type CustomFormQuestion,
  type CustomFormSection,
  type IntakeInvitation,
  type Client,
} from '@/lib/api-client';

const QUESTION_TYPES = [
  { value: 'text', label: 'Short answer' },
  { value: 'textarea', label: 'Long answer' },
  { value: 'select', label: 'Multiple choice' },
] as const;

function newQuestion(): CustomFormQuestion {
  return {
    id: `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    label: '',
    type: 'text',
    options: [],
  };
}

function newSection(): CustomFormSection {
  return {
    id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    title: '',
    questions: [newQuestion()],
  };
}

interface Props {
  client: Client;
  onCreated: (invitation: IntakeInvitation) => void;
  onCancel: () => void;
}

export default function CustomFormPanel({ client, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [recipientEmail, setRecipientEmail] = useState(client.email ?? '');
  const [recipientName, setRecipientName] = useState(`${client.firstName} ${client.lastName}`.trim());
  const [sections, setSections] = useState<CustomFormSection[]>([
    { ...newSection(), title: 'General' },
  ]);
  const [activeSection, setActiveSection] = useState(0);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOptions, setExpandedOptions] = useState<Set<string>>(new Set());
  const [editingSectionTitle, setEditingSectionTitle] = useState<number | null>(null);

  // Helper styling (matching intake form)
  const inputCls =
    'block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500 bg-white';
  const labelCls = 'mb-1.5 block text-sm font-medium text-slate-700';

  // ── Section helpers ────────────────────────────────────────────────────────

  function addSection() {
    const sec = newSection();
    setSections((prev) => [...prev, sec]);
    setActiveSection(sections.length);
  }

  function removeSection(idx: number) {
    if (sections.length <= 1) return;
    setSections((prev) => prev.filter((_, i) => i !== idx));
    if (activeSection >= sections.length - 1) {
      setActiveSection(Math.max(0, sections.length - 2));
    } else if (activeSection > idx) {
      setActiveSection(activeSection - 1);
    }
  }

  function updateSectionTitle(idx: number, title: string) {
    setSections((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, title } : s)),
    );
  }

  // ── Question helpers ──────────────────────────────────────────────────────

  function addQuestion() {
    setSections((prev) =>
      prev.map((s, i) =>
        i === activeSection
          ? { ...s, questions: [...s.questions, newQuestion()] }
          : s,
      ),
    );
  }

  function updateQuestion(qIdx: number, updates: Partial<CustomFormQuestion>) {
    setSections((prev) =>
      prev.map((s, i) =>
        i === activeSection
          ? {
              ...s,
              questions: s.questions.map((q, j) =>
                j === qIdx ? { ...q, ...updates } : q,
              ),
            }
          : s,
      ),
    );
  }

  function removeQuestion(qIdx: number) {
    const section = sections[activeSection];
    if (section.questions.length <= 1) return;
    setSections((prev) =>
      prev.map((s, i) =>
        i === activeSection
          ? { ...s, questions: s.questions.filter((_, j) => j !== qIdx) }
          : s,
      ),
    );
  }

  function addOption(qIdx: number) {
    setSections((prev) =>
      prev.map((s, i) =>
        i === activeSection
          ? {
              ...s,
              questions: s.questions.map((q, j) =>
                j === qIdx ? { ...q, options: [...(q.options ?? []), ''] } : q,
              ),
            }
          : s,
      ),
    );
  }

  function updateOption(qIdx: number, oIdx: number, value: string) {
    setSections((prev) =>
      prev.map((s, i) =>
        i === activeSection
          ? {
              ...s,
              questions: s.questions.map((q, j) =>
                j === qIdx
                  ? {
                      ...q,
                      options: (q.options ?? []).map((o, k) =>
                        k === oIdx ? value : o,
                      ),
                    }
                  : q,
              ),
            }
          : s,
      ),
    );
  }

  function removeOption(qIdx: number, oIdx: number) {
    setSections((prev) =>
      prev.map((s, i) =>
        i === activeSection
          ? {
              ...s,
              questions: s.questions.map((q, j) =>
                j === qIdx
                  ? { ...q, options: (q.options ?? []).filter((_, k) => k !== oIdx) }
                  : q,
              ),
            }
          : s,
      ),
    );
  }

  function toggleOptions(qId: string) {
    setExpandedOptions((prev) => {
      const next = new Set(prev);
      if (next.has(qId)) next.delete(qId);
      else next.add(qId);
      return next;
    });
  }

  // ── AI generation ─────────────────────────────────────────────────────────

  async function handleGenerate() {
    setGenerating(true);
    setError(null);
    try {
      const { questions: generated } = await generateCustomFormQuestions(
        client.id,
        aiPrompt.trim() || undefined,
      );
      const grouped: CustomFormSection[] = [];
      const sectionSize = Math.ceil(generated.length / Math.max(1, Math.ceil(generated.length / 4)));
      for (let i = 0; i < generated.length; i += sectionSize) {
        const chunk = generated.slice(i, i + sectionSize);
        grouped.push({
          id: `sec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          title: `Section ${grouped.length + 1}`,
          questions: chunk,
        });
      }
      setSections(grouped);
      setActiveSection(0);
      setShowAiPrompt(false);
      setAiPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions');
    } finally {
      setGenerating(false);
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  const canGoNext = activeSection < sections.length - 1;
  const canGoPrev = activeSection > 0;
  const goNext = () => canGoNext && setActiveSection((s) => s + 1);
  const goPrev = () => canGoPrev && setActiveSection((s) => s - 1);

  // ── Progress tracking ─────────────────────────────────────────────────────

  const filledSections = sections.map(
    (s) => s.questions.some((q) => q.label.trim()),
  );
  const totalQuestions = sections.reduce(
    (acc, s) => acc + s.questions.filter((q) => q.label.trim()).length,
    0,
  );
  const completedSectionCount = filledSections.filter(Boolean).length;
  const progressPct = sections.length > 0
    ? Math.round((completedSectionCount / sections.length) * 100)
    : 0;

  // ── Form submission ───────────────────────────────────────────────────────

  async function handleSend() {
    if (!title.trim()) { setError('Please enter a form title.'); return; }
    if (!recipientEmail.trim()) { setError('Please enter a recipient email.'); return; }
    const validSections = sections
      .map((s) => ({
        ...s,
        title: s.title.trim() || `Section ${sections.indexOf(s) + 1}`,
        questions: s.questions
          .filter((q) => q.label.trim())
          .map((q) => ({
            ...q,
            options: q.type === 'select' ? (q.options ?? []).filter((o) => o.trim()) : undefined,
          })),
      }))
      .filter((s) => s.questions.length > 0);

    if (validSections.length === 0) {
      setError('Add at least one question.');
      return;
    }

    setSending(true);
    setError(null);
    try {
      const created = await createCustomForm(client.id, {
        title: title.trim(),
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim() || undefined,
        sections: validSections,
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send form');
    } finally {
      setSending(false);
    }
  }

  // ── Current section ───────────────────────────────────────────────────────

  const currentSection = sections[activeSection];
  if (!currentSection) return null;

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/50 p-4 py-8">
      <div className="relative flex w-full max-w-4xl flex-col rounded-2xl bg-white shadow-2xl">
        {/* Modal header */}
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-violet-50">
              <FileQuestion className="h-4.5 w-4.5 text-violet-600" />
            </div>
            <h2 className="text-lg font-semibold text-slate-900">New Custom Form</h2>
          </div>
          <button
            onClick={onCancel}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Modal body */}
        <div className="overflow-y-auto p-6">
          {error && (
            <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
          )}

          {/* Form metadata */}
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label className={labelCls}>Form title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Honeymoon preferences, Asia trip questions..."
                className={inputCls}
              />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Recipient email</label>
              <input
                type="email"
                value={recipientEmail}
                onChange={(e) => setRecipientEmail(e.target.value)}
                placeholder="client@email.com"
                className={inputCls}
              />
            </div>
            <div>
              <label className={labelCls}>Recipient name</label>
              <input
                type="text"
                value={recipientName}
                onChange={(e) => setRecipientName(e.target.value)}
                placeholder="Optional"
                className={inputCls}
              />
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mb-6">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-500">
              <span>{completedSectionCount} of {sections.length} sections filled</span>
              <span>{totalQuestions} question{totalQuestions !== 1 ? 's' : ''} total</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full rounded-full bg-violet-600 transition-all duration-500"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>

          {/* AI generate bar */}
          <div className="mb-6 flex items-center gap-2">
            <button
              onClick={() => setShowAiPrompt((v) => !v)}
              disabled={generating}
              className="inline-flex items-center gap-1.5 rounded-lg border border-violet-200 bg-violet-50 px-3 py-1.5 text-xs font-medium text-violet-700 hover:bg-violet-100 disabled:opacity-60"
            >
              {generating ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              AI Generate All Sections
            </button>
          </div>

          {/* AI prompt box */}
          {showAiPrompt && (
            <div className="mb-6 rounded-xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
              <p className="text-xs font-medium text-violet-800">
                Optionally describe what you want to learn about this client, or leave blank to auto-generate based on their profile.
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. I want to understand their food preferences, activity level, and whether they travel with children..."
                rows={2}
                className="block w-full resize-none rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
              />
              <div className="flex gap-2">
                <button
                  onClick={handleGenerate}
                  disabled={generating}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                >
                  {generating ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Sparkles className="h-3.5 w-3.5" />
                  )}
                  {generating ? 'Generating...' : 'Generate questions'}
                </button>
                <button
                  onClick={() => setShowAiPrompt(false)}
                  className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Main content: sidebar + questions */}
          <div className="flex gap-6">
            {/* Section Sidebar */}
            <nav className="hidden w-52 shrink-0 md:block">
              <div className="space-y-1">
                {sections.map((s, i) => {
                  const isCurrent = i === activeSection;
                  const isFilled = filledSections[i];
                  return (
                    <div key={s.id} className="group relative">
                      {editingSectionTitle === i ? (
                        <input
                          autoFocus
                          type="text"
                          value={s.title}
                          onChange={(e) => updateSectionTitle(i, e.target.value)}
                          onBlur={() => setEditingSectionTitle(null)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') setEditingSectionTitle(null);
                          }}
                          placeholder={`Section ${i + 1}`}
                          className="w-full rounded-lg border border-violet-300 px-3 py-2 text-sm font-medium text-slate-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
                        />
                      ) : (
                        <button
                          type="button"
                          onClick={() => setActiveSection(i)}
                          className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-sm font-medium transition-colors ${
                            isCurrent
                              ? 'bg-violet-50 text-violet-700'
                              : isFilled
                                ? 'text-slate-700 hover:bg-slate-50'
                                : 'text-slate-400 hover:bg-slate-50 hover:text-slate-600'
                          }`}
                        >
                          <LayoutList
                            className={`h-4 w-4 ${
                              isCurrent ? 'text-violet-600' : isFilled ? 'text-green-500' : 'text-slate-300'
                            }`}
                          />
                          <span className="flex-1 truncate">
                            {s.title.trim() || `Section ${i + 1}`}
                          </span>
                          {isFilled && !isCurrent && (
                            <Check className="ml-auto h-3.5 w-3.5 text-green-500" />
                          )}
                        </button>
                      )}
                      {editingSectionTitle !== i && (
                        <div className="absolute right-1 top-1 hidden items-center gap-0.5 group-hover:flex">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingSectionTitle(i);
                            }}
                            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
                            title="Rename section"
                          >
                            <Pencil className="h-3 w-3" />
                          </button>
                          {sections.length > 1 && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeSection(i);
                              }}
                              className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                              title="Remove section"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={addSection}
                className="mt-3 flex w-full items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs font-medium text-slate-500 transition-colors hover:border-slate-400 hover:text-slate-700"
              >
                <Plus className="h-3.5 w-3.5" />
                Add section
              </button>
            </nav>

            {/* Question content */}
            <div className="min-w-0 flex-1">
              {/* Mobile section indicator */}
              <div className="mb-4 flex items-center gap-2 md:hidden">
                <span className="rounded-full bg-violet-100 px-2.5 py-0.5 text-xs font-semibold text-violet-700">
                  {activeSection + 1}/{sections.length}
                </span>
                <span className="text-sm font-medium text-slate-700">
                  {currentSection.title.trim() || `Section ${activeSection + 1}`}
                </span>
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-5 shadow-sm">
                <div className="mb-4 flex items-center gap-2">
                  <LayoutList className="h-5 w-5 text-violet-600" />
                  <h2 className="text-lg font-semibold text-slate-900">
                    {currentSection.title.trim() || `Section ${activeSection + 1}`}
                  </h2>
                </div>

                <div className="mb-3 flex items-center justify-between">
                  <label className="text-xs font-medium text-slate-700">
                    Questions ({currentSection.questions.filter((q) => q.label.trim()).length} of{' '}
                    {currentSection.questions.length})
                  </label>
                  <button
                    onClick={addQuestion}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    Add question
                  </button>
                </div>

                {/* Question list */}
                <div className="space-y-3">
                  {currentSection.questions.map((q, idx) => (
                    <div
                      key={q.id}
                      className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"
                    >
                      <div className="flex items-start gap-3">
                        <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-slate-300" />
                        <div className="flex-1 space-y-2.5">
                          <div className="flex items-start gap-2">
                            <input
                              type="text"
                              value={q.label}
                              onChange={(e) => updateQuestion(idx, { label: e.target.value })}
                              placeholder={`Question ${idx + 1}...`}
                              className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
                            />
                            <div className="relative">
                              <select
                                value={q.type}
                                onChange={(e) => {
                                  const type = e.target.value as CustomFormQuestion['type'];
                                  updateQuestion(idx, {
                                    type,
                                    options: type === 'select' && (!q.options || q.options.length === 0)
                                      ? ['', '']
                                      : q.options,
                                  });
                                  if (type === 'select') {
                                    setExpandedOptions((prev) => new Set([...prev, q.id]));
                                  }
                                }}
                                className="appearance-none rounded-lg border border-slate-200 bg-white py-2 pl-3 pr-8 text-xs text-slate-700 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
                              >
                                {QUESTION_TYPES.map((t) => (
                                  <option key={t.value} value={t.value}>{t.label}</option>
                                ))}
                              </select>
                              <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-3.5 w-3.5 text-slate-400" />
                            </div>
                          </div>

                          {q.type === 'select' && (
                            <div className="space-y-1.5">
                              <div className="flex items-center justify-between">
                                <button
                                  type="button"
                                  onClick={() => toggleOptions(q.id)}
                                  className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                                >
                                  <Eye className="h-3 w-3" />
                                  {(q.options ?? []).filter((o) => o.trim()).length} option
                                  {(q.options ?? []).filter((o) => o.trim()).length !== 1 ? 's' : ''}
                                </button>
                                {expandedOptions.has(q.id) && (
                                  <button
                                    type="button"
                                    onClick={() => addOption(idx)}
                                    className="text-xs font-medium text-violet-600 hover:text-violet-700"
                                  >
                                    + Add option
                                  </button>
                                )}
                              </div>

                              {expandedOptions.has(q.id) && (
                                <div className="space-y-1.5 rounded-lg bg-white p-2 border border-slate-200">
                                  {(q.options ?? []).map((opt, oIdx) => (
                                    <div key={oIdx} className="flex items-center gap-2">
                                      <Check className="h-3.5 w-3.5 shrink-0 text-slate-300" />
                                      <input
                                        type="text"
                                        value={opt}
                                        onChange={(e) => updateOption(idx, oIdx, e.target.value)}
                                        placeholder={`Option ${oIdx + 1}`}
                                        className="flex-1 rounded border border-slate-200 px-2 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
                                      />
                                      <button
                                        type="button"
                                        onClick={() => removeOption(idx, oIdx)}
                                        className="rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-500"
                                      >
                                        <X className="h-3 w-3" />
                                      </button>
                                    </div>
                                  ))}
                                  {(q.options ?? []).length === 0 && (
                                    <p className="py-1 text-center text-xs text-slate-400">
                                      No options yet — add some above
                                    </p>
                                  )}
                                </div>
                              )}
                            </div>
                          )}
                        </div>

                        <button
                          type="button"
                          onClick={() => removeQuestion(idx)}
                          disabled={currentSection.questions.length === 1}
                          className="mt-1.5 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Navigation */}
              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={goPrev}
                  disabled={!canGoPrev}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ArrowLeft className="h-4 w-4" />
                  Previous
                </button>

                <div className="flex items-center gap-3">
                  <button
                    type="button"
                    onClick={onCancel}
                    className="rounded-lg px-4 py-2 text-sm font-medium text-slate-500 hover:text-slate-700"
                  >
                    Cancel
                  </button>

                  {canGoNext ? (
                    <button
                      type="button"
                      onClick={goNext}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white shadow-sm hover:bg-violet-700"
                    >
                      Next
                      <ArrowRight className="h-4 w-4" />
                    </button>
                  ) : (
                    <button
                      onClick={handleSend}
                      disabled={sending || !title.trim() || !recipientEmail.trim()}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-5 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
                    >
                      {sending ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Send className="h-4 w-4" />
                      )}
                      {sending ? 'Sending...' : 'Send Form'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
