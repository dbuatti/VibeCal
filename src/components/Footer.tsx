import React from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw, Activity, Brain, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

const STORAGE_KEY = 'vibecal_last_synced_at';

interface FooterProps {
  isSyncing: boolean;
  onSync: () => void;
}

function loadLastSynced(): Date | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? new Date(raw) : null;
  } catch {
    return null;
  }
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const Footer = ({ isSyncing, onSync }: FooterProps) => {
  const lastSyncedAt = loadLastSynced();

  return (
    <footer className="border-t border-gray-100 bg-white/80 backdrop-blur-xl mt-16">
      <div className="max-w-6xl mx-auto px-6 py-5 flex items-center justify-between flex-wrap gap-4">
        <div className="flex items-center gap-3 text-xs font-medium text-gray-400">
          {lastSyncedAt ? (
            <span>
              Last synced{' '}
              <span className="font-bold text-gray-500">
                {timeAgo(lastSyncedAt)}
              </span>
            </span>
          ) : (
            <span>Not synced yet</span>
          )}
          <button
            onClick={onSync}
            disabled={isSyncing}
            className={cn(
              'flex items-center gap-1.5 px-4 py-2 rounded-full font-black text-[9px] uppercase tracking-widest transition-all',
              'bg-gradient-to-tr from-indigo-500 to-purple-600 text-white shadow-lg hover:scale-105 active:scale-95 disabled:opacity-50 disabled:grayscale'
            )}
          >
            <RefreshCw
              size={12}
              className={cn(isSyncing && 'animate-spin')}
            />
            {isSyncing ? 'Syncing...' : 'Sync All'}
          </button>
        </div>

        <div className="flex items-center gap-4 text-[9px] font-black uppercase tracking-widest">
          <span className="text-gray-300">Quick links:</span>
          <Link
            to="/"
            className="text-gray-400 hover:text-indigo-600 transition-colors flex items-center gap-1"
          >
            <Activity size={12} /> Energy
          </Link>
          <Link
            to="/plan"
            className="text-gray-400 hover:text-indigo-600 transition-colors flex items-center gap-1"
          >
            <Brain size={12} /> Plan
          </Link>
          <Link
            to="/optimise"
            className="text-gray-400 hover:text-indigo-600 transition-colors flex items-center gap-1"
          >
            <Sparkles size={12} /> Optimise
          </Link>
        </div>
      </div>
    </footer>
  );
};

export default Footer;
