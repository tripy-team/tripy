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
} from 'lucide-react';
import {
  createCustomForm,
  generateCustomFormQuestions,
  type CustomFormQuestion,
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

interface Props {
  client: Client;
  onCreated: (invitation: IntakeInvitation) => void;
  onCancel: () => void;
}

export default function CustomFormPanel({ client, onCreated, onCancel }: Props) {
  const [title, setTitle] = useState('');
  const [recipientEmail, setRecipientEmail] = useState(client.email ?? '');
  const [recipientName, setRecipientName] = useState(`${client.firstName} ${client.lastName}`.trim());
  const [questions, setQuestions] = useState<CustomFormQuestion[]>([newQuestion()]);
  const [sending, setSending] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiPrompt, setShowAiPrompt] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedOptions, setExpandedOptions] = useState<Set<string>>(new Set());

  // ── Question helpers ──────────────────────────────────────────────────────

  function addQuestion() {
    setQuestions((prev) => [...prev, newQuestion()]);
  }

  function updateQuestion(idx: number, updates: Partial<CustomFormQuestion>) {
    setQuestions((prev) =>
      prev.map((q, i) => (i === idx ? { ...q, ...updates } : q)),
    );
  }

  function removeQuestion(idx: number) {
    setQuestions((prev) => prev.filter((_, i) => i !== idx));
  }

  function addOption(qIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIdx ? { ...q, options: [...(q.options ?? []), ''] } : q,
      ),
    );
  }

  function updateOption(qIdx: number, oIdx: number, value: string) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIdx
          ? {
              ...q,
              options: (q.options ?? []).map((o, j) => (j === oIdx ? value : o)),
            }
          : q,
      ),
    );
  }

  function removeOption(qIdx: number, oIdx: number) {
    setQuestions((prev) =>
      prev.map((q, i) =>
        i === qIdx
          ? { ...q, options: (q.options ?? []).filter((_, j) => j !== oIdx) }
          : q,
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
      setQuestions(generated);
      setShowAiPrompt(false);
      setAiPrompt('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions');
    } finally {
      setGenerating(false);
    }
  }

  // ── Form submission ───────────────────────────────────────────────────────

  async function handleSend() {
    if (!title.trim()) { setError('Please enter a form title.'); return; }
    if (!recipientEmail.trim()) { setError('Please enter a recipient email.'); return; }
    const validQuestions = questions.filter((q) => q.label.trim());
    if (validQuestions.length === 0) { setError('Add at least one question.'); return; }

    setSending(true);
    setError(null);
    try {
      const created = await createCustomForm(client.id, {
        title: title.trim(),
        recipientEmail: recipientEmail.trim(),
        recipientName: recipientName.trim() || undefined,
        questions: validQuestions.map((q) => ({
          ...q,
          options: q.type === 'select' ? (q.options ?? []).filter((o) => o.trim()) : undefined,
        })),
      });
      onCreated(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send form');
    } finally {
      setSending(false);
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 p-5">
        <h3 className="font-semibold text-slate-900">New Custom Form</h3>
        <button
          onClick={onCancel}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="p-5 space-y-6">
        {error && (
          <div className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</div>
        )}

        {/* Form metadata */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-3">
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Form title</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Honeymoon preferences, Asia trip questions…"
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Recipient email</label>
            <input
              type="email"
              value={recipientEmail}
              onChange={(e) => setRecipientEmail(e.target.value)}
              placeholder="client@email.com"
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
          <div>
            <label className="mb-1.5 block text-xs font-medium text-slate-700">Recipient name</label>
            <input
              type="text"
              value={recipientName}
              onChange={(e) => setRecipientName(e.target.value)}
              placeholder="Optional"
              className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
            />
          </div>
        </div>

        {/* Questions section */}
        <div>
          <div className="mb-3 flex items-center justify-between">
            <label className="text-xs font-medium text-slate-700">Questions ({questions.filter(q => q.label.trim()).length} of {questions.length})</label>
            <div className="flex items-center gap-2">
              {/* AI generate */}
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
                AI Generate
              </button>
              {/* Add question */}
              <button
                onClick={addQuestion}
                className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-slate-50"
              >
                <Plus className="h-3.5 w-3.5" />
                Add question
              </button>
            </div>
          </div>

          {/* AI prompt box */}
          {showAiPrompt && (
            <div className="mb-4 rounded-xl border border-violet-200 bg-violet-50/50 p-4 space-y-3">
              <p className="text-xs font-medium text-violet-800">
                Optionally describe what you want to learn about this client, or leave blank to auto-generate based on their profile.
              </p>
              <textarea
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
                placeholder="e.g. I want to understand their food preferences, activity level, and whether they travel with children…"
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
                  {generating ? 'Generating…' : 'Generate questions'}
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

          {/* Question list */}
          <div className="space-y-3">
            {questions.map((q, idx) => (
              <div
                key={q.id}
                className="rounded-xl border border-slate-200 bg-slate-50/50 p-4"
              >
                <div className="flex items-start gap-3">
                  <GripVertical className="mt-2.5 h-4 w-4 shrink-0 text-slate-300" />
                  <div className="flex-1 space-y-2.5">
                    {/* Question text + type */}
                    <div className="flex items-start gap-2">
                      <input
                        type="text"
                        value={q.label}
                        onChange={(e) => updateQuestion(idx, { label: e.target.value })}
                        placeholder={`Question ${idx + 1}…`}
                        className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-violet-500"
                      />
                      {/* Type selector */}
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

                    {/* Options for select type */}
                    {q.type === 'select' && (
                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between">
                          <button
                            type="button"
                            onClick={() => toggleOptions(q.id)}
                            className="flex items-center gap-1 text-xs font-medium text-slate-500 hover:text-slate-700"
                          >
                            <Eye className="h-3 w-3" />
                            {(q.options ?? []).filter(o => o.trim()).length} option{(q.options ?? []).filter(o => o.trim()).length !== 1 ? 's' : ''}
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
                              <p className="py-1 text-center text-xs text-slate-400">No options yet — add some above</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => removeQuestion(idx)}
                    disabled={questions.length === 1}
                    className="mt-1.5 rounded-lg p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-500 disabled:opacity-30"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Send action */}
        <div className="flex items-center justify-between border-t border-slate-100 pt-4">
          <p className="text-xs text-slate-400">
            The client will receive an email with a link to complete this form.
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={onCancel}
              className="rounded-lg border border-slate-200 px-4 py-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSend}
              disabled={sending || !title.trim() || !recipientEmail.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-60"
            >
              {sending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
              {sending ? 'Sending…' : 'Send form'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
