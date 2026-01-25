'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { 
  User, 
  CreditCard, 
  Bell, 
  Shield, 
  LogOut, 
  Camera,
  Globe,
  Save,
  Check
} from 'lucide-react';
import { users as usersAPI, UpdateProfileRequest } from '@/lib/api';
import CityAutocomplete from '@/components/city-autocomplete';

export default function SettingsPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('general');
  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  
  // Profile state
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [defaultHomeAirport, setDefaultHomeAirport] = useState('');
  const [timezone, setTimezone] = useState('America/Los_Angeles');
  const [totalSavings, setTotalSavings] = useState<number>(0);

  // Travel preferences
  const [preferredCurrency, setPreferredCurrency] = useState('USD');
  const [seatPreference, setSeatPreference] = useState('window');
  const [mealPreference, setMealPreference] = useState('standard');

  // Notification preferences
  const [emailTripInvites, setEmailTripInvites] = useState(true);
  const [emailPriceAlerts, setEmailPriceAlerts] = useState(true);
  const [emailMarketing, setEmailMarketing] = useState(false);
  const [pushItineraryUpdates, setPushItineraryUpdates] = useState(true);
  const [pushChatMessages, setPushChatMessages] = useState(true);

  // Billing & Payment state
  const [paymentMethods, setPaymentMethods] = useState<Array<{
    id: string;
    brand: string;
    last4: string;
    expiry: string;
  }>>([]);
  const [billingHistory, setBillingHistory] = useState<Array<{
    id: string;
    description: string;
    date: string;
    amount: string;
  }>>([]);

  // Security
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [twoFactorEnabled, setTwoFactorEnabled] = useState(false);

  // Load user profile on mount
  useEffect(() => {
    const loadProfile = async () => {
      try {
        setIsLoading(true);
        const profile = await usersAPI.getProfile();
        setName(profile.name || '');
        setEmail(profile.email || '');
        setDefaultHomeAirport(profile.default_home_airport || '');
        setTimezone(profile.timezone || 'America/Los_Angeles');
        setTotalSavings(profile.total_savings || 0);

        // Recalculate savings in the background
        usersAPI.calculateSavings().then((result) => {
          setTotalSavings(result.total_savings);
        }).catch((err) => {
          console.error('Error calculating savings:', err);
          // Don't show error to user - just use cached value
        });
      } catch (error) {
        console.error('Error loading profile:', error);
      } finally {
        setIsLoading(false);
      }
    };

    loadProfile();
  }, []);

  const handleSaveGeneral = async () => {
    try {
      setIsSaving(true);
      setSaveSuccess(false);
      
      const updates: UpdateProfileRequest = {
        name: name || undefined,
        default_home_airport: defaultHomeAirport || undefined,
        timezone: timezone || undefined,
      };

      await usersAPI.updateProfile(updates);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Error saving profile:', error);
      alert('Failed to save profile. Please try again.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleLogout = () => {
    // Clear tokens
    if (typeof window !== 'undefined') {
      localStorage.removeItem('access_token');
      localStorage.removeItem('id_token');
      localStorage.removeItem('refresh_token');
      localStorage.removeItem('auth_token');
      sessionStorage.removeItem('access_token');
      sessionStorage.removeItem('id_token');
      sessionStorage.removeItem('refresh_token');
      window.dispatchEvent(new Event('tripy_auth_change'));
    }
    router.push('/login');
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-blue-50/20 to-white">
      <div className="max-w-6xl mx-auto px-4 py-8">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-slate-900">Account Settings</h1>
          <p className="text-slate-500 mt-2">Manage your profile preferences and account security.</p>
        </div>

        <div className="flex flex-col lg:flex-row gap-8">
          {/* Sidebar Navigation */}
          <div className="lg:w-64 flex-shrink-0">
            <div className="bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
              <nav className="flex flex-col space-y-1 p-2">
                <button
                  onClick={() => setActiveTab('general')}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'general' 
                      ? 'bg-blue-50 text-blue-700' 
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <User className="w-5 h-5" />
                  <span>General Profile</span>
                </button>
                <button
                  onClick={() => setActiveTab('preferences')}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'preferences' 
                      ? 'bg-blue-50 text-blue-700' 
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Globe className="w-5 h-5" />
                  <span>Travel Preferences</span>
                </button>
                <button
                  onClick={() => setActiveTab('notifications')}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'notifications' 
                      ? 'bg-blue-50 text-blue-700' 
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Bell className="w-5 h-5" />
                  <span>Notifications</span>
                </button>
                <button
                  onClick={() => setActiveTab('billing')}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'billing' 
                      ? 'bg-blue-50 text-blue-700' 
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <CreditCard className="w-5 h-5" />
                  <span>Billing & Payments</span>
                </button>
                <button
                  onClick={() => setActiveTab('security')}
                  className={`flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium transition-colors ${
                    activeTab === 'security' 
                      ? 'bg-blue-50 text-blue-700' 
                      : 'text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <Shield className="w-5 h-5" />
                  <span>Security</span>
                </button>
                
                <div className="border-t border-slate-200 my-2" />
                
                <button
                  onClick={handleLogout}
                  className="flex items-center space-x-3 px-4 py-3 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-5 h-5" />
                  <span>Sign Out</span>
                </button>
              </nav>
            </div>
          </div>

          {/* Content Area */}
          <div className="flex-1">
            {isLoading ? (
              <div className="bg-white border border-slate-200 rounded-2xl p-12 shadow-sm flex items-center justify-center">
                <div className="text-slate-500">Loading profile...</div>
              </div>
            ) : (
              <>
                {activeTab === 'general' && (
                  <div className="space-y-6">
                    {/* Profile Card */}
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                      <div className="mb-6">
                        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Profile Information</h2>
                        <p className="text-sm text-slate-500">Update your photo and personal details.</p>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="flex items-center gap-6">
                          <div className="relative group">
                            <div className="w-24 h-24 rounded-full bg-blue-100 flex items-center justify-center border-4 border-white shadow-md overflow-hidden">
                              {email ? (
                                <div className="w-full h-full bg-gradient-to-br from-blue-500 to-blue-600 flex items-center justify-center text-white text-2xl font-semibold">
                                  {name ? name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) : email[0].toUpperCase()}
                                </div>
                              ) : (
                                <User className="w-12 h-12 text-blue-600" />
                              )}
                            </div>
                            <button 
                              type="button"
                              className="absolute bottom-0 right-0 bg-white p-2 rounded-full shadow-lg border border-slate-200 text-slate-600 hover:text-blue-600 hover:border-blue-200 transition-all"
                              onClick={() => {
                                // TODO: Implement photo upload
                                alert('Photo upload coming soon!');
                              }}
                            >
                              <Camera className="w-4 h-4" />
                            </button>
                          </div>
                          <div className="space-y-1">
                            <h3 className="font-medium text-lg text-slate-900">{name || 'Your Name'}</h3>
                            <p className="text-slate-500 text-sm">Update your photo and personal details</p>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label htmlFor="name" className="block text-sm font-medium text-slate-700">Full Name</label>
                            <input
                              id="name"
                              type="text"
                              value={name}
                              onChange={(e) => setName(e.target.value)}
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                              placeholder="Your full name"
                            />
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="email" className="block text-sm font-medium text-slate-700">Email Address</label>
                            <input
                              id="email"
                              type="email"
                              value={email}
                              disabled
                              className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-500 cursor-not-allowed"
                            />
                            <p className="text-xs text-slate-500">Email cannot be changed</p>
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="homeAirport" className="block text-sm font-medium text-slate-700">Home Airport</label>
                            <CityAutocomplete
                              value={defaultHomeAirport}
                              onChange={setDefaultHomeAirport}
                              onSelect={(city) => setDefaultHomeAirport(city)}
                              placeholder="e.g., SFO, JFK"
                            />
                          </div>
                          <div className="space-y-2">
                            <label htmlFor="timezone" className="block text-sm font-medium text-slate-700">Timezone</label>
                            <select
                              id="timezone"
                              value={timezone}
                              onChange={(e) => setTimezone(e.target.value)}
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                            >
                              <option value="America/Los_Angeles">Pacific Time (PT)</option>
                              <option value="America/Denver">Mountain Time (MT)</option>
                              <option value="America/Chicago">Central Time (CT)</option>
                              <option value="America/New_York">Eastern Time (ET)</option>
                              <option value="Europe/London">London (GMT)</option>
                              <option value="Europe/Paris">Paris (CET)</option>
                              <option value="Asia/Tokyo">Tokyo (JST)</option>
                              <option value="Australia/Sydney">Sydney (AEDT)</option>
                            </select>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label htmlFor="totalSavings" className="block text-sm font-medium text-slate-700">Total Money Saved</label>
                          <div className="w-full px-4 py-3 bg-slate-50 border border-slate-200 rounded-xl text-slate-700">
                            ${typeof totalSavings === 'number' ? totalSavings.toLocaleString() : '0'}
                          </div>
                          <p className="text-xs text-slate-500">
                            This is calculated from all your completed trips
                          </p>
                        </div>

                        <div className="flex justify-end pt-4 gap-3">
                          {saveSuccess && (
                            <div className="flex items-center gap-2 text-green-600">
                              <Check className="w-4 h-4" />
                              <span className="text-sm">Saved successfully!</span>
                            </div>
                          )}
                          <button
                            onClick={handleSaveGeneral}
                            disabled={isSaving}
                            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                          >
                            {isSaving ? (
                              <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                                Saving...
                              </>
                            ) : (
                              <>
                                <Save className="w-4 h-4" />
                                Save Changes
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'preferences' && (
                  <div className="space-y-6">
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                      <div className="mb-6">
                        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Travel Preferences</h2>
                        <p className="text-sm text-slate-500">Customize your travel experience and requirements.</p>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-slate-700">Home Airport</label>
                            <CityAutocomplete
                              value={defaultHomeAirport}
                              onChange={setDefaultHomeAirport}
                              onSelect={(city) => setDefaultHomeAirport(city)}
                              placeholder="e.g., SFO, JFK"
                            />
                          </div>
                          <div className="space-y-2">
                            <label className="block text-sm font-medium text-slate-700">Preferred Currency</label>
                            <select
                              value={preferredCurrency}
                              onChange={(e) => setPreferredCurrency(e.target.value)}
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                            >
                              <option value="USD">USD ($)</option>
                              <option value="EUR">EUR (€)</option>
                              <option value="GBP">GBP (£)</option>
                              <option value="JPY">JPY (¥)</option>
                              <option value="CAD">CAD ($)</option>
                              <option value="AUD">AUD ($)</option>
                            </select>
                          </div>
                        </div>

                        <div className="border-t border-slate-200 pt-6">
                          <h3 className="font-medium text-slate-900 mb-4">Flight Preferences</h3>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label className="block text-sm font-medium text-slate-700">Seat Preference</label>
                              <select
                                value={seatPreference}
                                onChange={(e) => setSeatPreference(e.target.value)}
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                              >
                                <option value="window">Window</option>
                                <option value="aisle">Aisle</option>
                                <option value="middle">Middle</option>
                                <option value="no-preference">No Preference</option>
                              </select>
                            </div>
                            <div className="space-y-2">
                              <label className="block text-sm font-medium text-slate-700">Meal Preference</label>
                              <select
                                value={mealPreference}
                                onChange={(e) => setMealPreference(e.target.value)}
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                              >
                                <option value="standard">Standard</option>
                                <option value="vegetarian">Vegetarian</option>
                                <option value="vegan">Vegan</option>
                                <option value="gluten-free">Gluten Free</option>
                                <option value="kosher">Kosher</option>
                                <option value="halal">Halal</option>
                              </select>
                            </div>
                          </div>
                        </div>

                        <div className="flex justify-end pt-4">
                          <button
                            onClick={handleSaveGeneral}
                            disabled={isSaving}
                            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSaving ? 'Saving...' : 'Save Preferences'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'notifications' && (
                  <div className="space-y-6">
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                      <div className="mb-6">
                        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Notification Settings</h2>
                        <p className="text-sm text-slate-500">Choose how you want to be notified about trip updates.</p>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <h3 className="font-medium text-sm text-slate-500 uppercase tracking-wider">Email Notifications</h3>
                          
                          <div className="flex items-center justify-between py-3">
                            <div className="space-y-0.5">
                              <label className="text-base font-medium text-slate-900">Trip Invites</label>
                              <p className="text-sm text-slate-500">Receive emails when someone invites you to a trip.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={emailTripInvites}
                                onChange={(e) => setEmailTripInvites(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                          </div>
                          
                          <div className="border-t border-slate-200" />
                          
                          <div className="flex items-center justify-between py-3">
                            <div className="space-y-0.5">
                              <label className="text-base font-medium text-slate-900">Price Alerts</label>
                              <p className="text-sm text-slate-500">Get notified when flight or hotel prices drop.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={emailPriceAlerts}
                                onChange={(e) => setEmailPriceAlerts(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                          </div>
                          
                          <div className="border-t border-slate-200" />
                          
                          <div className="flex items-center justify-between py-3">
                            <div className="space-y-0.5">
                              <label className="text-base font-medium text-slate-900">Marketing & Tips</label>
                              <p className="text-sm text-slate-500">Receive travel tips and promotional offers.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={emailMarketing}
                                onChange={(e) => setEmailMarketing(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                          </div>
                        </div>

                        <div className="pt-6 space-y-4 border-t border-slate-200">
                          <h3 className="font-medium text-sm text-slate-500 uppercase tracking-wider">Push Notifications</h3>
                          
                          <div className="flex items-center justify-between py-3">
                            <div className="space-y-0.5">
                              <label className="text-base font-medium text-slate-900">Itinerary Updates</label>
                              <p className="text-sm text-slate-500">Instant updates for flight changes or schedule adjustments.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={pushItineraryUpdates}
                                onChange={(e) => setPushItineraryUpdates(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                          </div>
                          
                          <div className="border-t border-slate-200" />
                          
                          <div className="flex items-center justify-between py-3">
                            <div className="space-y-0.5">
                              <label className="text-base font-medium text-slate-900">Chat Messages</label>
                              <p className="text-sm text-slate-500">Notifications for new messages in group chats.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={pushChatMessages}
                                onChange={(e) => setPushChatMessages(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                          </div>
                        </div>

                        <div className="flex justify-end pt-4">
                          <button
                            disabled={isSaving}
                            className="px-6 py-3 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-colors font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {isSaving ? 'Saving...' : 'Save Settings'}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'billing' && (
                  <div className="space-y-6">
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                      <div className="mb-6">
                        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Payment Methods</h2>
                        <p className="text-sm text-slate-500">Manage your credit cards and billing information.</p>
                      </div>
                      
                      <div className="space-y-6">
                        {paymentMethods.length > 0 ? (
                          <>
                            {paymentMethods.map((method) => (
                              <div key={method.id} className="bg-slate-50 p-4 rounded-xl border border-slate-200 flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                  <div className="w-12 h-8 bg-slate-900 rounded-md flex items-center justify-center text-white font-bold text-xs">
                                    {method.brand.toUpperCase()}
                                  </div>
                                  <div>
                                    <p className="font-medium text-slate-900">{method.brand} ending in {method.last4}</p>
                                    <p className="text-sm text-slate-500">Expires {method.expiry}</p>
                                  </div>
                                </div>
                                <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors text-sm font-medium">
                                  Edit
                                </button>
                              </div>
                            ))}
                          </>
                        ) : (
                          <div className="bg-slate-50 p-8 rounded-xl border border-slate-200 text-center">
                            <CreditCard className="w-12 h-12 text-slate-300 mx-auto mb-3" />
                            <p className="text-slate-500 text-sm mb-2">No payment methods added yet</p>
                            <p className="text-slate-400 text-xs">Add a payment method to manage your subscriptions</p>
                          </div>
                        )}

                        <button className="w-full px-4 py-3 border-2 border-dashed border-slate-300 bg-transparent text-slate-600 hover:bg-slate-50 rounded-xl transition-colors font-medium">
                          + Add New Payment Method
                        </button>
                      </div>
                    </div>
                    
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                      <div className="mb-6">
                        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Billing History</h2>
                        <p className="text-sm text-slate-500">View your past transactions and invoices.</p>
                      </div>
                      
                      <div className="space-y-4">
                        {billingHistory.length > 0 ? (
                          <>
                            {billingHistory.map((item) => (
                              <div key={item.id} className="flex items-center justify-between py-3 border-b border-slate-100 last:border-0">
                                <div className="flex flex-col">
                                  <span className="font-medium text-slate-900">{item.description}</span>
                                  <span className="text-sm text-slate-500">{item.date}</span>
                                </div>
                                <div className="flex items-center gap-4">
                                  <span className="font-medium">{item.amount}</span>
                                  <button className="px-3 py-1.5 text-sm text-blue-600 hover:text-blue-700 hover:bg-blue-50 rounded-lg transition-colors">
                                    Download
                                  </button>
                                </div>
                              </div>
                            ))}
                          </>
                        ) : (
                          <div className="bg-slate-50 p-8 rounded-xl border border-slate-200 text-center">
                            <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mx-auto mb-3">
                              <span className="text-2xl">📄</span>
                            </div>
                            <p className="text-slate-500 text-sm mb-2">No billing history yet</p>
                            <p className="text-slate-400 text-xs">Your past transactions and invoices will appear here</p>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === 'security' && (
                  <div className="space-y-6">
                    <div className="bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
                      <div className="mb-6">
                        <h2 className="text-2xl font-semibold text-slate-900 mb-2">Security Settings</h2>
                        <p className="text-sm text-slate-500">Protect your account with a strong password and 2FA.</p>
                      </div>
                      
                      <div className="space-y-6">
                        <div className="space-y-4">
                          <h3 className="font-medium text-slate-900">Change Password</h3>
                          <div className="space-y-2">
                            <label htmlFor="current-password" className="block text-sm font-medium text-slate-700">Current Password</label>
                            <input
                              id="current-password"
                              type="password"
                              value={currentPassword}
                              onChange={(e) => setCurrentPassword(e.target.value)}
                              className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                            />
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div className="space-y-2">
                              <label htmlFor="new-password" className="block text-sm font-medium text-slate-700">New Password</label>
                              <input
                                id="new-password"
                                type="password"
                                value={newPassword}
                                onChange={(e) => setNewPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                              />
                            </div>
                            <div className="space-y-2">
                              <label htmlFor="confirm-password" className="block text-sm font-medium text-slate-700">Confirm Password</label>
                              <input
                                id="confirm-password"
                                type="password"
                                value={confirmPassword}
                                onChange={(e) => setConfirmPassword(e.target.value)}
                                className="w-full px-4 py-3 bg-white border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-transparent"
                              />
                            </div>
                          </div>
                          <div className="flex justify-end">
                            <button className="px-4 py-2 bg-white border border-slate-200 rounded-xl hover:bg-slate-50 transition-colors font-medium">
                              Update Password
                            </button>
                          </div>
                        </div>

                        <div className="border-t border-slate-200 pt-6">
                          <div className="flex items-center justify-between">
                            <div className="space-y-0.5">
                              <h3 className="font-medium text-slate-900">Two-Factor Authentication</h3>
                              <p className="text-sm text-slate-500">Add an extra layer of security to your account.</p>
                            </div>
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={twoFactorEnabled}
                                onChange={(e) => setTwoFactorEnabled(e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none peer-focus:ring-2 peer-focus:ring-blue-600 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all peer-checked:bg-blue-600"></div>
                            </label>
                          </div>
                        </div>

                        <div className="border-t border-slate-200 pt-6">
                          <h3 className="font-medium text-red-600 mb-2">Delete Account</h3>
                          <p className="text-sm text-slate-500 mb-4">
                            Permanently delete your account and all of your content. This action cannot be undone.
                          </p>
                          <button className="px-4 py-2 bg-red-600 text-white rounded-xl hover:bg-red-700 transition-colors font-medium">
                            Delete Account
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
