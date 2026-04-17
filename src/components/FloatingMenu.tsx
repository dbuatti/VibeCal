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
  Brain
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
    { icon: Sparkles, label: 'Optimiser', path: '/optimise' },
    { icon: History, label: 'History', path: '/history' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <div className="fixed bottom-8 right-8 z-[100] flex flex-col items-end gap-4">
      {/* Menu Items */}
      <div className={cn(
        "flex flex-col gap-3 transition-all duration-300 origin-bottom",
        isOpen ? "scale-100 opacity-100 translate-y-0" : "scale-0 opacity-0 translate-y-10 pointer-events-none"
      )}>
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            onClick={() => setIsOpen(false)}
            className={cn(
              "flex items-center gap-3 px-6 py-3 rounded-2xl shadow-xl transition-all hover:scale-105 active:scale-95",
              location.pathname === item.path 
                ? "bg-indigo-600 text-white" 
                : "bg-white text-gray-600 hover:bg-gray-50"
            )}
          >
            <item.icon size={18} />
            <span className="font-bold text-sm">{item.label}</span>
          </Link>
        ))}
        
        <button 
          onClick={handleSignOut}
          className="flex items-center gap-3 px-6 py-3 rounded-2xl bg-white text-red-500 shadow-xl hover:bg-red-50 transition-all hover:scale-105 active:scale-95"
        >
          <LogOut size={18} />
          <span className="font-bold text-sm">Sign Out</span>
        </button>
      </div>

      {/* Toggle Button */}
      <Button
        onClick={() => setIsOpen(!isOpen)}
        className={cn(
          "w-16 h-16 rounded-full shadow-2xl transition-all duration-500 hover:scale-110 active:scale-90",
          isOpen ? "bg-gray-900 rotate-90" : "bg-indigo-600"
        )}
      >
        {isOpen ? <X size={28} /> : <Menu size={28} />}
      </Button>
    </div>
  );
};

export default FloatingMenu;