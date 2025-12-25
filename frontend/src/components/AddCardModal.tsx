'use client';

import { useState } from 'react';
import { X, CreditCard } from 'lucide-react';

interface AddCardModalProps {
    onClose: () => void;
}

export function AddCardModal({ onClose }: AddCardModalProps) {
    const [cardType, setCardType] = useState('');
    const [points, setPoints] = useState('');

    const cardTypes = [
        'Chase Ultimate Rewards',
        'Amex Membership Rewards',
        'Citi ThankYou Points',
        'Capital One Miles',
        'Marriott Bonvoy',
        'Hilton Honors',
        'Delta SkyMiles',
        'United MileagePlus',
        'American Airlines AAdvantage',
    ];

    return (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-2xl max-w-md w-full p-6">
                <div className="flex items-center justify-between mb-6">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-100 rounded-xl flex items-center justify-center">
                            <CreditCard className="w-5 h-5 text-orange-600" />
                        </div>
                        <h2 className="text-gray-900">Add Credit Card</h2>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-2 hover:bg-gray-100 rounded-lg transition-colors"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                <div className="space-y-4 mb-6">
                    <div>
                        <label className="block text-sm text-gray-600 mb-2">Card Type / Points Program</label>
                        <select
                            value={cardType}
                            onChange={(e) => setCardType(e.target.value)}
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        >
                            <option value="">Select card type...</option>
                            {cardTypes.map((type) => (
                                <option key={type} value={type}>{type}</option>
                            ))}
                        </select>
                    </div>

                    <div>
                        <label className="block text-sm text-gray-600 mb-2">Points Balance</label>
                        <input
                            type="number"
                            value={points}
                            onChange={(e) => setPoints(e.target.value)}
                            placeholder="Enter points balance..."
                            className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                </div>

                <div className="p-4 bg-blue-50 rounded-lg mb-6">
                    <p className="text-sm text-blue-800 mb-2">Transfer Partners Detected:</p>
                    <div className="flex flex-wrap gap-2">
                        <span className="px-2 py-1 bg-white text-blue-700 rounded text-xs">United Airlines</span>
                        <span className="px-2 py-1 bg-white text-blue-700 rounded text-xs">Hyatt</span>
                        <span className="px-2 py-1 bg-white text-blue-700 rounded text-xs">Air France</span>
                        <span className="px-2 py-1 bg-white text-blue-700 rounded text-xs">+12 more</span>
                    </div>
                </div>

                <div className="flex gap-3">
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-3 border border-gray-300 rounded-lg text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-1 px-4 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                        Add Card
                    </button>
                </div>
            </div>
        </div>
    );
}
