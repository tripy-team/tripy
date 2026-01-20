'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Link2, ArrowRight } from 'lucide-react';

export default function JoinTrip() {
  const router = useRouter();
  const [inviteCode, setInviteCode] = useState('');
  const [error, setError] = useState('');

  const handleJoin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    
    if (!inviteCode.trim()) {
      setError('Please enter an invite code');
      return;
    }

    try {
      // Extract code from URL if full URL is pasted, or use the code directly
      const code = inviteCode.split('/').pop() || inviteCode;
      
      // Try to validate the code by fetching trip info
      const { trips } = await import('@/lib/api');
      await trips.getByInvite(code.trim());
      
      // If successful, navigate
      router.push(`/group/join/${code.trim()}`);
    } catch (err) {
      // Show error message instead of redirecting
      setError('Invalid invite code. Please check the code and try again.');
      console.error('Error validating invite code:', err);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-white via-blue-50/30 to-white">
        <div className="max-w-md w-full">
          <div className="text-center mb-10">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mx-auto mb-6 shadow-lg shadow-blue-600/20">
              <Link2 className="w-8 h-8 text-white" />
            </div>
            <h1 className="text-3xl font-bold text-slate-900 mb-3">Join a Trip</h1>
            <p className="text-slate-600">
              Enter the invite link or code shared by your group administrator
            </p>
          </div>

          <div className="bg-white p-8 rounded-3xl shadow-xl shadow-slate-200/50 border border-slate-100">
            <form onSubmit={handleJoin} className="space-y-6">
              <div>
                <label htmlFor="invite-code" className="block text-sm font-medium text-slate-700 mb-2">
                  Invite Link or Code
                </label>
                <input
                  id="invite-code"
                  type="text"
                  value={inviteCode}
                  onChange={(e) => {
                    setInviteCode(e.target.value);
                    setError(''); // Clear error when user types
                  }}
                  placeholder="tripy.app/group/join/xyz... or just the code"
                  className={`w-full px-4 py-3 bg-slate-50 border rounded-xl focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent transition-all ${
                    error ? 'border-red-500' : 'border-slate-200'
                  }`}
                  autoFocus
                />
                {error && (
                  <p className="mt-2 text-sm text-red-600">{error}</p>
                )}
              </div>

              <button
                type="submit"
                disabled={!inviteCode.trim()}
                className="w-full flex items-center justify-center gap-2 px-6 py-4 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>

            <div className="mt-8 pt-6 border-t border-slate-100 text-center">
              <p className="text-sm text-slate-500">
                Don&apos;t have a code?{' '}
                <button 
                  onClick={() => router.push('/group/setup')}
                  className="text-blue-600 font-medium hover:underline"
                >
                  Create a new group trip
                </button>
              </p>
            </div>
          </div>
        </div>
      </div>
  );
}
