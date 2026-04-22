"use client";

import React, { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import PageHeader from '@/components/PageHeader';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Sparkles, RefreshCw, Calendar, Clock, Lock, Unlock, ChevronRight, ListOrdered, BrainCircuit, Inbox, ChevronLeft } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { format, nextSaturday } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

type Step = 'initial' | 'vetting' | 'requirements';

const DAYS = [
  { label: 'Sun', value: 0 }, { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 },
];

const Optimise = () => {
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<Step>('initial');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  
  const [durationOverride, setDurationOverride] = useState<string>("original");
  const [maxTasksOverride, setMaxTasksOverride] = useState<number>(5);
  const [maxHoursOverride, setMaxHoursOverride] = useState<number>(6);
  const [slotAlignment, setSlotAlignment] = useState<string>("15");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [placeholderDate, setPlaceholderDate] = useState<string>(format(nextSaturday(new Date()), 'yyyy-MM-dd'));

  useEffect(() => {
    const fetchSettings = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase.from('user_settings').select('max_hours_per_day, max_tasks_per_day').eq('user_id', user.id).single();
      if (data) {
        setMaxHoursOverride(data.max_hours_per_day || 6);
        setMaxTasksOverride(data.max_tasks_per_day || 5);
      }
    };
    fetchSettings();
  }, []);

  const toggleDay = (day: number) => {
    setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const runAnalysis = async () => {
    setIsProcessing(true);
    setStatusText('Syncing Calendars...');
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.provider_token) {
        await supabase.functions.invoke('sync-calendar', { body: { googleAccessToken: session.provider_token } });
      }
      await supabase.functions.invoke('sync-apple-calendar');
      const { data: fetchedEvents } = await supabase.from('calendar_events_cache').select('*').order('start_time', { ascending: true });
      setEvents(fetchedEvents || []);
      setCurrentStep('vetting');
      showSuccess('Calendar analysed!');
    } catch (err: any) { showError(err.message); }
    finally { setIsProcessing(false); }
  };

  const toggleLock = async (eventId: string, currentStatus: boolean) => {
    try {
      await supabase.from('calendar_events_cache').update({ is_locked: !currentStatus }).eq('event_id', eventId);
      setEvents(events.map(e => e.event_id === eventId ? { ...e, is_locked: !currentStatus } : e));
    } catch (err: any) { showError("Failed to update lock status"); }
  };

  const runAIClassification = async () => {
    setIsProcessing(true);
    setStatusText('AI is learning your preferences...');
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
      for (let i = 0; i < updatedEvents.length; i++) {
        const classification = data.classifications[i];
        const isMovable = typeof classification === 'boolean' ? classification : classification.isMovable;
        updatedEvents[i].is_locked = !isMovable;
        await supabase.from('calendar_events_cache').update({ is_locked: !isMovable }).eq('event_id', updatedEvents[i].event_id);
      }
      setEvents(updatedEvents);
      showSuccess("AI has updated your task classifications!");
    } catch (err: any) { showError(err.message); }
    finally { setIsProcessing(false); }
  };

  const runOptimisation = async () => {
    if (selectedDays.length === 0) { showError("Select at least one day."); return; }
    setIsProcessing(true);
    setStatusText('Calculating optimal alignment...');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data, error } = await supabase.functions.invoke('optimise-schedule', {
        body: { 
          durationOverride: durationOverride === "original" ? null : parseInt(durationOverride), 
          maxTasksOverride, 
          maxHoursOverride,
          slotAlignment: parseInt(slotAlignment), 
          selectedDays,
          placeholderDate
        }
      });
      if (error) throw error;

      // Save to history as a proposal
      await supabase.from('optimisation_history').insert({
        user_id: user.id,
        proposed_changes: data.changes,
        status: 'proposed',
        metadata: { selectedDays, maxTasksOverride, maxHoursOverride }
      });

      showSuccess("Optimisation complete! Redirecting to your plan...");
      navigate('/plan');
    } catch (err: any) { showError(err.message); }
    finally { setIsProcessing(false); }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <PageHeader 
          title="Optimiser"
          subtitle="Align your movable tasks with your work window."
          icon={Sparkles}
          breadcrumbs={
            <button onClick={() => navigate('/plan')} className="group flex items-center gap-2 text-gray-400 hover:text-indigo-600 font-black text-[10px] uppercase tracking-widest transition-all">
              <ChevronLeft size={14} /> Back to Plan
            </button>
          }
          actions={
            <div className="flex items-center gap-4">
              {['initial', 'vetting', 'requirements'].map((s, i) => (
                <React.Fragment key={s}>
                  <div className={cn("flex items-center gap-3 transition-all duration-500", currentStep === s ? "opacity-100" : "opacity-30")}>
                    <div className={cn(
                      "w-8 h-8 rounded-xl flex items-center justify-center text-[10px] font-black shadow-sm",
                      currentStep === s ? "bg-indigo-600 text-white ring-4 ring-indigo-100" : "bg-gray-100 text-gray-400"
                    )}>
                      {i + 1}
                    </div>
                    <span className="text-[10px] font-black uppercase tracking-widest hidden sm:inline">{s}</span>
                  </div>
                  {i < 2 && <div className="h-px w-8 bg-gray-100" />}
                </React.Fragment>
              ))}
            </div>
          }
        />

        {currentStep === 'initial' && !isProcessing && (
          <Card className="border-none shadow-2xl shadow-indigo-100/50 rounded-[3rem] overflow-hidden bg-white">
            <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-20 text-white text-center">
              <div className="w-24 h-24 bg-white/20 rounded-[2rem] flex items-center justify-center mx-auto mb-10 backdrop-blur-md">
                <Calendar size={48} />
              </div>
              <h2 className="text-4xl font-black mb-6 tracking-tight">Ready to Analyse?</h2>
              <p className="text-indigo-100 mb-10 text-lg font-medium max-w-md mx-auto">We'll sync your calendars and identify which tasks can be moved to better align with your focus.</p>
              <Button onClick={runAnalysis} className="bg-white text-indigo-600 hover:bg-indigo-50 rounded-[2rem] px-16 py-10 text-2xl font-black shadow-2xl transition-all hover:scale-[1.02] active:scale-[0.98]">
                Analyse Calendar
              </Button>
            </div>
          </Card>
        )}

        {isProcessing && (
          <Card className="border-none shadow-sm rounded-[3rem] p-20 text-center bg-white">
            <div className="relative w-32 h-32 mx-auto mb-12">
              <div className="absolute inset-0 bg-indigo-100 rounded-full animate-ping opacity-20" />
              <div className="relative bg-white rounded-full p-6 shadow-xl">
                <RefreshCw className="text-indigo-600 animate-spin w-20 h-20" />
              </div>
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-4 tracking-tight">{statusText}</h2>
            <p className="text-gray-400 font-medium">This usually takes a few seconds...</p>
          </Card>
        )}

        {currentStep === 'vetting' && !isProcessing && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex items-center justify-between bg-white p-10 rounded-[2.5rem] border border-gray-100 shadow-sm">
              <div>
                <h2 className="text-2xl font-black text-gray-900">Vet Your Tasks</h2>
                <p className="text-sm text-gray-400 font-medium mt-1">Toggle tasks that are movable.</p>
              </div>
              <div className="flex gap-4">
                <Button variant="outline" onClick={runAIClassification} className="rounded-2xl px-8 h-14 font-black text-xs uppercase tracking-widest flex gap-3 border-indigo-100 text-indigo-600 hover:bg-indigo-50">
                  <BrainCircuit size={20} /> Ask AI to Vet
                </Button>
                <Button onClick={() => setCurrentStep('requirements')} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-10 h-14 font-black text-xs uppercase tracking-widest flex gap-3 shadow-xl shadow-indigo-100">
                  Next: Requirements <ChevronRight size={20} />
                </Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {events.map((event, i) => (
                <div key={i} className={cn(
                  "p-6 rounded-[2rem] border transition-all duration-300 flex items-center justify-between group",
                  event.is_locked 
                    ? "bg-white border-gray-100 opacity-70" 
                    : "bg-indigo-50/30 border-indigo-100 shadow-sm"
                )}>
                  <div className="flex items-center gap-6">
                    <div className={cn(
                      "w-14 h-14 rounded-2xl flex items-center justify-center transition-all",
                      event.is_locked ? "bg-gray-50 text-gray-400" : "bg-white text-indigo-600 shadow-md"
                    )}>
                      {event.is_locked ? <Lock size={24} /> : <Unlock size={24} />}
                    </div>
                    <div>
                      <h3 className="font-black text-xl text-gray-900">{event.title}</h3>
                      <p className="text-xs font-bold text-gray-400 uppercase tracking-widest mt-1">
                        {event.is_locked ? 'Fixed Event' : 'Movable Task'}
                      </p>
                    </div>
                  </div>
                  <Switch 
                    checked={!event.is_locked} 
                    onCheckedChange={() => toggleLock(event.event_id, event.is_locked)} 
                    className="data-[state=checked]:bg-indigo-600 scale-125" 
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 'requirements' && !isProcessing && (
          <Card className="border-none shadow-sm rounded-[3rem] overflow-hidden bg-white animate-in fade-in slide-in-from-bottom-4 duration-700">
            <CardHeader className="p-12 border-b border-gray-50">
              <CardTitle className="text-3xl font-black tracking-tight">Specify Requirements</CardTitle>
            </CardHeader>
            <CardContent className="p-12 space-y-12">
              <div className="space-y-8">
                <Label className="text-xl font-black flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                    <Calendar className="text-indigo-600" size={20} />
                  </div>
                  Allowed Days
                </Label>
                <div className="flex flex-wrap gap-4">
                  {DAYS.map((day) => (
                    <button 
                      key={day.value} 
                      onClick={() => toggleDay(day.value)} 
                      className={cn(
                        "px-8 py-4 rounded-2xl font-black text-sm uppercase tracking-widest transition-all border-2",
                        selectedDays.includes(day.value) 
                          ? "bg-indigo-600 border-indigo-600 text-white shadow-xl shadow-indigo-100" 
                          : "bg-white border-gray-100 text-gray-400 hover:border-indigo-100"
                      )}
                    >
                      {day.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-8 p-10 bg-indigo-50/50 rounded-[2.5rem] border border-indigo-100">
                <Label className="text-xl font-black flex items-center gap-3">
                  <div className="w-10 h-10 bg-white rounded-xl flex items-center justify-center shadow-sm">
                    <Inbox className="text-indigo-600" size={20} />
                  </div>
                  Surplus Handling
                </Label>
                <div className="space-y-6">
                  <p className="text-sm text-gray-500 font-bold leading-relaxed">If tasks exceed your daily limit, where should they go?</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    <div className="space-y-3">
                      <Label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Placeholder Day</Label>
                      <Input 
                        type="date" 
                        value={placeholderDate} 
                        onChange={(e) => setPlaceholderDate(e.target.value)}
                        className="h-14 rounded-2xl border-gray-200 font-black text-lg px-6 focus:ring-indigo-500"
                      />
                    </div>
                    <div className="flex items-end">
                      <div className="bg-white p-5 rounded-2xl border border-indigo-100 shadow-sm">
                        <p className="text-xs text-indigo-600 font-black leading-relaxed">
                          Surplus tasks will be stacked on this day for future shuffling.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-12">
                <div className="space-y-4">
                  <Label className="text-xl font-black flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                      <Clock className="text-indigo-600" size={20} />
                    </div>
                    Max Work Hours/Day
                  </Label>
                  <Input 
                    type="number" 
                    value={maxHoursOverride} 
                    onChange={(e) => setMaxHoursOverride(parseInt(e.target.value))} 
                    className="h-16 rounded-[1.5rem] border-gray-200 font-black text-2xl px-8 focus:ring-indigo-500" 
                  />
                </div>
                <div className="space-y-4">
                  <Label className="text-xl font-black flex items-center gap-3">
                    <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                      <ListOrdered className="text-indigo-600" size={20} />
                    </div>
                    Max Tasks/Day
                  </Label>
                  <Input 
                    type="number" 
                    value={maxTasksOverride} 
                    onChange={(e) => setMaxTasksOverride(parseInt(e.target.value))} 
                    className="h-16 rounded-[1.5rem] border-gray-200 font-black text-2xl px-8 focus:ring-indigo-500" 
                  />
                </div>
              </div>
              
              <Button 
                onClick={runOptimisation} 
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-[2rem] py-10 text-2xl font-black shadow-2xl shadow-indigo-100 transition-all hover:scale-[1.01] active:scale-[0.99]"
              >
                Generate Proposed Schedule
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
};

export default Optimise;