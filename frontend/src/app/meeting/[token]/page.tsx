'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import {
  Loader2,
  XCircle,
  Video,
  Mic,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';

type Status = 'loading' | 'ready' | 'expired' | 'invalid' | 'error';

interface ResolvedInvitation {
  status: 'ready' | 'expired';
  meetingTitle?: string;
  meetingStatus?: string;
  advisorName?: string;
  clientName?: string;
  recipientName?: string | null;
  expiresAt?: string;
  join?: {
    roomName: string;
    clientId: string;
    exp: number;
    sig: string;
  };
}

export default function MeetingInvitePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();

  const [status, setStatus] = useState<Status>('loading');
  const [data, setData] = useState<ResolvedInvitation | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/meeting-invitations/${token}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { error?: string }).error ?? 'Link not found');
        }
        return res.json();
      })
      .then((payload: ResolvedInvitation) => {
        if (cancelled) return;
        if (payload.status === 'expired') {
          setStatus('expired');
          return;
        }
        setData(payload);
        setStatus('ready');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMessage(err.message);
        setStatus('invalid');
      });
    return () => {
      cancelled = true;
    };
  }, [token]);

  const handleJoin = () => {
    if (!data?.join) return;
    // Mark invitation as joined (fire and forget)
    fetch(`/api/meeting-invitations/${token}`, { method: 'POST' }).catch(() => {});

    const url = new URL(
      `/join/${encodeURIComponent(data.join.roomName)}`,
      window.location.origin,
    );
    const displayName = data.clientName || data.recipientName || 'Client';
    url.searchParams.set('name', displayName);
    url.searchParams.set('clientId', data.join.clientId);
    url.searchParams.set('exp', String(data.join.exp));
    url.searchParams.set('sig', data.join.sig);
    router.push(url.toString());
  };

  if (status === 'loading') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50">
        <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
      </div>
    );
  }

  if (status === 'invalid') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-red-400" />
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Link not found</h1>
          <p className="text-slate-500">
            {errorMessage ?? 'This meeting link is invalid or has been revoked.'}
          </p>
        </div>
      </div>
    );
  }

  if (status === 'expired') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-4">
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
          <XCircle className="mx-auto mb-4 h-12 w-12 text-slate-400" />
          <h1 className="mb-2 text-xl font-semibold text-slate-900">Link expired</h1>
          <p className="text-slate-500">
            This meeting link has expired. Please ask your advisor to send a new one.
          </p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const firstName =
    (data.recipientName ?? data.clientName ?? '').split(' ')[0] || null;
  const greeting = firstName ? `Hi ${firstName},` : 'Hi there,';

  return (
    <div className="min-h-screen bg-slate-50 px-4 py-12">
      <div className="mx-auto w-full max-w-2xl">
        {/* Header */}
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-600 text-lg font-bold text-white">
            T
          </div>
          <h1 className="text-2xl font-bold text-slate-900">{greeting}</h1>
          <p className="mt-1 text-lg font-medium text-slate-700">
            {data.meetingTitle ?? 'Travel discovery call'}
          </p>
          <p className="mt-2 text-sm text-slate-500">
            {data.advisorName ? `${data.advisorName} invited you to a quick call` : 'Your travel advisor invited you to a quick call'}
            {' '}to learn how you like to travel.
          </p>
        </div>

        {/* Main card */}
        <div className="rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 space-y-4">
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-blue-50">
                <Video className="h-4.5 w-4.5 text-blue-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900">A live video call</p>
                <p className="text-sm text-slate-500">
                  You&apos;ll join a short call with your advisor. Camera and microphone
                  will be requested when you click through.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-violet-50">
                <Sparkles className="h-4.5 w-4.5 text-violet-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900">A few discovery questions</p>
                <p className="text-sm text-slate-500">
                  Your advisor will ask you a handful of questions about how you prefer
                  to travel — airlines, hotels, pace, special occasions, and more.
                </p>
              </div>
            </div>
            <div className="flex gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-50">
                <ShieldCheck className="h-4.5 w-4.5 text-emerald-600" />
              </div>
              <div>
                <p className="font-medium text-slate-900">Saved to your profile</p>
                <p className="text-sm text-slate-500">
                  Your answers help your advisor plan better trips for you — now and in
                  the future.
                </p>
              </div>
            </div>
          </div>

          <button
            onClick={handleJoin}
            className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-3 text-sm font-semibold text-white transition-colors hover:bg-blue-700"
          >
            <Video className="h-4 w-4" />
            Join the call
          </button>

          <div className="mt-4 flex items-center justify-center gap-2 text-xs text-slate-400">
            <Mic className="h-3 w-3" />
            <span>Make sure you&apos;re somewhere quiet with a stable connection.</span>
          </div>
        </div>

        <p className="mt-6 text-center text-xs text-slate-400">
          © {new Date().getFullYear()} Tripy. Better travel starts here.
        </p>
      </div>
    </div>
  );
}
