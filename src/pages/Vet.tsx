"use client";

import React, { useEffect, useState } from 'react';
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
  CheckCircle2
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { format, parseISO } from 'date-fns';
import { cn } from '@/lib/utils';

const Vet = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [filter, setFilter] = useState<'all' | 'locked' | 'movable'>('all');

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

  const filteredEvents = events.filter(e => {
    const matchesSearch = e.title.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFilter = filter === 'all' || (filter === 'locked' ? e.is_locked : !e.is_locked);
    return matchesSearch && matchesFilter;
  });

  const lockedCount = events.filter(e => e.is_locked).length;
  const movableCount = events.filter(e => !e.is_locked).length;

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

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <Card className="border-none shadow-sm rounded-3xl bg-white p-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Total Tasks</p>
              <p className="text-2xl font-black text-gray-900">{events.length}</p>
            </div>
            <div className="w-12 h-12 bg-gray-50 rounded-2xl flex items-center justify-center text-gray-400">
              <Calendar size={24} />
            </div>
          </Card>
          <Card className="border-none shadow-sm rounded-3xl bg-white p-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Locked</p>
              <p className="text-2xl font-black text-gray-900">{lockedCount}</p>
            </div>
            <div className="w-12 h-12 bg-red-50 rounded-2xl flex items-center justify-center text-red-500">
              <Lock size={24} />
            </div>
          </Card>
          <Card className="border-none shadow-sm rounded-3xl bg-white p-6 flex items-center justify-between">
            <div>
              <p className="text-[10px] font-black text-gray-400 uppercase tracking-widest mb-1">Movable</p>
              <p className="text-2xl font-black text-gray-900">{movableCount}</p>
            </div>
            <div className="w-12 h-12 bg-green-50 rounded-2xl flex items-center justify-center text-green-500">
              <Unlock size={24} />
            </div>
          </Card>
        </div>

        <div className="bg-white rounded-[2.5rem] border border-gray-100 shadow-sm overflow-hidden">
          <div className="p-8 border-b border-gray-50 flex flex-col md:flex-row gap-4 justify-between items-center">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <Input 
                placeholder="Search tasks..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-12 h-12 rounded-2xl border-gray-100 bg-gray-50/50 font-bold text-sm focus:ring-indigo-500"
              />
            </div>
            <div className="flex bg-gray-50 p-1.5 rounded-2xl border border-gray-100">
              {(['all', 'locked', 'movable'] as const).map((f) => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={cn(
                    "px-6 py-2 rounded-xl font-black text-[10px] uppercase tracking-widest transition-all",
                    filter === f ? "bg-white text-indigo-600 shadow-sm" : "text-gray-400 hover:text-gray-600"
                  )}
                >
                  {f}
                </button>
              ))}
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
                  event.is_locked ? "opacity-60" : "bg-indigo-50/10"
                )}>
                  <div className="flex items-center gap-6">
                    <div className={cn(
                      "w-14 h-14 rounded-2xl flex items-center justify-center transition-all",
                      event.is_locked ? "bg-gray-100 text-gray-400" : "bg-white text-indigo-600 shadow-md"
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
                      event.is_locked ? "text-gray-400" : "text-indigo-600"
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
                <p className="text-gray-400 font-bold">No tasks found matching your search.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default Vet;