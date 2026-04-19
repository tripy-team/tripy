'use client';

import { useState, useEffect, useCallback } from 'react';
import { AlertTriangle, Check, X, ChevronDown, ChevronUp, Loader2 } from 'lucide-react';
import {
  getClientContradictions,
  updateContradiction,
  type ProfileContradiction,
  type ContradictionStatus,
} from '@/lib/api-client';
import { getFieldLabel } from '@/lib/profile-fields';

interface ClientContradictionsProps {
  clientId: string;
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map((v) => String(v)).join(', ');
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export default function ClientContradictions({ clientId }: ClientContradictionsProps) {
  const [items, setItems] = useState<ProfileContradiction[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [noteDrafts, setNoteDrafts] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setLoading(true);
    getClientContradictions(clientId, 'unresolved')
      .then(setItems)
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, [clientId]);

  useEffect(() => {
    load();
  }, [load]);

  const resolve = async (id: string, status: ContradictionStatus) => {
    setPendingId(id);
    try {
      await updateContradiction(clientId, id, {
        status,
        resolutionNote: noteDrafts[id] || null,
      });
      setItems((prev) => (prev ? prev.filter((c) => c.id !== id) : prev));
      setNoteDrafts((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
    } catch (err) {
      console.error('Failed to update contradiction:', err);
    } finally {
      setPendingId(null);
    }
  };

  if (loading || !items || items.length === 0) return null;

  return (
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-3 text-left"
      >
        <AlertTriangle className="h-5 w-5 flex-shrink-0 text-amber-600" />
        <div className="flex-1">
          <p className="text-sm font-semibold text-amber-900">
            {items.length} unresolved contradiction{items.length !== 1 ? 's' : ''}
          </p>
          <p className="mt-0.5 text-xs text-amber-700">
            The client said different things about the same preference. Review before recommending trips.
          </p>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 flex-shrink-0 text-amber-500" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-amber-500" />
        )}
      </button>

      {expanded && (
        <div className="mt-3 space-y-3">
          {items.map((c) => {
            const isPending = pendingId === c.id;
            return (
              <div
                key={c.id}
                className="rounded-lg border border-amber-200 bg-white p-3 text-xs"
              >
                <p className="text-sm font-semibold text-slate-900">
                  {getFieldLabel(c.field)}
                </p>
                <div className="mt-2 space-y-1 text-slate-700">
                  <div>
                    <span className="font-medium text-slate-500">Previously:</span>{' '}
                    {formatValue(c.previousValue)}
                  </div>
                  <div>
                    <span className="font-medium text-slate-500">Now:</span>{' '}
                    {formatValue(c.newValue)}
                  </div>
                  {c.evidence && (
                    <div className="italic text-slate-500">&ldquo;{c.evidence}&rdquo;</div>
                  )}
                  {c.session?.title && (
                    <div className="text-[11px] text-slate-400">
                      From meeting: {c.session.title}
                    </div>
                  )}
                </div>

                <input
                  type="text"
                  value={noteDrafts[c.id] ?? ''}
                  onChange={(e) =>
                    setNoteDrafts((prev) => ({ ...prev, [c.id]: e.target.value }))
                  }
                  placeholder="Resolution note (optional)"
                  disabled={isPending}
                  className="mt-3 w-full rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 placeholder:text-slate-400 focus:border-amber-400 focus:outline-none disabled:bg-slate-50"
                />

                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => resolve(c.id, 'resolved')}
                    disabled={isPending}
                    className="flex items-center gap-1 rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    Resolved
                  </button>
                  <button
                    onClick={() => resolve(c.id, 'dismissed')}
                    disabled={isPending}
                    className="flex items-center gap-1 rounded-md border border-slate-300 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
                  >
                    <X className="h-3 w-3" />
                    Dismiss
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
