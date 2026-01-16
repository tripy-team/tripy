'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Bell, LogOut, Settings, User } from 'lucide-react';
import { auth } from '@/lib/api';

interface UserData {
  name: string;
  email: string;
}

export function TopBar() {
  const router = useRouter();
  const [user, setUser] = useState<UserData | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    // Check for logged in user
    const checkUser = () => {
      // Check for access token first (from our API)
      const accessToken = localStorage.getItem('access_token') || sessionStorage.getItem('access_token');
      const authToken = localStorage.getItem('auth_token');
      
      if (accessToken || authToken) {
        // Try to get user from localStorage
        const storedUser = localStorage.getItem('user');
        if (storedUser) {
          try {
            setUser(JSON.parse(storedUser));
          } catch (e) {
            console.error('Failed to parse user', e);
            // Create default user from token
            setUser({
              name: 'User',
              email: 'user@tripy.com'
            });
          }
        } else {
          // Create default user
          setUser({
            name: 'User',
            email: 'user@tripy.com'
          });
        }
      } else {
        setUser(null);
      }
    };

    checkUser();

    // Listen for storage events (in case login happens in another tab)
    window.addEventListener('storage', checkUser);
    
    // Custom event for same-tab updates
    window.addEventListener('tripy_auth_change', checkUser);

    return () => {
      window.removeEventListener('storage', checkUser);
      window.removeEventListener('tripy_auth_change', checkUser);
    };
  }, []);

  const handleLogout = () => {
    auth.logout();
    setUser(null);
    window.dispatchEvent(new Event('tripy_auth_change'));
    router.push('/login');
  };

  const getInitials = (name: string) => {
    return name
      .split(' ')
      .map(part => part[0])
      .join('')
      .toUpperCase()
      .slice(0, 2);
  };

  return (
    <header className="bg-white border-b border-slate-200 px-8 py-4 flex items-center justify-end">
      <div className="flex items-center gap-4">
        <button 
          className="relative p-2 hover:bg-blue-50 rounded-xl transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-5 h-5 text-slate-600" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-blue-600 rounded-full"></span>
        </button>
        
        {user ? (
          <div className="relative">
            <button
              onClick={() => setShowDropdown(!showDropdown)}
              className="outline-none"
            >
              <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center text-white font-medium shadow-lg shadow-blue-600/20 hover:bg-blue-700 transition-colors cursor-pointer">
                {getInitials(user.name)}
              </div>
            </button>
            
            {showDropdown && (
              <div className="absolute right-0 mt-2 w-56 bg-white rounded-xl shadow-lg border border-slate-200 py-2 z-50">
                <div className="px-3 py-2 border-b border-slate-100">
                  <p className="text-sm font-medium leading-none">{user.name}</p>
                  <p className="text-xs leading-none text-slate-500 mt-1">
                    {user.email}
                  </p>
                </div>
                <div className="py-1">
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      router.push('/dashboard');
                    }}
                    className="w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 text-sm"
                  >
                    <User className="w-4 h-4" />
                    <span>Profile</span>
                  </button>
                  <button
                    onClick={() => setShowDropdown(false)}
                    className="w-full px-3 py-2 text-left text-slate-700 hover:bg-slate-50 flex items-center gap-2 text-sm"
                  >
                    <Settings className="w-4 h-4" />
                    <span>Settings</span>
                  </button>
                </div>
                <div className="border-t border-slate-100 pt-1">
                  <button
                    onClick={() => {
                      setShowDropdown(false);
                      handleLogout();
                    }}
                    className="w-full px-3 py-2 text-left text-red-600 hover:bg-red-50 flex items-center gap-2 text-sm"
                  >
                    <LogOut className="w-4 h-4" />
                    <span>Log out</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <Link
            href="/register"
            className="px-5 py-2.5 bg-blue-600 text-white rounded-xl hover:bg-blue-700 transition-all shadow-lg shadow-blue-600/20 hover:shadow-xl hover:shadow-blue-600/30 font-medium text-sm"
          >
            Sign Up
          </Link>
        )}
      </div>
      
      {/* Click outside to close dropdown */}
      {showDropdown && (
        <div
          className="fixed inset-0 z-40"
          onClick={() => setShowDropdown(false)}
        />
      )}
    </header>
  );
}
