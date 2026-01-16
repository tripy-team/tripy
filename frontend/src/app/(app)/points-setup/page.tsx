'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { CreditCard, Plus, X, Zap, TrendingUp, ArrowRight, Sparkles } from 'lucide-react';

interface LoyaltyCard {
  id: string;
  program: string;
  points: number;
  category: 'credit' | 'hotel' | 'airline';
}

const POPULAR_PROGRAMS = [
  { name: 'Chase Ultimate Rewards', category: 'credit' as const },
  { name: 'Amex Membership Rewards', category: 'credit' as const },
  { name: 'Citi ThankYou Points', category: 'credit' as const },
  { name: 'Capital One Miles', category: 'credit' as const },
  { name: 'Marriott Bonvoy', category: 'hotel' as const },
  { name: 'Hilton Honors', category: 'hotel' as const },
  { name: 'Hyatt World of Hyatt', category: 'hotel' as const },
  { name: 'Delta SkyMiles', category: 'airline' as const },
  { name: 'United MileagePlus', category: 'airline' as const },
  { name: 'American Airlines AAdvantage', category: 'airline' as const },
];

export default function PointsSetup() {
  const router = useRouter();
  const [cards, setCards] = useState<LoyaltyCard[]>([]);
  const [showAddModal, setShowAddModal] = useState(false);
  const [newProgram, setNewProgram] = useState('');
  const [newPoints, setNewPoints] = useState('');
  const [newCategory, setNewCategory] = useState<'credit' | 'hotel' | 'airline'>('credit');

  const totalPoints = cards.reduce((sum, card) => sum + card.points, 0);

  const addCard = () => {
    if (newProgram.trim() && newPoints.trim()) {
      const card: LoyaltyCard = {
        id: String(Date.now()),
        program: newProgram.trim(),
        points: Number(newPoints.trim()),
        category: newCategory,
      };
      setCards([...cards, card]);
      setNewProgram('');
      setNewPoints('');
      setNewCategory('credit');
      setShowAddModal(false);
    }
  };

  const removeCard = (id: string) => {
    setCards(cards.filter(card => card.id !== id));
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'credit': return 'bg-blue-50 border-blue-200 text-blue-700';
      case 'hotel': return 'bg-purple-50 border-purple-200 text-purple-700';
      case 'airline': return 'bg-cyan-50 border-cyan-200 text-cyan-700';
      default: return 'bg-slate-50 border-slate-200 text-slate-700';
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'credit': return <CreditCard className="w-4 h-4" />;
      case 'hotel': return <Sparkles className="w-4 h-4" />;
      case 'airline': return <TrendingUp className="w-4 h-4" />;
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
                          <div className="flex items-center gap-2">
                            <span className="text-sm text-slate-600">{card.points.toLocaleString()} points</span>
                            <span className={`text-xs px-2 py-0.5 rounded-full ${getCategoryColor(card.category)}`}>
                              {card.category}
                            </span>
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
                {POPULAR_PROGRAMS.map(program => (
                  <button
                    key={program.name}
                    onClick={() => {
                      setNewProgram(program.name);
                      setNewCategory(program.category);
                      setShowAddModal(true);
                    }}
                    className="flex items-center gap-3 px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl hover:bg-blue-50 hover:border-blue-200 transition-all text-left"
                  >
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${getCategoryColor(program.category)}`}>
                      {getCategoryIcon(program.category)}
                    </div>
                    <span className="text-sm text-slate-900">{program.name}</span>
                  </button>
                ))}
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
                  <div className="text-sm text-blue-100 mb-2">Total Points Value</div>
                  <div className="text-5xl font-bold mb-1">{totalPoints.toLocaleString()}</div>
                  <div className="text-sm text-blue-100">points across {cards.length} program{cards.length !== 1 ? 's' : ''}</div>
                </div>

                {cards.length > 0 && (
                  <div className="pt-6 border-t border-blue-500/30">
                    <div className="text-sm text-blue-100 mb-3">Breakdown by Category</div>
                    <div className="space-y-2">
                      {['credit', 'hotel', 'airline'].map(category => {
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
                  <span>Plan Solo Trip</span>
                  <ArrowRight className="w-5 h-5" />
                </button>

                <button
                  onClick={() => router.push('/group/setup')}
                  disabled={cards.length === 0}
                  className="w-full px-6 py-4 bg-white border-2 border-slate-200 text-slate-900 rounded-xl hover:bg-slate-50 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 font-semibold"
                >
                  <span>Plan Group Trip</span>
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
                }}
                className="p-2 hover:bg-slate-100 rounded-lg transition-colors"
              >
                <X className="w-5 h-5 text-slate-600" />
              </button>
            </div>

            <div className="space-y-5">
              <div>
                <label className="block text-sm text-slate-600 mb-2 font-medium">
                  Program Name
                </label>
                <input
                  type="text"
                  value={newProgram}
                  onChange={(e) => setNewProgram(e.target.value)}
                  placeholder="e.g., Chase Ultimate Rewards"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-600 mb-2 font-medium">
                  Points Balance
                </label>
                <input
                  type="number"
                  value={newPoints}
                  onChange={(e) => setNewPoints(e.target.value)}
                  placeholder="e.g., 150000"
                  className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm text-slate-600 mb-2 font-medium">
                  Category
                </label>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { value: 'credit', label: 'Credit Card', icon: CreditCard },
                    { value: 'hotel', label: 'Hotel', icon: Sparkles },
                    { value: 'airline', label: 'Airline', icon: TrendingUp },
                  ].map(({ value, label, icon: Icon }) => (
                    <button
                      key={value}
                      onClick={() => setNewCategory(value as 'credit' | 'hotel' | 'airline')}
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
            </div>

            <div className="flex gap-3 mt-8">
              <button
                onClick={() => {
                  setShowAddModal(false);
                  setNewProgram('');
                  setNewPoints('');
                  setNewCategory('credit');
                }}
                className="flex-1 px-4 py-3 bg-white border-2 border-slate-200 text-slate-900 rounded-xl hover:bg-slate-50 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={addCard}
                disabled={!newProgram.trim() || !newPoints.trim()}
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
