"use client";

import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import DayByDayPlanner from '@/components/DayByDayPlanner';
import RequirementsForm from '@/components/RequirementsForm';
import PlanPageHeader from '@/components/plan/PlanPageHeader';
import PlanInitialView from '@/components/plan/PlanInitialView';
import PlanLoadingView from '@/components/plan/PlanLoadingView';
import { Card } from '@/components/ui/card';
import { format, nextSaturday, parseISO, addMinutes, startOfDay, endOfDay, isAfter, isBefore } from 'date-fns';
import { AlertCircle, LogIn } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PlanStep = 'initial' | 'analysis' | 'vetting_tasks' | 'requirements' | 'active_plan';

const Plan = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<PlanStep>('initial');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [tokenMissing, setTokenMissing] = useState(false);
  
  const [proposal, setProposal] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [appliedChanges, setAppliedChanges] = useState<string[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [deepFocus, setDeepFocus] = useState(false);

  // Requirements state
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

      const { data: { session } } = await supabase.auth.getSession();
      if (session?.provider_token) {
        await supabase.from('profiles').update({ google_access_token: session.provider_token }).eq('id', user.id);
      }

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
        const s = settingsRes.data;
        setSettings(s);
        setMaxHoursOverride(s.max_hours_per_day || 6);
        setMaxTasksOverride(s.max_tasks_per_day || 5);
        if (s.duration_override) setDurationOverride(s.duration_override);
        if (s.slot_alignment) setSlotAlignment(s.slot_alignment);
        if (s.selected_days) setSelectedDays(s.selected_days);
        if (s.placeholder_date) setPlaceholderDate(s.placeholder_date);
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
    setTokenMissing(false);
    setStatusText(skipSync ? 'Loading cached data...' : 'Syncing Calendars...');
    
    try {
      if (!skipSync) {
        const { data: { session } } = await supabase.auth.getSession();
        let token = session?.provider_token;

        const { data: syncData, error: syncError } = await supabase.functions.invoke('sync-calendar', { 
          body: { googleAccessToken: token } 
        });

        if (syncError || syncData?.error) {
          const errorMsg = syncError?.message || syncData?.error || "";
          const isAuthError = errorMsg.includes("401") || 
                             errorMsg.includes("Unauthorized") || 
                             errorMsg.includes("invalid authentication credentials") ||
                             errorMsg.includes("Missing Google Access Token");

          if (isAuthError) {
            setTokenMissing(true);
            setIsProcessing(false);
            showError("Google session expired. Please reconnect.");
            return;
          }
          throw new Error(errorMsg);
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
    finally { 
      setIsProcessing(false); 
    }
  };

  const handleReauth = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  const handleFullReset = async () => {
    setIsProcessing(true);
    setStatusText('Performing full system reset...');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      await supabase.from('calendar_events_cache').delete().eq('user_id', user.id);
      await supabase.from('optimisation_history').delete().eq('user_id', user.id);
      
      setEvents([]);
      setProposal(null);
      setAppliedChanges([]);
      setCurrentStep('initial');
      
      await runAnalysis(false);
    } catch (err: any) {
      showError("Reset failed: " + err.message);
    } finally {
      setIsProcessing(false);
    }
  };

  const runOptimisation = async (isResuggest = false) => {
    if (selectedDays.length === 0) { showError("Select at least one day."); return; }
    
    setIsProcessing(true);
    setStatusText(isResuggest ? 'Reshuffling unvetted tasks...' : 'Optimising...');
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      await supabase.from('user_settings').upsert({
        user_id: user.id,
        max_hours_per_day: maxHoursOverride,
        max_tasks_per_day: maxTasksOverride,
        duration_override: durationOverride,
        slot_alignment: slotAlignment,
        selected_days: selectedDays,
        placeholder_date: placeholderDate
      }, { onConflict: 'user_id' });

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
    } catch (err: any) { 
      showError(err.message); 
    }
    finally { 
      setIsProcessing(false); 
    }
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
    } catch (err: any) { 
      showError("Failed to reset"); 
    }
  };

  const handleApplyDay = async (dateChanges: any[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      const newAppliedIds = [...appliedChanges];
      const updatedEvents = [...events];
      
      let token = session?.provider_token;
      if (!token && user) {
        const { data: profile } = await supabase.from('profiles').select('google_access_token').eq('id', user.id).single();
        token = profile?.google_access_token;
      }

      for (const change of dateChanges) {
        const eventIdx = updatedEvents.findIndex(e => e.event_id === change.event_id);
        if (eventIdx === -1) continue;
        const eventInCache = updatedEvents[eventIdx];

        const { data: pushData, error: pushError } = await supabase.functions.invoke('push-to-provider', {
          body: { 
            eventId: change.event_id, 
            provider: eventInCache.provider, 
            calendarId: eventInCache.source_calendar_id, 
            startTime: change.new_start, 
            endTime: change.new_end, 
            googleAccessToken: token 
          }
        });

        if (pushError) throw pushError;

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
    } catch (err: any) { 
      showError(err.message); 
      throw err; 
    }
  };

  const handleUndoApplyDay = async (dateChanges: any[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      const changeIds = dateChanges.map(c => c.event_id);
      const newAppliedIds = appliedChanges.filter(id => !changeIds.includes(id));
      const updatedEvents = [...events];

      let token = session?.provider_token;
      if (!token && user) {
        const { data: profile } = await supabase.from('profiles').select('google_access_token').eq('id', user.id).single();
        token = profile?.google_access_token;
      }

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
            googleAccessToken: token 
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
    } catch (err: any) { 
      showError("Failed to undo: " + err.message); 
    }
  };

  const handleReinsertTask = async (eventId: string, targetDateStr: string) => {
    if (!proposal) return;
    
    const changeIdx = proposal.proposed_changes.findIndex((c: any) => c.event_id === eventId);
    if (changeIdx === -1) return;

    const change = proposal.proposed_changes[changeIdx];
    const targetDate = parseISO(targetDateStr);
    
    // Find a slot on the target day
    // We'll look at existing events on that day to find the last end time
    const dayEvents = [
      ...events.filter(e => format(parseISO(e.start_time), 'yyyy-MM-dd') === targetDateStr),
      ...proposal.proposed_changes.filter((c: any) => 
        c.event_id !== eventId && 
        format(parseISO(c.new_start), 'yyyy-MM-dd') === targetDateStr
      )
    ];

    let lastEnd = new Date(targetDate);
    // Default to work start time if no events
    const [startH, startM] = (settings?.day_start_time || '09:00').split(':').map(Number);
    lastEnd.setHours(startH, startM, 0, 0);

    dayEvents.forEach(e => {
      const end = parseISO(e.end_time || e.new_end);
      if (isAfter(end, lastEnd)) lastEnd = end;
    });

    // Add a small buffer
    const newStart = addMinutes(lastEnd, 5);
    const newEnd = addMinutes(newStart, change.duration);

    const updatedChanges = [...proposal.proposed_changes];
    updatedChanges[changeIdx] = {
      ...change,
      new_start: newStart.toISOString(),
      new_end: newEnd.toISOString(),
      is_surplus: false
    };

    try {
      await supabase.from('optimisation_history')
        .update({ proposed_changes: updatedChanges })
        .eq('id', proposal.id);
      
      setProposal({ ...proposal, proposed_changes: updatedChanges });
      showSuccess(`Reinserted "${change.title}" into today`);
    } catch (err) {
      showError("Failed to reinsert task");
    }
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

  if (loading) return <Layout><PlanLoadingView statusText="Loading your plan..." /></Layout>;

  return (
    <Layout hideSidebar={deepFocus}>
      <PlanPageHeader 
        currentStep={currentStep}
        isProcessing={isProcessing}
        deepFocus={deepFocus}
        setDeepFocus={setDeepFocus}
        onVetTasks={() => navigate('/vet')}
        onResync={() => runAnalysis(false)}
        onReset={handleResetPlan}
        onFullReset={handleFullReset}
        renderRequirementsForm={renderRequirementsForm}
      />

      {tokenMissing && (
        <Card className="border-none shadow-xl rounded-[2rem] overflow-hidden bg-white mb-8 animate-in zoom-in-95 duration-300">
          <div className="p-10 text-center space-y-6">
            <div className="w-16 h-16 bg-amber-50 rounded-2xl flex items-center justify-center mx-auto">
              <AlertCircle className="text-amber-500" size={32} />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">Google Connection Expired</h2>
              <p className="text-gray-500 font-medium max-w-md mx-auto">
                Your Google session has timed out. Please reconnect to continue syncing your calendar.
              </p>
            </div>
            <Button onClick={handleReauth} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 py-6 font-black">
              <LogIn className="mr-2" size={18} /> Reconnect Google
            </Button>
          </div>
        </Card>
      )}

      {isProcessing ? (
        <PlanLoadingView statusText={statusText} />
      ) : (
        <>
          {currentStep === 'initial' && (
            <PlanInitialView 
              hasEvents={events.length > 0}
              onSyncFresh={() => runAnalysis(false)}
              onUseCache={() => runAnalysis(true)}
            />
          )}

          {currentStep === 'active_plan' && proposal && (
            <DayByDayPlanner 
              events={events}
              changes={proposal.proposed_changes}
              appliedChanges={appliedChanges}
              onApplyDay={handleApplyDay}
              onUndoApplyDay={handleUndoApplyDay}
              onResuggestDay={() => runOptimisation(true)} 
              onReinsertTask={handleReinsertTask}
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