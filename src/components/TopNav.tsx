import React from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, Brain, CheckSquare, Sparkles, History, Settings, RefreshCw } from 'lucide-react';
import { cn } from '@/lib/utils';

const navItems = [
  { path: '/', label: 'Energy', icon: Activity },
  { path: '/plan', label: 'Plan', icon: Brain },
  { path: '/vet', label: 'Vet', icon: CheckSquare },
  { path: '/optimise', label: 'Optimise', icon: Sparkles },
  { path: '/history', label: 'History', icon: History },
  { path: '/settings', label: 'Settings', icon: Settings },
];

interface TopNavProps {
  isSyncing?: boolean;
  onSync?: () => void;
}

const TopNav = ({ isSyncing, onSync }: TopNavProps) => {
  const location = useLocation();

  return (
    <nav className="hidden md:block sticky top-0 z-50 bg-white/90 backdrop-blur-xl border-b border-gray-100">
      <div className="max-w-6xl mx-auto px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Link
            to="/"
            className="mr-6 text-sm font-black text-indigo-600 tracking-tight shrink-0"
          >
            VibeCal
          </Link>
          {navItems.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <Link
                key={item.path}
                to={item.path}
                className={cn(
                  'flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all',
                  isActive
                    ? 'bg-indigo-600 text-white shadow-sm'
                    : 'text-gray-400 hover:text-gray-600 hover:bg-gray-50'
                )}
              >
                <item.icon size={14} />
                {item.label}
              </Link>
            );
          })}
        </div>

        {onSync && (
          <button
            onClick={onSync}
            disabled={isSyncing}
            aria-label="Sync all calendars"
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-full text-[10px] font-black uppercase tracking-widest transition-all shrink-0',
              'bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale'
            )}
          >
            <RefreshCw
              size={12}
              className={cn(isSyncing && 'animate-spin')}
            />
            {isSyncing ? 'Syncing...' : 'Sync'}
          </button>
        )}
      </div>
    </nav>
  );
};

export default TopNav;
