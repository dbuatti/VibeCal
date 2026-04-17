import React, { useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Sparkles, RefreshCw, CheckCircle2, Calendar, Clock, Lock, Unlock, Bug, ArrowRight, Zap, Apple, Info } from 'lucide-react';
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

  const runGoogleSync = async () => {
    setIsOptimising(true);
    setProgress(0);
    setSyncReport(null);
    
    try {
      setStep('Authenticating with Google...');
      setProgress(10);

      const { data: { session } } = await supabase.auth.getSession();
      const providerToken = session?.provider_token;

      if (!providerToken) {
        throw new Error("Google access token not found. Please sign out and sign back in.");
      }

      setStep('Syncing Google Calendar...');
      setProgress(30);
      
      const { data, error } = await supabase.functions.invoke('sync-calendar', {
        body: { googleAccessToken: providerToken }
      });
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await finalizeSync(data.count, data.events);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsOptimising(false);
    }
  };

  const runAppleSync = async () => {
    setIsOptimising(true);
    setProgress(0);
    setSyncReport(null);
    
    try {
      setStep('Connecting to iCloud (CalDAV)...');
      setProgress(20);

      const { data, error } = await supabase.functions.invoke('sync-apple-calendar');
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      await finalizeSync(data.count, data.events);
    } catch (err: any) {
      showError(err.message);
    } finally {
      setIsOptimising(false);
    }
  };

  const finalizeSync = async (count: number, rawEvents?: any[]) => {
    setStep('Verifying database records...');
    setProgress(80);

    const { data: events, error: fetchError } = await supabase
      .from('calendar_events_cache')
      .select('*')
      .order('start_time', { ascending: true });

    if (fetchError) throw fetchError;

    setSyncReport({
      total: events?.length || 0,
      range: {
        start: events?.[0]?.start_time,
        end: events?.[events.length - 1]?.start_time
      },
      samples: events || [],
      rawResponse: rawEvents,
      lastSync: new Date().toISOString()
    });
    
    setProgress(100);
    showSuccess(`Successfully synced ${count} events!`);
  };

  const runOptimisation = async () => {
    setIsOptimising(true);
    setProgress(0);
    setStep('Calculating optimal slots...');
    
    try {
      const { data, error } = await supabase.functions.invoke('optimise-schedule');
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      setOptimisationResult(data);
      setProgress(100);
      showSuccess(data.message);
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

      showSuccess("Changes applied to your local schedule!");
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

        {!isOptimising && !syncReport && !optimisationResult && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <Card className="border-none shadow-xl shadow-indigo-100/50 rounded-3xl overflow-hidden">
              <div className="bg-indigo-600 p-8 text-white">
                <h2 className="text-xl font-bold mb-2">Google Calendar</h2>
                <p className="opacity-90 text-sm">Sync using your Google account.</p>
              </div>
              <CardContent className="p-8">
                <Button 
                  onClick={runGoogleSync}
                  className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl py-8 text-lg font-bold shadow-lg shadow-indigo-200 transition-all hover:scale-[1.01]"
                >
                  Sync Google
                </Button>
              </CardContent>
            </Card>

            <Card className="border-none shadow-xl shadow-gray-100/50 rounded-3xl overflow-hidden">
              <div className="bg-gray-900 p-8 text-white">
                <h2 className="text-xl font-bold mb-2 flex items-center gap-2">
                  <Apple size={20} /> Apple Calendar
                </h2>
                <p className="opacity-90 text-sm">Sync using CalDAV credentials.</p>
              </div>
              <CardContent className="p-8">
                <Button 
                  onClick={runAppleSync}
                  className="w-full bg-gray-900 hover:bg-black text-white rounded-2xl py-8 text-lg font-bold shadow-lg shadow-gray-200 transition-all hover:scale-[1.01]"
                >
                  Sync Apple
                </Button>
              </CardContent>
            </Card>
          </div>
        )}

        {isOptimising && (
          <Card className="border-none shadow-sm rounded-3xl p-12 text-center">
            <RefreshCw className="text-indigo-600 animate-spin mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-gray-900 mb-4">{step}</h2>
            <Progress value={progress} className="h-3 bg-gray-100 mb-4" />
            <p className="text-gray-500 font-medium">{progress}% Complete</p>
          </Card>
        )}

        {syncReport && !optimisationResult && (
          <div className="space-y-6">
            <div className="bg-white p-8 rounded-3xl border border-gray-100 shadow-sm flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-900">Calendar Synced</h2>
                <p className="text-gray-500 text-sm mt-1">{syncReport.total} events found in the next 14 days.</p>
              </div>
              <div className="flex gap-3">
                <Button variant="outline" onClick={() => setSyncReport(null)} className="rounded-xl">
                  Back
                </Button>
                <Button onClick={runOptimisation} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 py-6 h-auto font-bold flex gap-2">
                  <Zap size={18} />
                  Run Optimisation
                </Button>
              </div>
            </div>

            {showDebug && (
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-gray-900 flex items-center gap-2">
                  <Info size={20} className="text-indigo-600" />
                  Discovered Events Debug
                </h3>
                <div className="grid grid-cols-1 gap-3">
                  {syncReport.samples.map((event: any, i: number) => (
                    <div key={i} className="bg-slate-900 p-4 rounded-2xl font-mono text-xs text-emerald-400 border border-slate-800">
                      <div className="flex justify-between mb-2 border-b border-slate-800 pb-2">
                        <span className="text-slate-400">#{i + 1} {event.title}</span>
                        <span className="text-indigo-400">[{event.provider || 'google'}]</span>
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <div>Start: {format(new Date(event.start_time), 'MMM d, HH:mm')}</div>
                        <div>End: {format(new Date(event.end_time), 'MMM d, HH:mm')}</div>
                        <div>Duration: {event.duration_minutes}m</div>
                        <div>Calendar: {event.source_calendar || 'primary'}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {optimisationResult && (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Proposed Schedule Changes</h2>
              <Button variant="outline" onClick={() => { setSyncReport(null); setOptimisationResult(null); }} className="rounded-xl">
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
                
                <div className="bg-indigo-600 p-8 rounded-[2.5rem] text-white shadow-xl shadow-indigo-100 mt-10">
                  <div className="flex items-center justify-between mb-6">
                    <div>
                      <h3 className="text-2xl font-bold">Ready to apply?</h3>
                      <p className="opacity-80 text-sm mt-1">This will update {optimisationResult.changes.length} events in your local schedule.</p>
                    </div>
                    <div className="w-14 h-14 bg-white/20 rounded-2xl flex items-center justify-center backdrop-blur-sm">
                      <Zap size={28} />
                    </div>
                  </div>
                  <Button 
                    onClick={applyChanges}
                    disabled={isApplying}
                    className="w-full bg-white text-indigo-600 hover:bg-indigo-50 rounded-2xl py-7 text-lg font-black shadow-lg disabled:opacity-50"
                  >
                    {isApplying ? 'Applying...' : 'Apply Changes to Schedule'}
                  </Button>
                </div>
              </div>
            ) : (
              <Card className="border-none shadow-sm bg-white rounded-3xl p-12 text-center">
                <div className="w-20 h-20 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="text-gray-300" size={40} />
                </div>
                <h3 className="text-xl font-bold text-gray-900 mb-2">No Movable Events</h3>
                <p className="text-gray-500 max-w-xs mx-auto">All your events are currently locked or recurring. Create a single, non-recurring event to test the optimiser.</p>
              </Card>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Optimise;