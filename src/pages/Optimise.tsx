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
import { Sparkles, RefreshCw, CheckCircle2, Calendar, Clock, Lock, Unlock, ArrowRight, Zap, Apple, Globe, ChevronRight, Settings2, ListOrdered, BrainCircuit, AlignLeft, Check, LayoutList, LayoutGrid, ChevronLeft, Briefcase } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import VisualSchedule from '@/components/VisualSchedule';

type Step = 'initial' | 'vetting' | 'requirements' | 'proposed' | 'applying';

const DAYS = [
  { label: 'Sun', value: 0 }, { label: 'Mon', value: 1 }, { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 }, { label: 'Thu', value: 4 }, { label: 'Fri', value: 5 }, { label: 'Sat', value: 6 },
];

const Optimise = () => {
  const [currentStep, setCurrentStep] = useState<Step>('initial');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [optimisationResult, setOptimisationResult] = useState<any>(null);
  const [appliedChanges, setAppliedChanges] = useState<string[]>([]);
  const [selectedChanges, setSelectedChanges] = useState<string[]>([]);
  
  const [durationOverride, setDurationOverride] = useState<string>("original");
  const [maxTasksOverride, setMaxTasksOverride] = useState<number>(5);
  const [slotAlignment, setSlotAlignment] = useState<string>("15");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);

  const toggleDay = (day: number) => {
    setSelectedDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const runAnalysis = async () => {
    setIsProcessing(true);
    setProgress(0);
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

  const toggleLock = async (eventId: string, currentStatus: boolean, taskName: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
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
      const { data, error } = await supabase.functions.invoke('optimise-schedule', {
        body: { durationOverride: durationOverride === "original" ? null : parseInt(durationOverride), maxTasksOverride, slotAlignment: parseInt(slotAlignment), selectedDays }
      });
      if (error) throw error;
      setOptimisationResult(data);
      setAppliedChanges([]);
      setSelectedChanges(data.changes.map((c: any) => c.event_id)); // Select all by default
      setCurrentStep('proposed');
      showSuccess("Optimisation complete!");
    } catch (err: any) { showError(err.message); }
    finally { setIsProcessing(false); }
  };

  const applySingleChange = async (change: any) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();
      const eventInCache = events.find(e => e.event_id === change.event_id);
      if (!eventInCache) throw new Error("Event not found");

      await supabase.functions.invoke('push-to-provider', {
        body: { eventId: change.event_id, provider: eventInCache.provider, calendarId: eventInCache.source_calendar_id, startTime: change.new_start, endTime: change.new_end, googleAccessToken: session?.provider_token }
      });

      await supabase.from('calendar_events_cache').update({ start_time: change.new_start, end_time: change.new_end, duration_minutes: change.duration, last_synced_at: new Date().toISOString() }).eq('event_id', change.event_id);
      setAppliedChanges(prev => [...prev, change.event_id]);
      showSuccess(`Synced: ${change.title}`);
    } catch (err: any) { showError(err.message); }
  };

  const applySelectedChanges = async () => {
    if (!optimisationResult?.changes) return;
    setIsProcessing(true);
    setCurrentStep('applying');
    try {
      const toApply = optimisationResult.changes.filter((c: any) => selectedChanges.includes(c.event_id) && !appliedChanges.includes(c.event_id));
      for (const change of toApply) { await applySingleChange(change); }
      showSuccess("Selected changes synced!");
      setCurrentStep('initial');
      setOptimisationResult(null);
    } catch (err: any) { showError(err.message); setCurrentStep('proposed'); }
    finally { setIsProcessing(false); }
  };

  const toggleSelection = (id: string) => {
    setSelectedChanges(prev => prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]);
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Schedule Optimiser</h1>
          <p className="text-lg text-gray-500">Align your movable tasks with your work window.</p>
          <div className="flex items-center gap-4 mt-8">
            {['initial', 'vetting', 'requirements', 'proposed'].map((s, i) => (
              <React.Fragment key={s}>
                <button onClick={() => setCurrentStep(s as Step)} disabled={isProcessing} className={cn("flex items-center gap-2 group transition-all", currentStep === s ? "opacity-100" : "opacity-40")}>
                  <div className={cn("w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold", currentStep === s ? "bg-indigo-600 text-white ring-4 ring-indigo-100" : "bg-gray-100 text-gray-400")}>{i + 1}</div>
                  <span className="text-sm font-bold">{s.charAt(0).toUpperCase() + s.slice(1)}</span>
                </button>
                {i < 3 && <div className="h-px w-8 bg-gray-100" />}
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

        {isProcessing && currentStep !== 'applying' && (
          <Card className="border-none shadow-sm rounded-[2.5rem] p-16 text-center bg-white">
            <RefreshCw className="text-indigo-600 animate-spin w-24 h-24 mx-auto mb-10" />
            <h2 className="text-3xl font-black text-gray-900 mb-4">{statusText}</h2>
          </Card>
        )}

        {currentStep === 'vetting' && (
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
                  <Switch checked={!event.is_locked} onCheckedChange={() => toggleLock(event.event_id, event.is_locked, event.title)} className="data-[state=checked]:bg-indigo-600" />
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 'requirements' && (
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                <div className="space-y-4">
                  <Label className="text-lg font-bold flex items-center gap-2"><Clock className="text-indigo-600" size={20} />Duration Override</Label>
                  <Select value={durationOverride} onValueChange={setDurationOverride}>
                    <SelectTrigger className="h-14 rounded-2xl border-gray-200 font-bold"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="original">Keep Original</SelectItem>
                      <SelectItem value="30">30m Blocks</SelectItem>
                      <SelectItem value="60">60m Blocks</SelectItem>
                    </SelectContent>
                  </Select>
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

        {currentStep === 'proposed' && optimisationResult && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Proposed Schedule</h2>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setCurrentStep('requirements')} className="rounded-xl border-gray-200">Adjust Requirements</Button>
              </div>
            </div>

            <Tabs defaultValue="list" className="w-full">
              <TabsList className="bg-gray-100 p-1 rounded-2xl mb-8">
                <TabsTrigger value="list" className="rounded-xl px-6 py-2 data-[state=active]:bg-white flex gap-2"><LayoutList size={18} />List View</TabsTrigger>
                <TabsTrigger value="visual" className="rounded-xl px-6 py-2 data-[state=active]:bg-white flex gap-2"><LayoutGrid size={18} />Visual Timeline</TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="space-y-4">
                {optimisationResult.changes.map((change: any, i: number) => {
                  const isApplied = appliedChanges.includes(change.event_id);
                  const isSelected = selectedChanges.includes(change.event_id);
                  return (
                    <Card key={i} className={cn("border-none shadow-sm bg-white rounded-2xl overflow-hidden group transition-all", isApplied && "opacity-50 grayscale")}>
                      <div className="flex flex-col md:flex-row">
                        <div className="p-6 flex-1 flex items-center gap-4">
                          <Checkbox checked={isSelected} onCheckedChange={() => toggleSelection(change.event_id)} disabled={isApplied} className="w-6 h-6 rounded-lg border-2 border-indigo-100 data-[state=checked]:bg-indigo-600" />
                          <div className="flex-1">
                            <div className="flex items-center gap-3 mb-2">
                              <h3 className="font-bold text-gray-900 text-lg">{change.title}</h3>
                              {change.is_work && <Badge variant="secondary" className="bg-amber-50 text-amber-700 border-amber-100 flex gap-1 items-center"><Briefcase size={10} /> Work</Badge>}
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                              <div><p className="text-[10px] font-bold text-gray-400 uppercase">Current</p><p className="text-sm font-medium text-gray-500 line-through">{format(new Date(change.old_start), 'MMM d, HH:mm')}</p></div>
                              <div><p className="text-[10px] font-bold text-indigo-400 uppercase">Proposed</p><p className="text-sm font-bold text-indigo-600">{format(new Date(change.new_start), 'MMM d, HH:mm')} → {format(new Date(change.new_end), 'HH:mm')}</p></div>
                            </div>
                          </div>
                        </div>
                        <div className="bg-indigo-50/50 px-6 py-4 md:w-48 flex flex-col justify-center items-center gap-3 border-t md:border-t-0 md:border-l border-indigo-100/50">
                          <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm"><Clock size={14} />{change.duration}m</div>
                          {isApplied && <Badge className="bg-green-500 text-white border-none">Synced</Badge>}
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </TabsContent>
              <TabsContent value="visual"><VisualSchedule events={events} changes={optimisationResult.changes} appliedChanges={appliedChanges} /></TabsContent>
            </Tabs>
            
            <div className="bg-indigo-600 p-10 rounded-[3rem] text-white shadow-2xl shadow-indigo-200 mt-10">
              <h3 className="text-3xl font-black mb-2">Ready to align?</h3>
              <p className="opacity-80 text-lg mb-8">{selectedChanges.filter(id => !appliedChanges.includes(id)).length} tasks selected for sync.</p>
              <Button onClick={applySelectedChanges} disabled={selectedChanges.filter(id => !appliedChanges.includes(id)).length === 0} className="w-full bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl py-8 text-xl font-black shadow-xl transition-all hover:scale-[1.01]">Sync Selected Changes</Button>
            </div>
          </div>
        )}

        {currentStep === 'applying' && (
          <Card className="border-none shadow-sm rounded-[2.5rem] p-16 text-center bg-white">
            <RefreshCw className="text-indigo-600 animate-spin w-24 h-24 mx-auto mb-8" />
            <h2 className="text-3xl font-black text-gray-900 mb-4">Syncing with Provider...</h2>
          </Card>
        )}
      </div>
    </Layout>
  );
};

export default Optimise;