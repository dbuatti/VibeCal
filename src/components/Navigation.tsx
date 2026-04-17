import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Calendar, Settings, LayoutDashboard, Sparkles, History } from 'lucide-react';
import { cn } from '@/lib/utils';

const Navigation = () => {
  const location = useLocation();
  
  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Sparkles, label: 'Optimiser', path: '/optimise' },
    { icon: History, label: 'History', path: '/history' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  return (
    <nav className="fixed left-0 top-0 h-screen w-64 bg-white border-r border-gray-100 p-6 flex flex-col gap-8 z-50">
      <div className="flex items-center gap-3 px-2">
        <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center">
          <Calendar className="text-white" size={24} />
        </div>
        <span className="font-bold text-xl tracking-tight text-gray-900">VibeCal</span>
      </div>
      
      <div className="flex flex-col gap-2">
        {navItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={cn(
              "flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 group",
              location.pathname === item.path 
                ? "bg-indigo-50 text-indigo-600" 
                : "text-gray-500 hover:bg-gray-50 hover:text-gray-900"
            )}
          >
            <item.icon size={20} className={cn(
              "transition-colors",
              location.pathname === item.path ? "text-indigo-600" : "text-gray-400 group-hover:text-gray-600"
            )} />
            <span className="font-medium">{item.label}</span>
          </Link>
        ))}
      </div>

      <div className="mt-auto p-4 bg-gradient-to-br from-indigo-500 to-purple-600 rounded-2xl text-white">
        <p className="text-xs font-semibold uppercase tracking-wider opacity-80 mb-1">Current Score</p>
        <div className="flex items-baseline gap-1">
          <span className="text-3xl font-bold">84</span>
          <span className="text-sm opacity-80">/100</span>
        </div>
        <p className="text-xs mt-2 opacity-90 leading-relaxed">Your schedule is 12% more aligned than last week.</p>
      </div>
    </nav>
  );
};

export default Navigation;