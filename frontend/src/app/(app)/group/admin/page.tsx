'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Users, Trash2, UserPlus, Copy, Check } from 'lucide-react';
import { Navigation } from '@/components/navigation';
import { trips as tripsAPI } from '@/lib/api';

interface Member {
  id: string;
  name: string;
  email: string;
  role: 'Admin' | 'Member';
  status: 'Active' | 'Pending';
}

export default function GroupAdmin() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [tripId, setTripId] = useState<string | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  const fetchTripData = useCallback(async (id: string) => {
    try {
      setIsLoading(true);
      // TODO: Fetch trip details and members from API
      // const trip = await tripsAPI.get(id);
      // const membersData = await tripsAPI.getMembers(id);
      
      // For now, using mock data
      const mockMembers: Member[] = [
        { id: '1', name: 'Sarah Chen', email: 'sarah@example.com', role: 'Admin', status: 'Active' },
        { id: '2', name: 'Michael Rodriguez', email: 'michael@example.com', role: 'Member', status: 'Active' },
        { id: '3', name: 'Emma Thompson', email: 'emma@example.com', role: 'Member', status: 'Pending' },
        { id: '4', name: 'David Kim', email: 'david@example.com', role: 'Member', status: 'Active' },
      ];
      
      setMembers(mockMembers);
      
      // Generate invite link
      // TODO: Get actual invite code from trip data
      // For now, try to get it from trip response or use a placeholder
      const inviteCode = 'EU2025'; // Placeholder - should come from trip data
      setInviteLink(`${typeof window !== 'undefined' ? window.location.origin : ''}/group/join/${inviteCode}`);
    } catch (error) {
      console.error('Error fetching trip data:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Get trip ID from URL query params
    const id = searchParams?.get('trip_id') || searchParams?.get('tripId');
    
    if (id) {
      setTripId(id);
      fetchTripData(id);
    } else {
      // If no trip ID, redirect to dashboard
      router.push('/group/dashboard');
    }
  }, [router, searchParams, fetchTripData]);

  const removeMember = async (id: string) => {
    if (!tripId) return;
    
    try {
      // TODO: Call API to remove member
      // await tripsAPI.removeMember(tripId, id);
      setMembers(members.filter(m => m.id !== id));
    } catch (error) {
      console.error('Error removing member:', error);
      // Show error toast/notification
    }
  };

  const copyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  if (isLoading) {
    return (
      <React.Fragment>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
          <div className="text-slate-600">Loading...</div>
        </div>
      </React.Fragment>
    );
  }

  return (
    <React.Fragment>
      <Navigation />
      <div className="min-h-screen p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-start mb-12">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                <Users className="w-4 h-4" />
                <span>Group Management</span>
              </div>
              <h1 className="text-4xl mb-3 tracking-tight text-slate-900 font-bold">Manage Group</h1>
              <p className="text-slate-600">
                Add or remove members from your group trip
              </p>
            </div>
            <button 
              onClick={() => router.push('/group/dashboard')}
              className="text-slate-500 hover:text-slate-900 font-medium"
            >
              Back to Dashboard
            </button>
          </div>

          <div className="grid gap-8">
            {/* Invite Section */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                Invite New Members
              </h2>
              <p className="text-slate-600 mb-6">
                Share this link with friends to let them join your trip automatically.
              </p>
              
              <div className="flex gap-4">
                <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-600 font-mono text-sm overflow-x-auto">
                  {inviteLink || 'Generating invite link...'}
                </div>
                <button
                  onClick={copyLink}
                  disabled={!inviteLink}
                  className="flex items-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                  {copied ? 'Copied!' : 'Copy Link'}
                </button>
              </div>
            </div>

            {/* Members List */}
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-sm">
              <div className="p-6 border-b border-slate-200">
                <h2 className="text-xl font-semibold text-slate-900 flex items-center gap-2">
                  <Users className="w-5 h-5 text-blue-600" />
                  Current Members ({members.length})
                </h2>
              </div>
              
              <div className="divide-y divide-slate-100">
                {members.map((member) => (
                  <div key={member.id} className="p-6 flex items-center justify-between hover:bg-slate-50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="w-12 h-12 bg-blue-100 text-blue-700 rounded-full flex items-center justify-center font-semibold text-lg">
                        {member.name.split(' ').map(n => n[0]).join('')}
                      </div>
                      <div>
                        <div className="font-semibold text-slate-900">{member.name}</div>
                        <div className="text-sm text-slate-500">{member.email}</div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6">
                      <div className={`px-3 py-1 rounded-full text-xs font-medium ${
                        member.status === 'Active' 
                          ? 'bg-green-100 text-green-700' 
                          : 'bg-orange-100 text-orange-700'
                      }`}>
                        {member.status}
                      </div>
                      
                      <span className="text-sm text-slate-500 font-medium w-16">
                        {member.role}
                      </span>

                      {member.role !== 'Admin' && (
                        <button
                          onClick={() => removeMember(member.id)}
                          className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                          title="Remove member"
                        >
                          <Trash2 className="w-5 h-5" />
                        </button>
                      )}
                      {member.role === 'Admin' && (
                        <div className="w-9 h-9"></div> {/* Spacer to align with remove button */}
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </React.Fragment>
  );
}
