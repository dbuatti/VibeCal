"use client";

import React, { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Sparkles, RefreshCw, CheckCircle2, Calendar, Clock, Lock, Unlock, ArrowRight, Zap, Apple, Globe, ChevronRight, Settings2, ListOrdered, BrainCircuit, AlignLeft, Check, LayoutList, LayoutGrid, ChevronLeft, Briefcase, CheckSquare, Square, Inbox, Brain } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { format, nextSaturday } from 'date-fns';
import { cn } from '@/lib/utils';
import { useNavigate } from 'react-router-dom';

type Step = 'initial' | 'vetting' | 'requirements' | 'proposed' | 'applying';

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
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Schedule Optimiser</h1>
          <p className="text-lg text-gray-500">Align your movable tasks with your work window.</p>
          <div className="flex items-center gap-4 mt-8">
            {['initial', 'vetting', 'requirements'].map((s, i) => (
              <React.Fragment key={s}>
                <button onClick={() => setCurrentStep(s as Step)} disabled={isProcessing} className={cn("flex items-center gap-2 group transition-all", currentStep === s ? "opacity-100" : "opacity-40")}>
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold", currentStep === s ? "bg-indigo-600 text-white ring-4 ring-indigo-100" : "bg-gray-100 text-gray-400")}>{i + 1}</div>
                  <span className="text-sm font-bold">{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                </button>
                {i < 2 && <div className="h-px w-8 bg-gray-100" />}
              </React.Fragment>
            ))}
          </div>
        </div>

        {currentStep === 'initial' && !isProcessing && (
          <Card className="border-none shadow-2xl shadow-indigo-100/50 rounded-[2.5rem] overflow-hidden bg-white">
            <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-16 text-white text-center">
              <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-8 backdrop-blur-md"><Calendar size={40} /></div>
              <h2 className="text-3xl font-black mb-4">Ready to Analyse?</h2>
              <Button onClick={runAnalysis} className="bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl px-12 py-8 text-xl font-black shadow-xl">Analyse Calendar</Button>
            </div>
          </Card>
        )}

        {isProcessing && (
          <Card className="border-none shadow-sm rounded-[2.5rem] p-16 text-center bg-white">
            <RefreshCw className="text-indigo-600 animate-spin w-24 h-24 mx-auto mb-10" />
            <h2 className="text-3xl font-black text-gray-900 mb-4">{statusText}</h2>
          </Card>
        )}

        {currentStep === 'vetting' && !isProcessing && (
          <div className="space-y-8">
            <div className="flex items-center justify-between bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
              <div><h2 className="text-2xl font-bold text-gray-900">Vet Your Tasks</h2></div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={runAIClassification} className="rounded-xl px-6 h-12 font-bold flex gap-2 border-indigo-100 text-indigo-600 hover:bg-indigo-50"><BrainCircuit size={20} />Ask AI to Vet</Button>
                <Button onClick={() => setCurrentStep('requirements')} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 h-12 font-black flex gap-3 shadow-lg shadow-indigo-100">Next: Requirements <ChevronRight size={20} /></Button>
              </div>
            </div>
            <div className="grid grid-cols-1 gap-4">
              {events.map((event, i) => (
                <div key={i} className={cn("p-5 rounded-[1.5rem] border transition-all duration-300 flex items-center justify-between", event.is_locked ? "bg-white border-gray-100 opacity-80" : "bg-indigo-50/30 border-indigo-100 shadow-sm")}>
                  <div className="flex items-center gap-5">
                    <div className={cn("w-12 h-12 rounded-2xl flex items-center justify-center", event.is_locked ? "bg-gray-50 text-gray-400" : "bg-white text-indigo-600 shadow-sm")}>{event.is_locked ? <Lock size={20} /> : <Unlock size={20} />}</div>
                    <div><h3 className="font-bold text-lg">{event.title}</h3></div>
                  </div>
                  <Switch checked={!event.is_locked} onCheckedChange={() => toggleLock(event.event_id, event.is_locked)} className="data-[state=checked]:bg-indigo-600" />
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 'requirements' && !isProcessing && (
          <Card className="border-none shadow-sm rounded-[2rem] overflow-hidden bg-white">
            <CardHeader className="p-10 border-b border-gray-50"><CardTitle className="text-2xl font-bold">Specify Requirements</CardTitle></CardHeader>
            <CardContent className="p-10 space-y-10">
              <div className="space-y-6">
                <Label className="text-lg font-bold flex items-center gap-2"><Calendar className="text-indigo-600" size={20} />Allowed Days</Label>
                <div className="flex flex-wrap gap-3">
                  {DAYS.map((day) => (
                    <button key={day.value} onClick={() => toggleDay(day.value)} className={cn("px-6 py-3 rounded-xl font-bold transition-all border-2", selectedDays.includes(day.value) ? "bg-indigo-600 border-indigo-600 text-white shadow-lg" : "bg-white border-gray-100 text-gray-400")}>{day.label}</button>
                  ))}
                </div>
              </div>

              <div className="space-y-6 p-6 bg-indigo-50/50 rounded-3xl border border-indigo-100">
                <Label className="text-lg font-bold flex items-center gap-2"><Inbox className="text-indigo-600" size={20} />Surplus Handling</Label>
                <div className="space-y-4">
                  <p className="text-sm text-gray-500 font-medium">If tasks exceed your daily limit, where should they go?</p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label className="text-xs font-bold text-gray-400 uppercase">Placeholder Day</Label>
                      <Input 
                        type="date" 
                        value={placeholderDate} 
                        onChange={(e) => setPlaceholderDate(e.target.value)}
                        className="h-12 rounded-xl border-gray-200 font-bold"
                      />
                    </div>
                    <div className="flex items-end">
                      <p className="text-xs text-indigo-600 font-bold bg-white p-3 rounded-xl border border-indigo-100">
                        Surplus tasks will be stacked on this day for future shuffling.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <Label className="text-lg font-bold flex items-center gap-2"><Clock className="text-indigo-600" size={20} />Max Work Hours/Day</Label>
                  <Input type="number" value={maxHoursOverride} onChange={(e) => setMaxHoursOverride(parseInt(e.target.value))} className="h-14 rounded-2xl border-gray-200 font-bold text-lg" />
                </div>
                <div className="space-y-4">
                  <Label className="text-lg font-bold flex items-center gap-2"><ListOrdered className="text-indigo-600" size={20} />Max Tasks/Day</Label>
                  <Input type="number" value={maxTasksOverride} onChange={(e) => setMaxTasksOverride(parseInt(e.target.value))} className="h-14 rounded-2xl border-gray-200 font-bold text-lg" />
                </div>
              </div>
              <Button onClick={runOptimisation} className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl h-14 font-black text-lg shadow-xl">Generate Proposed Schedule</Button>
            </CardContent>
          </Card>
        )}
      </div>
    </Layout>
  );
};

export default Optimise;