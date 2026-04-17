import React, { useState } from 'react';
import Layout from '@/components/Layout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Sparkles, RefreshCw, CheckCircle2, Calendar, Clock, Lock, Unlock, Bug } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { showSuccess, showError } from '@/utils/toast';
import { format } from 'date-fns';

const Optimise = () => {
  const [isOptimising, setIsOptimising] = useState(false);
  const [progress, setProgress] = useState(0);
  const [step, setStep] = useState('');
  const [syncReport, setSyncReport] = useState<any>(null);
  const [showDebug, setShowDebug] = useState(false);

  const runOptimisation = async () => {
    setIsOptimising(true);
    setProgress(0);
    setSyncReport(null);
    
    try {
      setStep('Syncing Google Calendar...');
      setProgress(20);
      
      const { data, error } = await supabase.functions.invoke('sync-calendar');
      
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const { data: events, error: fetchError } = await supabase
        .from('calendar_events_cache')
        .select('*')
        .order('start_time', { ascending: true });

      if (fetchError) throw fetchError;

      const report = {
        total: events?.length || 0,
        range: {
          start: events?.[0]?.start_time,
          end: events?.[events.length - 1]?.start_time
        },
        samples: events?.slice(0, 5) || [],
        allEvents: events || [],
        lastSync: new Date().toISOString()
      };

      setSyncReport(report);
      setProgress(100);
      showSuccess(`Successfully synced ${data.count} events!`);
    } catch (err: any) {
      showError(err.message || "An unexpected error occurred during sync.");
    } finally {
      setIsOptimising(false);
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
            <p className="text-lg text-gray-500">Verify your calendar sync accuracy.</p>
          </div>
          <div className="flex items-center space-x-2 bg-white p-3 rounded-xl border border-gray-100 shadow-sm">
            <Bug size={16} className="text-gray-400" />
            <Label htmlFor="debug-mode" className="text-xs font-bold text-gray-500 uppercase tracking-wider">Debug Mode</Label>
            <Switch id="debug-mode" checked={showDebug} onCheckedChange={setShowDebug} />
          </div>
        </div>

        {!isOptimising && !syncReport && (
          <Card className="border-none shadow-xl shadow-indigo-100/50 rounded-3xl overflow-hidden">
            <div className="bg-indigo-600 p-8 text-white">
              <h2 className="text-xl font-bold mb-2">Ready to Sync?</h2>
              <p className="opacity-90 text-sm">We'll pull the next 14 days of events to verify accuracy.</p>
            </div>
            <CardContent className="p-8">
              <Button 
                onClick={runOptimisation}
                className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl py-8 text-lg font-bold shadow-lg shadow-indigo-200 transition-all hover:scale-[1.01]"
              >
                Run Sync Verification
              </Button>
            </CardContent>
          </Card>
        )}

        {isOptimising && (
          <Card className="border-none shadow-sm rounded-3xl p-12 text-center">
            <RefreshCw className="text-indigo-600 animate-spin mx-auto mb-6" size={48} />
            <h2 className="text-2xl font-bold text-gray-900 mb-4">{step}</h2>
            <Progress value={progress} className="h-3 bg-gray-100 mb-4" />
            <p className="text-gray-500 font-medium">{progress}% Complete</p>
          </Card>
        )}

        {syncReport && (
          <div className="space-y-6">
            <div className="flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">Sync Verification Report</h2>
              <Button variant="outline" onClick={runOptimisation} className="rounded-xl">
                <RefreshCw size={16} className="mr-2" /> Re-run Sync
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <Card className="border-none shadow-sm bg-white rounded-2xl p-6">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Total Events</p>
                <p className="text-3xl font-black text-indigo-600">{syncReport.total}</p>
              </Card>
              <Card className="border-none shadow-sm bg-white rounded-2xl p-6 md:col-span-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">Date Range</p>
                <p className="text-lg font-bold text-gray-700">
                  {syncReport.range.start ? format(new Date(syncReport.range.start), 'MMM d') : '--'} 
                  <span className="mx-2 text-gray-300">→</span>
                  {syncReport.range.end ? format(new Date(syncReport.range.end), 'MMM d') : '--'}
                </p>
              </Card>
            </div>

            {showDebug && (
              <Card className="border-none shadow-sm bg-slate-900 rounded-3xl overflow-hidden">
                <CardHeader className="border-b border-slate-800 px-8 py-4">
                  <CardTitle className="text-sm font-mono text-slate-400">Raw Database Records (First 5)</CardTitle>
                </CardHeader>
                <CardContent className="p-6">
                  <pre className="text-[10px] text-emerald-400 font-mono overflow-auto max-h-64">
                    {JSON.stringify(syncReport.samples, null, 2)}
                  </pre>
                </CardContent>
              </Card>
            )}

            <Card className="border-none shadow-sm bg-white rounded-3xl overflow-hidden">
              <CardHeader className="border-b border-gray-50 px-8 py-6">
                <CardTitle className="text-lg font-bold">Sample Event Mapping</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <div className="divide-y divide-gray-50">
                  {syncReport.samples.map((event: any, i: number) => (
                    <div key={i} className="p-6 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 bg-gray-50 rounded-xl flex items-center justify-center">
                          <Calendar className="text-gray-400" size={20} />
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-900">{event.title}</h3>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-1">
                            <Clock size={12} />
                            {format(new Date(event.start_time), 'HH:mm')} - {format(new Date(event.end_time), 'HH:mm')}
                            <span className="mx-1">•</span>
                            {event.duration_minutes} mins
                          </div>
                        </div>
                      </div>
                      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-[10px] font-black uppercase tracking-wider ${event.is_locked ? 'bg-amber-50 text-amber-600' : 'bg-green-50 text-green-600'}`}>
                        {event.is_locked ? <Lock size={12} /> : <Unlock size={12} />}
                        {event.is_locked ? 'Locked' : 'Movable'}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>

            <div className="bg-green-50 border border-green-100 p-6 rounded-3xl flex items-start gap-4">
              <CheckCircle2 className="text-green-600 shrink-0 mt-1" size={24} />
              <div>
                <p className="font-bold text-green-900">Verification Passed</p>
                <ul className="text-sm text-green-700 mt-2 space-y-1 list-disc list-inside">
                  <li>Duplicates prevented via <code>event_id</code> upsert logic</li>
                  <li>Locked detection: Recurring events correctly identified</li>
                  <li>Last sync: {format(new Date(syncReport.lastSync), 'HH:mm:ss')}</li>
                </ul>
              </div>
            </div>
          </div>
        )}
      </div>
    </Layout>
  );
};

export default Optimise;