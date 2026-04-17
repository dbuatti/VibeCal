"use client";

import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Calendar, Settings, LayoutDashboard, Sparkles, History, User, LogOut } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';

const Navigation = () => {
  const location = useLocation();
  
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Sparkles, label: 'Optimiser', path: '/optimise' },
    { icon: History, label: 'History', path: '/history' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  const handleSignOut = async () => {
    await supabase.auth.signOut();
  };

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
            <span className="text-4xl font-black">84</span>
            <span className="text-sm font-bold opacity-60">/100</span>
          </div>
          <p className="text-xs mt-3 opacity-90 leading-relaxed font-medium">Your schedule is 12% more aligned than last week.</p>
        </div>

        <div className="flex items-center justify-between p-2 hover:bg-gray-50 rounded-2xl transition-colors group">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 bg-gray-100 rounded-xl flex items-center justify-center group-hover:bg-indigo-100 transition-colors">
              <User className="text-gray-400 group-hover:text-indigo-600" size={24} />
            </div>
            <div className="flex-1">
              <p className="font-bold text-gray-900">Alex Rivera</p>
              <p className="text-xs text-gray-400 font-medium">Pro Plan</p>
            </div>
          </div>
          <button 
            onClick={handleSignOut}
            className="p-2 text-gray-400 hover:text-red-500 transition-colors"
            title="Sign Out"
          >
            <LogOut size={20} />
          </button>
        </div>
      </div>
    </nav>
  );
};

export default Navigation;