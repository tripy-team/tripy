'use client';

import { useState, useEffect, useMemo, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Plus, X, Zap, TrendingUp, ArrowRight, Sparkles, ChevronDown, Plane, AlertTriangle } from 'lucide-react';
import { users as usersAPI, points as pointsAPI } from '@/lib/api';
import { ALL_LOYALTY_PROGRAMS, getProgramCategory, isValidProgram } from '@/lib/loyalty-programs';

interface LoyaltyCard {
  id: string;
  program: string;
  points: number;
  category: 'credit' | 'airline';
  /** Optional card product (e.g. "Delta SkyMiles Gold Amex") for benefit-aware optimization (free bags, etc.) */
  card_product?: string;
}

// Popular programs for quick selection
const POPULAR_PROGRAMS = [
  'Chase Ultimate Rewards',
  'Amex Membership Rewards',
  'Citi ThankYou Points',
  'Capital One Miles',
  'Delta SkyMiles',
  'United MileagePlus',
  'American Airlines AAdvantage',
  'Southwest Rapid Rewards',
];

export default function PointsSetup() {
  const router = useRouter();
  const [cards, setCards] = useState<LoyaltyCard[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProgram, setNewProgram] = useState('');
  const [newPoints, setNewPoints] = useState('');
  const [newCategory, setNewCategory] = useState<'credit' | 'airline'>('credit');
  const [newCardProduct, setNewCardProduct] = useState('');
  const [showProgramDropdown, setShowProgramDropdown] = useState(false);
  const [programSearchQuery, setProgramSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [valuations, setValuations] = useState<Record<string, number>>({});
  
  // Use ref for saving state to avoid infinite loop in useEffect
  const isSavingRef = useRef(false);

  // Fetch TPG market-rate valuations (cents per point)
  useEffect(() => {
    pointsAPI.valuations().then(setValuations).catch(() => {});
  }, []);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      // Don't close if clicking inside the dropdown or input
      if (!target.closest('[data-program-dropdown]') && !target.closest('[data-program-input]')) {
        setShowProgramDropdown(false);
      }
    };
    if (showProgramDropdown) {
      // Use mousedown to prevent closing before click handlers fire
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [showProgramDropdown]);

  // Filter programs by category and search query
  const filteredPrograms = useMemo(() => {
    return ALL_LOYALTY_PROGRAMS.filter(p => {
      const matchesCategory = p.category === newCategory;
      const matchesSearch = !programSearchQuery || 
        p.label.toLowerCase().includes(programSearchQuery.toLowerCase()) ||
        p.value.toLowerCase().includes(programSearchQuery.toLowerCase());
      return matchesCategory && matchesSearch;
    });
  }, [newCategory, programSearchQuery]);

  // Update category when program is selected
  const handleProgramSelect = (program: string) => {
    const programInfo = ALL_LOYALTY_PROGRAMS.find(p => p.value === program || p.label === program);
    if (programInfo) {
      setNewProgram(programInfo.value);
      // Hotels not supported - treat as credit
      setNewCategory(programInfo.category === 'hotel' ? 'credit' : programInfo.category);
      setShowProgramDropdown(false);
      setProgramSearchQuery('');
    }
  };

  const totalPoints = cards.reduce((sum, card) => sum + card.points, 0);
  const totalValue = cards.length > 0 && Object.keys(valuations).length > 0
    ? cards.reduce((sum, card) => sum + (card.points * ((valuations[card.program] ?? 0) / 100)), 0)
    : null;

  // Load user profile on mount
  useEffect(() => {
    const loadUserProfile = async () => {
      try {
        setIsLoading(true);
        const profile = await usersAPI.getProfile();
        
        if (profile.credit_cards && profile.credit_cards.length > 0) {
          // Convert backend format to frontend format
          // Determine category from program name
          const loadedCards: LoyaltyCard[] = profile.credit_cards.map(card => {
            const rawCategory = getProgramCategory(card.program) || 'credit';
            // Hotels not supported - treat as credit if encountered
            const category: 'credit' | 'airline' = rawCategory === 'hotel' ? 'credit' : rawCategory;
            const c = card as { card_product?: string; card_name?: string };
            return {
              id: card.id,
              program: card.program,
              points: card.points,
              category,
              card_product: c.card_product || c.card_name,
            };
          });
          setCards(loadedCards);
        }
      } catch (err) {
        console.error('Error loading user profile:', err);
      } finally {
        setIsLoading(false);
      }
    };

    loadUserProfile();
  }, []);

  // Save credit cards to user profile when they change
  useEffect(() => {
    // Skip if still loading initial data or already saving
    if (isLoading || isSavingRef.current) {
      return;
    }

    const saveProfile = async () => {
      if (isSavingRef.current) return;
      
      try {
        isSavingRef.current = true;
        // Convert to backend format (remove category as it's not stored)
        const cardsToSave = cards.map(card => ({
          id: card.id,
          program: card.program,
          points: card.points,
          ...(card.card_product ? { card_product: card.card_product } : {}),
        }));
        
        await usersAPI.updateProfile({
          credit_cards: cardsToSave,
        });
      } catch (err) {
        console.error('Error saving user profile:', err);
      } finally {
        isSavingRef.current = false;
      }
    };

    // Debounce saves to avoid too many API calls
    const timeoutId = setTimeout(saveProfile, 1000);
    return () => clearTimeout(timeoutId);
  }, [cards, isLoading]);

  const addCard = () => {
    if (newProgram.trim() && newPoints.trim() && isValidProgram(newProgram)) {
      const programInfo = ALL_LOYALTY_PROGRAMS.find(p => p.value === newProgram || p.label === newProgram);
      const rawCategory = programInfo?.category || newCategory;
      // Hotels not supported - treat as credit if encountered
      const category: 'credit' | 'airline' = rawCategory === 'hotel' ? 'credit' : rawCategory;
      const card: LoyaltyCard = {
        id: `card-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        program: programInfo?.value || newProgram.trim(),
        points: Number(newPoints.trim()),
        category,
        card_product: newCardProduct.trim() || undefined,
      };
      setCards([...cards, card]);
      setNewProgram('');
      setNewPoints('');
      setNewCategory('credit');
      setNewCardProduct('');
      setShowAddModal(false);
    }
  };

  const removeCard = (id: string) => {
    setCards(cards.filter(card => card.id !== id));
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'credit': return 'bg-blue-50 border-blue-200 text-blue-700';
      case 'airline': return 'bg-cyan-50 border-cyan-200 text-cyan-700';
      default: return 'bg-slate-50 border-slate-200 text-slate-700';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'credit': return <CreditCard className="w-4 h-4" />;
      case 'airline': return <Plane className="w-4 h-4" />;
      default: return <CreditCard className="w-4 h-4" />;
    }
  };

  return (
    <div className="min-h-full bg-gradient-to-br from-white via-blue-50/30 to-white">
      <div className="max-w-6xl mx-auto px-8 py-12">
        {/* Header */}
        <div className="mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-100 rounded-full mb-4">
            <Zap className="w-4 h-4 text-blue-600" />
            <span className="text-sm text-blue-700 font-medium">Step 1: Add Your Points</span>
          </div>
          <h1 className="text-5xl mb-3 tracking-tight text-slate-900 font-bold">
            Maximize Your Travel Rewards
          </h1>
          <p className="text-lg text-slate-600">
            Add your credit card points and loyalty programs to get personalized travel recommendations
          </p>
        </div>

        <div className="mb-8 p-4 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
          <div>
            <h3 className="text-sm font-semibold text-amber-900 mb-1">Manual Entry Required</h3>
            <p className="text-sm text-amber-700 leading-relaxed">
              Tripy is currently working on a fix to automatically sync loyalty points, but right now you will have to input your points manually. 
              <br/>
              Thanks for your patience as we improve your experience!
            </p>
          </div>
        </div>

        <div className="grid lg:grid-cols-3 gap-8">
          {/* Left Column - Cards List */}
          <div className="lg:col-span-2 space-y-6">
            {/* Add Card Button */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <div className="flex items-center justify-between mb-6">
                <div>
                  <h2 className="text-2xl text-slate-900 mb-1">Your Loyalty Programs</h2>
                  <p className="text-sm text-slate-600">
                    {cards.length === 0 
                      ? 'Add your first loyalty program to get started' 
                      : `Managing ${cards.length} program${cards.length !== 1 ? 's' : ''}`
                    }
                  </p>
                </div>
                <button
                  onClick={() => setShowAddModal(true)}
                  className="flex items-center gap-2 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                >
                  <Plus className="w-5 h-5" />
                  <span>Add Program</span>
                </button>
              </div>

              {/* Cards List */}
              {cards.length === 0 ? (
                <div className="text-center py-12">
                  <div className="w-20 h-20 bg-blue-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <CreditCard className="w-10 h-10 text-blue-600" />
                  </div>
                  <h3 className="text-lg text-slate-900 mb-2">No programs added yet</h3>
                  <p className="text-slate-600 mb-6">
                    Add your credit cards and loyalty programs to unlock personalized recommendations
                  </p>
                  <button
                    onClick={() => setShowAddModal(true)}
                    className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm"
                  >
                    Add Your First Program
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  {cards.map(card => (
                    <div
                      key={card.id}
                      className="flex items-center justify-between px-6 py-4 bg-slate-50 border border-slate-200 rounded-xl group hover:bg-slate-100 transition-all"
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-xl flex items-center justify-center ${getCategoryColor(card.category)}`}>
                          {getCategoryIcon(card.category)}
                        </div>
                        <div>
                          <div className="text-slate-900 font-medium mb-0.5">{card.program}</div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-slate-600">{card.points.toLocaleString()} points</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${getCategoryColor(card.category)}`}>
                              {card.category}
                            </span>
                            {card.card_product && (
                              <span className="text-xs text-slate-500">• {card.card_product}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={() => removeCard(card.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-2 hover:bg-red-50 rounded-lg"
                      >
                        <X className="w-5 h-5 text-red-600" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Quick Add Popular Programs */}
            <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
              <h3 className="text-lg text-slate-900 mb-4 font-semibold">Popular Programs</h3>
              <p className="text-sm text-slate-600 mb-6">
                Quickly add commonly used loyalty programs
              </p>
              <div className="grid grid-cols-2 gap-3">
                {POPULAR_PROGRAMS.map(programName => {
                  const programInfo = ALL_LOYALTY_PROGRAMS.find(p => p.value === programName || p.label === programName);
                  if (!programInfo) return null;
                  return (
                    <button
                      key={programInfo.value}
                      onClick={() => {
                        setNewProgram(programInfo.value);
                        // Hotels not supported - treat as credit
                        setNewCategory(programInfo.category === 'hotel' ? 'credit' : programInfo.category);
                        setShowAddModal(true);
                      }}
                      className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-all text-left"
                    >
                      <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getCategoryColor(programInfo.category)}`}>
                        {getCategoryIcon(programInfo.category)}
                      </div>
                      <span className="text-sm text-slate-900">{programInfo.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Right Column - Summary & Actions */}
          <div className="lg:col-span-1">
            <div className="sticky top-8 space-y-6">
              {/* Points Summary */}
              <div className="bg-gradient-to-br from-blue-600 to-blue-700 text-white rounded-2xl p-8 shadow-xl shadow-blue-600/20">
                <div className="flex items-center gap-2 mb-6">
                  <Sparkles className="w-5 h-5" />
                  <h3 className="text-xl">Your Portfolio</h3>
                </div>

                <div className="mb-8">
                  <div className="text-sm text-blue-100 mb-2">Total Points</div>
                  <div className="text-5xl font-bold mb-1">{totalPoints.toLocaleString()}</div>
                  <div className="text-sm text-blue-100">points across {cards.length} program{cards.length !== 1 ? 's' : ''}</div>
                  {totalValue != null && totalValue > 0 && (
                    <div className="mt-2 text-sm text-blue-100">≈ ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} at TPG market rates</div>
                  )}
                </div>

                {cards.length > 0 && (
                  <div className="pt-6 border-t border-blue-500/30">
                    <div className="text-sm text-blue-100 mb-3">Breakdown by Category</div>
                    <div className="space-y-2">
                      {['credit', 'airline'].map(category => {
                        const categoryCards = cards.filter(c => c.category === category);
                        const categoryPoints = categoryCards.reduce((sum, c) => sum + c.points, 0);
                        if (categoryCards.length === 0) return null;
                        return (
                          <div key={category} className="flex justify-between text-sm">
                            <span className="text-blue-100 capitalize">{category}</span>
                            <span>{categoryPoints.toLocaleString()} pts</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div className="space-y-3">
                <button
                  onClick={() => router.push('/solo/setup')}
                  disabled={cards.length === 0}
                  className="w-full px-6 py-4 bg-yellow-400 text-slate-900 rounded-xl hover:bg-yellow-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 shadow-lg shadow-yellow-400/20 font-semibold"
                >
                  <span>Plan Trip</span>
                  <ArrowRight className="w-5 h-5" />
                </button>

                {cards.length === 0 && (
                  <p className="text-sm text-slate-500 text-center px-4">
                    Add at least one loyalty program to start planning
                  </p>
                )}
              </div>

              {/* Info Card */}
              <div className="bg-blue-50 border border-blue-200 rounded-xl p-6">
                <div className="flex gap-3">
                  <TrendingUp className="w-5 h-5 text-blue-600 flex-shrink-0 mt-0.5" />
                  <div>
                    <h4 className="text-sm text-slate-900 font-semibold mb-1">Maximize Your Value</h4>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Our AI finds redemptions worth 3-10x more than cash value per point
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Add Card Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl max-w-md w-full p-8 shadow-2xl">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl text-slate-900 font-semibold">Add Loyalty Program</h2>
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewProgram('');
                  setNewPoints('');
                  setNewCategory('credit');
                  setNewCardProduct('');
                  setProgramSearchQuery('');
                  setShowProgramDropdown(false);
                }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm text-slate-600 mb-2 font-medium">
                  Category
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { value: 'credit', label: 'Credit Card', icon: CreditCard },
                    { value: 'airline', label: 'Airline', icon: Plane },
                  ].map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => {
                        setNewCategory(value as 'credit' | 'airline');
                        setNewProgram('');
                        setProgramSearchQuery('');
                      }}
                      className={`px-4 py-3 rounded-xl border-2 transition-all flex flex-col items-center gap-2 ${
                        newCategory === value
                          ? 'border-blue-600 bg-blue-50'
                          : 'border-slate-200 bg-white hover:border-slate-300'
                      }`}
                    >
                      <Icon className={`w-5 h-5 ${newCategory === value ? 'text-blue-600' : 'text-slate-600'}`} />
                      <span className={`text-xs font-medium ${newCategory === value ? 'text-blue-600' : 'text-slate-600'}`}>
                        {label}
                      </span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="relative">
                <label className="block text-sm text-slate-600 mb-2 font-medium">
                  Program Name <span className="text-red-500">*</span>
                </label>
                <div className="relative" data-program-dropdown>
                  <input
                    type="text"
                    data-program-input
                    value={programSearchQuery || newProgram}
                    onChange={(e) => {
                      setProgramSearchQuery(e.target.value);
                      setShowProgramDropdown(true);
                      // Clear selected program when user types
                      if (e.target.value !== newProgram) {
                        setNewProgram('');
                      }
                      // Auto-select if exact match
                      const match = ALL_LOYALTY_PROGRAMS.find(
                        p => p.category === newCategory && 
                        (p.label.toLowerCase() === e.target.value.toLowerCase() || 
                         p.value.toLowerCase() === e.target.value.toLowerCase())
                      );
                      if (match) {
                        handleProgramSelect(match.value);
                      }
                    }}
                    onFocus={() => setShowProgramDropdown(true)}
                    placeholder="Search or select a program..."
                    className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent pr-10"
                  />
                  <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-400 pointer-events-none" />
                  
                  {showProgramDropdown && filteredPrograms.length > 0 && (
                    <div 
                      className="absolute z-50 w-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg max-h-64 overflow-y-auto"
                      onMouseDown={(e) => e.preventDefault()} // Prevent blur when clicking dropdown
                    >
                      {filteredPrograms.map(program => {
                        const programInfo = ALL_LOYALTY_PROGRAMS.find(p => p.value === program.value || p.label === program.label);
                        return (
                          <button
                            key={program.value}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleProgramSelect(program.value);
                            }}
                            className="w-full px-4 py-3 text-left hover:bg-blue-50 transition-colors border-b border-slate-100 last:border-b-0 flex items-center gap-3"
                          >
                            {programInfo && (
                              <div className={`w-6 h-6 rounded-lg flex items-center justify-center ${getCategoryColor(programInfo.category)}`}>
                                {getCategoryIcon(programInfo.category)}
                              </div>
                            )}
                            <div className="text-sm font-medium text-slate-900">{program.label}</div>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
                {newProgram && !isValidProgram(newProgram) && (
                  <p className="text-xs text-red-500 mt-1">Please select a valid program from the list</p>
                )}
              </div>

              <div>
                <label className="block text-sm text-slate-600 mb-2 font-medium">
                  Points Balance
                </label>
                <input
                  type="number"
                  value={newPoints}
                  onChange={(e) => setNewPoints(e.target.value)}
                  onWheel={(e) => e.currentTarget.blur()}
                  placeholder="e.g., 150000"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-600 mb-2 font-medium">
                  Card product <span className="text-slate-400 font-normal">(optional)</span>
                </label>
                <input
                  type="text"
                  value={newCardProduct}
                  onChange={(e) => setNewCardProduct(e.target.value)}
                  placeholder="e.g., Delta SkyMiles Gold Amex"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Enables benefit-aware savings (e.g. free bags on Delta when you have Delta Gold)
                </p>
              </div>

            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewProgram('');
                  setNewPoints('');
                  setNewCategory('credit');
                  setNewCardProduct('');
                  setProgramSearchQuery('');
                  setShowProgramDropdown(false);
                }}
                className="flex-1 px-4 py-3 bg-white border-2 border-slate-200 text-slate-900 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addCard}
                disabled={!newProgram.trim() || !newPoints.trim() || !isValidProgram(newProgram)}
                className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors shadow-sm disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Add Program
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
