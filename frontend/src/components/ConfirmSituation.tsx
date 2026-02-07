'use client';

import { useState, useEffect } from 'react';
import { CreditCard, Check, Edit3, Sparkles, ChevronDown, ChevronUp, Plus, X } from 'lucide-react';

interface CardPreset {
  id: string;
  name: string;
  program: string;
  estimated_balance: number;
  usable_label: string;
  icon: string;
}

interface CreditCardEntry {
  id: string;
  program: string;
  points: number;
  confidence?: 'exact' | 'estimated' | 'unknown';
}

interface ConfirmSituationProps {
  creditCards: CreditCardEntry[];
  onConfirm: (cards: CreditCardEntry[]) => void;
  isLoading?: boolean;
}

// Card brand colors
const CARD_COLORS: Record<string, string> = {
  amex: 'from-blue-500 to-blue-700',
  chase: 'from-blue-600 to-indigo-800',
  capitalone: 'from-red-500 to-red-700',
  citi: 'from-blue-400 to-blue-600',
  bilt: 'from-slate-700 to-slate-900',
};

const CARD_BG: Record<string, string> = {
  amex: 'bg-blue-50 border-blue-200',
  chase: 'bg-indigo-50 border-indigo-200',
  capitalone: 'bg-red-50 border-red-200',
  citi: 'bg-sky-50 border-sky-200',
  bilt: 'bg-slate-50 border-slate-200',
};

export default function ConfirmSituation({ creditCards, onConfirm, isLoading }: ConfirmSituationProps) {
  const [presets, setPresets] = useState<CardPreset[]>([]);
  const [selectedPresets, setSelectedPresets] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'confirm' | 'edit' | 'estimate'>('confirm');
  const [editableCards, setEditableCards] = useState<CreditCardEntry[]>([]);
  const [showAllPresets, setShowAllPresets] = useState(false);

  // Load presets from backend
  useEffect(() => {
    const loadPresets = async () => {
      try {
        const BACKEND_URL = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000';
        const res = await fetch(`${BACKEND_URL}/points/card-presets`);
        if (res.ok) {
          const data = await res.json();
          setPresets(data.presets || []);
        }
      } catch (err) {
        console.error('Failed to load card presets:', err);
        // Fallback presets
        setPresets([
          { id: 'amex_gold', name: 'Amex Gold', program: 'amex_mr', estimated_balance: 60000, usable_label: '~60,000 MR points', icon: 'amex' },
          { id: 'chase_sapphire_preferred', name: 'Chase Sapphire Preferred', program: 'chase_ur', estimated_balance: 50000, usable_label: '~50,000 UR points', icon: 'chase' },
          { id: 'amex_platinum', name: 'Amex Platinum', program: 'amex_mr', estimated_balance: 100000, usable_label: '~100,000 MR points', icon: 'amex' },
          { id: 'capital_one_venture_x', name: 'Capital One Venture X', program: 'capital_one', estimated_balance: 50000, usable_label: '~50,000 miles', icon: 'capitalone' },
        ]);
      }
    };
    loadPresets();
  }, []);

  // Initialize editable cards from existing credit cards
  useEffect(() => {
    if (creditCards.length > 0) {
      setEditableCards(creditCards);
      setMode('confirm');
    }
  }, [creditCards]);

  const togglePreset = (presetId: string) => {
    setSelectedPresets(prev => {
      const next = new Set(prev);
      if (next.has(presetId)) {
        next.delete(presetId);
      } else {
        next.add(presetId);
      }
      return next;
    });
  };

  const handleLooksRight = () => {
    if (creditCards.length > 0) {
      onConfirm(creditCards.map(c => ({ ...c, confidence: 'exact' })));
    } else if (selectedPresets.size > 0) {
      const cards = presets
        .filter(p => selectedPresets.has(p.id))
        .map(p => ({
          id: p.id,
          program: p.program,
          points: p.estimated_balance,
          confidence: 'estimated' as const,
        }));
      onConfirm(cards);
    }
  };

  const handleEdit = () => {
    if (creditCards.length > 0) {
      setEditableCards([...creditCards]);
    } else {
      const cards = presets
        .filter(p => selectedPresets.has(p.id))
        .map(p => ({
          id: p.id,
          program: p.program,
          points: p.estimated_balance,
          confidence: 'estimated' as const,
        }));
      setEditableCards(cards);
    }
    setMode('edit');
  };

  const handleEstimate = () => {
    if (selectedPresets.size === 0) {
      // Select common cards by default
      const defaults = new Set(['amex_gold', 'chase_sapphire_preferred']);
      setSelectedPresets(defaults);
    }
    
    const cards = presets
      .filter(p => selectedPresets.has(p.id) || (selectedPresets.size === 0 && ['amex_gold', 'chase_sapphire_preferred'].includes(p.id)))
      .map(p => ({
        id: p.id,
        program: p.program,
        points: p.estimated_balance,
        confidence: 'estimated' as const,
      }));
    onConfirm(cards);
  };

  const handleEditConfirm = () => {
    onConfirm(editableCards.filter(c => c.points > 0).map(c => ({ ...c, confidence: 'exact' })));
  };

  const hasExistingCards = creditCards.length > 0;
  const displayedPresets = showAllPresets ? presets : presets.slice(0, 4);

  return (
    <div className="space-y-6">
      {/* Section Header */}
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 bg-blue-100 rounded-xl">
          <CreditCard className="w-5 h-5 text-blue-600" />
        </div>
        <div>
          <h3 className="text-lg font-semibold text-slate-900">Confirm your situation</h3>
          <p className="text-sm text-slate-500">
            {hasExistingCards
              ? "We found your cards. Does this look right?"
              : "Which cards do you have? We'll figure out the best way to use your points."}
          </p>
        </div>
      </div>

      {/* If user has existing cards, show them */}
      {hasExistingCards && mode === 'confirm' && (
        <div className="space-y-3">
          {creditCards.map((card) => (
            <div key={card.id} className="flex items-center justify-between p-4 bg-white border border-slate-200 rounded-xl">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-slate-100 rounded-lg">
                  <CreditCard className="w-4 h-4 text-slate-600" />
                </div>
                <div>
                  <p className="font-medium text-slate-900">{card.program}</p>
                  <p className="text-sm text-slate-500">{card.points.toLocaleString()} points available</p>
                </div>
              </div>
              <Check className="w-5 h-5 text-green-500" />
            </div>
          ))}
        </div>
      )}

      {/* Card selection for new/anonymous users */}
      {!hasExistingCards && mode === 'confirm' && (
        <div className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            {displayedPresets.map((preset) => (
              <button
                key={preset.id}
                onClick={() => togglePreset(preset.id)}
                className={`relative flex items-center gap-3 p-4 rounded-xl border-2 transition-all text-left ${
                  selectedPresets.has(preset.id)
                    ? `${CARD_BG[preset.icon] || 'bg-blue-50 border-blue-200'} ring-1 ring-blue-300`
                    : 'bg-white border-slate-200 hover:border-slate-300'
                }`}
              >
                <div className={`p-2 rounded-lg bg-gradient-to-br ${CARD_COLORS[preset.icon] || 'from-slate-500 to-slate-700'}`}>
                  <CreditCard className="w-4 h-4 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-medium text-slate-900 truncate">{preset.name}</p>
                  <p className="text-sm text-slate-500">{preset.usable_label}</p>
                </div>
                {selectedPresets.has(preset.id) && (
                  <div className="absolute top-2 right-2 p-0.5 bg-blue-500 rounded-full">
                    <Check className="w-3 h-3 text-white" />
                  </div>
                )}
              </button>
            ))}
          </div>
          
          {presets.length > 4 && (
            <button
              onClick={() => setShowAllPresets(!showAllPresets)}
              className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-700 mx-auto"
            >
              {showAllPresets ? (
                <>Show fewer <ChevronUp className="w-4 h-4" /></>
              ) : (
                <>Show more cards <ChevronDown className="w-4 h-4" /></>
              )}
            </button>
          )}
        </div>
      )}

      {/* Edit mode */}
      {mode === 'edit' && (
        <div className="space-y-3">
          {editableCards.map((card, idx) => (
            <div key={card.id} className="flex items-center gap-3 p-3 bg-white border border-slate-200 rounded-xl">
              <div className="p-2 bg-slate-100 rounded-lg">
                <CreditCard className="w-4 h-4 text-slate-600" />
              </div>
              <div className="flex-1">
                <p className="text-sm font-medium text-slate-700">{card.program}</p>
                <input
                  type="number"
                  value={card.points}
                  onChange={(e) => {
                    const updated = [...editableCards];
                    updated[idx] = { ...updated[idx], points: parseInt(e.target.value) || 0 };
                    setEditableCards(updated);
                  }}
                  className="w-full mt-1 px-3 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="Enter exact points balance"
                />
              </div>
              <button
                onClick={() => setEditableCards(editableCards.filter((_, i) => i !== idx))}
                className="p-1 text-slate-400 hover:text-red-500"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          <button
            onClick={handleEditConfirm}
            className="w-full py-3 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors"
          >
            Confirm balances
          </button>
        </div>
      )}

      {/* Action buttons */}
      {mode === 'confirm' && (
        <div className="flex flex-col sm:flex-row gap-3">
          <button
            onClick={handleLooksRight}
            disabled={!hasExistingCards && selectedPresets.size === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-blue-600 text-white rounded-xl font-medium hover:bg-blue-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Check className="w-4 h-4" />
            {hasExistingCards ? "Looks right" : "Use these cards"}
          </button>
          <button
            onClick={handleEdit}
            disabled={!hasExistingCards && selectedPresets.size === 0}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-white text-slate-700 border border-slate-300 rounded-xl font-medium hover:bg-slate-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Edit3 className="w-4 h-4" />
            Edit
          </button>
          <button
            onClick={handleEstimate}
            className="flex-1 flex items-center justify-center gap-2 py-3 px-4 bg-white text-slate-700 border border-slate-300 rounded-xl font-medium hover:bg-slate-50 transition-colors"
          >
            <Sparkles className="w-4 h-4" />
            Estimate for me
          </button>
        </div>
      )}
    </div>
  );
}
