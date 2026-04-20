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
import { format, nextSaturday, parseISO, addMinutes, isAfter, isBefore } from 'date-fns';
import { AlertCircle, LogIn, Sparkles, Calendar } from 'lucide-react';
import { Button } from '@/components/ui/button';

type PlanStep = 'initial' | 'analysis' | 'vetting_tasks' | 'requirements' | 'active_plan';

const Plan = () => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [currentStep, setCurrentStep] = useState<PlanStep>('initial');
  const [isProcessing, setIsProcessing] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [progress, setProgress] = useState(0);
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

      const fetchedEvents = eventsRes.data || [];
      setEvents(fetchedEvents);

      if (history) {
        setProposal(history);
        const appliedIds = history.proposed_changes
          .filter((c: any) => c.applied === true)
          .map((c: any) => c.event_id);
        setAppliedChanges(appliedIds);
        setCurrentStep('active_plan');
      } else if (fetchedEvents.length > 0) {
        setCurrentStep('requirements');
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

  const runAnalysis = async (skipSync = false, forceVetRedirect = false) => {
    console.log("[Plan] runAnalysis started", { skipSync, forceVetRedirect });
    setIsProcessing(true);
    setTokenMissing(false);
    setProgress(5);
    
    try {
      if (!skipSync) {
        setStatusText('Authenticating...');
        setProgress(15);
        const { data: { session } } = await supabase.auth.getSession();
        const { data: { user } } = await supabase.auth.getUser();
        
        console.log("[Plan] Session:", !!session, "User:", user?.id);

        let token = session?.provider_token;
        if (!token && user) {
          const { data: profile } = await supabase.from('profiles').select('google_access_token').eq('id', user.id).single();
          token = profile?.google_access_token;
        }

        console.log("[Plan] Google token:", !!token);

        setStatusText('Syncing calendars...');
        setProgress(30);
        
        const syncPromises = [
          supabase.functions.invoke('sync-calendar', { body: { googleAccessToken: token } }),
          supabase.functions.invoke('sync-apple-calendar')
        ];

        console.log("[Plan] Invoking sync functions...");
        const results = await Promise.allSettled(syncPromises);
        console.log("[Plan] Sync results:", results);
        setProgress(60);
        
        const googleResult = results[0];
        if (googleResult.status === 'fulfilled') {
          const { data, error } = googleResult.value;
          if (error || data?.error) {
            const errorMsg = (error?.message || data?.error || "").toLowerCase();
            console.error("[Plan] Google Sync Error:", errorMsg);
            if (errorMsg.includes("401") || errorMsg.includes("unauthorized")) {
              setTokenMissing(true);
              setIsProcessing(false);
              showError("Google session expired.");
              return;
            }
          }
        }
      } else {
        setStatusText('Loading cached data...');
        setProgress(50);
      }
      
      setStatusText('AI is vetting your schedule...');
      setProgress(75);
      
      const { data: { user } } = await supabase.auth.getUser();
      const { data: fetchedEvents } = await supabase
        .from('calendar_events_cache')
        .select('*')
        .eq('user_id', user?.id)
        .order('start_time', { ascending: true });

      console.log("[Plan] Fetched events for classification:", fetchedEvents?.length);

      if (fetchedEvents && fetchedEvents.length > 0) {
        const { data: settings } = await supabase.from('user_settings').select('movable_keywords, locked_keywords, work_keywords, natural_language_rules').single();
        console.log("[Plan] Invoking classify-tasks...");
        
        const batchSize = 10;
        for (let i = 0; i < fetchedEvents.length; i += batchSize) {
          const batch = fetchedEvents.slice(i, i + batchSize);
          const classificationProgress = Math.round(((i + batch.length) / fetchedEvents.length) * 100);
          setStatusText(`AI is vetting tasks (${classificationProgress}%)...`);
          // Update overall progress bar too
          setProgress(75 + (classificationProgress * 0.2)); // Map 0-100% of classification to 75-95% of overall progress

          await supabase.functions.invoke('classify-tasks', {
            body: {
              events: batch.map(e => ({
                event_id: e.event_id,
                title: e.title,
                start_time: e.start_time,
                end_time: e.end_time,
                provider: e.provider,
                source_calendar: e.source_calendar,
                source_calendar_id: e.source_calendar_id
              })),
              movableKeywords: settings?.movable_keywords || [],
              lockedKeywords: settings?.locked_keywords || [],
              workKeywords: settings?.work_keywords || [],
              naturalLanguageRules: settings?.natural_language_rules || '',
              persist: true
            }
          });
        }
      }
        
      setStatusText('Updating local view...');
      setProgress(95);
      
      const { data: finalEvents } = await supabase
        .from('calendar_events_cache')
        .select('*')
        .eq('user_id', user?.id)
        .order('start_time', { ascending: true });
        
      setEvents(finalEvents || []);
      setProgress(100);
      
      console.log("[Plan] Analysis complete, final events:", finalEvents?.length);

      setTimeout(() => {
        if (forceVetRedirect || currentStep !== 'active_plan') {
          if (finalEvents && finalEvents.length > 0) {
            console.log("[Plan] Navigating to /vet");
            navigate('/vet');
          } else {
            console.log("[Plan] No events, staying on initial");
            showError("No calendar events found. Please check your calendar settings.");
            setCurrentStep('initial');
          }
        }
        setIsProcessing(false);
      }, 500);

    } catch (err: any) {
      console.error("[Plan] runAnalysis error:", err);
      showError(err.message);
      setIsProcessing(false);
    }
  };

  const handleFullSync = async () => {
    console.log("[Plan] handleFullSync started");
    setIsProcessing(true);
    setProgress(0);
    setStatusText('Performing full system sync...');
    try {
      console.log("[Plan] Calling full_reset_user_data RPC");
      const { error } = await supabase.rpc('full_reset_user_data');
      if (error) {
        console.error("[Plan] RPC Error:", error);
        throw error;
      }
      console.log("[Plan] RPC Success, calling runAnalysis");
      setProgress(20);
      await runAnalysis(false, true);
    } catch (err: any) {
      console.error("[Plan] handleFullSync error:", err);
      showError("Sync failed: " + err.message);
      setIsProcessing(false);
    }
  };

  const runOptimisation = async (isResuggest = false) => {
    if (selectedDays.length === 0) { showError("Select at least one day."); return; }
    
    setIsProcessing(true);
    setProgress(10);
    setStatusText(isResuggest ? 'Reshuffling unvetted tasks...' : 'Calculating optimal alignment...');
    
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

      setProgress(40);
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
      setProgress(80);

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
      setProgress(100);
      setCurrentStep('active_plan');
      showSuccess(isResuggest ? "Day resuggested!" : "Optimisation complete!");
    } catch (err: any) { 
      showError(err.message); 
    }
    finally { 
      setTimeout(() => setIsProcessing(false), 500);
    }
  };

  const handleResetPlan = async () => {
    if (!proposal) return;
    if (!confirm("Clear this plan?")) return;
    try {
      await supabase.from('optimisation_history').update({ status: 'cancelled' }).eq('id', proposal.id);
      setProposal(null);
      setAppliedChanges([]);
      setCurrentStep('requirements');
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

        await supabase.functions.invoke('push-to-provider', {
          body: { 
            eventId: change.event_id, 
            provider: eventInCache.provider, 
            calendarId: eventInCache.source_calendar_id, 
            startTime: change.new_start, 
            endTime: change.new_end, 
            googleAccessToken: token 
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
    const updatedChanges = [...proposal.proposed_changes];
    updatedChanges[changeIdx] = { ...change, is_surplus: false };
    try {
      await supabase.from('optimisation_history').update({ proposed_changes: updatedChanges }).eq('id', proposal.id);
      setProposal({ ...proposal, proposed_changes: updatedChanges });
      showSuccess(`Reinserted "${change.title}"`);
    } catch (err) { showError("Failed to reinsert task"); }
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

  if (loading) return <Layout><PlanLoadingView statusText="Loading your plan..." progress={30} /></Layout>;

  return (
    <Layout hideSidebar={deepFocus}>
      <PlanPageHeader 
        currentStep={currentStep}
        isProcessing={isProcessing}
        deepFocus={deepFocus}
        setDeepFocus={setDeepFocus}
        onVetTasks={() => navigate('/vet')}
        onFullSync={handleFullSync}
        onReset={handleResetPlan}
        renderRequirementsForm={renderRequirementsForm}
      />

      {tokenMissing && (
        <Card className="border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-white mb-10 border-l-8 border-l-amber-400">
          <div className="p-12 text-center space-y-8">
            <div className="w-20 h-20 bg-amber-50 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
              <AlertCircle className="text-amber-500" size={40} />
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-black text-gray-900 tracking-tight">Google Connection Expired</h2>
              <p className="text-gray-500 font-medium max-w-md mx-auto leading-relaxed">
                Your Google session has timed out. Please reconnect to continue syncing.
              </p>
            </div>
            <Button onClick={() => navigate('/login')} className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-10 py-8 text-lg font-black shadow-xl">
              <LogIn className="mr-3" size={20} /> Reconnect Google
            </Button>
          </div>
        </Card>
      )}

      {isProcessing ? (
        <PlanLoadingView statusText={statusText} progress={progress} />
      ) : (
        <>
          {currentStep === 'initial' && (
            <PlanInitialView 
              hasEvents={events.length > 0}
              onSyncFresh={handleFullSync}
              onUseCache={() => runAnalysis(true)}
            />
          )}

          {currentStep === 'requirements' && (
            <div className="max-w-2xl mx-auto animate-in fade-in slide-in-from-bottom-4 duration-700">
              <Card className="border-none shadow-2xl rounded-[3rem] overflow-hidden bg-white">
                <CardHeader className="p-12 bg-indigo-600 text-white">
                  <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center mb-6 backdrop-blur-md">
                    <Sparkles size={32} />
                  </div>
                  <CardTitle className="text-3xl font-black tracking-tight">Generate Your Plan</CardTitle>
                  <p className="text-indigo-100 font-medium mt-2">Your tasks are vetted. Now, let's align them with your work window.</p>
                </CardHeader>
                <CardContent className="p-12">
                  {renderRequirementsForm()}
                </CardContent>
              </Card>
            </div>
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
              selectedDays={selectedDays}
            />
          )}
        </>
      )}
    </Layout>
  );
};

export default Plan;