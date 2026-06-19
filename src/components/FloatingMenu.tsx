"use client";

import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import {
  Settings,
  Sparkles,
  History,
  LogOut,
  Menu,
  X,
  Brain,
  CheckSquare,
  Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui/button';

const FloatingMenu = () => {
  const [isOpen, setIsOpen] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const menuItems = [
    { icon: Activity, label: 'Energy & Load', path: '/' },
    { icon: Brain, label: 'Daily Plan', path: '/plan' },
    { icon: CheckSquare, label: 'Vet Tasks', path: '/vet' },
    { icon: Sparkles, label: 'Optimiser', path: '/optimise' },
    { icon: History, label: 'Vibe History', path: '/history' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="md:hidden fixed bottom-6 right-6 z-[100] flex flex-col items-end gap-4">
      {/* Backdrop Blur when open */}
      {isOpen && (
        <div 
          aria-hidden="true"
          className="fixed inset-0 bg-white/40 backdrop-blur-md z-[-1] animate-in fade-in duration-300"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Menu Items */}
      <div
        role="dialog"
        aria-label="Navigation menu"
        onKeyDown={(e) => { if (e.key === 'Escape') setIsOpen(false); }}
        className={cn(
        "flex flex-col gap-3 transition-all duration-400 origin-bottom-right",
        isOpen ? "scale-100 opacity-100 translate-y-0" : "scale-50 opacity-0 translate-y-20 pointer-events-none"
      )}>
        {menuItems.map((item, idx) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => setIsOpen(false)}
            style={{ transitionDelay: `${idx * 40}ms` }}
            className={cn(
              "flex items-center gap-3 px-6 py-3 rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95 border",
              location.pathname === item.path 
                ? "bg-indigo-600 text-white border-indigo-500 shadow-indigo-200" 
                : "bg-white/90 backdrop-blur-xl text-gray-600 hover:bg-white border-gray-100"
            )}
          >
            <item.icon size={18} className={cn(location.pathname === item.path ? "text-white" : "text-indigo-500")} />
            <span className="font-black text-xs uppercase tracking-widest">{item.label}</span>
          </Link>
        ))}
        
        <div className="h-px w-full bg-gray-100 my-1" />
        
        <button 
          onClick={handleSignOut}
          className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white/90 backdrop-blur-xl text-red-500 border border-red-50 shadow-xl hover:bg-red-50 transition-all hover:scale-105 active:scale-95"
        >
          <LogOut size={18} />
          <span className="font-black text-xs uppercase tracking-widest">Sign Out</span>
        </button>
      </div>

      {/* Toggle Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-14 h-14 rounded-2xl shadow-2xl transition-all duration-500 hover:scale-110 active:scale-90 border-2 border-white",
          isOpen ? "bg-gray-900 rotate-90" : "bg-indigo-600"
        )}
      >
        {isOpen ? <X size={24} /> : <Menu size={24} />}
      </Button>
    </div>
  );
};

export default FloatingMenu;