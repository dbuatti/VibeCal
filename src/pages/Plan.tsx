"use client";

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import DayByDayPlanner from '@/components/DayByDayPlanner';
import RequirementsForm from '@/components/RequirementsForm';
import { Brain, RefreshCw, Trash2, Eye, EyeOff, Calendar, Settings2, CheckSquare, Wand2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { format, nextSaturday, parseISO, addMinutes } from 'date-fns';
import { cn } from '@/lib/utils';

type PlanStep = 'initial' | 'analysis' | 'vetting_tasks' | 'requirements' | 'active_plan';

const Plan = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<PlanStep>('initial');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  
  const [proposal, setProposal] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [appliedChanges, setAppliedChanges] = useState<string[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [deepFocus, setDeepFocus] = useState(false);

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

      if (eventsRes.data) setEvents(eventsRes.data);

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
      
      if (currentStep !== 'active_plan') {
        navigate('/vet');
      }
      
      showSuccess(skipSync ? 'Loaded from cache!' : 'Calendar synced!');
    } catch (err: any) { 
      showError(err.message); 
    }
    finally { setIsProcessing(false); }
  };

  const runOptimisation = async (isResuggest = false) => {
    if (selectedDays.length === 0) { showError("Select at least one day."); return; }
    setIsProcessing(true);
    setStatusText(isResuggest ? 'Reshuffling unvetted tasks...' : 'Optimising...');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const currentApplied = isResuggest ? appliedChanges : [];

      const { data, error } = await supabase.functions.invoke('optimise-schedule', {
        body: { 
          durationOverride: durationOverride === "original" ? null : parseInt(durationOverride), 
          maxTasksOverride, 
          slotAlignment: parseInt(slotAlignment), 
          selectedDays,
          placeholderDate,
          vettedEventIds: currentApplied 
        }
      });
      if (error) throw error;

      let finalChanges = data.changes;
      if (isResuggest && proposal) {
        const vettedChanges = proposal.proposed_changes.filter((c: any) => currentApplied.includes(c.event_id));
        const newUnvettedChanges = data.changes.filter((c: any) => !currentApplied.includes(c.event_id));
        finalChanges = [...vettedChanges, ...newUnvettedChanges];
      }

      const { data: newProposal } = await supabase.from('optimisation_history').insert({
        user_id: user.id,
        proposed_changes: finalChanges.map((c: any) => ({ ...c, applied: currentApplied.includes(c.event_id) })),
        status: 'proposed',
        metadata: { selectedDays, maxTasksOverride, maxHoursOverride, durationOverride, isResuggest, placeholderDate }
      }).select().single();

      setProposal(newProposal);
      setAppliedChanges(currentApplied);
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

  const renderRequirementsForm = () => (
    <RequirementsForm 
      durationOverride={durationOverride}
      setDurationOverride={setDurationOverride}
      slotAlignment={slotAlignment}
      setSlotAlignment={setSlotAlignment}
      selectedDays={selectedDays}
      setSelectedDays={setSelectedDays}
      maxHoursOverride={maxHoursOverride}
      setMaxHoursOverride={setMaxHoursOverride}
      maxTasksOverride={maxTasksOverride}
      setMaxTasksOverride={setMaxTasksOverride}
      placeholderDate={placeholderDate}
      setPlaceholderDate={setPlaceholderDate}
      onOptimise={() => runOptimisation(false)}
    />
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
            <Button 
              variant="outline" 
              onClick={() => navigate('/vet')}
              className="bg-white border-gray-100 text-gray-500 rounded-xl font-black text-[9px] uppercase tracking-widest h-10 px-4 shadow-sm"
            >
              <CheckSquare size={14} className="mr-2" /> Vet Tasks
            </Button>
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
                {renderRequirementsForm()}
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

          {currentStep === 'requirements' && (
            <Card className="border-none shadow-xl rounded-[2rem] overflow-hidden bg-white animate-in fade-in slide-in-from-bottom-4 duration-500">
              <CardHeader className="p-8 border-b border-gray-50">
                <CardTitle className="text-2xl font-black tracking-tight">Requirements</CardTitle>
              </CardHeader>
              <CardContent className="p-8">
                {renderRequirementsForm()}
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