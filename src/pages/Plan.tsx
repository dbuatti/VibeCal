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
    console.log("[Plan] fetchData START");
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        console.log("[Plan] No user found, skipping fetch");
        return;
      }

      // Check for token in session and cache it if found
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.provider_token) {
        console.log("[Plan] Found fresh Google token in session, caching to DB...");
        const { error: cacheError } = await supabase.from('profiles').update({ google_access_token: session.provider_token }).eq('id', user.id);
        if (cacheError) console.error("[Plan] Token cache error:", cacheError);
        else console.log("[Plan] Token cached successfully");
      }

      console.log("[Plan] Fetching history, events, and settings...");
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
        console.log("[Plan] Settings loaded:", settingsRes.data);
        const s = settingsRes.data;
        setSettings(s);
        setMaxHoursOverride(s.max_hours_per_day || 6);
        setMaxTasksOverride(s.max_tasks_per_day || 5);
        if (s.duration_override) setDurationOverride(s.duration_override);
        if (s.slot_alignment) setSlotAlignment(s.slot_alignment);
        if (s.selected_days) setSelectedDays(s.selected_days);
        if (s.placeholder_date) setPlaceholderDate(s.placeholder_date);
      }

      if (eventsRes.data) {
        console.log(`[Plan] ${eventsRes.data.length} events loaded from cache`);
        setEvents(eventsRes.data);
      }

      if (history) {
        console.log("[Plan] Active proposal found:", history.id);
        setProposal(history);
        const appliedIds = history.proposed_changes
          .filter((c: any) => c.applied === true)
          .map((c: any) => c.event_id);
        console.log(`[Plan] ${appliedIds.length} changes already applied`);
        setAppliedChanges(appliedIds);
        setCurrentStep('active_plan');
      } else {
        console.log("[Plan] No active proposal found, setting to initial");
        setCurrentStep('initial');
      }
    } catch (err: any) {
      console.error("[Plan] fetchData FATAL ERROR:", err);
      showError("Failed to load your plan");
    } finally {
      setLoading(false);
      console.log("[Plan] fetchData END");
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const runAnalysis = async (skipSync = false) => {
    console.log(`[Plan] runAnalysis START (skipSync: ${skipSync})`);
    setIsProcessing(true);
    setTokenMissing(false);
    setStatusText(skipSync ? 'Loading cached data...' : 'Syncing Calendars...');
    
    try {
      if (!skipSync) {
        const { data: { session } } = await supabase.auth.getSession();
        const { data: { user } } = await supabase.auth.getUser();
        
        let token = session?.provider_token;
        console.log("[Plan] Syncing... Provider:", session?.user?.app_metadata?.provider, "Token in session:", !!token);
        
        if (!token && user?.app_metadata?.provider === 'google') {
          console.log("[Plan] Session token missing, Edge Function will attempt to use database cache.");
        }

        console.log("[Plan] Invoking sync-calendar...");
        const { data: syncData, error: syncError } = await supabase.functions.invoke('sync-calendar', { 
          body: { googleAccessToken: token } 
        });

        if (syncError || syncData?.error) {
          console.error("[Plan] sync-calendar error:", syncError || syncData?.error);
          if (syncData?.error?.includes("Missing Google Access Token") || syncData?.error?.includes("401")) {
            setTokenMissing(true);
            setIsProcessing(false);
            return;
          }
          throw new Error(syncError?.message || syncData?.error);
        }
        console.log("[Plan] sync-calendar success:", syncData);

        console.log("[Plan] Invoking sync-apple-calendar...");
        const { data: appleData, error: appleError } = await supabase.functions.invoke('sync-apple-calendar');
        if (appleError) console.error("[Plan] sync-apple-calendar error:", appleError);
        else console.log("[Plan] sync-apple-calendar success:", appleData);
      }
      
      console.log("[Plan] Refreshing local event state...");
      const { data: fetchedEvents } = await supabase.from('calendar_events_cache').select('*').order('start_time', { ascending: true });
      setEvents(fetchedEvents || []);
      
      if (currentStep !== 'active_plan') {
        console.log("[Plan] Navigating to /vet");
        navigate('/vet');
      }
      
      showSuccess(skipSync ? 'Loaded from cache!' : 'Calendar synced!');
    } catch (err: any) { 
      console.error("[Plan] runAnalysis FATAL ERROR:", err);
      showError(err.message); 
    }
    finally { 
      setIsProcessing(false); 
      console.log("[Plan] runAnalysis END");
    }
  };

  const handleReauth = () => {
    console.log("[Plan] handleReauth triggered");
    navigate('/login');
  };

  const handleFullReset = async () => {
    console.log("[Plan] handleFullReset START");
    setIsProcessing(true);
    setStatusText('Performing full system reset...');
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      
      console.log("[Plan] Deleting cache and history...");
      await supabase.from('calendar_events_cache').delete().eq('user_id', user.id);
      await supabase.from('optimisation_history').delete().eq('user_id', user.id);
      
      setEvents([]);
      setProposal(null);
      setAppliedChanges([]);
      setCurrentStep('initial');
      
      console.log("[Plan] Reset complete, triggering fresh sync...");
      await runAnalysis(false);
    } catch (err: any) {
      console.error("[Plan] handleFullReset error:", err);
      showError("Reset failed: " + err.message);
    } finally {
      setIsProcessing(false);
      console.log("[Plan] handleFullReset END");
    }
  };

  const runOptimisation = async (isResuggest = false) => {
    console.log(`[Plan] runOptimisation START (isResuggest: ${isResuggest})`);
    if (selectedDays.length === 0) { showError("Select at least one day."); return; }
    
    setIsProcessing(true);
    setStatusText(isResuggest ? 'Reshuffling unvetted tasks...' : 'Optimising...');
    
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      console.log("[Plan] Saving requirements to settings...");
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
      console.log("[Plan] Invoking optimise-schedule with vetted IDs:", currentApplied);

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
      console.log(`[Plan] optimise-schedule success. ${data.changes.length} changes proposed.`);

      let finalChanges = data.changes;
      if (isResuggest && proposal) {
        console.log("[Plan] Merging resuggested changes with existing vetted changes...");
        const vettedChanges = proposal.proposed_changes.filter((c: any) => currentApplied.includes(c.event_id));
        const newUnvettedChanges = data.changes.filter((c: any) => !currentApplied.includes(c.event_id));
        finalChanges = [...vettedChanges, ...newUnvettedChanges];
      }

      console.log("[Plan] Saving new proposal to history...");
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
      console.error("[Plan] runOptimisation FATAL ERROR:", err);
      showError(err.message); 
    }
    finally { 
      setIsProcessing(false); 
      console.log("[Plan] runOptimisation END");
    }
  };

  const handleResetPlan = async () => {
    console.log("[Plan] handleResetPlan triggered");
    if (!proposal) return;
    if (!confirm("Clear this plan?")) return;
    try {
      await supabase.from('optimisation_history').update({ status: 'cancelled' }).eq('id', proposal.id);
      setProposal(null);
      setAppliedChanges([]);
      setCurrentStep('initial');
      showSuccess("Plan cleared");
    } catch (err: any) { 
      console.error("[Plan] handleResetPlan error:", err);
      showError("Failed to reset"); 
    }
  };

  const handleApplyDay = async (dateChanges: any[]) => {
    console.log(`[Plan] handleApplyDay START (${dateChanges.length} changes)`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      const newAppliedIds = [...appliedChanges];
      const updatedEvents = [...events];
      
      // Get token from session or database
      let token = session?.provider_token;
      if (!token && user) {
        console.log("[Plan] Session token missing for apply, checking DB cache...");
        const { data: profile } = await supabase.from('profiles').select('google_access_token').eq('id', user.id).single();
        token = profile?.google_access_token;
      }

      for (const change of dateChanges) {
        console.log(`[Plan] Applying change for event: ${change.title} (${change.event_id})`);
        const eventIdx = updatedEvents.findIndex(e => e.event_id === change.event_id);
        if (eventIdx === -1) {
          console.warn(`[Plan] Event ${change.event_id} not found in local cache, skipping push`);
          continue;
        }
        const eventInCache = updatedEvents[eventIdx];

        console.log(`[Plan] Pushing to provider (${eventInCache.provider})...`);
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

        if (pushError) {
          console.error(`[Plan] Push error for ${change.title}:`, pushError);
          throw pushError;
        }
        console.log(`[Plan] Push success for ${change.title}:`, pushData);

        console.log(`[Plan] Updating local DB cache for ${change.title}...`);
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

      console.log("[Plan] Updating proposal status in DB...");
      const updatedProposedChanges = proposal.proposed_changes.map((c: any) => ({ ...c, applied: newAppliedIds.includes(c.event_id) }));
      await supabase.from('optimisation_history').update({ proposed_changes: updatedProposedChanges }).eq('id', proposal.id);
      
      setEvents(updatedEvents);
      setAppliedChanges(newAppliedIds);
      setProposal({ ...proposal, proposed_changes: updatedProposedChanges });
      console.log("[Plan] handleApplyDay SUCCESS");
    } catch (err: any) { 
      console.error("[Plan] handleApplyDay FATAL ERROR:", err);
      showError(err.message); 
      throw err; 
    }
  };

  const handleUndoApplyDay = async (dateChanges: any[]) => {
    console.log(`[Plan] handleUndoApplyDay START (${dateChanges.length} changes)`);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      const changeIds = dateChanges.map(c => c.event_id);
      const newAppliedIds = appliedChanges.filter(id => !changeIds.includes(id));
      const updatedEvents = [...events];

      // Get token from session or database
      let token = session?.provider_token;
      if (!token && user) {
        console.log("[Plan] Session token missing for undo, checking DB cache...");
        const { data: profile } = await supabase.from('profiles').select('google_access_token').eq('id', user.id).single();
        token = profile?.google_access_token;
      }

      for (const change of dateChanges) {
        console.log(`[Plan] Reverting change for event: ${change.title} (${change.event_id})`);
        const eventIdx = updatedEvents.findIndex(e => e.event_id === change.event_id);
        if (eventIdx === -1) continue;
        const eventInCache = updatedEvents[eventIdx];
        const oldEnd = addMinutes(parseISO(change.old_start), change.old_duration).toISOString();

        console.log(`[Plan] Pushing revert to provider (${eventInCache.provider})...`);
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

        console.log(`[Plan] Reverting local DB cache for ${change.title}...`);
        await supabase.from('calendar_events_cache')
          .update({ start_time: change.old_start, end_time: oldEnd, duration_minutes: change.old_duration, last_synced_at: new Date().toISOString() })
          .eq('event_id', change.event_id);

        updatedEvents[eventIdx] = { ...eventInCache, start_time: change.old_start, end_time: oldEnd, duration_minutes: change.old_duration };
      }

      console.log("[Plan] Updating proposal status in DB...");
      const updatedProposedChanges = proposal.proposed_changes.map((c: any) => ({ ...c, applied: newAppliedIds.includes(c.event_id) }));
      await supabase.from('optimisation_history').update({ proposed_changes: updatedProposedChanges }).eq('id', proposal.id);
      
      setEvents(updatedEvents);
      setAppliedChanges(newAppliedIds);
      setProposal({ ...proposal, proposed_changes: updatedProposedChanges });
      showSuccess("Day reverted.");
      console.log("[Plan] handleUndoApplyDay SUCCESS");
    } catch (err: any) { 
      console.error("[Plan] handleUndoApplyDay FATAL ERROR:", err);
      showError("Failed to undo: " + err.message); 
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
              <h2 className="text-2xl font-black text-gray-900 tracking-tight">Google Connection Required</h2>
              <p className="text-gray-500 font-medium max-w-md mx-auto">
                To sync your Google Calendar, we need to refresh your access token.
              </p>
            </div>
            <Button onClick={handleReauth} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl px-8 py-6 font-black">
              <LogIn className="mr-2" size={18} /> Refresh Google Connection
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