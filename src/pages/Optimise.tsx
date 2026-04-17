import React, { useState, useEffect } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Sparkles, RefreshCw, CheckCircle2, Calendar, Clock, Lock, Unlock, Bug, ArrowRight, Zap, Apple, Info, Globe, ChevronRight, Settings2 } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { format } from 'date-fns';
import { cn } from '@/lib/utils';

const Optimise = () => {
  const [isOptimising, setIsOptimising] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [syncReport, setSyncReport] = useState<any>(null);
  const [optimisationResult, setOptimisationResult] = useState<any>(null);
  const [isReviewing, setIsReviewing] = useState(false);
  const [isApplying, setIsApplying] = useState(false);
  const [events, setEvents] = useState<any[]>([]);
  
  // New state for pre-optimisation settings
  const [durationOverride, setDurationOverride] = useState<string>("original");

  const fetchEventsAndReview = async (providerLabel: string) => {
    setStep('Preparing review list...');
    setProgress(90);
    const { data: fetchedEvents, error: fetchError } = await supabase
      .from('calendar_events_cache')
      .select('*')
      .order('start_time', { ascending: true });

    if (fetchError) throw fetchError;

    setEvents(fetchedEvents || []);
    setSyncReport({
      total: fetchedEvents?.length || 0,
      googleCount: fetchedEvents?.filter(e => e.provider === 'google').length || 0,
      appleCount: fetchedEvents?.filter(e => e.provider === 'apple').length || 0,
    });

    setIsReviewing(true);
    setProgress(100);
    showSuccess(`${providerLabel} synced! Please review your tasks.`);
  };

  const runFullAlignment = async () => {
    setIsOptimising(true);
    setProgress(0);
    setSyncReport(null);
    setOptimisationResult(null);
    setIsReviewing(false);
    
    try {
      setStep('Syncing Google Calendar...');
      setProgress(10);
      const { data: { session } } = await supabase.auth.getSession();
      const providerToken = session?.provider_token;

      if (providerToken) {
        await supabase.functions.invoke('sync-calendar', {
          body: { googleAccessToken: providerToken }
        });
      }

      setProgress(40);
      setStep('Syncing Apple Calendar...');
      await supabase.functions.invoke('sync-apple-calendar');

      await fetchEventsAndReview('All Calendars');
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsOptimising(false);
    }
  };

  const toggleLock = async (eventId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('calendar_events_cache')
        .update({ is_locked: !currentStatus })
        .eq('event_id', eventId);

      if (error) throw error;

      setEvents(events.map(e => e.event_id === eventId ? { ...e, is_locked: !currentStatus } : e));
    } catch (err: any) {
      showError("Failed to update lock status");
    }
  };

  const runOptimisation = async () => {
    setIsOptimising(true);
    setProgress(0);
    setStep('Calculating optimal alignment...');
    setIsReviewing(false);
    
    try {
      const { data, error } = await supabase.functions.invoke('optimise-schedule', {
        body: { 
          durationOverride: durationOverride === "original" ? null : parseInt(durationOverride) 
        }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setOptimisationResult(data);
      setProgress(100);
      showSuccess("Optimisation complete!");
    } catch (err: any) {
      showError(err.message);
      setIsReviewing(true);
    } finally {
      setIsOptimising(false);
    }
  };

  const applyChanges = async () => {
    if (!optimisationResult?.changes) return;
    
    setIsApplying(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error("User not found");

      for (const change of optimisationResult.changes) {
        const { error } = await supabase
          .from('calendar_events_cache')
          .update({
            start_time: change.new_start,
            end_time: change.new_end,
            duration_minutes: change.duration,
            last_synced_at: new Date().toISOString()
          })
          .eq('event_id', change.event_id)
          .eq('user_id', user.id);
        
        if (error) throw error;
      }

      showSuccess("Schedule updated successfully!");
      setOptimisationResult(null);
      setSyncReport(null);
      setIsReviewing(false);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsApplying(false);
    }
  };

  return (
    <Layout>
      <div className="max-w-4xl mx-auto">
        <div className="flex justify-between items-start mb-12">
          <div className="text-left">
            <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mb-6">
              <Sparkles className="text-indigo-600" size={32} />
            </div>
            <h1 className="text-4xl font-bold text-gray-900 mb-2">Schedule Optimiser</h1>
            <p className="text-lg text-gray-500">Align your movable tasks with your work window.</p>
          </div>
        </div>

        {/* INITIAL STATE */}
        {!isOptimising && !isReviewing && !optimisationResult && (
          <div className="space-y-8">
            <Card className="border-none shadow-2xl shadow-indigo-100/50 rounded-[2.5rem] overflow-hidden bg-white">
              <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-12 text-white text-center">
                <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-8 backdrop-blur-md">
                  <Zap size={40} />
                </div>
                <h2 className="text-3xl font-black mb-4">Full Schedule Alignment</h2>
                <p className="text-indigo-100 text-lg max-w-md mx-auto mb-10">
                  Sync both Google and Apple calendars, then manually review which tasks should be movable.
                </p>
                <Button 
                  onClick={runFullAlignment}
                  className="bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl px-12 py-8 text-xl font-black shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  Start Sync & Review
                </Button>
              </div>
              <CardContent className="p-8 bg-gray-50/50 border-t border-gray-100">
                <div className="flex justify-center gap-12">
                  <div className="flex items-center gap-3 text-gray-500 font-bold">
                    <Globe size={20} className="text-blue-500" /> Google
                  </div>
                  <div className="flex items-center gap-3 text-gray-500 font-bold">
                    <Apple size={20} className="text-gray-900" /> Apple
                  </div>
                  <div className="flex items-center gap-3 text-gray-500 font-bold">
                    <Sparkles size={20} className="text-indigo-500" /> AI Optimise
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        )}

        {/* LOADING STATE */}
        {isOptimising && (
          <Card className="border-none shadow-sm rounded-[2.5rem] p-16 text-center bg-white">
            <div className="relative w-24 h-24 mx-auto mb-10">
              <RefreshCw className="text-indigo-600 animate-spin w-full h-full" />
              <div className="absolute inset-0 flex items-center justify-center">
                <Sparkles className="text-indigo-600" size={32} />
              </div>
            </div>
            <h2 className="text-3xl font-black text-gray-900 mb-4">{step}</h2>
            <div className="max-w-md mx-auto">
              <Progress value={progress} className="h-4 bg-gray-100 mb-4 rounded-full" />
              <p className="text-gray-500 font-bold text-lg">{progress}% Complete</p>
            </div>
          </Card>
        )}

        {/* REVIEW STATE */}
        {isReviewing && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex flex-col md:flex-row items-start md:items-center justify-between bg-white p-8 rounded-[2rem] border border-gray-100 shadow-sm gap-6">
              <div className="flex-1">
                <h2 className="text-2xl font-bold text-gray-900">Review & Lock Tasks</h2>
                <p className="text-gray-500 font-medium">Decide which events the AI is allowed to move.</p>
              </div>
              
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-4 w-full md:w-auto">
                <div className="flex items-center gap-3 bg-gray-50 px-4 py-2 rounded-xl border border-gray-100">
                  <Settings2 size={18} className="text-indigo-600" />
                  <div className="flex flex-col">
                    <span className="text-[10px] font-black uppercase tracking-wider text-gray-400">Block Size</span>
                    <Select value={durationOverride} onValueChange={setDurationOverride}>
                      <SelectTrigger className="h-auto p-0 border-none bg-transparent shadow-none focus:ring-0 font-bold text-sm">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="original">Original Duration</SelectItem>
                        <SelectItem value="15">15 Min Blocks</SelectItem>
                        <SelectItem value="30">30 Min Blocks</SelectItem>
                        <SelectItem value="45">45 Min Blocks</SelectItem>
                        <SelectItem value="60">60 Min Blocks</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>

                <div className="flex gap-3">
                  <Button variant="outline" onClick={() => setIsReviewing(false)} className="rounded-xl h-12">
                    Back
                  </Button>
                  <Button 
                    onClick={runOptimisation}
                    className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 h-12 font-black flex gap-3 shadow-lg shadow-indigo-100"
                  >
                    Optimise
                    <ChevronRight size={20} />
                  </Button>
                </div>
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

                  <div className="flex items-center gap-4">
                    <div className="text-right hidden md:block">
                      <p className={cn("text-[10px] font-black uppercase tracking-widest", event.is_locked ? "text-gray-400" : "text-indigo-400")}>
                        Status
                      </p>
                      <p className={cn("font-bold text-sm", event.is_locked ? "text-gray-500" : "text-indigo-600")}>
                        {event.is_locked ? 'Fixed' : 'Movable'}
                      </p>
                    </div>
                    <Switch 
                      checked={!event.is_locked} 
                      onCheckedChange={() => toggleLock(event.event_id, event.is_locked)}
                      className="data-[state=checked]:bg-indigo-600"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RESULTS STATE */}
        {optimisationResult && (
          <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Proposed Schedule Changes</h2>
              <Button variant="outline" onClick={() => { setSyncReport(null); setOptimisationResult(null); setIsReviewing(false); }} className="rounded-xl border-gray-200">
                <RefreshCw size={16} className="mr-2" /> Reset & Re-sync
              </Button>
            </div>

            {optimisationResult.changes.length > 0 ? (
              <div className="space-y-4">
                {optimisationResult.changes.map((change: any, i: number) => (
                  <Card key={i} className="border-none shadow-sm bg-white rounded-2xl overflow-hidden group hover:shadow-md transition-all">
                    <div className="flex flex-col md:flex-row">
                      <div className="p-6 flex-1">
                        <div className="flex items-center gap-3 mb-4">
                          <div className="w-10 h-10 bg-indigo-50 rounded-xl flex items-center justify-center">
                            <Calendar className="text-indigo-600" size={20} />
                          </div>
                          <h3 className="font-bold text-gray-900 text-lg">{change.title}</h3>
                        </div>
                        
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Current Time</p>
                            <p className="text-sm font-medium text-gray-500 line-through">
                              {format(new Date(change.old_start), 'MMM d, HH:mm')}
                            </p>
                          </div>
                          <div className="space-y-1">
                            <p className="text-[10px] font-bold text-indigo-400 uppercase tracking-wider">Suggested Time</p>
                            <p className="text-sm font-bold text-indigo-600 flex items-center gap-2">
                              {format(new Date(change.new_start), 'MMM d, HH:mm')}
                              <ArrowRight size={14} />
                              {format(new Date(change.new_end), 'HH:mm')}
                            </p>
                          </div>
                        </div>
                      </div>
                      <div className="bg-indigo-50/50 px-6 py-4 md:w-48 flex flex-col justify-center border-t md:border-t-0 md:border-l border-indigo-100/50">
                        <div className="flex items-center gap-2 text-indigo-600 font-bold text-sm">
                          <Clock size={14} />
                          {change.duration} mins
                        </div>
                        <p className="text-[10px] text-indigo-400 font-bold uppercase mt-1">Duration</p>
                      </div>
                    </div>
                  </Card>
                ))}
                
                <div className="bg-indigo-600 p-10 rounded-[3rem] text-white shadow-2xl shadow-indigo-200 mt-10">
                  <div className="flex items-center justify-between mb-8">
                    <div>
                      <h3 className="text-3xl font-black">Ready to align?</h3>
                      <p className="opacity-80 text-lg mt-2">This will update {optimisationResult.changes.length} events in your local schedule.</p>
                    </div>
                    <div className="w-16 h-16 bg-white/20 rounded-3xl flex items-center justify-center backdrop-blur-md">
                      <Zap size={32} />
                    </div>
                  </div>
                  <Button 
                    onClick={applyChanges}
                    disabled={isApplying}
                    className="w-full bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl py-8 text-xl font-black shadow-xl disabled:opacity-50 transition-all hover:scale-[1.01]"
                  >
                    {isApplying ? 'Applying Changes...' : 'Apply Changes to Schedule'}
                  </Button>
                </div>
              </div>
            ) : (
              <Card className="border-none shadow-sm bg-white rounded-[2.5rem] p-16 text-center">
                <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-8">
                  <CheckCircle2 className="text-gray-300" size={48} />
                </div>
                <h3 className="text-2xl font-black text-gray-900 mb-4">Schedule is Optimal</h3>
                <p className="text-gray-500 max-w-sm mx-auto text-lg">All your movable events are already perfectly aligned with your work window and themes.</p>
              </Card>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Optimise;