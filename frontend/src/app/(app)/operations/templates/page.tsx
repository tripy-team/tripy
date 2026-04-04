'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import {
  Loader2,
  ArrowLeft,
  Plus,
  FileText,
  Pencil,
  Trash2,
  Eye,
  X,
  Building2,
  Globe,
} from 'lucide-react';
import {
  getVendorTemplates,
  createVendorTemplate,
  updateVendorTemplate,
  deleteVendorTemplate,
} from '@/lib/api-client';
import type { VendorRequestTemplate, VendorRequestType, VendorRequestUrgency } from '@/lib/api-client';

const REQUEST_TYPES: { value: VendorRequestType; label: string }[] = [
  { value: 'early_check_in', label: 'Early Check-In' },
  { value: 'late_check_out', label: 'Late Check-Out' },
  { value: 'room_upgrade', label: 'Room Upgrade' },
  { value: 'celebration_request', label: 'Celebration Amenity' },
  { value: 'airport_transfer', label: 'Airport Transfer' },
  { value: 'connecting_rooms', label: 'Connecting Rooms' },
  { value: 'dining_request', label: 'Dining Request' },
  { value: 'amenity_request', label: 'Amenity Request' },
  { value: 'quote_request', label: 'Quote Request' },
  { value: 'custom_request', label: 'Custom' },
];

function interpolatePreview(body: string) {
  return body.replace(/\{\{(\w+)\}\}/g, (_, key) => `[${key}]`);
}

export default function TemplatesPage() {
  const [templates, setTemplates] = useState<VendorRequestTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [title, setTitle] = useState('');
  const [requestType, setRequestType] = useState<VendorRequestType>('custom_request');
  const [defaultBody, setDefaultBody] = useState('');
  const [defaultUrgency, setDefaultUrgency] = useState<VendorRequestUrgency>('medium');

  const load = async () => {
    setLoading(true);
    try {
      const data = await getVendorTemplates();
      setTemplates(data);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const resetForm = () => {
    setTitle('');
    setRequestType('custom_request');
    setDefaultBody('');
    setDefaultUrgency('medium');
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (t: VendorRequestTemplate) => {
    setTitle(t.title);
    setRequestType(t.requestType);
    setDefaultBody(t.defaultBody);
    setDefaultUrgency(t.defaultUrgency);
    setEditingId(t.id);
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!title.trim() || !defaultBody.trim()) return;
    setSaving(true);
    try {
      if (editingId) {
        await updateVendorTemplate(editingId, { title, defaultBody, defaultUrgency });
      } else {
        await createVendorTemplate({ title, requestType, defaultBody, defaultUrgency });
      }
      resetForm();
      load();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this template?')) return;
    await deleteVendorTemplate(id);
    load();
  };

  const systemTemplates = templates.filter((t) => t.scope === 'system');
  const orgTemplates = templates.filter((t) => t.scope === 'organization');

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-6 w-6 animate-spin text-blue-600" />
        <span className="ml-3 text-slate-500">Loading templates...</span>
      </div>
    );
  }

  return (
    <div className="max-w-4xl">
      {/* Breadcrumb */}
      <div className="mb-4">
        <Link
          href="/operations"
          className="inline-flex items-center gap-1 text-sm text-slate-500 hover:text-slate-700"
        >
          <ArrowLeft className="h-4 w-4" />
          Operations
        </Link>
      </div>

      {/* Header */}
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Vendor Request Templates</h1>
          <p className="mt-1 text-sm text-slate-500">
            Reusable templates for common vendor communication
          </p>
        </div>
        <button
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
          className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          <Plus className="h-4 w-4" />
          New Template
        </button>
      </div>

      {/* Create/Edit Form */}
      {showForm && (
        <div className="mb-6 rounded-xl border border-blue-200 bg-blue-50/30 p-5">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-semibold text-slate-900">
              {editingId ? 'Edit Template' : 'New Template'}
            </h3>
            <button onClick={resetForm} className="text-slate-400 hover:text-slate-600">
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Title</label>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Early Check-In Request"
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Request Type
                </label>
                <select
                  value={requestType}
                  onChange={(e) => setRequestType(e.target.value as VendorRequestType)}
                  disabled={!!editingId}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none disabled:opacity-50"
                >
                  {REQUEST_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">
                  Default Urgency
                </label>
                <select
                  value={defaultUrgency}
                  onChange={(e) =>
                    setDefaultUrgency(e.target.value as VendorRequestUrgency)
                  }
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm focus:border-blue-300 focus:outline-none"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="urgent">Urgent</option>
                </select>
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">
                Template Body
                <span className="ml-1 text-slate-400 font-normal">
                  (use {'{{vendorName}}'}, {'{{clientName}}'}, {'{{tripTitle}}'}, {'{{dueDate}}'} as placeholders)
                </span>
              </label>
              <textarea
                value={defaultBody}
                onChange={(e) => setDefaultBody(e.target.value)}
                rows={5}
                placeholder="Dear {{vendorName}},&#10;&#10;We would like to request..."
                className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm font-mono focus:border-blue-300 focus:outline-none focus:ring-2 focus:ring-blue-100"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleSave}
                disabled={saving || !title.trim() || !defaultBody.trim()}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                {editingId ? 'Update' : 'Create'} Template
              </button>
              <button
                onClick={resetForm}
                className="rounded-lg border border-slate-200 px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* System Templates */}
      {systemTemplates.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center gap-2 mb-3">
            <Globe className="h-4 w-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
              System Templates
            </h2>
          </div>
          <div className="space-y-2">
            {systemTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onPreview={() =>
                  setPreviewId(previewId === t.id ? null : t.id)
                }
                previewOpen={previewId === t.id}
                isSystem
              />
            ))}
          </div>
        </div>
      )}

      {/* Org Templates */}
      <div>
        <div className="flex items-center gap-2 mb-3">
          <Building2 className="h-4 w-4 text-slate-400" />
          <h2 className="text-sm font-semibold text-slate-600 uppercase tracking-wide">
            Your Templates
          </h2>
        </div>
        {orgTemplates.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
            <FileText className="mx-auto h-10 w-10 text-slate-300" />
            <p className="mt-3 text-sm text-slate-500">
              No custom templates yet. Create one to speed up vendor communication.
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {orgTemplates.map((t) => (
              <TemplateCard
                key={t.id}
                template={t}
                onEdit={() => startEdit(t)}
                onDelete={() => handleDelete(t.id)}
                onPreview={() =>
                  setPreviewId(previewId === t.id ? null : t.id)
                }
                previewOpen={previewId === t.id}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function TemplateCard({
  template,
  onEdit,
  onDelete,
  onPreview,
  previewOpen,
  isSystem,
}: {
  template: VendorRequestTemplate;
  onEdit?: () => void;
  onDelete?: () => void;
  onPreview: () => void;
  previewOpen: boolean;
  isSystem?: boolean;
}) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white">
      <div className="flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <FileText className="h-4 w-4 text-slate-400" />
          <div>
            <p className="text-sm font-medium text-slate-900">{template.title}</p>
            <p className="text-xs text-slate-500">
              {template.requestType.replace(/_/g, ' ')} · {template.defaultUrgency} urgency
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={onPreview}
            className="rounded p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
            title="Preview"
          >
            <Eye className="h-4 w-4" />
          </button>
          {!isSystem && onEdit && (
            <button
              onClick={onEdit}
              className="rounded p-1.5 text-slate-400 hover:bg-slate-50 hover:text-slate-600"
              title="Edit"
            >
              <Pencil className="h-4 w-4" />
            </button>
          )}
          {!isSystem && onDelete && (
            <button
              onClick={onDelete}
              className="rounded p-1.5 text-slate-400 hover:bg-red-50 hover:text-red-600"
              title="Delete"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      {previewOpen && (
        <div className="border-t border-slate-100 bg-slate-50 px-4 py-3">
          <p className="text-xs font-medium text-slate-500 mb-1">Preview (placeholders shown as [field])</p>
          <pre className="whitespace-pre-wrap text-sm text-slate-700 font-sans">
            {interpolatePreview(template.defaultBody)}
          </pre>
        </div>
      )}
    </div>
  );
}
