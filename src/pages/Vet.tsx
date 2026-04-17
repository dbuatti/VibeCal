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
  MoreHorizontal
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { 
  DropdownMenu, 
  DropdownMenuContent, 
  DropdownMenuItem, 
  DropdownMenuLabel, 
  DropdownMenuSeparator, 
  DropdownMenuTrigger,
  DropdownMenuCheckboxItem
} from '@/components/ui/dropdown-menu';
import { format, parseISO } from 'date-fns';
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

  const stats = useMemo(() => {
    const total = events.length;
    const locked = events.filter(e => e.is_locked).length;
    const movable = total - locked;
    return { total, locked, movable };
  }, [events]);

  const providers = Array.from(new Set(events.map(e => e.provider)));

  return (
    <Layout>
      <div className="max-w-5xl mx-auto">
        {/* Header Section */}
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
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
              className="flex-1 md:flex-none rounded-2xl h-14 px-8 font-black text-xs uppercase tracking-widest border-indigo-100 text-indigo-600 hover:bg-indigo-50 shadow-sm transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              {isProcessing ? <RefreshCw className="animate-spin mr-2" size={18} /> : <BrainCircuit className="mr-2" size={18} />}
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

        {/* Stats Pulse Bar */}
        <div className="grid grid-cols-3 gap-4 mb-10">
          {[
            { label: 'Total Tasks', value: stats.total, icon: Layers, color: 'bg-gray-100 text-gray-600' },
            { label: 'Locked', value: stats.locked, icon: Lock, color: 'bg-red-50 text-red-600' },
            { label: 'Movable', value: stats.movable, icon: Unlock, color: 'bg-green-50 text-green-600' },
          ].map((stat, i) => (
            <div key={i} className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm flex items-center gap-4">
              <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", stat.color)}>
                <stat.icon size={20} />
              </div>
              <div>
                <div className="text-2xl font-black text-gray-900">{stat.value}</div>
                <div className="text-[10px] font-black text-gray-400 uppercase tracking-widest">{stat.label}</div>
              </div>
            </div>
          ))}
        </div>

        {/* Filter & Search Bar */}
        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden mb-8">
          <div className="p-6 border-b border-gray-50 flex flex-col lg:flex-row gap-4 justify-between items-center">
            <div className="relative w-full lg:w-96">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                placeholder="Search tasks..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 rounded-2xl border-gray-100 bg-gray-50/50 font-bold text-sm focus:ring-indigo-500 transition-all"
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
                  {showLocked ? <Eye size={14} /> : <EyeOff size={14} />} Locked
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
                    <Filter size={14} className="mr-2" /> Sort & Filter
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
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel className="text-[10px] font-black uppercase tracking-widest text-gray-400 px-2 py-1.5">Provider</DropdownMenuLabel>
                  <DropdownMenuCheckboxItem 
                    checked={selectedProvider === 'all'} 
                    onCheckedChange={() => setSelectedProvider('all')}
                    className="rounded-lg font-bold text-xs"
                  >
                    All Providers
                  </DropdownMenuCheckboxItem>
                  {providers.map(p => (
                    <DropdownMenuCheckboxItem 
                      key={p}
                      checked={selectedProvider === p} 
                      onCheckedChange={() => setSelectedProvider(p)}
                      className="rounded-lg font-bold text-xs capitalize"
                    >
                      {p}
                    </DropdownMenuCheckboxItem>
                  ))}
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

          {/* Task List */}
          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="p-20 text-center">
                <RefreshCw className="animate-spin text-indigo-600 mx-auto mb-4" size={32} />
                <p className="text-gray-400 font-bold">Loading your schedule...</p>
              </div>
            ) : filteredEvents.length > 0 ? (
              <div className="grid grid-cols-1 gap-0">
                {filteredEvents.map((event) => (
                  <div key={event.event_id} className={cn(
                    "p-6 flex items-center justify-between transition-all group hover:bg-gray-50/80",
                    event.is_locked ? "bg-white" : "bg-indigo-50/5"
                  )}>
                    <div className="flex items-center gap-6 flex-1 min-w-0">
                      <div className={cn(
                        "w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 transition-all duration-500 group-hover:scale-110",
                        event.is_locked ? "bg-red-50 text-red-400" : "bg-indigo-50 text-indigo-600"
                      )}>
                        {event.is_locked ? <Lock size={24} /> : <Unlock size={24} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-3 mb-1">
                          <h3 className="font-black text-lg text-gray-900 tracking-tight truncate">{event.title}</h3>
                          <Badge variant="outline" className="text-[8px] font-black border-gray-100 text-gray-400 px-2 py-0 h-4 uppercase tracking-tighter shrink-0">
                            {event.provider}
                          </Badge>
                        </div>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                          <div className="flex items-center gap-1.5 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                            <Calendar size={12} className="text-indigo-400" />
                            {format(parseISO(event.start_time), 'EEEE, MMM do')}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                            <Clock size={12} className="text-indigo-400" />
                            {format(parseISO(event.start_time), 'HH:mm')}
                          </div>
                          <div className="flex items-center gap-1.5 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                            <Zap size={12} className="text-indigo-400" />
                            {event.duration_minutes}m
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-6 ml-4">
                      <div className="hidden sm:flex flex-col items-end">
                        <span className={cn(
                          "text-[10px] font-black uppercase tracking-widest",
                          event.is_locked ? "text-red-400" : "text-indigo-600"
                        )}>
                          {event.is_locked ? 'Fixed' : 'Movable'}
                        </span>
                        <span className="text-[8px] font-bold text-gray-300 uppercase tracking-tighter">Status</span>
                      </div>
                      <Switch 
                        checked={!event.is_locked} 
                        onCheckedChange={() => toggleLock(event.event_id, event.is_locked)} 
                        className="data-[state=checked]:bg-indigo-600 scale-125" 
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-20 text-center">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Search className="text-gray-300" size={32} />
                </div>
                <p className="text-gray-400 font-bold text-lg">No tasks found matching your filters.</p>
                <Button variant="link" onClick={() => {
                  setSearchQuery('');
                  setShowLocked(true);
                  setShowUnlocked(true);
                  setSelectedProvider('all');
                }} className="text-indigo-600 font-black text-xs uppercase tracking-widest mt-2">
                  Clear all filters
                </Button>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Vet;