'use client';

import { useState, useEffect, useCallback } from 'react';
import {
  FileText,
  RefreshCw,
  Loader2,
  Save,
  X,
  Pencil,
  Clock,
  ChevronDown,
  Sparkles,
  CheckCircle2,
} from 'lucide-react';
import {
  getTripBrief,
  generateTripBrief,
  updateTripBrief,
  getTripBriefVersions,
} from '@/lib/api-client';
import type { TripBrief, TripBriefVersion } from '@/lib/api-client';

const BRIEF_SECTIONS = [
  { key: 'executiveSummary', label: 'Executive Summary', icon: '📋' },
  { key: 'hardConstraints', label: 'Hard Constraints', icon: '🚫' },
  { key: 'softPreferences', label: 'Soft Preferences', icon: '💡' },
  { key: 'pointsCashPosture', label: 'Points / Cash Posture', icon: '💳' },
  { key: 'acceptableTradeoffs', label: 'Acceptable Tradeoffs', icon: '⚖️' },
  { key: 'doNotRecommend', label: 'Do Not Recommend', icon: '🚷' },
  { key: 'operationalNotes', label: 'Operational Notes', icon: '📝' },
] as const;

type SectionKey = (typeof BRIEF_SECTIONS)[number]['key'];

interface TripBriefPanelProps {
  tripId: string;
  hasCompletedIntake: boolean;
}

export default function TripBriefPanel({ tripId, hasCompletedIntake }: TripBriefPanelProps) {
  const [brief, setBrief] = useState<TripBrief | null>(null);
  const [versions, setVersions] = useState<TripBriefVersion[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [editing, setEditing] = useState(false);
  const [showVersions, setShowVersions] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Record<SectionKey, string>>({
    executiveSummary: '',
    hardConstraints: '',
    softPreferences: '',
    pointsCashPosture: '',
    acceptableTradeoffs: '',
    doNotRecommend: '',
    operationalNotes: '',
  });

  const loadBrief = useCallback(async () => {
    try {
      const [b, v] = await Promise.all([
        getTripBrief(tripId),
        getTripBriefVersions(tripId).catch(() => []),
      ]);
      setBrief(b);
      setVersions(v);
    } catch {
      // No brief yet — that's fine
    } finally {
      setLoading(false);
    }
  }, [tripId]);

  useEffect(() => {
    loadBrief();
  }, [loadBrief]);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const newBrief = await generateTripBrief(tripId);
      setBrief(newBrief);
      const v = await getTripBriefVersions(tripId).catch(() => []);
      setVersions(v);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate brief');
    } finally {
      setGenerating(false);
    }
  };

  const startEditing = () => {
    if (!brief) return;
    setEditForm({
      executiveSummary: brief.executiveSummary || '',
      hardConstraints: brief.hardConstraints || '',
      softPreferences: brief.softPreferences || '',
      pointsCashPosture: brief.pointsCashPosture || '',
      acceptableTradeoffs: brief.acceptableTradeoffs || '',
      doNotRecommend: brief.doNotRecommend || '',
      operationalNotes: brief.operationalNotes || '',
    });
    setEditing(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const updated = await updateTripBrief(tripId, editForm);
      setBrief(updated);
      setEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save brief');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-5 w-5 animate-spin text-blue-600" />
          <span className="ml-2 text-sm text-slate-500">Loading brief...</span>
        </div>
      </div>
    );
  }

  if (!brief && !hasCompletedIntake) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <FileText className="mx-auto h-10 w-10 text-slate-300" />
        <h3 className="mt-3 text-sm font-semibold text-slate-700">Trip Brief</h3>
        <p className="mt-1 text-sm text-slate-500">
          Complete a client intake to generate a trip hacker brief.
        </p>
      </div>
    );
  }

  if (!brief) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 bg-slate-50 p-8 text-center">
        <Sparkles className="mx-auto h-10 w-10 text-blue-400" />
        <h3 className="mt-3 text-sm font-semibold text-slate-700">Generate Trip Brief</h3>
        <p className="mt-1 mb-4 text-sm text-slate-500">
          This client has a completed intake. Generate an AI-powered trip hacker brief.
        </p>
        {error && <p className="mb-3 text-sm text-red-600">{error}</p>}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white shadow-sm hover:bg-blue-700 disabled:opacity-60"
        >
          {generating ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Sparkles className="h-4 w-4" />
          )}
          {generating ? 'Generating...' : 'Generate Trip Brief'}
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50">
            <FileText className="h-4 w-4 text-blue-600" />
          </div>
          <div>
            <h2 className="font-semibold text-slate-900">Trip Brief</h2>
            <p className="text-xs text-slate-500">
              v{brief.version}
              {brief.isEdited && ' (edited)'}
              {brief.generatedBy &&
                ` · by ${brief.generatedBy.firstName} ${brief.generatedBy.lastName}`}
              {' · '}
              {new Date(brief.createdAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {versions.length > 1 && (
            <button
              onClick={() => setShowVersions(!showVersions)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Clock className="h-3.5 w-3.5" />
              {versions.length} versions
              <ChevronDown
                className={`h-3 w-3 transition-transform ${showVersions ? 'rotate-180' : ''}`}
              />
            </button>
          )}
          {!editing && (
            <button
              onClick={startEditing}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit
            </button>
          )}
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
          >
            {generating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="h-3.5 w-3.5" />
            )}
            Regenerate
          </button>
        </div>
      </div>

      {/* Version History */}
      {showVersions && versions.length > 1 && (
        <div className="border-b border-slate-100 bg-slate-50 px-5 py-3">
          <p className="mb-2 text-xs font-medium text-slate-500">Version History</p>
          <div className="space-y-1">
            {versions.map((v) => (
              <div
                key={v.id}
                className={`flex items-center justify-between rounded-lg px-3 py-2 text-xs ${
                  v.id === brief.id ? 'bg-blue-50 text-blue-700' : 'text-slate-600'
                }`}
              >
                <div className="flex items-center gap-2">
                  {v.id === brief.id && <CheckCircle2 className="h-3.5 w-3.5 text-blue-600" />}
                  <span className="font-medium">v{v.version}</span>
                  {v.isEdited && (
                    <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                      edited
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  {v.generatedBy && (
                    <span>
                      {v.generatedBy.firstName} {v.generatedBy.lastName}
                    </span>
                  )}
                  <span className="text-slate-400">
                    {new Date(v.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {error && (
        <div className="border-b border-red-100 bg-red-50 px-5 py-3">
          <p className="text-sm text-red-600">{error}</p>
        </div>
      )}

      {/* Edit bar */}
      {editing && (
        <div className="flex items-center justify-between border-b border-amber-200 bg-amber-50 px-5 py-3">
          <p className="text-sm font-medium text-amber-800">Editing brief</p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-medium text-slate-600 hover:bg-slate-50"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Save className="h-3.5 w-3.5" />
              )}
              Save Changes
            </button>
          </div>
        </div>
      )}

      {/* Brief Sections */}
      <div className="divide-y divide-slate-100">
        {BRIEF_SECTIONS.map((section) => {
          const value = brief[section.key] || '';
          return (
            <div key={section.key} className="px-5 py-4">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm">{section.icon}</span>
                <h3 className="text-sm font-semibold text-slate-900">{section.label}</h3>
              </div>
              {editing ? (
                <textarea
                  value={editForm[section.key]}
                  onChange={(e) =>
                    setEditForm((prev) => ({ ...prev, [section.key]: e.target.value }))
                  }
                  rows={Math.max(3, (editForm[section.key]?.split('\n').length ?? 0) + 1)}
                  className="block w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 placeholder:text-slate-400 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              ) : (
                <div className="whitespace-pre-wrap text-sm leading-relaxed text-slate-600">
                  {value || (
                    <span className="italic text-slate-400">No content for this section.</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
