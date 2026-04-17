import React, { useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Sparkles, RefreshCw, CheckCircle2, Calendar, Clock, Lock, Unlock, Bug, ArrowRight, Zap, Apple, Info, Globe } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import { format } from 'date-fns';

const Optimise = () => {
  const [isOptimising, setIsOptimising] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [syncReport, setSyncReport] = useState<any>(null);
  const [optimisationResult, setOptimisationResult] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [isApplying, setIsApplying] = useState(false);

  const runFullAlignment = async () => {
    setIsOptimising(true);
    setProgress(0);
    setSyncReport(null);
    setOptimisationResult(null);
    
    try {
      // 1. Google Sync
      setStep('Syncing Google Calendar...');
      setProgress(10);
      const { data: { session } } = await supabase.auth.getSession();
      const providerToken = session?.provider_token;

      if (providerToken) {
        const { data: gData, error: gError } = await supabase.functions.invoke('sync-calendar', {
          body: { googleAccessToken: providerToken }
        });
        if (gError) console.warn("Google sync failed:", gError);
      } else {
        console.warn("No Google token found, skipping Google sync.");
      }

      // 2. Apple Sync
      setProgress(40);
      setStep('Syncing Apple Calendar...');
      const { data: aData, error: aError } = await supabase.functions.invoke('sync-apple-calendar');
      if (aError) console.warn("Apple sync failed:", aError);

      // 3. Fetch Combined Cache for Report
      setProgress(60);
      setStep('Analyzing combined schedule...');
      const { data: events, error: fetchError } = await supabase
        .from('calendar_events_cache')
        .select('*')
        .order('start_time', { ascending: true });

      if (fetchError) throw fetchError;

      setSyncReport({
        total: events?.length || 0,
        googleCount: events?.filter(e => e.provider === 'google').length || 0,
        appleCount: events?.filter(e => e.provider === 'apple').length || 0,
        samples: events || [],
        lastSync: new Date().toISOString()
      });

      // 4. Run Optimisation
      setProgress(80);
      setStep('Calculating optimal alignment...');
      const { data: optData, error: optError } = await supabase.functions.invoke('optimise-schedule');
      
      if (optError) throw optError;
      if (optData?.error) throw new Error(optData.error);

      setOptimisationResult(optData);
      setProgress(100);
      showSuccess("Alignment calculation complete!");
    } catch (err: any) {
      showError(err.message);
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
            last_synced_at: new Date().toISOString()
          })
          .eq('event_id', change.event_id)
          .eq('user_id', user.id);
        
        if (error) throw error;
      }

      showSuccess("Schedule updated successfully!");
      setOptimisationResult(null);
      setSyncReport(null);
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
          <div className="flex items-center space-x-2 bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
            <Bug size={16} className="text-gray-400" />
            <Label htmlFor="debug-mode" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Debug Mode</Label>
            <Switch id="debug-mode" checked={showDebug} onCheckedChange={setShowDebug} />
          </div>
        </div>

        {!isOptimising && !optimisationResult && (
          <div className="space-y-8">
            <Card className="border-none shadow-2xl shadow-indigo-100/50 rounded-[2.5rem] overflow-hidden bg-white">
              <div className="bg-gradient-to-br from-indigo-600 to-purple-700 p-12 text-white text-center">
                <div className="w-20 h-20 bg-white/20 rounded-3xl flex items-center justify-center mx-auto mb-8 backdrop-blur-md">
                  <Zap size={40} />
                </div>
                <h2 className="text-3xl font-black mb-4">Full Schedule Alignment</h2>
                <p className="text-indigo-100 text-lg max-w-md mx-auto mb-10">
                  Sync both Google and Apple calendars, then automatically redistribute movable tasks to your optimal focus windows.
                </p>
                <Button 
                  onClick={runFullAlignment}
                  className="bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl px-12 py-8 text-xl font-black shadow-xl transition-all hover:scale-[1.02] active:scale-[0.98]"
                >
                  Start Alignment
                </Button>
              </div>
              <CardContent className="p-8 bg-gray-50/50 border-t border-gray-100">
                <div className="flex justify-center gap-12">
                  <div className="flex items-center gap-3 text-gray-500 font-bold">
                    <Globe size={20} className="text-blue-500" /> Google Sync
                  </div>
                  <div className="flex items-center gap-3 text-gray-500 font-bold">
                    <Apple size={20} className="text-gray-900" /> Apple Sync
                  </div>
                  <div className="flex items-center gap-3 text-gray-500 font-bold">
                    <Sparkles size={20} className="text-indigo-500" /> AI Optimise
                  </div>
                </div>
              </CardContent>
            </Card>

            {syncReport && showDebug && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Info size={20} className="text-indigo-600" />
                  Discovered Events Debug ({syncReport.total})
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {syncReport.samples.map((event: any, i: number) => (
                    <div key={i} className="bg-slate-900 p-4 rounded-2xl font-mono text-xs text-emerald-400 border border-slate-800">
                      <div className="flex justify-between mb-2 border-b border-slate-800 pb-2">
                        <span className="text-slate-400">#{i + 1} {event.title}</span>
                        <div className="flex items-center gap-3">
                          <span className={event.is_locked ? "text-red-400" : "text-emerald-400"}>
                            {event.is_locked ? '[LOCKED]' : '[MOVABLE]'}
                          </span>
                          <span className="text-indigo-400 uppercase">[{event.provider}]</span>
                        </div>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>Start: {format(new Date(event.start_time), 'MMM d, HH:mm')}</div>
                        <div>End: {format(new Date(event.end_time), 'MMM d, HH:mm')}</div>
                        <div>Duration: {event.duration_minutes}m</div>
                        <div>Calendar: {event.source_calendar}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

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

        {optimisationResult && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Proposed Schedule Changes</h2>
              <Button variant="outline" onClick={() => { setSyncReport(null); setOptimisationResult(null); }} className="rounded-xl border-gray-200">
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