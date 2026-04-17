"use client";

import React, { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Calendar, Settings, LayoutDashboard, Sparkles, History, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

const Navigation = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const [profile, setProfile] = useState<any>(null);
  
  useEffect(() => {
    const fetchProfile = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase
        .from('profiles')
        .select('first_name, email, vibe_score, vibe_score_trend')
        .eq('id', user.id)
        .single();

      if (!error && data) {
        setProfile(data);
      }
    };

    fetchProfile();

    // Subscribe to profile changes
    const channel = supabase
      .channel('profile_changes')
      .on('postgres_changes', { 
        event: 'UPDATE', 
        schema: 'public', 
        table: 'profiles' 
      }, (payload) => {
        setProfile((prev: any) => ({ ...prev, ...payload.new }));
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Sparkles, label: 'Optimiser', path: '/optimise' },
    { icon: History, label: 'History', path: '/history' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const vibeScore = profile?.vibe_score ?? 0;
  const trend = profile?.vibe_score_trend ?? 0;

  return (
    <nav className="fixed left-0 top-0 h-screen w-72 bg-white border-r border-gray-100 p-8 flex flex-col gap-10 z-50">
      <div className="flex items-center gap-4 px-2">
        <div className="w-12 h-12 bg-indigo-600 rounded-2xl flex items-center justify-center shadow-lg shadow-indigo-200">
          <Calendar className="text-white" size={26} />
        </div>
        <span className="font-black text-2xl tracking-tighter text-gray-900">VibeCal</span>
      </div>
      
      <div className="flex flex-col gap-3">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-4 px-5 py-4 rounded-2xl transition-all duration-300 group",
              location.pathname === item.path 
                ? "bg-indigo-50 text-indigo-600 shadow-sm" 
                : "text-gray-400 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            <item.icon size={22} className={cn(
              "transition-colors",
              location.pathname === item.path ? "text-indigo-600" : "text-gray-400 group-hover:text-gray-600"
            )} />
            <span className="font-bold text-lg">{item.label}</span>
          </Link>
        ))}
      </div>

      <div className="mt-auto space-y-6">
        <div className="p-6 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-[2rem] text-white shadow-xl shadow-indigo-100">
          <p className="text-[10px] font-black uppercase tracking-[0.2em] opacity-70 mb-2">Vibe Score</p>
          <div className="flex items-baseline gap-1">
            <span className="text-4xl font-black">{vibeScore}</span>
            <span className="text-sm font-bold opacity-60">/100</span>
          </div>
          <p className="text-xs mt-3 opacity-90 leading-relaxed font-medium">
            Your schedule is {Math.abs(trend)}% {trend >= 0 ? 'more' : 'less'} aligned than last week.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center gap-4 p-2">
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center">
              <User className="text-gray-400" size={24} />
            </div>
            <div className="flex-1 overflow-hidden">
              <p className="font-bold text-gray-900 truncate">
                {profile?.first_name || profile?.email?.split('@')[0] || 'User'}
              </p>
              <p className="text-xs text-gray-400 font-medium">Pro Plan</p>
            </div>
          </div>
          
          <button 
            onClick={handleSignOut}
            className="w-full flex items-center gap-3 px-5 py-3 rounded-xl text-gray-500 hover:text-red-600 hover:bg-red-50 transition-all duration-200 font-bold text-sm"
          >
            <LogOut size={18} />
            Sign Out
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;