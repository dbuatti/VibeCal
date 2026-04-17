"use client";

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import DayByDayPlanner from '@/components/DayByDayPlanner';
import { Brain, RefreshCw, Trash2, Eye, EyeOff, Sparkles, Calendar, Clock, ListOrdered, ChevronRight, BrainCircuit, Inbox, Unlock, Lock, History, Settings2, Wand2, CheckSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, nextSaturday, formatDistanceToNow, parseISO, addMinutes } from 'date-fns';
import { cn } from '@/lib/utils';

type PlanStep = 'initial' | 'analysis' | 'vetting_tasks' | 'requirements' | 'active_plan';

const DAYS = [
  { label: 'Sun', value: 0 }, { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 },
];

const Plan = () => {
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<PlanStep>('initial');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  
  const [proposal, setProposal] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [appliedChanges, setAppliedChanges] = useState<string[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [deepFocus, setDeepFocus] = useState(false);
  const [lastSynced, setLastSynced] = useState<string | null>(null);

  const [durationOverride, setDurationOverride] = useState<string>("original");
  const [maxTasksOverride, setMaxTasksOverride] = useState<number>(5);
  const [maxHoursOverride, setMaxHoursOverride] = useState<number>(6);
  const [slotAlignment, setSlotAlignment] = useState<string>("15");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [placeholderDate, setPlaceholderDate] = useState<string>(format(nextSaturday(new Date()), 'yyyy-MM-dd'));

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: history } = await supabase
        .from('optimisation_history')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'proposed')
        .order('run_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const [eventsRes, settingsRes] = await Promise.all([
        supabase.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true }),
        supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle()
      ]);

      if (settingsRes.data) {
        setSettings(settingsRes.data);
        setMaxHoursOverride(settingsRes.data.max_hours_per_day || 6);
        setMaxTasksOverride(settingsRes.data.max_tasks_per_day || 5);
      }

      if (eventsRes.data && eventsRes.data.length > 0) {
        setEvents(eventsRes.data);
        setLastSynced(eventsRes.data[0].last_synced_at);
      }

      if (history) {
        setProposal(history);
        const appliedIds = history.proposed_changes
          .filter((c: any) => c.applied === true)
          .map((c: any) => c.event_id);
        setAppliedChanges(appliedIds);
        setCurrentStep('active_plan');
      } else {
        setCurrentStep('initial');
      }
    } catch (err: any) {
      showError("Failed to load your plan");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const runAnalysis = async (skipSync = false) => {
    setIsProcessing(true);
    setStatusText(skipSync ? 'Loading cached data...' : 'Syncing Calendars...');
    try {
      if (!skipSync) {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.provider_token) {
          await supabase.functions.invoke('sync-calendar', { 
            body: { googleAccessToken: session.provider_token } 
          });
        }
        await supabase.functions.invoke('sync-apple-calendar');
      }
      
      const { data: fetchedEvents } = await supabase.from('calendar_events_cache').select('*').order('start_time', { ascending: true });
      setEvents(fetchedEvents || []);
      if (fetchedEvents && fetchedEvents.length > 0) {
        setLastSynced(fetchedEvents[0].last_synced_at);
      }
      
      if (currentStep !== 'active_plan') {
        setCurrentStep('vetting_tasks');
      }
      
      showSuccess(skipSync ? 'Loaded from cache!' : 'Calendar synced!');
    } catch (err: any) { 
      showError(err.message); 
    }
    finally { setIsProcessing(false); }
  };

  const runAIClassification = async () => {
    setIsProcessing(true);
    setStatusText('AI is learning...');
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
      showSuccess("AI updated classifications!");
    } catch (err: any) { showError(err.message); }
    finally { setIsProcessing(false); }
  };

  const runOptimisation = async (isResuggest = false) => {
    if (selectedDays.length === 0) { showError("Select at least one day."); return; }
    setIsProcessing(true);
    setStatusText(isResuggest ? 'Reshuffling unvetted tasks...' : 'Optimising...');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase.functions.invoke('optimise-schedule', {
        body: { 
          durationOverride: durationOverride === "original" ? null : parseInt(durationOverride), 
          maxTasksOverride, 
          slotAlignment: parseInt(slotAlignment), 
          selectedDays,
          placeholderDate,
          vettedEventIds: isResuggest ? appliedChanges : [] 
        }
      });
      if (error) throw error;

      let finalChanges = data.changes;
      if (isResuggest && proposal) {
        const vettedChanges = proposal.proposed_changes.filter((c: any) => appliedChanges.includes(c.event_id));
        const newUnvettedChanges = data.changes.filter((c: any) => !appliedChanges.includes(c.event_id));
        finalChanges = [...vettedChanges, ...newUnvettedChanges];
      }

      const { data: newProposal } = await supabase.from('optimisation_history').insert({
        user_id: user.id,
        proposed_changes: finalChanges.map((c: any) => ({ ...c, applied: appliedChanges.includes(c.event_id) })),
        status: 'proposed',
        metadata: { selectedDays, maxTasksOverride, maxHoursOverride, durationOverride, isResuggest, placeholderDate }
      }).select().single();

      setProposal(newProposal);
      setCurrentStep('active_plan');
      showSuccess(isResuggest ? "Day resuggested!" : "Optimisation complete!");
    } catch (err: any) { showError(err.message); }
    finally { setIsProcessing(false); }
  };

  const handleResetPlan = async () => {
    if (!proposal) return;
    if (!confirm("Clear this plan?")) return;
    try {
      await supabase.from('optimisation_history').update({ status: 'cancelled' }).eq('id', proposal.id);
      setProposal(null);
      setAppliedChanges([]);
      setCurrentStep('initial');
      showSuccess("Plan cleared");
    } catch (err: any) { showError("Failed to reset"); }
  };

  const handleApplyDay = async (dateChanges: any[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const newAppliedIds = [...appliedChanges];
      const updatedEvents = [...events];
      
      for (const change of dateChanges) {
        const eventIdx = updatedEvents.findIndex(e => e.event_id === change.event_id);
        if (eventIdx === -1) continue;
        const eventInCache = updatedEvents[eventIdx];

        await supabase.functions.invoke('push-to-provider', {
          body: { 
            eventId: change.event_id, 
            provider: eventInCache.provider, 
            calendarId: eventInCache.source_calendar_id, 
            startTime: change.new_start, 
            endTime: change.new_end, 
            googleAccessToken: session?.provider_token 
          }
        });

        await supabase.from('calendar_events_cache')
          .update({ 
            start_time: change.new_start, 
            end_time: change.new_end, 
            duration_minutes: change.duration,
            last_synced_at: new Date().toISOString() 
          })
          .eq('event_id', change.event_id);
        
        updatedEvents[eventIdx] = { ...eventInCache, start_time: change.new_start, end_time: change.new_end, duration_minutes: change.duration };
        if (!newAppliedIds.includes(change.event_id)) newAppliedIds.push(change.event_id);
      }

      const updatedProposedChanges = proposal.proposed_changes.map((c: any) => ({ ...c, applied: newAppliedIds.includes(c.event_id) }));
      await supabase.from('optimisation_history').update({ proposed_changes: updatedProposedChanges }).eq('id', proposal.id);
      setEvents(updatedEvents);
      setAppliedChanges(newAppliedIds);
      setProposal({ ...proposal, proposed_changes: updatedProposedChanges });
    } catch (err: any) { showError(err.message); throw err; }
  };

  const handleUndoApplyDay = async (dateChanges: any[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const changeIds = dateChanges.map(c => c.event_id);
      const newAppliedIds = appliedChanges.filter(id => !changeIds.includes(id));
      const updatedEvents = [...events];

      for (const change of dateChanges) {
        const eventIdx = updatedEvents.findIndex(e => e.event_id === change.event_id);
        if (eventIdx === -1) continue;
        const eventInCache = updatedEvents[eventIdx];
        const oldEnd = addMinutes(parseISO(change.old_start), change.old_duration).toISOString();

        await supabase.functions.invoke('push-to-provider', {
          body: { 
            eventId: change.event_id, 
            provider: eventInCache.provider, 
            calendarId: eventInCache.source_calendar_id, 
            startTime: change.old_start, 
            endTime: oldEnd, 
            googleAccessToken: session?.provider_token 
          }
        });

        await supabase.from('calendar_events_cache')
          .update({ start_time: change.old_start, end_time: oldEnd, duration_minutes: change.old_duration, last_synced_at: new Date().toISOString() })
          .eq('event_id', change.event_id);

        updatedEvents[eventIdx] = { ...eventInCache, start_time: change.old_start, end_time: oldEnd, duration_minutes: change.old_duration };
      }

      const updatedProposedChanges = proposal.proposed_changes.map((c: any) => ({ ...c, applied: newAppliedIds.includes(c.event_id) }));
      await supabase.from('optimisation_history').update({ proposed_changes: updatedProposedChanges }).eq('id', proposal.id);
      setEvents(updatedEvents);
      setAppliedChanges(newAppliedIds);
      setProposal({ ...proposal, proposed_changes: updatedProposedChanges });
      showSuccess("Day reverted.");
    } catch (err: any) { showError("Failed to undo: " + err.message); }
  };

  const toggleLock = async (eventId: string, currentStatus: boolean) => {
    try {
      await supabase.from('calendar_events_cache').update({ is_locked: !currentStatus }).eq('event_id', eventId);
      setEvents(events.map(e => e.event_id === eventId ? { ...e, is_locked: !currentStatus } : e));
    } catch (err: any) { showError("Failed to update lock"); }
  };

  const RequirementsForm = () => (
    <div className="space-y-6 p-2">
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Duration</Label>
          <Select value={durationOverride} onValueChange={setDurationOverride}>
            <SelectTrigger className="h-10 rounded-xl border-gray-100 font-bold text-xs px-3 bg-gray-50/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="original">Original</SelectItem>
              <SelectItem value="15">15m</SelectItem>
              <SelectItem value="30">30m</SelectItem>
              <SelectItem value="45">45m</SelectItem>
              <SelectItem value="60">60m</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Alignment</Label>
          <Select value={slotAlignment} onValueChange={setSlotAlignment}>
            <SelectTrigger className="h-10 rounded-xl border-gray-100 font-bold text-xs px-3 bg-gray-50/50">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="rounded-xl">
              <SelectItem value="5">5m</SelectItem>
              <SelectItem value="15">15m</SelectItem>
              <SelectItem value="30">30m</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Allowed Days</Label>
        <div className="flex flex-wrap gap-1.5">
          {DAYS.map((day) => (
            <button 
              key={day.value} 
              onClick={() => setSelectedDays(prev => prev.includes(day.value) ? prev.filter(d => d !== day.value) : [...prev, day.value])} 
              className={cn(
                "px-2.5 py-1.5 rounded-lg font-black text-[8px] uppercase tracking-widest transition-all border",
                selectedDays.includes(day.value) ? "bg-indigo-600 border-indigo-600 text-white shadow-sm" : "bg-white border-gray-100 text-gray-400"
              )}
            >
              {day.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Max Hours</Label>
          <Input type="number" value={maxHoursOverride} onChange={(e) => setMaxHoursOverride(parseInt(e.target.value))} className="h-10 rounded-xl border-gray-100 font-bold text-sm px-3 bg-gray-50/50" />
        </div>
        <div className="space-y-2">
          <Label className="text-[10px] font-black uppercase tracking-widest text-gray-400">Max Tasks</Label>
          <Input type="number" value={maxTasksOverride} onChange={(e) => setMaxTasksOverride(parseInt(e.target.value))} className="h-10 rounded-xl border-gray-100 font-bold text-sm px-3 bg-gray-50/50" />
        </div>
      </div>

      <div className="space-y-2 p-4 bg-amber-50/50 rounded-2xl border border-amber-100">
        <Label className="text-[10px] font-black uppercase tracking-widest text-amber-600 flex items-center gap-2">
          <Inbox size={12} /> Surplus Handling
        </Label>
        <div className="space-y-2">
          <p className="text-[9px] text-amber-700 font-bold leading-tight">Overflow tasks will be moved to:</p>
          <Input 
            type="date" 
            value={placeholderDate} 
            onChange={(e) => setPlaceholderDate(e.target.value)}
            className="h-9 rounded-xl border-amber-100 font-bold text-xs px-3 bg-white focus:ring-amber-500"
          />
        </div>
      </div>
      
      <Button onClick={() => runOptimisation(false)} className="w-full bg-indigo-600 text-white rounded-xl py-6 text-xs font-black uppercase tracking-widest shadow-lg shadow-indigo-100">
        <Wand2 size={14} className="mr-2" /> Re-Generate Plan
      </Button>
    </div>
  );

  const VettingOverlay = () => (
    <div className="space-y-4 p-2">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-black uppercase tracking-widest text-gray-400">Synced Events</p>
        <Button variant="ghost" size="sm" onClick={runAIClassification} className="h-7 px-2 text-[8px] font-black uppercase tracking-widest text-indigo-600 hover:bg-indigo-50">
          <BrainCircuit size={12} className="mr-1" /> AI Vet
        </Button>
      </div>
      <div className="space-y-2 max-h-[400px] overflow-y-auto pr-2 custom-scrollbar">
        {events.map((event, i) => (
          <div key={i} className={cn(
            "p-3 rounded-xl border transition-all flex items-center justify-between",
            event.is_locked ? "bg-white border-gray-100 opacity-60" : "bg-indigo-50/30 border-indigo-100 shadow-sm"
          )}>
            <div className="flex items-center gap-3 overflow-hidden">
              <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center shrink-0", event.is_locked ? "bg-gray-50 text-gray-300" : "bg-white text-indigo-600 shadow-sm")}>
                {event.is_locked ? <Lock size={14} /> : <Unlock size={14} />}
              </div>
              <div className="overflow-hidden">
                <h3 className="font-black text-[11px] text-gray-900 tracking-tight truncate max-w-[160px]">{event.title}</h3>
                <p className="text-[8px] font-black text-gray-400 uppercase tracking-widest">
                  {format(parseISO(event.start_time), 'EEE, HH:mm')}
                </p>
              </div>
            </div>
            <Switch checked={!event.is_locked} onCheckedChange={() => toggleLock(event.event_id, event.is_locked)} className="data-[state=checked]:bg-indigo-600 scale-90" />
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <Layout hideSidebar={deepFocus}>
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center mb-8 gap-4">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <Badge className="bg-indigo-50 text-indigo-600 border-none px-3 py-1 rounded-full font-black flex gap-2 text-[9px] uppercase tracking-widest">
              <Brain size={12} /> ADHD Focus
            </Badge>
            {currentStep === 'active_plan' && (
              <div className="flex items-center gap-2 px-3 py-1 bg-white rounded-full border border-gray-100 shadow-sm">
                <Switch id="deep-focus" checked={deepFocus} onCheckedChange={setDeepFocus} className="h-4 w-8" />
                <Label htmlFor="deep-focus" className="text-[9px] font-black text-gray-400 uppercase tracking-widest flex items-center gap-1.5 cursor-pointer">
                  {deepFocus ? <EyeOff size={12} /> : <Eye size={12} />}
                  Compact
                </Label>
              </div>
            )}
          </div>
          <h1 className="text-3xl font-black text-gray-900 tracking-tight">Daily Plan</h1>
        </div>
        <div className="flex gap-2">
          {(currentStep === 'active_plan' || currentStep === 'vetting_tasks') && (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="bg-white border-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm">
                  <CheckSquare size={14} className="mr-2" /> Vet Tasks
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 rounded-[2rem] shadow-2xl border-none p-6" align="end">
                <h3 className="text-sm font-black text-gray-900 mb-4 uppercase tracking-widest">Vet Synced Tasks</h3>
                <VettingOverlay />
              </PopoverContent>
            </Popover>
          )}
          
          {currentStep === 'active_plan' ? (
            <Popover>
              <PopoverTrigger asChild>
                <Button variant="outline" className="bg-white border-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm">
                  <Settings2 size={14} className="mr-2" /> Requirements
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 rounded-[2rem] shadow-2xl border-none p-6" align="end">
                <h3 className="text-sm font-black text-gray-900 mb-4 uppercase tracking-widest">Plan Requirements</h3>
                <RequirementsForm />
              </PopoverContent>
            </Popover>
          ) : currentStep === 'vetting_tasks' && (
            <Button variant="outline" onClick={() => setCurrentStep('requirements')} className="bg-white border-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm">
              <Settings2 size={14} className="mr-2" /> Requirements
            </Button>
          )}
          <Button variant="outline" onClick={() => runAnalysis(false)} disabled={isProcessing} className="bg-white border-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm">
            <RefreshCw size={14} className={cn("mr-2", isProcessing && "animate-spin")} /> Resync
          </Button>
          {currentStep === 'active_plan' && (
            <Button variant="outline" onClick={handleResetPlan} className="bg-white border-gray-100 text-gray-400 hover:text-red-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm">
              <Trash2 size={14} className="mr-2" /> Reset
            </Button>
          )}
        </div>
      </div>

      {isProcessing ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <RefreshCw className="text-indigo-600 animate-spin w-12 h-12 mb-4" />
          <h2 className="text-xl font-black text-gray-900 tracking-tight">{statusText}</h2>
        </div>
      ) : (
        <>
          {currentStep === 'initial' && (
            <Card className="border-none shadow-xl rounded-[2rem] overflow-hidden bg-white">
              <div className="bg-gradient-to-br from-indigo-600 to-purple-800 p-12 text-white text-center">
                <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mx-auto mb-6 backdrop-blur-xl border border-white/30">
                  <Calendar size={32} />
                </div>
                <h2 className="text-3xl font-black mb-4 tracking-tight">Ready to Optimise?</h2>
                <p className="text-indigo-100 mb-8 text-base font-medium max-w-md mx-auto">Align your schedule with your life.</p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                  <Button onClick={() => runAnalysis(false)} className="bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl px-10 py-6 text-lg font-black shadow-xl">
                    Sync Fresh
                  </Button>
                  {events.length > 0 && (
                    <Button onClick={() => runAnalysis(true)} variant="outline" className="bg-white/10 border-white/20 text-white hover:bg-white/20 rounded-2xl px-10 py-6 text-lg font-black">
                      Use Cache
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          )}

          {currentStep === 'vetting_tasks' && (
            <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="flex items-center justify-between bg-white p-6 rounded-2xl border border-gray-100 shadow-sm">
                <div>
                  <h2 className="text-xl font-black text-gray-900 tracking-tight">Vet Your Tasks</h2>
                  <p className="text-gray-400 text-xs font-medium">Toggle tasks that are movable.</p>
                </div>
                <div className="flex gap-3">
                  <Button variant="outline" onClick={runAIClassification} className="rounded-xl px-6 h-12 font-black text-[9px] uppercase tracking-widest flex gap-2 border-indigo-100 text-indigo-600">
                    <BrainCircuit size={16} /> AI Vet
                  </Button>
                  <Button onClick={() => setCurrentStep('requirements')} className="bg-indigo-600 text-white rounded-xl px-8 h-12 font-black text-[9px] uppercase tracking-widest flex gap-2 shadow-lg shadow-indigo-100">
                    Next <ChevronRight size={16} />
                  </Button>
                </div>
              </div>
              <div className="grid grid-cols-1 gap-3">
                {events.map((event, i) => (
                  <div key={i} className={cn(
                    "p-4 rounded-2xl border transition-all flex items-center justify-between",
                    event.is_locked ? "bg-white border-gray-100 opacity-60" : "bg-indigo-50/30 border-indigo-100 shadow-sm"
                  )}>
                    <div className="flex items-center gap-4">
                      <div className={cn("w-10 h-10 rounded-xl flex items-center justify-center", event.is_locked ? "bg-gray-50 text-gray-300" : "bg-white text-indigo-600 shadow-sm")}>
                        {event.is_locked ? <Lock size={18} /> : <Unlock size={18} />}
                      </div>
                      <div>
                        <h3 className="font-black text-base text-gray-900 tracking-tight">{event.title}</h3>
                        <p className="text-[9px] font-black text-gray-400 uppercase tracking-widest">
                          {format(parseISO(event.start_time), 'EEE, MMM d')} • {format(parseISO(event.start_time), 'HH:mm')}
                        </p>
                      </div>
                    </div>
                    <Switch checked={!event.is_locked} onCheckedChange={() => toggleLock(event.event_id, event.is_locked)} className="data-[state=checked]:bg-indigo-600 scale-110" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {currentStep === 'requirements' && (
            <Card className="border-none shadow-xl rounded-[2rem] overflow-hidden bg-white animate-in fade-in slide-in-from-bottom-4 duration-500">
              <CardHeader className="p-8 border-b border-gray-50">
                <CardTitle className="text-2xl font-black tracking-tight">Requirements</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                <RequirementsForm />
              </CardContent>
            </Card>
          )}

          {currentStep === 'active_plan' && proposal && (
            <DayByDayPlanner 
              events={events}
              changes={proposal.proposed_changes}
              appliedChanges={appliedChanges}
              onApplyDay={handleApplyDay}
              onUndoApplyDay={handleUndoApplyDay}
              onResuggestDay={() => runOptimisation(true)} 
              maxHours={maxHoursOverride}
              maxTasks={maxTasksOverride}
              workKeywords={settings?.work_keywords}
            />
          )}
        </>
      )}
    </Layout>
  );
};

export default Plan;