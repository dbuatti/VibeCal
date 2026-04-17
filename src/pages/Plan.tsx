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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { format, nextSaturday, parseISO, addMinutes } from 'date-fns';

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
        
        // Load persisted requirements
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

  const saveRequirements = async () => {
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
  };

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

  const handleFullReset = async () => {
    setIsProcessing(true);
    setStatusText('Performing full system reset...');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // 1. Clear Cache
      await supabase.from('calendar_events_cache').delete().eq('user_id', user.id);
      
      // 2. Clear History
      await supabase.from('optimisation_history').delete().eq('user_id', user.id);

      // 3. Reset State
      setEvents([]);
      setProposal(null);
      setAppliedChanges([]);
      setCurrentStep('initial');

      // 4. Trigger Fresh Sync
      await runAnalysis(false);
      
      showSuccess("System reset complete. Everything is fresh!");
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

      // Save requirements to DB
      await saveRequirements();

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