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
import { Sparkles, RefreshCw, CheckCircle2, Calendar, Clock, Lock, Unlock, ArrowRight, Zap, Apple, Globe, ChevronRight, Settings2, ListOrdered, BrainCircuit, AlignLeft, Check, LayoutList, LayoutGrid } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';
import VisualSchedule from '@/components/VisualSchedule';

type Step = 'initial' | 'vetting' | 'requirements' | 'proposed' | 'applying';

const DAYS = [
  { label: 'Sun', value: 0 },
  { label: 'Mon', value: 1 },
  { label: 'Tue', value: 2 },
  { label: 'Wed', value: 3 },
  { label: 'Thu', value: 4 },
  { label: 'Fri', value: 5 },
  { label: 'Sat', value: 6 },
];

const Optimise = () => {
  const [currentStep, setCurrentStep] = useState<Step>('initial');
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');
  const [events, setEvents] = useState<any[]>([]);
  const [optimisationResult, setOptimisationResult] = useState<any>(null);
  const [appliedChanges, setAppliedChanges] = useState<string[]>([]);
  
  // Requirements state
  const [durationOverride, setDurationOverride] = useState<string>("original");
  const [maxTasksOverride, setMaxTasksOverride] = useState<number>(5);
  const [slotAlignment, setSlotAlignment] = useState<string>("15");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]); // Default Mon-Fri

  const toggleDay = (day: number) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  // Step 1: Analyse Calendar
  const runAnalysis = async () => {
    setIsProcessing(true);
    setProgress(0);
    setStatusText('Syncing Google Calendar...');
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.provider_token) {
        await supabase.functions.invoke('sync-calendar', {
          body: { googleAccessToken: session.provider_token }
        });
      }

      setProgress(40);
      setStatusText('Syncing Apple Calendar...');
      await supabase.functions.invoke('sync-apple-calendar');

      setProgress(80);
      setStatusText('Fetching events...');
      const { data: fetchedEvents } = await supabase
        .from('calendar_events_cache')
        .select('*')
        .order('start_time', { ascending: true });

      setEvents(fetchedEvents || []);
      setCurrentStep('vetting');
      showSuccess('Calendar analysed! Please vet your tasks.');
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 2: Vet Tasks (Lock/Unlock)
  const toggleLock = async (eventId: string, currentStatus: boolean, taskName: string) => {
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { error: cacheError } = await supabase
        .from('calendar_events_cache')
        .update({ is_locked: !currentStatus })
        .eq('event_id', eventId);

      if (cacheError) throw cacheError;

      await supabase
        .from('task_classification_feedback')
        .upsert({ 
          user_id: user.id, 
          task_name: taskName, 
          is_movable: currentStatus 
        }, { onConflict: 'user_id, task_name' });

      setEvents(events.map(e => e.event_id === eventId ? { ...e, is_locked: !currentStatus } : e));
    } catch (err: any) {
      showError("Failed to update lock status");
    }
  };

  const runAIClassification = async () => {
    setIsProcessing(true);
    setStatusText('AI is learning your preferences...');
    try {
      const { data: settings } = await supabase.from('user_settings').select('movable_keywords').single();
      const taskTitles = events.map(e => e.title);
      
      const { data, error } = await supabase.functions.invoke('classify-tasks', {
        body: { tasks: taskTitles, movableKeywords: settings?.movable_keywords || [] }
      });

      if (error) throw error;

      const updatedEvents = [...events];
      for (let i = 0; i < updatedEvents.length; i++) {
        const isMovable = data.classifications[i];
        updatedEvents[i].is_locked = !isMovable;
        
        await supabase
          .from('calendar_events_cache')
          .update({ is_locked: !isMovable })
          .eq('event_id', updatedEvents[i].event_id);
      }
      
      setEvents(updatedEvents);
      showSuccess("AI has updated your task classifications!");
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 3: Run Optimisation
  const runOptimisation = async () => {
    if (selectedDays.length === 0) {
      showError("Please select at least one day for scheduling.");
      return;
    }

    setIsProcessing(true);
    setProgress(0);
    setStatusText('Calculating optimal alignment...');
    
    try {
      const { data, error } = await supabase.functions.invoke('optimise-schedule', {
        body: { 
          durationOverride: durationOverride === "original" ? null : parseInt(durationOverride),
          maxTasksOverride: maxTasksOverride,
          slotAlignment: parseInt(slotAlignment),
          selectedDays: selectedDays
        }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setOptimisationResult(data);
      setAppliedChanges([]);
      setCurrentStep('proposed');
      showSuccess("Optimisation complete!");
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // Step 4: Apply Single Change
  const applySingleChange = async (change: any) => {
    console.log("[Optimise] Applying change and pushing to provider:", change.title);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      const { data: { session } } = await supabase.auth.getSession();
      if (!user) throw new Error("User not found");

      // 1. Find the event in cache to get provider info
      const eventInCache = events.find(e => e.event_id === change.event_id);
      if (!eventInCache) throw new Error("Event not found in cache");

      // 2. Push to Provider
      const { error: pushError } = await supabase.functions.invoke('push-to-provider', {
        body: {
          eventId: change.event_id,
          provider: eventInCache.provider,
          calendarId: eventInCache.source_calendar_id,
          startTime: change.new_start,
          endTime: change.new_end,
          googleAccessToken: session?.provider_token
        }
      });

      if (pushError) throw pushError;

      // 3. Update Local Cache
      await supabase
        .from('calendar_events_cache')
        .update({
          start_time: change.new_start,
          end_time: change.new_end,
          duration_minutes: change.duration,
          last_synced_at: new Date().toISOString()
        })
        .eq('event_id', change.event_id)
        .eq('user_id', user.id);

      setAppliedChanges(prev => [...prev, change.event_id]);
      showSuccess(`Synced: ${change.title}`);
    } catch (err: any) {
      console.error("[Optimise] applySingleChange failed:", err);
      showError(err.message);
    }
  };

  const applyAllChanges = async () => {
    if (!optimisationResult?.changes) return;
    
    setIsProcessing(true);
    setCurrentStep('applying');
    try {
      const pendingChanges = optimisationResult.changes.filter((c: any) => !appliedChanges.includes(c.event_id));
      
      for (const change of pendingChanges) {
        await applySingleChange(change);
      }

      showSuccess("All changes synced to your calendar!");
      setCurrentStep('initial');
      setOptimisationResult(null);
    } catch (err: any) {
      showError(err.message);
      setCurrentStep('proposed');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="mb-12">
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Schedule Optimiser</h1>
          <p className="text-lg text-gray-500">Align your movable tasks with your work window.</p>
          
          <div className="flex items-center gap-4 mt-8">
            {['Analyse', 'Vet', 'Requirements', 'Proposed'].map((s, i) => {
              const steps: Step[] = ['initial', 'vetting', 'requirements', 'proposed'];
              const isActive = steps.indexOf(currentStep) >= i;
              return (
                <React.Fragment key={s}>
                  <div className="flex items-center gap-2">
                    <div className={cn(
                      "w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold transition-colors",
                      isActive ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-400"
                    )}>
                      {i + 1}
                    </div>
                    <span className={cn("text-sm font-bold", isActive ? "text-gray-900" : "text-gray-400")}>{s}</span>
                  </div>
                  {i < 3 && <div className="h-px w-8 bg-gray-100" />}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {currentStep === 'initial' && !isProcessing && (
          <Card className="border-none shadow-2xl shadow-indigo-100/50 rounded-[2.5rem] overflow-hidden bg-white">
            <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-16 text-white text-center">
              <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-8 backdrop-blur-md">
                <Calendar size={40} />
              </div>
              <h2 className="text-3xl font-black mb-4">Ready to Analyse?</h2>
              <p className="text-indigo-100 text-lg max-w-md mx-auto mb-10">
                We'll pull in your latest events from Google and Apple to start the optimisation process.
              </p>
              <Button 
                onClick={runAnalysis}
                className="bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl px-12 py-8 text-xl font-black shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
              >
                Analyse Calendar
              </Button>
            </div>
          </Card>
        )}

        {isProcessing && currentStep !== 'applying' && (
          <Card className="border-none shadow-sm rounded-[2.5rem] p-16 text-center bg-white">
            <div className="relative w-24 h-24 mx-auto mb-10">
              <RefreshCw className="text-indigo-600 animate-spin w-full h-full" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="text-indigo-600" size={32} />
              </div>
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-4">{statusText}</h2>
            <div className="max-w-md mx-auto">
              <Progress value={progress} className="h-4 bg-gray-100 mb-4 rounded-full" />
              <p className="text-gray-500 font-bold text-lg">{progress}% Complete</p>
            </div>
          </Card>
        )}

        {currentStep === 'vetting' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm">
              <div>
                <h2 className="text-2xl font-bold text-gray-900">Vet Your Tasks</h2>
                <p className="text-gray-500 font-medium">Unlock tasks you want the AI to redistribute.</p>
              </div>
              <div className="flex gap-3">
                <Button 
                  variant="outline"
                  onClick={runAIClassification}
                  className="rounded-xl px-6 h-12 font-bold flex gap-2 border-indigo-100 text-indigo-600 hover:bg-indigo-50"
                >
                  <BrainCircuit size={20} />
                  Ask AI to Vet
                </Button>
                <Button 
                  onClick={() => setCurrentStep('requirements')}
                  className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 h-12 font-black flex gap-3 shadow-lg shadow-indigo-100"
                >
                  Next: Requirements
                  <ChevronRight size={20} />
                </Button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-4">
              {events.map((event, i) => (
                <div 
                  key={i} 
                  className={cn(
                    "p-5 rounded-[1.5rem] border transition-all duration-300 flex items-center justify-between group",
                    event.is_locked 
                      ? "bg-white border-gray-100 opacity-80" 
                      : "bg-indigo-50/30 border-indigo-100 shadow-sm"
                  )}
                >
                  <div className="flex items-center gap-5">
                    <div className={cn(
                      "w-12 h-12 rounded-2xl flex items-center justify-center transition-colors",
                      event.is_locked ? "bg-gray-50 text-gray-400" : "bg-white text-indigo-600 shadow-sm"
                    )}>
                      {event.is_locked ? <Lock size={20} /> : <Unlock size={20} />}
                    </div>
                    <div>
                      <h3 className={cn("font-bold text-lg", event.is_locked ? "text-gray-500" : "text-gray-900")}>
                        {event.title}
                      </h3>
                      <div className="flex items-center gap-2 text-gray-400 mt-0.5 font-medium text-sm">
                        <span className="flex items-center gap-1">
                          {event.provider === 'google' ? <Globe size={12} className="text-blue-400" /> : <Apple size={12} className="text-gray-400" />}
                          {event.source_calendar}
                        </span>
                        <span className="w-1 h-1 bg-gray-200 rounded-full" />
                        <span>{format(new Date(event.start_time), 'MMM d, HH:mm')}</span>
                        <span className="w-1 h-1 bg-gray-200 rounded-full" />
                        <span className="flex items-center gap-1">
                          <Clock size={12} />
                          {event.duration_minutes}m
                        </span>
                      </div>
                    </div>
                  </div>
                  <Switch 
                    checked={!event.is_locked} 
                    onCheckedChange={() => toggleLock(event.event_id, event.is_locked, event.title)}
                    className="data-[state=checked]:bg-indigo-600"
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {currentStep === 'requirements' && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <Card className="border-none shadow-sm rounded-[2rem] overflow-hidden bg-white">
              <CardHeader className="p-10 border-b border-gray-50">
                <CardTitle className="text-2xl font-bold">Specify Requirements</CardTitle>
                <p className="text-gray-500">Set the rules for your new schedule.</p>
              </CardHeader>
              <CardContent className="p-10 space-y-10">
                <div className="space-y-6">
                  <Label className="text-lg font-bold flex items-center gap-2">
                    <Calendar className="text-indigo-600" size={20} />
                    Allowed Scheduling Days
                  </Label>
                  <div className="flex flex-wrap gap-3">
                    {DAYS.map((day) => (
                      <button
                        key={day.value}
                        onClick={() => toggleDay(day.value)}
                        className={cn(
                          "px-6 py-3 rounded-xl font-bold transition-all border-2",
                          selectedDays.includes(day.value)
                            ? "bg-indigo-600 border-indigo-600 text-white shadow-lg shadow-indigo-100"
                            : "bg-white border-gray-100 text-gray-400 hover:border-indigo-100"
                        )}
                      >
                        {day.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-10">
                  <div className="space-y-4">
                    <Label className="text-lg font-bold flex items-center gap-2">
                      <Clock className="text-indigo-600" size={20} />
                      Task Duration Override
                    </Label>
                    <Select value={durationOverride} onValueChange={setDurationOverride}>
                      <SelectTrigger className="h-14 rounded-2xl border-gray-200 font-bold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="original">Keep Original Durations</SelectItem>
                        <SelectItem value="15">15 Minute Blocks</SelectItem>
                        <SelectItem value="30">30 Minute Blocks</SelectItem>
                        <SelectItem value="45">45 Minute Blocks</SelectItem>
                        <SelectItem value="60">60 Minute Blocks</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-lg font-bold flex items-center gap-2">
                      <AlignLeft className="text-indigo-600" size={20} />
                      Slot Alignment
                    </Label>
                    <Select value={slotAlignment} onValueChange={setSlotAlignment}>
                      <SelectTrigger className="h-14 rounded-2xl border-gray-200 font-bold">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="1">No Alignment (Freeform)</SelectItem>
                        <SelectItem value="15">Every 15 Minutes</SelectItem>
                        <SelectItem value="30">Every 30 Minutes</SelectItem>
                        <SelectItem value="60">On the Hour (60m)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-4">
                    <Label className="text-lg font-bold flex items-center gap-2">
                      <ListOrdered className="text-indigo-600" size={20} />
                      Max Tasks Per Day
                    </Label>
                    <Input 
                      type="number" 
                      value={maxTasksOverride}
                      onChange={(e) => setMaxTasksOverride(parseInt(e.target.value))}
                      className="h-14 rounded-2xl border-gray-200 font-bold text-lg"
                    />
                  </div>
                </div>

                <div className="flex gap-4 pt-6">
                  <Button variant="outline" onClick={() => setCurrentStep('vetting')} className="rounded-xl h-14 px-8">
                    Back
                  </Button>
                  <Button 
                    onClick={runOptimisation}
                    className="flex-1 bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl h-14 font-black text-lg shadow-xl shadow-indigo-100"
                  >
                    Generate Proposed Schedule
                  </Button>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {currentStep === 'proposed' && optimisationResult && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Proposed Schedule</h2>
              <Button variant="outline" onClick={() => setCurrentStep('requirements')} className="rounded-xl border-gray-200">
                Adjust Requirements
              </Button>
            </div>

            <Tabs defaultValue="list" className="w-full">
              <TabsList className="bg-gray-100 p-1 rounded-2xl mb-8">
                <TabsTrigger value="list" className="rounded-xl px-6 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm flex gap-2">
                  <LayoutList size={18} />
                  List View
                </TabsTrigger>
                <TabsTrigger value="visual" className="rounded-xl px-6 py-2 data-[state=active]:bg-white data-[state=active]:shadow-sm flex gap-2">
                  <LayoutGrid size={18} />
                  Visual Timeline
                </TabsTrigger>
              </TabsList>

              <TabsContent value="list" className="space-y-4">
                {optimisationResult.changes.map((change: any, i: number) => {
                  const isApplied = appliedChanges.includes(change.event_id);
                  return (
                    <Card key={i} className={cn(
                      "border-none shadow-sm bg-white rounded-2xl overflow-hidden group transition-all",
                      isApplied && "opacity-50 grayscale"
                    )}>
                      <div className="flex flex-col md:flex-row">
                        <div className="p-6 flex-1">
                          <div className="flex items-center gap-3 mb-4">
                            <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                              <Calendar className="text-indigo-600" size={20} />
                            </div>
                            <h3 className="font-bold text-gray-900 text-lg">{change.title}</h3>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                            <div>
                              <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Current</p>
                              <p className="text-sm font-medium text-gray-500 line-through">{format(new Date(change.old_start), 'MMM d, HH:mm')}</p>
                            </div>
                            <div>
                              <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Proposed</p>
                              <p className="text-sm font-bold text-indigo-600">{format(new Date(change.new_start), 'MMM d, HH:mm')} → {format(new Date(change.new_end), 'HH:mm')}</p>
                            </div>
                          </div>
                        </div>
                        <div className="bg-indigo-50/50 px-6 py-4 md:w-64 flex flex-col justify-center items-center gap-3 border-t md:border-t-0 md:border-l border-indigo-100/50">
                          <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm">
                            <Clock size={14} />
                            {change.old_duration !== change.duration ? (
                              <span className="flex items-center gap-1">
                                <span className="line-through opacity-50">{change.old_duration}m</span>
                                <ArrowRight size={10} />
                                {change.duration}m
                              </span>
                            ) : (
                              <span>{change.duration}m</span>
                            )}
                          </div>
                          <Button 
                            size="sm" 
                            disabled={isApplied}
                            onClick={() => applySingleChange(change)}
                            className={cn(
                              "w-full rounded-xl font-bold",
                              isApplied ? "bg-green-500 text-white" : "bg-white text-indigo-600 border border-indigo-100 hover:bg-indigo-600 hover:text-white"
                            )}
                          >
                            {isApplied ? <Check size={16} className="mr-2" /> : <Sparkles size={14} className="mr-2" />}
                            {isApplied ? 'Synced' : 'Sync to Calendar'}
                          </Button>
                        </div>
                      </div>
                    </Card>
                  );
                })}
              </TabsContent>

              <TabsContent value="visual">
                <VisualSchedule 
                  events={events} 
                  changes={optimisationResult.changes} 
                  appliedChanges={appliedChanges}
                />
              </TabsContent>
            </Tabs>
            
            <div className="bg-indigo-600 p-10 rounded-[3rem] text-white shadow-2xl shadow-indigo-200 mt-10">
              <h3 className="text-3xl font-black mb-2">Ready to align?</h3>
              <p className="opacity-80 text-lg mb-8">
                {optimisationResult.changes.length - appliedChanges.length} pending changes remaining.
              </p>
              <Button 
                onClick={applyAllChanges}
                disabled={optimisationResult.changes.length === appliedChanges.length}
                className="w-full bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl py-8 text-xl font-black shadow-xl transition-all hover:scale-[1.01]"
              >
                Sync All Remaining Changes
              </Button>
            </div>
          </div>
        )}

        {currentStep === 'applying' && (
          <Card className="border-none shadow-sm rounded-[2.5rem] p-16 text-center bg-white">
            <div className="w-24 h-24 bg-indigo-50 rounded-full flex items-center justify-center mx-auto mb-8">
              <RefreshCw className="text-indigo-600 animate-spin" size={48} />
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-4">Syncing with Provider...</h2>
            <p className="text-gray-500 text-lg">Updating your calendar events. Please wait.</p>
          </Card>
        )}
      </div>
    </Layout>
  );
};

export default Optimise;