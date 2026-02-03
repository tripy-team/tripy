'use client';

import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { tripExtraction, ExtractedTripInfo } from '@/lib/api';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

interface TripChatbotInlineProps {
  onExtract: (info: ExtractedTripInfo) => void | Promise<void>;
}

export default function TripChatbotInline({ onExtract }: TripChatbotInlineProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text:
        "Hi! I'm your trip planning assistant. Tell me about your trip — where you want to go, when, and your budget, and I'll help fill out the form for you!",
      sender: 'bot',
      timestamp: new Date(),
    },
  ]);

  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Prevent double-sends / race conditions
  const inFlightRef = useRef(false);

  // Focus input once (no scrolling hacks)
  useEffect(() => {
    // Only focus if the user hasn't already focused something else
    const t = setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
    }, 200);
    return () => clearTimeout(t);
  }, []);

  // Only scroll inside the messages container (not the whole page)
  useEffect(() => {
    const end = messagesEndRef.current;
    if (!end) return;

    const container = end.closest('.overflow-y-auto') as HTMLElement | null;
    if (!container) return;

    // Keep chat pinned near bottom when new messages arrive
    end.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }, [messages, isTyping]);

  const safeString = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

  const handleSend = async () => {
    if (!input.trim()) return;
    if (inFlightRef.current) return;

    inFlightRef.current = true;

    const text = input.trim();

    const userMessage: Message = {
      id: Date.now().toString(),
      text,
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    let extracted: ExtractedTripInfo | null = null;

    try {
      extracted = await tripExtraction.extract(text);
    } catch (error) {
      console.error('Error extracting trip info:', error);
      extracted = null;
    }

    // Build bot response + ALWAYS call onExtract if we got anything useful
    const extractedItems: string[] = [];

    if (extracted) {
      // IMPORTANT: include start/end destination in summary and "useful" check
      const startDest = safeString(extracted.startDestination);
      const endDest = safeString(extracted.endDestination);

      if (startDest) extractedItems.push(`🛫 Start: ${startDest}`);
      if (endDest) extractedItems.push(`🛬 End: ${endDest}`);

      if (extracted.cities && extracted.cities.length > 0) {
        extractedItems.push(`📍 Cities: ${extracted.cities.join(', ')}`);
      }

      if (extracted.startDate && extracted.endDate) {
        extractedItems.push(`📅 Dates: ${extracted.startDate} to ${extracted.endDate}`);
      } else if (extracted.startDate && !extracted.endDate) {
        extractedItems.push(`📅 Start date: ${extracted.startDate}`);
      } else if (extracted.duration) {
        extractedItems.push(`📅 Duration: ${extracted.duration} days`);
      }

      // isFlexible can be boolean false — only show when true, but don't block extraction
      if (extracted.isFlexible === true) {
        extractedItems.push('📅 Flexible dates');
      }

      // Budget: show whichever bounds exist (maxBudget is what your form uses)
      const minB = extracted.minBudget;
      const maxB = extracted.maxBudget;

      if (typeof minB === 'number' && typeof maxB === 'number') {
        extractedItems.push(`💰 Budget: $${minB.toLocaleString()} - $${maxB.toLocaleString()}`);
      } else if (typeof maxB === 'number') {
        extractedItems.push(`💰 Max budget: $${maxB.toLocaleString()}`);
      } else if (typeof minB === 'number') {
        extractedItems.push(`💰 Min budget: $${minB.toLocaleString()}`);
      }

      if (extracted.creditCards && extracted.creditCards.length > 0) {
        extractedItems.push(
          `💳 Credit cards: ${extracted.creditCards
            .map((c) => `${c.program} (${c.points.toLocaleString()} pts)`)
            .join(', ')}`
        );
      }

      if (extracted.flightClass) {
        extractedItems.push(`✈️ Flight Class: ${extracted.flightClass.replace(/_/g, ' ')}`);
      }
    }

    const hasUsefulExtraction = extractedItems.length > 0;

    let botResponse = '';
    if (hasUsefulExtraction && extracted) {
      botResponse = `Got it — I found:\n\n${extractedItems.join('\n')}\n\nI updated the form. Tell me more details if you want!`;

      // ✅ Always apply extraction if we found anything
      try {
        await onExtract(extracted);
      } catch (err) {
        console.error('Error in onExtract callback:', err);
      }
    } else {
      botResponse =
        "I couldn’t confidently extract trip details from that. Try something like:\n\n• “SEA to NRT, Tokyo + Kyoto, March 10–18, $3000”\n• “Flexible 7 days in Spain: Barcelona + Madrid, max $2500”\n• “JFK to CDG one-way April 2, Paris + London”";
    }

    const botMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: botResponse,
      sender: 'bot',
      timestamp: new Date(),
    };

    setMessages((prev) => [...prev, botMessage]);
    setIsTyping(false);
    inFlightRef.current = false;

    // Keep focus in input for fast iteration
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="space-y-4">
      {/* Messages Container */}
      <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 h-64 overflow-y-auto">
        <div className="space-y-3">
          {messages.map((message) => (
            <div
              key={message.id}
              className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
            >
              <div
                className={`max-w-[80%] rounded-xl px-3 py-2 ${
                  message.sender === 'user'
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-slate-900 border border-slate-200'
                }`}
              >
                <p className="text-sm whitespace-pre-wrap">{message.text}</p>
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex justify-start">
              <div className="bg-white border border-slate-200 rounded-xl px-3 py-2">
                <div className="flex gap-1">
                  <div
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: '0ms' }}
                  />
                  <div
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: '150ms' }}
                  />
                  <div
                    className="w-2 h-2 bg-slate-400 rounded-full animate-bounce"
                    style={{ animationDelay: '300ms' }}
                  />
                </div>
              </div>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Input */}
      <div className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Tell me about your trip..."
          className="flex-1 px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
        />
        <button
          onClick={handleSend}
          disabled={!input.trim() || isTyping}
          className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
        >
          <Send className="w-5 h-5" />
        </button>
      </div>

      <p className="text-xs text-slate-500">
        Try: &quot;SEA to NRT, Tokyo + Kyoto, March 10–18, max $3000&quot;
      </p>
    </div>
  );
}
