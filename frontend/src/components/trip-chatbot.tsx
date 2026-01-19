'use client';

import { useState, useRef, useEffect } from 'react';
import { MessageCircle, Send, X, Sparkles } from 'lucide-react';
import { extractTripInfo, ExtractedTripInfo } from '@/lib/trip-extractor';

interface Message {
  id: string;
  text: string;
  sender: 'user' | 'bot';
  timestamp: Date;
}

interface TripChatbotProps {
  onExtract: (info: ExtractedTripInfo) => void;
  isOpen: boolean;
  onToggle: () => void;
}

export default function TripChatbot({ onExtract, isOpen, onToggle }: TripChatbotProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      text: "Hi! I'm your trip planning assistant. Tell me about your trip - where you want to go, when, and your budget, and I'll help fill out the form for you!",
      sender: 'bot',
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isOpen]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim()) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      text: input.trim(),
      sender: 'user',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsTyping(true);

    // Simulate bot thinking
    await new Promise(resolve => setTimeout(resolve, 500));

    // Extract information
    const extracted = extractTripInfo(userMessage.text);

    // Generate bot response
    let botResponse = '';
    const extractedItems: string[] = [];

    if (extracted.cities.length > 0) {
      extractedItems.push(`📍 Cities: ${extracted.cities.join(', ')}`);
    }
    if (extracted.startDate && extracted.endDate) {
      extractedItems.push(`📅 Dates: ${extracted.startDate} to ${extracted.endDate}`);
    } else if (extracted.duration) {
      extractedItems.push(`📅 Duration: ${extracted.duration} days`);
    }
    if (extracted.isFlexible) {
      extractedItems.push('📅 Flexible dates');
    }
    if (extracted.minBudget && extracted.maxBudget) {
      extractedItems.push(`💰 Budget: $${extracted.minBudget.toLocaleString()} - $${extracted.maxBudget.toLocaleString()}`);
    }
    if (extracted.creditCards && extracted.creditCards.length > 0) {
      extractedItems.push(`💳 Credit cards: ${extracted.creditCards.map(c => `${c.program} (${c.points.toLocaleString()} pts)`).join(', ')}`);
    }

    if (extractedItems.length > 0) {
      botResponse = `Great! I found:\n\n${extractedItems.join('\n')}\n\nI've updated the form for you! Feel free to tell me more or make changes.`;
      
      // Apply extracted information
      onExtract(extracted);
    } else {
      botResponse = "I'm having trouble understanding that. Try saying something like:\n\n• \"I want to visit Paris and London in March\"\n• \"Trip to Tokyo for 7 days with a $3000 budget\"\n• \"Flexible dates, going to Barcelona and Madrid\"";
    }

    const botMessage: Message = {
      id: (Date.now() + 1).toString(),
      text: botResponse,
      sender: 'bot',
      timestamp: new Date(),
    };

    setMessages(prev => [...prev, botMessage]);
    setIsTyping(false);
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="fixed bottom-6 right-6 w-14 h-14 bg-blue-600 text-white rounded-full shadow-lg hover:bg-blue-700 transition-all flex items-center justify-center z-50 hover:scale-110"
        aria-label="Open chat"
      >
        <MessageCircle className="w-6 h-6" />
      </button>
    );
  }

  return (
    <div className="fixed bottom-6 right-6 w-96 h-[600px] bg-white rounded-2xl shadow-2xl border border-slate-200 flex flex-col z-50 animate-in slide-in-from-bottom-4 duration-300">
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-slate-200 bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-t-2xl">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-white/20 rounded-full flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h3 className="font-semibold">Trip Assistant</h3>
            <p className="text-xs text-blue-100">I can help fill out your trip details</p>
          </div>
        </div>
        <button
          onClick={onToggle}
          className="w-8 h-8 rounded-full hover:bg-white/20 transition-colors flex items-center justify-center"
          aria-label="Close chat"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-slate-50">
        {messages.map((message) => (
          <div
            key={message.id}
            className={`flex ${message.sender === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            <div
              className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                message.sender === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white text-slate-900 border border-slate-200'
              }`}
            >
              <p className="text-sm whitespace-pre-wrap">{message.text}</p>
              <p className={`text-xs mt-1 ${
                message.sender === 'user' ? 'text-blue-100' : 'text-slate-500'
              }`}>
                {message.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
        ))}
        {isTyping && (
          <div className="flex justify-start">
            <div className="bg-white border border-slate-200 rounded-2xl px-4 py-2">
              <div className="flex gap-1">
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                <div className="w-2 h-2 bg-slate-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-slate-200 bg-white rounded-b-2xl">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Tell me about your trip..."
            className="flex-1 px-4 py-2 border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent text-sm"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isTyping}
            className="px-4 py-2 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center"
          >
            <Send className="w-4 h-4" />
          </button>
        </div>
        <p className="text-xs text-slate-500 mt-2">
          Try: &quot;Paris and London in March, $3000 budget&quot;
        </p>
      </div>
    </div>
  );
}
