'use client';

import { useState, useRef, useEffect } from 'react';
import { copilotAPI } from '@/lib/api';

interface Message {
  role: 'user' | 'assistant';
  content: string;
}

interface CopilotPanelProps {
  tripId: string;
  currentConstraints?: Record<string, unknown>;
  currentRecommendations?: Record<string, unknown>[];
  onConstraintsUpdated?: (constraints: Record<string, unknown>) => void;
  onReoptimizeRequested?: () => void;
}

const QUICK_ACTIONS = [
  { id: 'make_cheaper', label: 'Make cheaper' },
  { id: 'more_comfort', label: 'More comfort' },
  { id: 'fewer_stops', label: 'Fewer stops' },
  { id: 'nonstop_only', label: 'Nonstop only' },
  { id: 'business_class', label: 'Business class' },
  { id: 'remove_self_transfers', label: 'No self-transfers' },
];

export default function CopilotPanel({
  tripId,
  currentConstraints = {},
  currentRecommendations = [],
  onConstraintsUpdated,
  onReoptimizeRequested,
}: CopilotPanelProps) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async (text?: string) => {
    const message = text || input.trim();
    if (!message || loading) return;

    setInput('');
    setMessages((prev) => [...prev, { role: 'user', content: message }]);
    setLoading(true);

    try {
      const response = await copilotAPI.sendMessage({
        message,
        tripId,
        currentConstraints,
        currentRecommendations,
        conversationHistory: messages.map((m) => ({ role: m.role, content: m.content })),
      });

      const reply = (response as { reply?: string }).reply || 'Done.';
      const updatedConstraints = (response as { updated_constraints?: Record<string, unknown> }).updated_constraints;
      const needsReoptimize = (response as { needs_reoptimize?: boolean }).needs_reoptimize;
      const newSuggestions = (response as { suggestions?: string[] }).suggestions || [];

      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);
      setSuggestions(newSuggestions);

      if (updatedConstraints && onConstraintsUpdated) {
        onConstraintsUpdated(updatedConstraints);
      }
      if (needsReoptimize && onReoptimizeRequested) {
        onReoptimizeRequested();
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong. Please try again.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickAction = async (actionId: string) => {
    if (loading) return;
    setLoading(true);

    const label = QUICK_ACTIONS.find((a) => a.id === actionId)?.label || actionId;
    setMessages((prev) => [...prev, { role: 'user', content: label }]);

    try {
      const response = await copilotAPI.quickAction(actionId, tripId, currentConstraints);
      const reply = (response as { reply?: string }).reply || 'Done.';
      const updatedConstraints = (response as { updated_constraints?: Record<string, unknown> }).updated_constraints;
      const needsReoptimize = (response as { needs_reoptimize?: boolean }).needs_reoptimize;

      setMessages((prev) => [...prev, { role: 'assistant', content: reply }]);

      if (updatedConstraints && onConstraintsUpdated) {
        onConstraintsUpdated(updatedConstraints);
      }
      if (needsReoptimize && onReoptimizeRequested) {
        onReoptimizeRequested();
      }
    } catch (e) {
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: 'Something went wrong.' },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-full flex-col rounded-xl border border-gray-200 bg-white">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-gray-200 px-4 py-3">
        <div className="h-2 w-2 rounded-full bg-green-500" />
        <h3 className="text-sm font-semibold text-gray-900">AI Copilot</h3>
      </div>

      {/* Quick actions */}
      <div className="flex flex-wrap gap-2 border-b border-gray-100 px-4 py-3">
        {QUICK_ACTIONS.map((action) => (
          <button
            key={action.id}
            onClick={() => handleQuickAction(action.id)}
            disabled={loading}
            className="rounded-full border border-gray-200 px-3 py-1 text-xs font-medium text-gray-600 hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 disabled:opacity-50"
          >
            {action.label}
          </button>
        ))}
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-gray-400 text-center py-8">
            Ask me to refine recommendations — "make it cheaper", "only nonstop", "use points first"
          </p>
        )}
        {messages.map((msg, idx) => (
          <div
            key={idx}
            className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-lg px-3 py-2 text-sm ${
                msg.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-800'
              }`}
            >
              {msg.content}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-400">
              Thinking...
            </div>
          </div>
        )}

        {/* Follow-up suggestions */}
        {suggestions.length > 0 && !loading && (
          <div className="flex flex-wrap gap-2 pt-2">
            {suggestions.map((s, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(s)}
                className="rounded-full border border-dashed border-gray-300 px-3 py-1 text-xs text-gray-500 hover:border-blue-300 hover:text-blue-600"
              >
                {s}
              </button>
            ))}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleSend();
          }}
          className="flex gap-2"
        >
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Tell me how to improve this trip..."
            disabled={loading}
            className="flex-1 rounded-lg border border-gray-300 px-3 py-2 text-sm focus:border-blue-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={!input.trim() || loading}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
