'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { 
  Users, Trash2, UserPlus, Copy, Check, Settings, Loader2, 
  CheckCircle, XCircle, Clock, Shield, AlertTriangle
} from 'lucide-react';
import { Navigation } from '@/components/navigation';
import { 
  trips as tripsAPI, 
  users as usersAPI,
  Trip,
  MemberLifecycleState 
} from '@/lib/api';

interface Member {
  userId: string;
  name: string;
  email?: string;
  role: 'owner' | 'member';
  status: string;
  lifecycle_state?: MemberLifecycleState;
  max_cash_budget?: number;
}

/**
 * Get display text for lifecycle state
 */
function getLifecycleStateDisplay(state?: MemberLifecycleState): { label: string; color: string; icon: typeof Clock } {
  switch (state) {
    case 'invited':
      return { label: 'Invited', color: 'bg-gray-100 text-gray-700', icon: Clock };
    case 'joined_no_wallet':
      return { label: 'Needs Wallet', color: 'bg-orange-100 text-orange-700', icon: Clock };
    case 'wallet_connected':
      return { label: 'Ready for Approval', color: 'bg-blue-100 text-blue-700', icon: CheckCircle };
    case 'approved_for_planning':
      return { label: 'Approved', color: 'bg-green-100 text-green-700', icon: CheckCircle };
    case 'approved_for_booking':
      return { label: 'Ready to Book', color: 'bg-green-100 text-green-700', icon: CheckCircle };
    case 'inactive':
      return { label: 'Inactive', color: 'bg-red-100 text-red-700', icon: XCircle };
    default:
      return { label: 'Pending', color: 'bg-orange-100 text-orange-700', icon: Clock };
  }
}

function GroupAdminContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [copied, setCopied] = useState(false);
  const [inviteLink, setInviteLink] = useState('');
  const [tripId, setTripId] = useState<string | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isCurrentUserOwner, setIsCurrentUserOwner] = useState(false);
  const [updatingMember, setUpdatingMember] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchTripData = useCallback(async (id: string) => {
    try {
      setIsLoading(true);
      setError(null);
      
      // Fetch trip details, members, and current user profile in parallel
      const [tripData, membersData, profile] = await Promise.all([
        tripsAPI.get(id),
        tripsAPI.listMembers(id),
        usersAPI.getProfile(),
      ]);
      
      setTrip(tripData);
      
      // Check if current user is the owner
      const currentUserId = profile.userId;
      setIsCurrentUserOwner(tripData.createdBy === currentUserId);
      
      // Transform members data
      const transformedMembers: Member[] = membersData.members.map(m => {
        const memberData = m as {
          userId: string;
          role: string;
          status: string;
          name?: string;
          email?: string;
          lifecycle_state?: MemberLifecycleState;
          max_cash_budget?: number;
        };
        
        return {
          userId: memberData.userId,
          name: memberData.name || `User ${memberData.userId.slice(0, 6)}`,
          email: memberData.email,
          role: memberData.role as 'owner' | 'member',
          status: memberData.status || 'pending',
          lifecycle_state: memberData.lifecycle_state,
          max_cash_budget: memberData.max_cash_budget,
        };
      });
      
      setMembers(transformedMembers);
      
      // Generate invite link
      if (tripData.inviteCode) {
        const frontendUrl = typeof window !== 'undefined' ? window.location.origin : '';
        setInviteLink(`${frontendUrl}/group/join/${tripData.inviteCode}`);
      }
    } catch (err) {
      console.error('Error fetching trip data:', err);
      setError(err instanceof Error ? err.message : 'Failed to load trip data');
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

  const approveMember = async (userId: string) => {
    if (!tripId) return;
    
    setUpdatingMember(userId);
    try {
      await tripsAPI.adminUpdateLifecycleState(tripId, userId, 'approved_for_planning');
      // Refresh the members list
      await fetchTripData(tripId);
    } catch (err) {
      console.error('Error approving member:', err);
      alert('Failed to approve member. Please try again.');
    } finally {
      setUpdatingMember(null);
    }
  };

  const denyMember = async (userId: string) => {
    if (!tripId) return;
    
    if (!confirm('Are you sure you want to deny this member? They will be marked as inactive and excluded from optimization.')) {
      return;
    }
    
    setUpdatingMember(userId);
    try {
      await tripsAPI.adminUpdateLifecycleState(tripId, userId, 'inactive');
      // Refresh the members list
      await fetchTripData(tripId);
    } catch (err) {
      console.error('Error denying member:', err);
      alert('Failed to deny member. Please try again.');
    } finally {
      setUpdatingMember(null);
    }
  };

  const removeMember = async (userId: string) => {
    if (!tripId) return;
    
    if (!confirm('Are you sure you want to remove this member from the trip?')) {
      return;
    }
    
    setUpdatingMember(userId);
    try {
      await tripsAPI.adminUpdateLifecycleState(tripId, userId, 'inactive');
      // Refresh the members list
      await fetchTripData(tripId);
    } catch (err) {
      console.error('Error removing member:', err);
      alert('Failed to remove member. Please try again.');
    } finally {
      setUpdatingMember(null);
    }
  };

  const copyLink = () => {
    if (inviteLink) {
      navigator.clipboard.writeText(inviteLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Count members by status
  const waitingForWallet = members.filter(m => 
    m.role !== 'owner' && 
    (m.lifecycle_state === 'joined_no_wallet' || !m.lifecycle_state)
  ).length;
  
  const readyForApproval = members.filter(m => 
    m.role !== 'owner' && m.lifecycle_state === 'wallet_connected'
  ).length;
  
  const approved = members.filter(m => 
    m.lifecycle_state === 'approved_for_planning' || m.lifecycle_state === 'approved_for_booking'
  ).length;
  
  const inactive = members.filter(m => m.lifecycle_state === 'inactive').length;

  if (isLoading) {
    return (
      <div>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Loading trip data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
          <div className="text-center max-w-md">
            <AlertTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Error Loading Trip</h2>
            <p className="text-slate-600 mb-4">{error}</p>
            <button
              onClick={() => router.push('/group/dashboard')}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!isCurrentUserOwner) {
    return (
      <div>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
          <div className="text-center max-w-md">
            <Shield className="w-12 h-12 text-orange-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold text-slate-900 mb-2">Access Restricted</h2>
            <p className="text-slate-600 mb-4">Only the trip organizer can access group management settings.</p>
            <button
              onClick={() => router.push(`/group/dashboard?tripId=${tripId}`)}
              className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div>
      <Navigation />
      <div className="min-h-screen p-8 bg-gradient-to-br from-white via-blue-50/20 to-white">
        <div className="max-w-4xl mx-auto">
          {/* Header */}
          <div className="flex justify-between items-start mb-12">
            <div>
              <div className="inline-flex items-center gap-2 px-3 py-1 bg-blue-100 rounded-full text-sm text-blue-700 mb-4 font-medium">
                <Settings className="w-4 h-4" />
                <span>Group Management</span>
              </div>
              <h1 className="text-4xl mb-3 tracking-tight text-slate-900 font-bold">
                {trip?.title || 'Manage Group'}
              </h1>
              <p className="text-slate-600">
                Approve members, manage access, and configure group settings
              </p>
            </div>
            <button 
              onClick={() => router.push(`/group/dashboard?tripId=${tripId}`)}
              className="text-slate-500 hover:text-slate-900 font-medium"
            >
              Back to Dashboard
            </button>
          </div>

          {/* Stats */}
          <div className="grid grid-cols-4 gap-4 mb-8">
            <div className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="text-2xl font-bold text-slate-900">{members.length}</div>
              <div className="text-sm text-slate-500">Total Members</div>
            </div>
            <div className="bg-orange-50 border border-orange-200 rounded-xl p-4">
              <div className="text-2xl font-bold text-orange-700">{waitingForWallet}</div>
              <div className="text-sm text-orange-600">Needs Wallet</div>
            </div>
            <div className="bg-blue-50 border border-blue-200 rounded-xl p-4">
              <div className="text-2xl font-bold text-blue-700">{readyForApproval}</div>
              <div className="text-sm text-blue-600">Ready for Approval</div>
            </div>
            <div className="bg-green-50 border border-green-200 rounded-xl p-4">
              <div className="text-2xl font-bold text-green-700">{approved}</div>
              <div className="text-sm text-green-600">Approved</div>
            </div>
          </div>

          <div className="grid gap-8">
            {/* Invite Section */}
            <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">
              <h2 className="text-xl font-semibold text-slate-900 mb-4 flex items-center gap-2">
                <UserPlus className="w-5 h-5 text-blue-600" />
                Invite New Members
              </h2>
              <p className="text-slate-600 mb-6">
                Share this link with friends to let them join your trip. They will need your approval before being added to the optimization.
              </p>
              
              <div className="flex gap-4">
                <div className="flex-1 flex items-center bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-600 font-mono text-sm overflow-hidden">
                  <span className="truncate">{inviteLink || 'Generating invite link...'}</span>
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
                  Members ({members.length})
                </h2>
              </div>
              
              <div className="divide-y divide-slate-100">
                {members.map((member) => {
                  const stateDisplay = getLifecycleStateDisplay(member.lifecycle_state);
                  const StateIcon = stateDisplay.icon;
                  const isOwner = member.role === 'owner';
                  // Can only approve members who have connected their wallet
                  const canBeApproved = !isOwner && member.lifecycle_state === 'wallet_connected';
                  // Members waiting to connect wallet (can only be denied, not approved)
                  const isWaitingForWallet = !isOwner && (
                    member.lifecycle_state === 'joined_no_wallet' || 
                    !member.lifecycle_state
                  );
                  const isInactive = member.lifecycle_state === 'inactive';
                  const isUpdating = updatingMember === member.userId;
                  
                  return (
                    <div 
                      key={member.userId} 
                      className={`p-6 flex items-center justify-between hover:bg-slate-50 transition-colors ${isInactive ? 'opacity-50' : ''}`}
                    >
                      <div className="flex items-center gap-4">
                        <div className={`w-12 h-12 rounded-full flex items-center justify-center font-semibold text-lg ${
                          isOwner ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'
                        }`}>
                          {member.name.split(' ').map(n => n[0]).join('').slice(0, 2)}
                        </div>
                        <div>
                          <div className="font-semibold text-slate-900 flex items-center gap-2">
                            {member.name}
                            {isOwner && (
                              <span className="text-xs px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full">
                                Organizer
                              </span>
                            )}
                          </div>
                          {member.email && (
                            <div className="text-sm text-slate-500">{member.email}</div>
                          )}
                          {member.max_cash_budget && (
                            <div className="text-xs text-slate-400">
                              Budget: ${member.max_cash_budget.toLocaleString()}
                            </div>
                          )}
                        </div>
                      </div>
                      
                      <div className="flex items-center gap-4">
                        {/* Status Badge */}
                        <div className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${stateDisplay.color}`}>
                          <StateIcon className="w-3.5 h-3.5" />
                          {stateDisplay.label}
                        </div>
                        
                        {/* Action Buttons */}
                        {!isOwner && (
                          <div className="flex items-center gap-2">
                            {/* Members with wallet connected can be approved */}
                            {canBeApproved && (
                              <>
                                <button
                                  onClick={() => approveMember(member.userId)}
                                  disabled={isUpdating}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm font-medium disabled:opacity-50"
                                >
                                  {isUpdating ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <CheckCircle className="w-4 h-4" />
                                  )}
                                  Approve
                                </button>
                                <button
                                  onClick={() => denyMember(member.userId)}
                                  disabled={isUpdating}
                                  className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium disabled:opacity-50"
                                >
                                  {isUpdating ? (
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                  ) : (
                                    <XCircle className="w-4 h-4" />
                                  )}
                                  Deny
                                </button>
                              </>
                            )}
                            
                            {/* Members waiting for wallet can only be denied */}
                            {isWaitingForWallet && (
                              <button
                                onClick={() => denyMember(member.userId)}
                                disabled={isUpdating}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-red-100 text-red-700 rounded-lg hover:bg-red-200 transition-colors text-sm font-medium disabled:opacity-50"
                              >
                                {isUpdating ? (
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                ) : (
                                  <XCircle className="w-4 h-4" />
                                )}
                                Deny
                              </button>
                            )}
                            
                            {!canBeApproved && !isWaitingForWallet && !isInactive && (
                              <button
                                onClick={() => removeMember(member.userId)}
                                disabled={isUpdating}
                                className="p-2 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                                title="Remove member"
                              >
                                {isUpdating ? (
                                  <Loader2 className="w-5 h-5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-5 h-5" />
                                )}
                              </button>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
                
                {members.length === 0 && (
                  <div className="p-8 text-center text-slate-500">
                    <Users className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                    <p>No members yet. Share the invite link to add members.</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function GroupAdmin() {
  return (
    <Suspense fallback={
      <div>
        <Navigation />
        <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-white via-blue-50/20 to-white">
          <div className="text-center">
            <Loader2 className="w-12 h-12 text-blue-600 animate-spin mx-auto mb-4" />
            <p className="text-slate-600">Loading...</p>
          </div>
        </div>
      </div>
    }>
      <GroupAdminContent />
    </Suspense>
  );
}
