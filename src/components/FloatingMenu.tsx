"use client";

import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { 
  Settings, 
  LayoutDashboard, 
  Sparkles, 
  History, 
  LogOut, 
  Menu, 
  X,
  Brain,
  CheckSquare
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/integrations/supabase/client';
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
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Brain, label: 'Daily Plan', path: '/plan' },
    { icon: CheckSquare, label: 'Vet Tasks', path: '/vet' },
    { icon: Sparkles, label: 'Optimiser', path: '/optimise' },
    { icon: History, label: 'History', path: '/history' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="fixed bottom-10 right-10 z-[100] flex flex-col items-end gap-6">
      {/* Backdrop Blur when open */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-white/40 backdrop-blur-md z-[-1] animate-in fade-in duration-500"
          onClick={() => setIsOpen(false)}
        />
      )}

      {/* Menu Items */}
      <div className={cn(
        "flex flex-col gap-4 transition-all duration-500 origin-bottom-right",
        isOpen ? "scale-100 opacity-100 translate-y-0" : "scale-50 opacity-0 translate-y-20 pointer-events-none"
      )}>
        {menuItems.map((item, idx) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => setIsOpen(false)}
            style={{ transitionDelay: `${idx * 50}ms` }}
            className={cn(
              "flex items-center gap-4 px-8 py-4 rounded-[2rem] shadow-2xl transition-all hover:scale-105 active:scale-95 border",
              location.pathname === item.path 
                ? "bg-indigo-600 text-white border-indigo-500 shadow-indigo-200" 
                : "bg-white/90 backdrop-blur-xl text-gray-600 hover:bg-white border-gray-100"
            )}
          >
            <item.icon size={20} className={cn(location.pathname === item.path ? "text-white" : "text-indigo-500")} />
            <span className="font-black text-xs uppercase tracking-widest">{item.label}</span>
          </Link>
        ))}
        
        <button 
          onClick={handleSignOut}
          className="flex items-center gap-4 px-8 py-4 rounded-[2rem] bg-white/90 backdrop-blur-xl text-red-500 border border-red-50 shadow-2xl hover:bg-red-50 transition-all hover:scale-105 active:scale-95"
        >
          <LogOut size={20} />
          <span className="font-black text-xs uppercase tracking-widest">Sign Out</span>
        </button>
      </div>

      {/* Toggle Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-20 h-20 rounded-[2.5rem] shadow-2xl transition-all duration-700 hover:scale-110 active:scale-90 border-4 border-white",
          isOpen ? "bg-gray-900 rotate-90" : "bg-indigo-600"
        )}
      >
        {isOpen ? <X size={32} /> : <Menu size={32} />}
      </Button>
    </div>
  );
};

export default FloatingMenu;