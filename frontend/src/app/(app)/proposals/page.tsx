'use client';

import { useEffect, useState } from 'react';
import { proposalsAPI } from '@/lib/api';

interface ProposalListItem {
  proposal_id: string;
  client_name: string;
  trip_summary: string;
  status: string;
  view_count: number;
  created_at: string;
  expires_at: string;
  share_url: string;
}

export default function ProposalsListPage() {
  const [proposals, setProposals] = useState<ProposalListItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    proposalsAPI.list()
      .then((data) => setProposals(data as unknown as ProposalListItem[]))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const copyLink = (shareUrl: string) => {
    const fullUrl = `${window.location.origin}${shareUrl}`;
    navigator.clipboard.writeText(fullUrl);
  };

  if (loading) {
    return (
      <div className="mx-auto max-w-4xl px-6 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 rounded bg-gray-200" />
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-20 rounded-xl bg-gray-200" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-6 py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Proposals</h1>
        <p className="text-sm text-gray-500">Client-facing recommendation proposals</p>
      </div>

      {proposals.length === 0 ? (
        <div className="rounded-xl border border-dashed border-gray-300 bg-gray-50 py-12 text-center">
          <p className="text-gray-500">No proposals yet.</p>
          <p className="text-sm text-gray-400 mt-1">
            Optimize a trip, then create a proposal to share with your client.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {proposals.map((p) => (
            <div
              key={p.proposal_id}
              className="flex items-center justify-between rounded-xl border border-gray-200 bg-white px-6 py-4"
            >
              <div>
                <h3 className="font-medium text-gray-900">{p.client_name}</h3>
                {p.trip_summary && (
                  <p className="text-sm text-gray-500 mt-0.5">{p.trip_summary}</p>
                )}
                <div className="mt-1 flex items-center gap-3 text-xs text-gray-400">
                  <span>{new Date(p.created_at).toLocaleDateString()}</span>
                  <span>{p.view_count} view{p.view_count !== 1 ? 's' : ''}</span>
                  <span
                    className={`rounded-full px-2 py-0.5 ${
                      p.status === 'active'
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-500'
                    }`}
                  >
                    {p.status}
                  </span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => copyLink(p.share_url)}
                  className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50"
                >
                  Copy Link
                </button>
                <a
                  href={p.share_url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-blue-700"
                >
                  View
                </a>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
