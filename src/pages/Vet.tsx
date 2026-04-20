"use client";

import React, { useEffect, useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { 
  Lock, 
  Unlock, 
  ChevronLeft, 
  Search, 
  Filter,
  Calendar,
  RefreshCw,
  CheckCircle2,
  SortAsc,
  Eye, 
  EyeOff,
  Clock,
  Zap,
  Sparkles,
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
  DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { format, parseISO, isToday, isTomorrow, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import TrainAIModal from '@/components/TrainAIModal';

const Vet = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [aiMetadata, setAiMetadata] = useState<Record<string, any>>({});
  
  const [showLocked, setShowLocked] = useState(true);
  const [showUnlocked, setShowUnlocked] = useState(true);
  const [sortBy, setSortBy] = useState('date');
  const [sortOrder, setSortOrder] = useState('asc');

  const [trainingTask, setTrainingTask] = useState<any>(null);
  const [isTrainingModalOpen, setIsTrainingModalOpen] = useState(false);

  const fetchEvents = async () => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true });
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

  const toggleLock = async (event: any) => {
    const newLockedStatus = !event.is_locked;
    
    // OPTIMISTIC UPDATE: Update UI immediately
    setEvents(prev => prev.map(e => e.event_id === event.event_id ? { ...e, is_locked: newLockedStatus } : e));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('calendar_events_cache').update({ is_locked: newLockedStatus }).eq('event_id', event.event_id);
      
      // Background learning
      supabase.from('task_classification_feedback').upsert({
        user_id: user.id,
        task_name: event.title,
        is_movable: !newLockedStatus
      }, { onConflict: 'user_id, task_name' });

    } catch (err) { 
      // Rollback on error
      setEvents(prev => prev.map(e => e.event_id === event.event_id ? { ...e, is_locked: !newLockedStatus } : e));
      showError("Failed to update status"); 
    }
  };

  const filteredEvents = useMemo(() => {
    const today = startOfDay(new Date());
    return events
      .filter(e => {
        const eventDate = parseISO(e.start_time);
        return eventDate >= today && 
               e.title.toLowerCase().includes(searchQuery.toLowerCase()) && 
               (e.is_locked ? showLocked : showUnlocked);
      })
      .sort((a, b) => {
        let comp = 0;
        if (sortBy === 'date') comp = new Date(a.start_time).getTime() - new Date(b.start_time).getTime();
        else if (sortBy === 'title') comp = a.title.localeCompare(b.title);
        return sortOrder === 'asc' ? comp : -comp;
      });
  }, [events, searchQuery, showLocked, showUnlocked, sortBy, sortOrder]);

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
    return { total, locked, progress: total > 0 ? ((total - locked) / total) * 100 : 0 };
  }, [filteredEvents]);

  return (
    <Layout>
      <div className="max-w-5xl mx-auto pb-24">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-6">
          <div className="space-y-1">
            <button onClick={() => navigate('/plan')} className="group flex items-center gap-2 text-gray-400 hover:text-indigo-600 font-black text-[10px] uppercase tracking-widest mb-4 transition-all">
              <ChevronLeft size={14} /> Back to Plan
            </button>
            <h1 className="text-4xl font-black text-gray-900 tracking-tight">Vet Your Tasks</h1>
            <p className="text-gray-500 font-medium">Fast-scan and toggle movable tasks.</p>
          </div>
          
          <div className="flex items-center gap-4">
            <Button onClick={() => navigate('/plan')} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl h-14 px-10 font-black text-xs uppercase tracking-widest shadow-xl">
              <CheckCircle2 className="mr-2" size={18} /> Done
            </Button>
          </div>
        </div>

        <div className="bg-white p-6 rounded-[2rem] border border-gray-100 shadow-sm mb-8">
          <div className="flex justify-between items-end mb-3 px-2">
            <div className="flex items-center gap-2"><Zap size={14} className="text-indigo-600" /><span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Flexibility Score</span></div>
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{Math.round(stats.progress)}% Movable</span>
          </div>
          <Progress value={stats.progress} className="h-2 bg-gray-50" />
        </div>

        <div className="sticky top-4 z-50 bg-white/90 backdrop-blur-xl rounded-[2.5rem] border border-gray-100 shadow-xl mb-10 p-4 flex flex-col lg:flex-row gap-4 justify-between items-center">
          <div className="relative w-full lg:w-96">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <Input placeholder="Search tasks..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-12 h-12 rounded-2xl border-none bg-gray-50/50 font-bold text-sm" />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-50 p-1 rounded-xl border border-gray-100">
              <button onClick={() => setShowLocked(!showLocked)} className={cn("px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest", showLocked ? "bg-white text-red-500 shadow-sm" : "text-gray-400")}>Fixed</button>
              <button onClick={() => setShowUnlocked(!showUnlocked)} className={cn("px-4 py-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest", showUnlocked ? "bg-white text-green-500 shadow-sm" : "text-gray-400")}>Movable</button>
            </div>
          </div>
        </div>

        <div className="space-y-12">
          {loading ? (
            <div className="p-20 text-center"><RefreshCw className="animate-spin text-indigo-600 mx-auto mb-4" size={32} /></div>
          ) : Object.keys(groupedEvents).sort().map(dateKey => (
            <div key={dateKey} className="space-y-6">
              <h2 className="text-xs font-black text-gray-400 uppercase tracking-widest px-4">{format(parseISO(dateKey), 'EEEE, MMM do')}</h2>
              <div className="grid grid-cols-1 gap-3">
                {groupedEvents[dateKey].map((event) => (
                  <div key={event.event_id} className={cn(
                    "px-6 py-4 rounded-[1.5rem] border transition-all duration-200 flex items-center justify-between group", 
                    event.is_locked ? "bg-white border-gray-100" : "bg-indigo-50/40 border-indigo-100/50"
                  )}>
                    <div className="flex items-center gap-4 flex-1 min-w-0">
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center shrink-0", event.is_locked ? "bg-gray-50 text-gray-400" : "bg-white text-indigo-600 shadow-sm")}>
                        {event.is_locked ? <Lock size={18} /> : <Unlock size={18} />}
                      </div>
                      <div className="min-w-0 flex-1">
                        <h3 className="font-black text-base text-gray-900 truncate">{event.title}</h3>
                        <div className="flex items-center gap-3 text-[9px] font-black text-gray-400 uppercase tracking-widest">
                          <Clock size={10} /> {format(parseISO(event.start_time), 'HH:mm')} • {event.duration_minutes}m
                        </div>
                      </div>
                    </div>
                    <Switch checked={!event.is_locked} onCheckedChange={() => toggleLock(event)} className="data-[state=checked]:bg-indigo-600" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <TrainAIModal isOpen={isTrainingModalOpen} onClose={() => setIsTrainingModalOpen(false)} task={trainingTask} onSuccess={() => fetchEvents()} />
    </Layout>
  );
};

export default Vet;