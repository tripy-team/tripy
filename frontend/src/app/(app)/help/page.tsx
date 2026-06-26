'use client';

import { useState } from 'react';
import {
  ChevronDown,
  ChevronUp,
  HelpCircle,
  Mail,
  MessageSquare,
  Send,
} from 'lucide-react';

const FAQ_ITEMS = [
  {
    question: 'How do I add a new client?',
    answer:
      'Go to Clients in the sidebar and click "New Client", or use the "Add a client" shortcut on your Profile page. You\'ll be prompted to enter basic contact details and can immediately start a discovery intake.',
  },
  {
    question: 'How does the discovery meeting feature work?',
    answer:
      'From any client page, open a discovery meeting to run a structured intake session. TripsHacker listens as you capture preferences and automatically surfaces follow-up questions based on what\'s been covered. At the end of the meeting you can commit the suggestions to the client\'s permanent profile.',
  },
  {
    question: 'What is the difference between committed preferences and meeting suggestions?',
    answer:
      'Committed preferences are saved to the client\'s permanent profile and used in all future trip planning. Meeting suggestions are in-session notes that haven\'t been reviewed yet. You decide which suggestions to keep, edit, or discard before they become part of the profile.',
  },
  {
    question: 'How do I generate a trip recommendation?',
    answer:
      'Once your preference profile is complete or near-complete, open a trip request and use the recommendation engine. TripsHacker will factor in your loyalty programs, cabin preferences, budget sensitivity, and any hard constraints to surface the most relevant options.',
  },
  {
    question: 'What are transfer bonuses and how do I use them?',
    answer:
      'Transfer bonuses are promotional multipliers from credit card programs to airline or hotel loyalty partners (e.g. Chase UR → United at 30% bonus). You can log active bonuses in the Workspace section of your Profile. TripsHacker uses them when evaluating points transfer strategies for your trips.',
  },
  {
    question: 'How is my data stored and kept secure?',
    answer:
      'All of your data is encrypted at rest and in transit. TripsHacker keeps strict data boundaries so your travel and loyalty information stays private to your account. You can contact us at any time if you have compliance or security questions.',
  },
];

function FaqItem({ question, answer }: { question: string; answer: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-b border-slate-200 last:border-0">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-4 py-4 text-left"
      >
        <span className="text-sm font-medium text-slate-900">{question}</span>
        {open ? (
          <ChevronUp className="h-4 w-4 flex-shrink-0 text-slate-400" />
        ) : (
          <ChevronDown className="h-4 w-4 flex-shrink-0 text-slate-400" />
        )}
      </button>
      {open && (
        <p className="pb-4 text-sm leading-relaxed text-slate-500">{answer}</p>
      )}
    </div>
  );
}

export default function HelpPage() {
  const [tab, setTab] = useState<'faq' | 'contact'>('faq');

  // Contact form state
  const [form, setForm] = useState({ name: '', email: '', subject: '', message: '' });
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setSubmitting(true);
    setError(null);
    try {
      const feedbackText = [
        `From: ${form.name} <${form.email}>`,
        form.subject ? `Subject: ${form.subject}` : null,
        `\n${form.message}`,
      ].filter(Boolean).join('\n');

      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ feedback: feedbackText }),
      });
      if (!res.ok) throw new Error('Failed to send message');
      setSubmitted(true);
    } catch {
      setError('Something went wrong. Please try again or email us directly at tripy@traveltripy.com.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-3xl mx-auto px-4 py-8">

        {/* Header */}
        <div className="mb-8">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 text-xs font-medium text-slate-700 mb-3">
            <HelpCircle className="w-3 h-3" />
            Help Center
          </div>
          <h1 className="text-3xl font-bold text-slate-900 tracking-tight">
            How can we help?
          </h1>
          <p className="text-slate-500 mt-1">
            Find answers to common questions or reach out directly.
          </p>
        </div>

        {/* Tab bar */}
        <div className="flex gap-1 rounded-xl bg-slate-100 p-1 mb-8 w-fit">
          <button
            onClick={() => setTab('faq')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'faq'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            FAQ
          </button>
          <button
            onClick={() => setTab('contact')}
            className={`flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
              tab === 'contact'
                ? 'bg-white text-slate-900 shadow-sm'
                : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Mail className="w-4 h-4" />
            Contact us
          </button>
        </div>

        {/* FAQ */}
        {tab === 'faq' && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm px-6">
            {FAQ_ITEMS.map((item) => (
              <FaqItem key={item.question} question={item.question} answer={item.answer} />
            ))}
          </div>
        )}

        {/* Contact */}
        {tab === 'contact' && (
          <div className="bg-white border border-slate-200 rounded-2xl shadow-sm p-8">
            {submitted ? (
              <div className="text-center py-8">
                <div className="w-12 h-12 rounded-full bg-emerald-100 flex items-center justify-center mx-auto mb-4">
                  <Send className="w-5 h-5 text-emerald-600" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900 mb-1">Message sent</h3>
                <p className="text-sm text-slate-500">
                  We'll get back to you within one business day.
                </p>
                <button
                  onClick={() => { setSubmitted(false); setError(null); setForm({ name: '', email: '', subject: '', message: '' }); }}
                  className="mt-6 text-sm font-medium text-blue-600 hover:text-blue-700"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-5">
                <div className="grid sm:grid-cols-2 gap-5">
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={form.name}
                      onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                      placeholder="Your name"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-slate-700 mb-1.5">
                      Email <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="email"
                      required
                      value={form.email}
                      onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                      className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                      placeholder="you@agency.com"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Subject
                  </label>
                  <input
                    type="text"
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600"
                    placeholder="What's this about?"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-slate-700 mb-1.5">
                    Message <span className="text-red-500">*</span>
                  </label>
                  <textarea
                    required
                    rows={5}
                    value={form.message}
                    onChange={(e) => setForm((f) => ({ ...f, message: e.target.value }))}
                    className="block w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-blue-600 resize-none"
                    placeholder="Describe your question or issue..."
                  />
                </div>
                {error && (
                  <p className="text-sm text-red-600">{error}</p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <p className="text-xs text-slate-400">
                    We typically respond within one business day.
                  </p>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
                  >
                    {submitting ? (
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                    Send message
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

      </div>
    </div>
  );
}
