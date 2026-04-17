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
  Trash2,
  CheckSquare,
  Square
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
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
  
  // Advanced Filtering & Sorting State
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

  const providers = Array.from(new Set(events.map(e => e.provider)));

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-10 gap-6">
          <div>
            <button 
              onClick={() => navigate('/plan')}
              className="flex items-center gap-2 text-gray-400 hover:text-indigo-600 font-black text-[10px] uppercase tracking-widest mb-4 transition-colors"
            >
              <ChevronLeft size={16} /> Back to Plan
            </button>
            <h1 className="text-4xl font-black text-gray-900 tracking-tight">Vet Tasks</h1>
            <p className="text-gray-500 font-medium mt-1">Decide which events are fixed and which can be moved.</p>
          </div>
          
          <div className="flex gap-3">
            <Button 
              variant="outline" 
              onClick={runAIClassification} 
              disabled={isProcessing}
              className="rounded-2xl h-14 px-8 font-black text-xs uppercase tracking-widest border-indigo-100 text-indigo-600 hover:bg-indigo-50 shadow-sm"
            >
              {isProcessing ? <RefreshCw className="animate-spin mr-2" size={18} /> : <BrainCircuit className="mr-2" size={18} />}
              AI Auto-Vet
            </Button>
            <Button 
              onClick={() => navigate('/plan')}
              className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl h-14 px-10 font-black text-xs uppercase tracking-widest shadow-xl shadow-indigo-100"
            >
              <CheckCircle2 className="mr-2" size={18} /> Done Vetting
            </Button>
          </div>
        </div>

        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden mb-8">
          <div className="p-8 border-b border-gray-50 flex flex-col lg:flex-row gap-6 justify-between items-center">
            <div className="relative w-full lg:w-96">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                placeholder="Search tasks..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 rounded-2xl border-gray-100 bg-gray-50/50 font-bold text-sm focus:ring-indigo-500"
              />
            </div>
            
            <div className="flex flex-wrap items-center gap-3 w-full lg:w-auto justify-center lg:justify-end">
              {/* Visibility Toggles */}
              <div className="flex bg-gray-50 p-1 rounded-xl border border-gray-100">
                <button 
                  onClick={() => setShowLocked(!showLocked)}
                  className={cn(
                    "p-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest",
                    showLocked ? "bg-white text-red-500 shadow-sm" : "text-gray-400"
                  )}
                >
                  {showLocked ? <Eye size={14} /> : <EyeOff size={14} />} Locked
                </button>
                <button 
                  onClick={() => setShowUnlocked(!showUnlocked)}
                  className={cn(
                    "p-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest",
                    showUnlocked ? "bg-white text-green-500 shadow-sm" : "text-gray-400"
                  )}
                >
                  {showUnlocked ? <Eye size={14} /> : <EyeOff size={14} />} Movable
                </button>
              </div>

              {/* Sort & Filter Dropdown */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-xl h-10 px-4 font-black text-[10px] uppercase tracking-widest border-gray-100">
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

              {/* Bulk Actions */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="rounded-xl h-10 px-4 font-black text-[10px] uppercase tracking-widest border-gray-100">
                    Bulk Actions
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

          <div className="divide-y divide-gray-50">
            {loading ? (
              <div className="p-20 text-center">
                <RefreshCw className="animate-spin text-indigo-600 mx-auto mb-4" size={32} />
                <p className="text-gray-400 font-bold">Loading your schedule...</p>
              </div>
            ) : filteredEvents.length > 0 ? (
              filteredEvents.map((event) => (
                <div key={event.event_id} className={cn(
                  "p-6 flex items-center justify-between transition-all group hover:bg-gray-50/50",
                  event.is_locked ? "bg-red-50/5" : "bg-indigo-50/10"
                )}>
                  <div className="flex items-center gap-6">
                    <div className={cn(
                      "w-14 h-14 rounded-2xl flex items-center justify-center transition-all",
                      event.is_locked ? "bg-red-50 text-red-400" : "bg-white text-indigo-600 shadow-md"
                    )}>
                      {event.is_locked ? <Lock size={24} /> : <Unlock size={24} />}
                    </div>
                    <div>
                      <h3 className="font-black text-lg text-gray-900 tracking-tight">{event.title}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest">
                          {format(parseISO(event.start_time), 'EEEE, MMM do')} • {format(parseISO(event.start_time), 'HH:mm')}
                        </p>
                        <Badge variant="outline" className="text-[8px] font-black border-gray-100 text-gray-400 px-2 py-0 h-4 uppercase tracking-tighter">
                          {event.provider}
                        </Badge>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className={cn(
                      "text-[10px] font-black uppercase tracking-widest",
                      event.is_locked ? "text-red-400" : "text-indigo-600"
                    )}>
                      {event.is_locked ? 'Locked' : 'Movable'}
                    </span>
                    <Switch 
                      checked={!event.is_locked} 
                      onCheckedChange={() => toggleLock(event.event_id, event.is_locked)} 
                      className="data-[state=checked]:bg-indigo-600 scale-125" 
                    />
                  </div>
                </div>
              ))
            ) : (
              <div className="p-20 text-center">
                <p className="text-gray-400 font-bold">No tasks found matching your filters.</p>
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