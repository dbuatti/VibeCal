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
  Info
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
import { format, parseISO, isToday, isTomorrow } from 'date-fns';
import { cn } from '@/lib/utils';

type SortField = 'date' | 'title' | 'status';
type SortOrder = 'asc' | 'desc';

const Vet = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  const [showLocked, setShowLocked] = useState(true);
  const [showUnlocked, setShowUnlocked] = useState(true);
  const [sortBy, setSortBy] = useState<SortField>('date');
  const [sortOrder, setSortOrder] = useState<SortOrder>('asc');
  const [selectedProvider, setSelectedProvider] = useState<string | 'all'>('all');

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
    try {
      const { data: settings } = await supabase.from('user_settings').select('movable_keywords, locked_keywords').single();
      const { data, error } = await supabase.functions.invoke('classify-tasks', {
        body: { 
          tasks: events.map(e => e.title), 
          movableKeywords: settings?.movable_keywords || [],
          lockedKeywords: settings?.locked_keywords || []
        }
      });
      if (error) throw error;
      
      const updatedEvents = [...events];
      for (let i = 0; i < updatedEvents.length; i++) {
        const isMovable = data.classifications[i];
        updatedEvents[i].is_locked = !isMovable;
        await supabase.from('calendar_events_cache').update({ is_locked: !isMovable }).eq('event_id', updatedEvents[i].event_id);
      }
      setEvents(updatedEvents);
      showSuccess("AI has vetted your tasks!");
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const filteredEvents = useMemo(() => {
    return events
      .filter(e => {
        const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase());
        const matchesLocked = e.is_locked ? showLocked : showUnlocked;
        const matchesProvider = selectedProvider === 'all' || e.provider === selectedProvider;
        return matchesSearch && matchesLocked && matchesProvider;
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
    const total = events.length;
    const locked = events.filter(e => e.is_locked).length;
    const movable = total - locked;
    const progress = total > 0 ? (movable / total) * 100 : 0;
    return { total, locked, movable, progress };
  }, [events]);

  const providers = Array.from(new Set(events.map(e => e.provider)));

  const getDateLabel = (dateStr: string) => {
    const date = parseISO(dateStr);
    if (isToday(date)) return "Today";
    if (isTomorrow(date)) return "Tomorrow";
    return format(date, 'EEEE, MMM do');
  };

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pb-24">
        {/* Header Section */}
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
          
          <div className="flex gap-3 w-full md:w-auto">
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

        {/* Vetting Progress Bar */}
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

        {/* Sticky Filter & Search Bar */}
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

        {/* Task List Grouped by Date */}
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
                      "p-6 rounded-[2.5rem] border transition-all duration-300 group flex items-center justify-between relative overflow-hidden hover:shadow-md",
                      event.is_locked 
                        ? "bg-white border-gray-100" 
                        : "bg-indigo-50/40 border-indigo-100/50"
                    )}>
                      {/* Work Watermark */}
                      {event.is_work && (
                        <div className="absolute -right-2 -bottom-2 opacity-[0.04] pointer-events-none rotate-12 group-hover:rotate-0 transition-transform duration-700">
                          <Briefcase size={80} />
                        </div>
                      )}

                      <div className="flex items-center gap-6 flex-1 min-w-0 relative z-10">
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
                      
                      <div className="flex items-center gap-8 ml-6 relative z-10">
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
    </Layout>
  );
};

export default Vet;