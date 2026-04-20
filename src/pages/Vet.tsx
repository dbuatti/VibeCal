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
  RefreshCw, 
  CheckCircle2, 
  Zap, 
  Sparkles, 
  AlertTriangle, 
  Brain, 
  MessageSquare,
  Clock,
  Globe
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { format, parseISO, startOfDay } from 'date-fns';
import { cn } from '@/lib/utils';
import TrainAIModal from '@/components/TrainAIModal';

const ProviderIcon = ({ provider }: { provider: string }) => {
  if (provider === 'google') {
    return (
      <svg viewBox="0 0 24 24" className="w-3 h-3 shrink-0">
        <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
        <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
        <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
        <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
      </svg>
    );
  }
  if (provider === 'apple') {
    return (
      <svg viewBox="0 0 24 24" className="w-3 h-3 text-gray-900 shrink-0" fill="currentColor">
        <path d="M17.05 20.28c-.98.95-2.05 1.61-3.22 1.61-1.14 0-1.55-.67-2.85-.67-1.32 0-1.77.65-2.85.67-1.15.02-2.19-.62-3.22-1.61C2.79 18.21 1.35 14.15 1.35 10.83c0-3.32 2.12-5.07 4.16-5.07 1.08 0 1.88.43 2.54.43.64 0 1.52-.47 2.75-.47 1.05 0 2.02.35 2.72.95 2.02 1.73 1.85 4.45 1.85 4.45s-2.35.85-2.35 3.5c0 2.65 2.35 3.5 2.35 3.5-.05.15-.32.65-.72 1.14zM12.03 4.95c-.02-1.3.5-2.55 1.35-3.45.85-.9 2.1-1.5 3.35-1.5.05 1.3-.45 2.55-1.35 3.45-.9.9-2.1 1.5-3.35 1.5z"/>
      </svg>
    );
  }
  return <Globe size={12} className="text-gray-400 shrink-0" />;
};

const Vet = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [aiMetadata, setAiMetadata] = useState<Record<string, { explanation: string, confidence: number }>>({});
  
  const [showLocked, setShowLocked] = useState(true);
  const [showUnlocked, setShowUnlocked] = useState(true);

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

  const handleSync = async () => {
    setIsProcessing(true);
    setStatusText('Syncing calendars...');
    try {
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
      showSuccess("Calendars synced!");
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  const runAIClassification = async () => {
    if (events.length === 0) return;

    setIsProcessing(true);
    setStatusText('AI is vetting your schedule...');
    
    try {
      const { data: settings } = await supabase.from('user_settings').select('movable_keywords, locked_keywords, natural_language_rules').single();
      
      const { data, error } = await supabase.functions.invoke('classify-tasks', {
        body: {
          events: events.map(e => ({ event_id: e.event_id, title: e.title })),
          movableKeywords: settings?.movable_keywords || [],
          lockedKeywords: settings?.locked_keywords || [],
          naturalLanguageRules: settings?.natural_language_rules || '',
          persist: true
        }
      });

      if (error) throw error;

      if (data?.classifications) {
        const updatedEvents = [...events];
        const newMetadata = { ...aiMetadata };

        events.forEach((event, idx) => {
          const classification = data.classifications[idx];
          if (classification) {
            const eventIdx = updatedEvents.findIndex(e => e.event_id === event.event_id);
            if (eventIdx !== -1) {
              updatedEvents[eventIdx].is_locked = !classification.isMovable;
              newMetadata[event.event_id] = {
                explanation: classification.explanation,
                confidence: classification.confidence || 1.0
              };
            }
          }
        });

        setEvents(updatedEvents);
        setAiMetadata(newMetadata);
        showSuccess("AI vetting complete!");
      }

    } catch (err: any) {
      showError("AI Vetting failed: " + err.message);
    } finally {
      setIsProcessing(false);
      setStatusText('');
    }
  };

  const toggleLock = async (event: any) => {
    const newLockedStatus = !event.is_locked;
    setEvents(prev => prev.map(e => e.event_id === event.event_id ? { ...e, is_locked: newLockedStatus } : e));

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      await supabase.from('calendar_events_cache').update({ is_locked: newLockedStatus }).eq('event_id', event.event_id);
      
      supabase.from('task_classification_feedback').upsert({
        user_id: user.id,
        task_name: event.title,
        is_movable: !newLockedStatus
      }, { onConflict: 'user_id, task_name' });
    } catch (err) { 
      setEvents(prev => prev.map(e => e.event_id === event.event_id ? { ...e, is_locked: !newLockedStatus } : e));
      showError("Failed to update status"); 
    }
  };

  const filteredEvents = useMemo(() => {
    const today = startOfDay(new Date());
    return events.filter(e => {
      const eventDate = parseISO(e.start_time);
      return eventDate >= today && 
             e.title.toLowerCase().includes(searchQuery.toLowerCase()) && 
             (e.is_locked ? showLocked : showUnlocked);
    });
  }, [events, searchQuery, showLocked, showUnlocked]);

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
          
          <div className="flex items-center gap-3">
            <Button 
              variant="outline" 
              onClick={handleSync} 
              disabled={isProcessing}
              className="rounded-2xl h-14 px-6 font-black text-xs uppercase tracking-widest flex gap-3 border-gray-100 text-gray-500 hover:bg-gray-50 shadow-sm"
            >
              <RefreshCw className={cn(isProcessing && statusText.includes('Syncing') && "animate-spin")} size={18} />
              Sync
            </Button>
            <Button 
              variant="outline" 
              onClick={runAIClassification} 
              disabled={isProcessing} 
              className="rounded-2xl h-14 px-8 font-black text-xs uppercase tracking-widest flex gap-3 border-indigo-100 text-indigo-600 hover:bg-indigo-50 shadow-sm"
            >
              {isProcessing && statusText.includes('AI') ? <RefreshCw className="animate-spin" size={20} /> : <Sparkles size={20} />}
              AI Auto-Vet
            </Button>
            <Button onClick={() => navigate('/plan')} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl h-14 px-10 font-black text-xs uppercase tracking-widest shadow-xl">
              <CheckCircle2 className="mr-2" size={18} /> Done
            </Button>
          </div>
        </div>

        {isProcessing && (
          <div className="mb-8 p-4 bg-indigo-600 text-white rounded-2xl flex items-center justify-center gap-3 animate-pulse shadow-lg">
            <RefreshCw className="animate-spin" size={18} />
            <span className="font-black text-xs uppercase tracking-widest">{statusText}</span>
          </div>
        )}

        <div className="bg-white p-8 rounded-[2.5rem] border border-gray-100 shadow-sm mb-8">
          <div className="flex justify-between items-end mb-4 px-2">
            <div className="flex items-center gap-2">
              <Zap size={16} className="text-indigo-600" />
              <span className="text-[10px] font-black uppercase tracking-widest text-gray-400">Flexibility Score</span>
            </div>
            <span className="text-[10px] font-black text-indigo-600 uppercase tracking-widest">{Math.round(stats.progress)}% Movable</span>
          </div>
          <Progress value={stats.progress} className="h-3 bg-gray-50" />
        </div>

        <div className="sticky top-4 z-50 bg-white/90 backdrop-blur-xl rounded-[2.5rem] border border-gray-100 shadow-xl mb-10 p-4 flex flex-col lg:flex-row gap-4 justify-between items-center">
          <div className="relative w-full lg:w-96">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
            <Input placeholder="Search tasks..." value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} className="pl-12 h-12 rounded-2xl border-none bg-gray-50/50 font-bold text-sm" />
          </div>
          <div className="flex items-center gap-3">
            <div className="flex bg-gray-50 p-1 rounded-xl border border-gray-100">
              <button onClick={() => setShowLocked(!showLocked)} className={cn("px-6 py-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest", showLocked ? "bg-white text-red-500 shadow-sm" : "text-gray-400")}>
                <Lock size={12} /> Fixed
              </button>
              <button onClick={() => setShowUnlocked(!showUnlocked)} className={cn("px-6 py-2 rounded-lg transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest", showUnlocked ? "bg-white text-green-500 shadow-sm" : "text-gray-400")}>
                <Unlock size={12} /> Movable
              </button>
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
                {groupedEvents[dateKey].map((event) => {
                  const metadata = aiMetadata[event.event_id];
                  const isLowConfidence = metadata && metadata.confidence < 0.7;

                  return (
                    <div key={event.event_id} className={cn(
                      "px-6 py-5 rounded-[2rem] border transition-all duration-300 flex flex-col gap-4 group", 
                      event.is_locked ? "bg-white border-gray-100" : "bg-indigo-50/40 border-indigo-100/50 shadow-sm",
                      isLowConfidence && "border-amber-200 ring-2 ring-amber-100/50"
                    )}>
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-5 flex-1 min-w-0">
                          <div className={cn(
                            "w-12 h-12 rounded-2xl flex items-center justify-center shrink-0 transition-all", 
                            event.is_locked ? "bg-gray-50 text-gray-400" : "bg-white text-indigo-600 shadow-md"
                          )}>
                            {event.is_locked ? <Lock size={20} /> : <Unlock size={20} />}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <h3 className={cn("font-black text-lg tracking-tight truncate", event.is_locked ? "text-gray-500" : "text-gray-900")}>
                                {event.title}
                              </h3>
                              <div className="flex items-center gap-1.5">
                                <Badge variant="outline" className="bg-gray-50 text-gray-400 border-gray-100 text-[8px] font-black px-1.5 py-0 uppercase tracking-tighter flex items-center gap-1">
                                  <ProviderIcon provider={event.provider} />
                                  {event.provider}
                                </Badge>
                                {isLowConfidence && (
                                  <Badge variant="outline" className="bg-amber-50 text-amber-600 border-amber-200 text-[8px] font-black px-2 py-0 uppercase tracking-widest animate-pulse">
                                    <AlertTriangle size={10} className="mr-1" /> Review
                                  </Badge>
                                )}
                              </div>
                            </div>
                            <div className="flex items-center gap-3 text-[10px] font-black text-gray-400 uppercase tracking-widest">
                              <Clock size={12} className="text-indigo-300" /> 
                              {format(parseISO(event.start_time), 'HH:mm')} • {event.duration_minutes}m
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          <button 
                            onClick={() => { setTrainingTask(event); setIsTrainingModalOpen(true); }} 
                            className="opacity-0 group-hover:opacity-100 transition-opacity p-2 rounded-xl bg-indigo-50 text-indigo-600 hover:bg-indigo-100 shadow-sm"
                            title="Train AI on this task"
                          >
                            <Brain size={18} />
                          </button>
                          <Switch 
                            checked={!event.is_locked} 
                            onCheckedChange={() => toggleLock(event)} 
                            className="data-[state=checked]:bg-indigo-600 scale-125" 
                          />
                        </div>
                      </div>
                      {metadata && (
                        <div className="p-3 rounded-xl bg-white/60 border border-black/5 flex items-start gap-3 animate-in slide-in-from-top-1 duration-300">
                          <MessageSquare size={14} className="text-indigo-400 mt-0.5 shrink-0" />
                          <p className="text-xs font-bold text-gray-500 leading-relaxed">{metadata.explanation}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>
      <TrainAIModal 
        isOpen={isTrainingModalOpen} 
        onClose={() => setIsTrainingModalOpen(false)} 
        task={trainingTask} 
        onSuccess={(isMovable) => {
          setEvents(prev => prev.map(e => e.event_id === trainingTask.event_id ? { ...e, is_locked: !isMovable } : e));
        }} 
      />
    </Layout>
  );
};

export default Vet;