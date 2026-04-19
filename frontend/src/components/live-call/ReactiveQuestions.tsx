'use client';

import { useState } from 'react';
import { HelpCircle, Sparkles, ChevronRight, Send } from 'lucide-react';
import type { ReactiveQuestion } from '@/lib/cactus-ws';

interface ReactiveQuestionsProps {
  questions: ReactiveQuestionWithMeta[];
  onUseQuestion: (questionText: string, category: string, targetFields: string[]) => void;
}

export interface ReactiveQuestionWithMeta extends ReactiveQuestion {
  isNew: boolean;
  timestamp: number;
  isUsed?: boolean;
}

export default function ReactiveQuestions({
  questions,
  onUseQuestion,
}: ReactiveQuestionsProps) {
  const [expandedIdx, setExpandedIdx] = useState<number | null>(null);
  const [answerInputs, setAnswerInputs] = useState<Record<number, string>>({});

  if (questions.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-center">
          <HelpCircle className="mx-auto h-8 w-8 text-slate-300" />
          <p className="mt-2 text-sm font-medium text-slate-500">
            Questions will appear here
          </p>
          <p className="mt-1 text-xs text-slate-400">
            As the client speaks, AI will suggest follow-up questions
          </p>
        </div>
      </div>
    );
  }

  const unusedQuestions = questions.filter((q) => !q.isUsed);
  const usedQuestions = questions.filter((q) => q.isUsed);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles className="h-4 w-4 text-blue-600" />
        <span className="text-xs font-semibold uppercase tracking-wider text-slate-500">
          Suggested Questions ({unusedQuestions.length})
        </span>
      </div>

      {unusedQuestions.map((q, i) => {
        const globalIdx = questions.indexOf(q);
        const isExpanded = expandedIdx === globalIdx;

        return (
          <div
            key={globalIdx}
            className={`rounded-xl border transition-all ${
              q.isNew
                ? 'border-blue-300 bg-blue-50 shadow-sm animate-in slide-in-from-top-2 fade-in duration-300'
                : 'border-slate-200 bg-white'
            }`}
          >
            <button
              onClick={() => setExpandedIdx(isExpanded ? null : globalIdx)}
              className="flex w-full items-start gap-3 px-3 py-2.5 text-left"
            >
              <PriorityDot priority={q.priority} />
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-800">
                  {q.questionText}
                </p>
              </div>
              <ChevronRight
                className={`mt-0.5 h-4 w-4 shrink-0 text-slate-400 transition-transform ${
                  isExpanded ? 'rotate-90' : ''
                }`}
              />
            </button>

            {isExpanded && (
              <div className="border-t border-slate-100 px-3 py-2.5">
                <div className="mb-2 flex flex-wrap gap-1">
                  <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                    {q.category}
                  </span>
                  {q.targetFields.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium text-blue-700"
                    >
                      {f}
                    </span>
                  ))}
                </div>
                <p className="mb-2 text-xs text-slate-600">{q.reason}</p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    placeholder="Record client's answer..."
                    value={answerInputs[globalIdx] || ''}
                    onChange={(e) =>
                      setAnswerInputs((prev) => ({ ...prev, [globalIdx]: e.target.value }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && answerInputs[globalIdx]?.trim()) {
                        onUseQuestion(q.questionText, q.category, q.targetFields);
                        setAnswerInputs((prev) => ({ ...prev, [globalIdx]: '' }));
                        setExpandedIdx(null);
                      }
                    }}
                    className="flex-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <button
                    onClick={() => {
                      onUseQuestion(q.questionText, q.category, q.targetFields);
                      setAnswerInputs((prev) => ({ ...prev, [globalIdx]: '' }));
                      setExpandedIdx(null);
                    }}
                    className="rounded-lg bg-blue-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                  >
                    <Send className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {usedQuestions.length > 0 && (
        <div className="mt-4">
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">
            Asked ({usedQuestions.length})
          </span>
          <div className="mt-1.5 space-y-1">
            {usedQuestions.map((q, i) => (
              <div
                key={i}
                className="rounded-lg bg-slate-50 px-3 py-1.5 text-xs text-slate-400 line-through"
              >
                {q.questionText}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PriorityDot({ priority }: { priority: string }) {
  const color =
    priority === 'high'
      ? 'bg-red-500'
      : priority === 'medium'
        ? 'bg-amber-500'
        : 'bg-slate-400';

  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
