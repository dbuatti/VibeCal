"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { 
  Lock, 
  Unlock, 
  BrainCircuit, 
  ChevronLeft, 
  Search, 
  Filter,
  Calendar,
  RefreshCw,
  CheckCircle2,
  SortAsc,
  SortDesc,
  Eye, 
  EyeOff,
  Clock,
  Layers,
  Zap,
  Briefcase,
  Globe,
  Sparkles,
  Info,
  AlertTriangle,
  Brain,
  MessageSquare
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem
} from '@/components/ui/dropdown-menu';
import { format, parseISO, isToday, isTomorrow, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import TrainAIModal from '@/components/TrainAIModal';

type SortField = 'date' | 'title' | 'status';
type SortOrder = 'asc' | 'desc';

const ProviderLogo = ({ provider }: { provider: string }) => {
  if (provider === 'google') {
    return (
      <div className="w-8 h-8 rounded-full bg-white shadow-sm border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
        <svg viewBox="0 0 24 24" className="w-4 h-4">
          <path d="M22.56 12.25c0 -0.78 -0.07 -1.53 -0.2 -2.25H12v4.26h5.92c-0.26 1.37 -1.04 2.53 -2.21 3.31v2.77h3.57c2.08 -1.92 3.28 -4.74 3.28 -8.09z" fill="#4285F4"/>
          <path d="M12 23c2.97 0 5.46 -0.98 7.28 -2.66l-3.57 -2.77c-0.98 0.66 -2.23 1.06 -3.71 1.06 -2.86 0 -5.29 -1.93 -6.16 -4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
          <path d="M5.84 14.09c-0.22 -0.66 -0.35 -1.36 -0.35 -2.09s0.13 -1.43 0.35 -2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s0.43 3.45 1.18 4.93l2.85 -2.22.81 -.62z" fill="#FBBC05"/>
          <path d="M12 5.38c1.62 0 3.06 0.56 4.21 1.64l3.15 -3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.47 2.18 7.07 3.66 2.84c0.87 -2.6 3.3 -4.53 12 -4.53z" fill="#EA4335"/>
        </svg>
      </div>
    );
  }
  if (provider === 'apple') {
    return (
      <div className="w-8 h-8 rounded-full bg-white shadow-sm border border-gray-100 flex items-center justify-center overflow-hidden shrink-0">
        <svg viewBox="0 0 24 24" className="w-4 h-4 text-gray-900" fill="currentColor">
          <path d="M17.05 20.28c-0.98 0.95 -2.05 1.61 -3.22 1.61 -1.14 0 -1.55 -0.67 -2.85 -0.67 -1.32 0 -1.77 0.65 -2.85 0.67 -1.15 0.02 -2.19 -0.62 -3.22 -1.61C2.79 18.21 1.35 14.15 1.35 10.83c0 -3.32 2.12 -5.07 4.16 -5.07 1.08 0 1.88 0.43 2.54 0.43 0.64 0 1.52 -0.47 2.75 -0.47 1.05 0 2.02 0.35 2.72 0.95 2.02 1.73 1.85 4.45 1.85 4.45s-2.35 0.85 -2.35 3.5c0 2.65 2.35 3.5 2.35 3.5 -0.05 0.15 -0.32 0.65 -0.72 1.14zM12.03 4.95c-0.02 -1.3 0.5 -2.55 1.35 -3.45 0.85 -0.9 2.1 -1.5 3.35 -1.5 0.05 1.3 -0.45 2.55 -1.35 3.45 -0.9 0.9 -2.1 1.5 -3.35 1.5z"/>
        </svg>
      </div>
    );
  }
  return null;
};

const Vet = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [aiExplanations, setAiExplanations] = useState<Record<string, string>>({});
  
  const [showLocked, setShowLocked] = useState(true);
  const [showUnlocked, setShowUnlocked] = useState(true);
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [selectedProvider, setSelectedProvider] = useState<string | 'all'>('all');

  // Training Modal State
  const [trainingTask, setTrainingTask] = useState<any>(null);
  const [isTrainingModalOpen, setIsTrainingModalOpen] = useState(false);

  const fetchEvents = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data } = await supabase
        .from('calendar_events_cache')
        .select('*')
        .eq('user_id', user.id)
        .order('start_time', { ascending: true });

      setEvents(data || []);
    } catch (err) {
      showError("Failed to load tasks");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEvents();
  }, []);

  const handleFullSync = async () => {
    setIsProcessing(true);
    setStatusText('Performing full system sync...');
    try {
      const { error } = await supabase.rpc('full_reset_user_data');
      if (error) throw error;
      
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      
      let token = session?.provider_token;
      if (!token && user) {
        const { data: profile } = await supabase.from('profiles').select('google_access_token').eq('id', user.id).single();
        token = profile?.google_access_token;
      }

      await Promise.allSettled([
        supabase.functions.invoke('sync-calendar', { body: { googleAccessToken: token } }),
        supabase.functions.invoke('sync-apple-calendar')
      ]);

      await fetchEvents();
      showSuccess("Full sync complete!");
    } catch (err: any) {
      showError("Sync failed: " + err.message);
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  const toggleLock = async (eventId: string, currentStatus: boolean) => {
    try {
      await supabase
        .from('calendar_events_cache')
        .update({ is_locked: !currentStatus })
        .eq('event_id', eventId);
      
      setEvents(events.map(e => e.event_id === eventId ? { ...e, is_locked: !currentStatus } : e));
    } catch (err) {
      showError("Failed to update status");
    }
  };

  const bulkAction = async (action: 'lock_all' | 'unlock_all') => {
    const isLocked = action === 'lock_all';
    const targetIds = filteredEvents.map(e => e.event_id);
    
    if (targetIds.length === 0) return;

    try {
      setIsProcessing(true);
      const { error } = await supabase
        .from('calendar_events_cache')
        .update({ is_locked: isLocked })
        .in('event_id', targetIds);

      if (error) throw error;

      setEvents(events.map(e => targetIds.includes(e.event_id) ? { ...e, is_locked: isLocked } : e));
      showSuccess(`${isLocked ? 'Locked' : 'Unlocked'} ${targetIds.length} tasks`);
    } catch (err) {
      showError("Bulk action failed");
    } finally {
      setIsProcessing(false);
    }
  };

  const runAIClassification = async () => {
    setIsProcessing(true);
    setStatusText('AI is analyzing your rules...');
    try {
      const { data: settings } = await supabase.from('user_settings').select('movable_keywords, locked_keywords, natural_language_rules').single();
      const { data, error } = await supabase.functions.invoke('classify-tasks', {
        body: {
          tasks: events.map(e => e.title),
          movableKeywords: settings?.movable_keywords || [],
          lockedKeywords: settings?.locked_keywords || [],
          naturalLanguageRules: settings?.natural_language_rules || ''
        }
      });
      if (error) throw error;
      
      const updatedEvents = [...events];
      const newExplanations: Record<string, string> = {};

      for (let i = 0; i < updatedEvents.length; i++) {
        const classification = data.classifications[i];
        const isMovable = typeof classification === 'boolean' ? classification : classification.isMovable;
        const explanation = typeof classification === 'object' ? classification.explanation : '';
        
        updatedEvents[i].is_locked = !isMovable;
        newExplanations[updatedEvents[i].event_id] = explanation;

        await supabase.from('calendar_events_cache').update({ is_locked: !isMovable }).eq('event_id', updatedEvents[i].event_id);
      }
      
      setEvents(updatedEvents);
      setAiExplanations(newExplanations);
      showSuccess("AI has vetted your tasks!");
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  const filteredEvents = useMemo(() => {
    const today = startOfDay(new Date());
    return events
      .filter(e => {
        const eventDate = parseISO(e.start_time);
        const isFutureOrToday = eventDate >= today;
        const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesLocked = e.is_locked ? showLocked : showUnlocked;
        const matchesProvider = selectedProvider === 'all' || e.provider === selectedProvider;
        return isFutureOrToday && matchesSearch && matchesLocked && matchesProvider;
      })
      .sort((a, b) => {
        let comparison = 0;
        if (sortBy === 'date') {
          comparison = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
        } else if (sortBy === 'title') {
          comparison = a.title.localeCompare(b.title);
        } else if (sortBy === 'status') {
          comparison = (a.is_locked === b.is_locked) ? 0 : a.is_locked ? 1 : -1;
        }
        return sortOrder === 'asc' ? comparison : -comparison;
      });
  }, [events, searchQuery, showLocked, showUnlocked, sortBy, sortOrder, selectedProvider]);

  const groupedEvents = useMemo(() => {
    const groups: { [key: string]: any[] } = {};
    filteredEvents.forEach(event => {
      const dateKey = format(parseISO(event.start_time), 'yyyy-MM-dd');
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(event);
    });
    return groups;
  }, [filteredEvents]);

  const stats = useMemo(() => {
    const total = filteredEvents.length;
    const locked = filteredEvents.filter(e => e.is_locked).length;
    const movable = total - locked;
    const progress = total > 0 ? (movable / total) * 100 : 0;
    return { total, locked, movable, progress };
  }, [filteredEvents]);

  const providers = Array.from(new Set(events.map(e => e.provider)));

  const getDateLabel = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, 'EEEE, MMM do');
  };

  const handleOpenTraining = (event: any) => {
    setTrainingTask(event);
    setIsTrainingModalOpen(true);
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pb-24">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
          <div className="space-y-1">
            <button 
              onClick={() => navigate('/plan')}
              className="group flex items-center gap-2 text-gray-400 hover:text-indigo-600 font-black text-[10px] uppercase tracking-widest mb-4 transition-all"
            >
              <div className="w-6 h-6 rounded-full bg-gray-50 flex items-center justify-center group-hover:bg-indigo-50 transition-colors">
                <ChevronLeft size={14} />
              </div>
              Back to Plan
            </button>
            <h1 className="text-4xl font-black text-gray-900 tracking-tight">Vet Your Tasks</h1>
            <p className="text-gray-500 font-medium">Decide which events are fixed and which can be moved by the AI.</p>
          </div>
          
          <div className="flex items-center gap-4 w-full md:w-auto">
            <button
              onClick={handleFullSync}
              disabled={isProcessing}
              title="Full Sync"
              className={cn(
                "w-14 h-14 rounded-full flex items-center justify-center transition-all shadow-xl hover:scale-110 active:scale-95 disabled:opacity-50 disabled:grayscale shrink-0",
                "bg-gradient-to-tr from-red-500 via-yellow-400 via-green-400 via-blue-500 to-purple-600 text-white"
              )}
            >
              <RefreshCw size={24} className={cn(isProcessing && "animate-spin")} />
            </button>

            <Button 
              variant="outline" 
              onClick={runAIClassification} 
              disabled={isProcessing}
              className="flex-1 md:flex-none rounded-2xl h-14 px-8 font-black text-xs uppercase tracking-widest border-indigo-100 text-indigo-600 hover:bg-indigo-50 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98] relative overflow-hidden group"
            >
              <div className="absolute inset-0 bg-gradient-to-r from-indigo-500/10 to-purple-500/10 opacity-0 group-hover:opacity-100 transition-opacity" />
              {isProcessing ? <RefreshCw className="animate-spin mr-2" size={18} /> : <Sparkles className="mr-2 text-indigo-500 animate-pulse" size={18} />}
              AI Auto-Vet
            </Button>
            <Button 
              onClick={() => navigate('/plan')}
              className="flex-1 md:flex-none bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl h-14 px-10 font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-100 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <CheckCircle2 className="mr-2" size={18} /> Done
            </Button>
          </div>
        </div>

        {statusText && (
          <div className="mb-8 p-4 bg-indigo-50 rounded-2xl border border-indigo-100 flex items-center gap-3 animate-pulse">
            <RefreshCw className="animate-spin text-indigo-600" size={16} />
            <span className="text-xs font-black text-indigo-600 uppercase tracking-widest">{statusText}</span>
          </div>
        )}

        <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm mb-8">
          <div className="flex justify-between items-end mb-3 px-2">
            <div className="flex items-center gap-2">
              <Zap size={14} className="text-indigo-600" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Movable Ratio</span>
            </div>
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">
              {Math.round(stats.progress)}% Flexible
            </span>
          </div>
          <Progress value={stats.progress} className="h-2 bg-gray-50" />
          <div className="flex justify-between mt-3 px-2 text-[9px] font-black uppercase tracking-widest text-gray-400">
            <span>{stats.locked} Fixed</span>
            <span>{stats.movable} Movable</span>
          </div>
        </div>

        <div className="sticky top-4 z-50 bg-white/90 backdrop-blur-xl rounded-[2.5rem] border border-gray-100 shadow-xl overflow-hidden mb-10">
          <div className="p-4 flex flex-col lg:flex-row gap-4 justify-between items-center">
            <div className="relative w-full lg:w-96">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                placeholder="Search tasks..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 rounded-2xl border-none bg-gray-50/50 font-bold text-sm focus:ring-indigo-500 transition-all"
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-center lg:justify-end">
              <div className="flex bg-gray-50 p-1 rounded-xl border border-gray-100">
                <button 
                  onClick={() => setShowLocked(!showLocked)}
                  className={cn(
                    "px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest",
                    showLocked ? "bg-white text-red-500 shadow-sm" : "text-gray-400 hover:text-gray-600"
                  )}
                >
                  {showLocked ? <Eye size={14} /> : <EyeOff size={14} />} Fixed
                </button>
                <button 
                  onClick={() => setShowUnlocked(!showUnlocked)}
                  className={cn(
                    "px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest",
                    showUnlocked ? "bg-white text-green-500 shadow-sm" : "text-gray-400 hover:text-gray-600"
                  )}
                >
                  {showUnlocked ? <Eye size={14} /> : <EyeOff size={14} />} Movable
                </button>
              </div>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-xl h-10 px-4 font-black text-[10px] uppercase tracking-widest border-gray-100 hover:bg-gray-50">
                    <Filter size={14} className="mr-2" /> Sort
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 rounded-2xl p-2" align="end">
                  <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 px-2 py-1.5">Sort By</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSortBy('date')} className="rounded-lg font-bold text-xs">
                    <Calendar size={14} className="mr-2" /> Date
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy('title')} className="rounded-lg font-bold text-xs">
                    <SortAsc size={14} className="mr-2" /> Title
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortBy('status')} className="rounded-lg font-bold text-xs">
                    <Lock size={14} className="mr-2" /> Status
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 px-2 py-1.5">Order</DropdownMenuLabel>
                  <DropdownMenuItem onClick={() => setSortOrder('asc')} className="rounded-lg font-bold text-xs">
                    <SortAsc size={14} className="mr-2" /> Ascending
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => setSortOrder('desc')} className="rounded-lg font-bold text-xs">
                    <SortDesc size={14} className="mr-2" /> Descending
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>

              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-xl h-10 px-4 font-black text-[10px] uppercase tracking-widest border-gray-100 hover:bg-gray-50">
                    <Zap size={14} className="mr-2" /> Bulk
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-48 rounded-2xl p-2" align="end">
                  <DropdownMenuItem onClick={() => bulkAction('lock_all')} className="rounded-lg font-bold text-xs text-red-600">
                    <Lock size={14} className="mr-2" /> Lock Visible
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => bulkAction('unlock_all')} className="rounded-lg font-bold text-xs text-green-600">
                    <Unlock size={14} className="mr-2" /> Unlock Visible
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>

        <div className="space-y-16">
          {loading ? (
            <div className="p-20 text-center">
              <RefreshCw className="animate-spin text-indigo-600 mx-auto mb-4" size={32} />
              <p className="text-gray-400 font-bold">Loading your schedule...</p>
            </div>
          ) : Object.keys(groupedEvents).length > 0 ? (
            Object.keys(groupedEvents).sort().map(dateKey => (
              <div key={dateKey} className="space-y-6">
                <div className="sticky top-24 z-40 bg-[#F8F9FC]/80 backdrop-blur-md py-4 -mx-4 px-4">
                  <div className="flex items-center gap-4">
                    <div className="bg-white px-6 py-2 rounded-full shadow-sm border border-gray-100 flex items-center gap-3">
                      <Calendar size={14} className="text-indigo-600" />
                      <h2 className="text-xs font-black text-gray-900 uppercase tracking-widest">
                        {getDateLabel(dateKey)}
                      </h2>
                      <Badge variant="secondary" className="bg-indigo-50 text-indigo-600 border-none text-[9px] font-black px-2 py-0">
                        {groupedEvents[dateKey].length}
                      </Badge>
                    </div>
                    <div className="h-px flex-1 bg-gray-200/50" />
                  </div>
                </div>
                
                <div className="grid grid-cols-1 gap-4">
                  {groupedEvents[dateKey].map((event) => (
                    <div key={event.event_id} className={cn(
                      "px-6 py-4 rounded-[2rem] border transition-all duration-300 group flex flex-col gap-4 relative overflow-hidden hover:shadow-md",
                      event.is_locked 
                        ? "bg-white border-gray-100" 
                        : "bg-indigo-50/40 border-indigo-100/50"
                    )}>
                      {event.is_work && (
                        <div className="absolute -right-2 -bottom-2 opacity-[0.04] pointer-events-none rotate-12 group-hover:rotate-0 transition-transform duration-700">
                          <Briefcase size={80} />
                        </div>
                      )}

                      <div className="flex items-center justify-between relative z-10">
                        <div className="flex items-center gap-6 flex-1 min-w-0">
                          <div className={cn(
                            "w-14 h-14 rounded-[1.5rem] flex items-center justify-center shrink-0 transition-all duration-500 group-hover:rotate-6 shadow-sm",
                            event.is_locked ? "bg-gray-50 text-gray-400" : "bg-white text-indigo-600"
                          )}>
                            {event.is_locked ? <Lock size={22} /> : <Unlock size={22} />}
                          </div>
                          
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-black text-lg text-gray-900 tracking-tight truncate">{event.title}</h3>
                              {event.is_work && (
                                <Badge variant="secondary" className="bg-slate-200/50 text-slate-600 text-[8px] font-black px-2 py-0.5 h-5 uppercase tracking-tighter border-none">
                                  Work
                                </Badge>
                              )}
                              <button 
                                onClick={() => handleOpenTraining(event)}
                                className="opacity-0 group-hover:opacity-100 transition-opacity p-1.5 rounded-lg bg-indigo-50 text-indigo-600 hover:bg-indigo-100"
                                title="Train AI on this task"
                              >
                                <Brain size={14} />
                              </button>
                            </div>
                            
                            <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
                              <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                <Clock size={14} className="text-indigo-400" />
                                {format(parseISO(event.start_time), 'HH:mm')}
                              </div>
                              <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                <Zap size={14} className="text-indigo-400" />
                                {event.duration_minutes}m
                              </div>
                              <div className="flex items-center gap-2 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                                <Globe size={14} className="text-indigo-400" />
                                {event.source_calendar || event.provider}
                              </div>
                            </div>
                          </div>
                        </div>
                        
                        <div className="flex items-center gap-8 ml-6">
                          <ProviderLogo provider={event.provider} />
                          
                          <div className="hidden sm:flex flex-col items-end">
                            <span className={cn(
                              "text-[10px] font-black uppercase tracking-widest mb-1",
                              event.is_locked ? "text-red-400" : "text-indigo-600"
                            )}>
                              {event.is_locked ? 'Fixed' : 'Movable'}
                            </span>
                            <div className="flex items-center gap-1 text-[8px] font-bold text-gray-300 uppercase tracking-tighter">
                              <Info size={10} />
                              Status
                            </div>
                          </div>
                          <Switch 
                            checked={!event.is_locked} 
                            onCheckedChange={() => toggleLock(event.event_id, event.is_locked)} 
                            className="data-[state=checked]:bg-indigo-600 scale-125 shadow-sm" 
                          />
                        </div>
                      </div>

                      {/* AI Reasoning Display */}
                      {aiExplanations[event.event_id] && (
                        <div className="mt-2 p-3 bg-white/50 rounded-xl border border-black/5 flex items-start gap-3 relative z-10 animate-in slide-in-from-top-1 duration-300">
                          <MessageSquare size={14} className="text-indigo-400 mt-0.5 shrink-0" />
                          <div className="space-y-0.5">
                            <p className="text-[8px] font-black uppercase tracking-widest text-gray-400">AI Reasoning</p>
                            <p className="text-[11px] font-bold text-gray-600 leading-tight">
                              {aiExplanations[event.event_id]}
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="p-24 text-center bg-white rounded-[4rem] border border-dashed border-gray-200 shadow-inner">
              <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-8">
                <Search className="text-gray-200" size={40} />
              </div>
              <h3 className="text-xl font-black text-gray-900 mb-2 tracking-tight">No tasks found</h3>
              <p className="text-gray-400 font-medium max-w-xs mx-auto">Try adjusting your filters or search query to find what you're looking for.</p>
              <Button variant="link" onClick={() => {
                setSearchQuery('');
                setShowLocked(true);
                setShowUnlocked(true);
                setSelectedProvider('all');
              }} className="text-indigo-600 font-black text-xs uppercase tracking-widest mt-6 hover:no-underline hover:text-indigo-700">
                Reset all filters
              </Button>
            </div>
          )}
        </div>
      </div>

      <TrainAIModal 
        isOpen={isTrainingModalOpen}
        onClose={() => setIsTrainingModalOpen(false)}
        task={trainingTask}
        onSuccess={(isMovable) => {
          if (trainingTask) {
            setEvents(prev => prev.map(e => 
              e.event_id === trainingTask.event_id ? { ...e, is_locked: !isMovable } : e
            ));
          }
          fetchEvents();
        }}
      />
    </Layout>
  );
};

export default Vet;