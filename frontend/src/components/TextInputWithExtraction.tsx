'use client';

import { useMemo, useState } from 'react';
import { Sparkles, Check, Loader2 } from 'lucide-react';

// Client-side preprocess — mirrors server lib/text-extraction-inference.ts
// We duplicate here to show chips immediately without waiting on the LLM.
function preprocessTokens(text: string): string[] {
  if (!text) return [];
  const cleaned = text
    .toLowerCase()
    .replace(/\band\b/g, ',')
    .replace(/[;/\n]/g, ',');
  const parts = cleaned.split(',');
  const tokens: string[] = [];
  const seen = new Set<string>();
  for (const raw of parts) {
    const t = raw.trim().replace(/[.!?]+$/, '');
    if (!t || t.length < 2 || t.length > 40 || seen.has(t)) continue;
    seen.add(t);
    tokens.push(t);
  }
  return tokens;
}

export interface ConfirmedToken {
  token: string;
  category: string;
}

type CommonProps = {
  fieldName: string;
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  confirmedTokens?: ConfirmedToken[];
  extracting?: boolean;
  inputClassName?: string;
  labelClassName?: string;
  hideChips?: boolean;
};

type Props =
  | (CommonProps & { multiline?: false; rows?: never })
  | (CommonProps & { multiline: true; rows?: number });

const DEFAULT_INPUT_CLS =
  'block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 bg-white';
const DEFAULT_LABEL_CLS = 'mb-1.5 block text-sm font-medium text-slate-700';

export function TextInputWithExtraction(props: Props) {
  const {
    fieldName,
    label,
    value,
    onChange,
    placeholder,
    confirmedTokens,
    extracting,
    inputClassName = DEFAULT_INPUT_CLS,
    labelClassName = DEFAULT_LABEL_CLS,
    hideChips,
  } = props;

  const [focused, setFocused] = useState(false);

  const pendingTokens = useMemo(() => preprocessTokens(value), [value]);

  const confirmedMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const t of confirmedTokens ?? []) m.set(t.token, t.category);
    return m;
  }, [confirmedTokens]);

  const showChips =
    !hideChips && (pendingTokens.length > 0 || (confirmedTokens?.length ?? 0) > 0);

  return (
    <div>
      {label && (
        <label className={labelClassName} htmlFor={`field-${fieldName}`}>
          {label}
        </label>
      )}
      {props.multiline ? (
        <textarea
          id={`field-${fieldName}`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          rows={props.rows ?? 3}
          className={inputClassName}
        />
      ) : (
        <input
          id={`field-${fieldName}`}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          placeholder={placeholder}
          className={inputClassName}
        />
      )}

      {showChips && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-500">
            <Sparkles className="h-3 w-3" />
            {extracting ? 'AI is reading…' : 'Extracted'}
          </span>
          {pendingTokens.map((tok) => {
            const confirmedCategory = confirmedMap.get(tok);
            const isConfirmed = Boolean(confirmedCategory);
            return (
              <span
                key={tok}
                title={
                  isConfirmed
                    ? `Saved as ${confirmedCategory?.replace(/_/g, ' ')}`
                    : focused
                      ? 'Will be sent to AI when you move on'
                      : 'Pending — will be analyzed'
                }
                className={
                  isConfirmed
                    ? 'inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-medium text-blue-700 ring-1 ring-blue-200'
                    : 'inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200'
                }
              >
                {isConfirmed && <Check className="h-3 w-3" />}
                {extracting && !isConfirmed && (
                  <Loader2 className="h-3 w-3 animate-spin" />
                )}
                {tok}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

export { preprocessTokens };
