import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Activity, Brain, CheckSquare, Sparkles, History, Settings, RefreshCw, ClipboardList } from 'lucide-react';
import { cn } from '@/lib/utils';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { format, subMonths, parseISO, isValid } from 'date-fns';

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

async function copyEvents(months: number) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error('Not authenticated');

    const since = subMonths(new Date(), months).toISOString();
    const { data: events, error } = await supabase
      .from('calendar_events_cache')
      .select('title, start_time, end_time, duration_minutes, source_calendar')
      .eq('user_id', user.id)
      .gte('start_time', since)
      .order('start_time', { ascending: true });

    if (error) throw error;
    if (!events || events.length === 0) {
      showError(`No events found in the last ${months} months`);
      return;
    }

    const rows = events.map((e) => {
      const s = parseISO(e.start_time);
      const date = isValid(s) ? format(s, 'yyyy-MM-dd') : '?';
      const day = isValid(s) ? format(s, 'EEE') : '?';
      const time = isValid(s) ? format(s, 'HH:mm') : '?';
      const end = parseISO(e.end_time);
      const endTime = isValid(end) ? format(end, 'HH:mm') : '?';
      const dur = e.duration_minutes ? `${e.duration_minutes}m` : '?';
      const title = (e.title || '').replace(/\|/g, '-');
      const cal = e.source_calendar || '';
      return `${date} | ${day} | ${time}-${endTime} | ${dur.padStart(5)} | ${title} | ${cal}`;
    });

    const header = `Date       | Day       | Time         | Duration | Title                          | Calendar\n${'-'.repeat(100)}`;
    const text = `${header}\n${rows.join('\n')}`;

    await navigator.clipboard.writeText(text);
    showSuccess(`Copied ${rows.length} events (${months}mo)`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Copy failed';
    showError(msg);
  }
}

const TopNav = ({ isSyncing, onSync }: TopNavProps) => {
  const location = useLocation();
  const [copying, setCopying] = useState(0);

  const handleCopy = async (months: number) => {
    setCopying(months);
    await copyEvents(months);
    setCopying(0);
  };

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

        <div className="flex items-center gap-2">
          {/* Copy to clipboard buttons */}
          <div className="flex items-center bg-gray-50 rounded-full p-0.5 border border-gray-100">
            <button
              onClick={() => handleCopy(3)}
              disabled={copying > 0}
              aria-label="Copy last 3 months to clipboard"
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all',
                copying === 3
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              )}
            >
              <ClipboardList size={10} />
              3m
            </button>
            <button
              onClick={() => handleCopy(6)}
              disabled={copying > 0}
              aria-label="Copy last 6 months to clipboard"
              className={cn(
                'flex items-center gap-1 px-3 py-1.5 rounded-full text-[9px] font-black uppercase tracking-widest transition-all',
                copying === 6
                  ? 'bg-indigo-600 text-white shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              )}
            >
              <ClipboardList size={10} />
              6m
            </button>
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
      </div>
    </nav>
  );
};

export default TopNav;
