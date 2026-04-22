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
import { format, nextSaturday, parseISO, addMinutes, isAfter, isBefore, isValid, startOfDay, endOfDay, isWithinInterval } from 'date-fns';
import { AlertCircle, LogIn, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { DateRange } from "react-day-picker";

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
  const [dateRange, setDateRange] = useState<DateRange | undefined>();

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
    setIsProcessing(true);
    setTokenMissing(false);
    setProgress(5);
    
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      if (!skipSync) {
        setStatusText('Authenticating...');
        setProgress(15);
        
        if (session?.provider_token) {
          const updates: any = { google_access_token: session.provider_token };
          if (session.provider_refresh_token) {
            updates.google_refresh_token = session.provider_refresh_token;
          }
          await supabase.from('profiles').update(updates).eq('id', user.id);
        }

        setStatusText('Syncing calendars...');
        setProgress(30);
        
        const syncPromises = [
          supabase.functions.invoke('sync-calendar'),
          supabase.functions.invoke('sync-apple-calendar')
        ];

        const results = await Promise.allSettled(syncPromises);
        setProgress(60);
        
        const googleResult = results[0];
        if (googleResult.status === 'fulfilled') {
          const { error } = googleResult.value;
          if (error) {
            const errorMsg = (error?.message || "").toLowerCase();
            if (errorMsg.includes("401") || errorMsg.includes("unauthorized") || errorMsg === "auth_expired") {
              setTokenMissing(true);
              setIsProcessing(false);
              showError("Google session expired. Please reconnect.");
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
      
      const { data: fetchedEvents } = await supabase
        .from('calendar_events_cache')
        .select('*')
        .eq('user_id', user.id)
        .order('start_time', { ascending: true });

      if (fetchedEvents && fetchedEvents.length > 0) {
        const { data: settings } = await supabase.from('user_settings').select('movable_keywords, locked_keywords, work_keywords, natural_language_rules').single();
        
        const batchSize = 10;
        for (let i = 0; i < fetchedEvents.length; i += batchSize) {
          const batch = fetchedEvents.slice(i, i + batchSize);
          const classificationProgress = Math.round(((i + batch.length) / fetchedEvents.length) * 100);
          setStatusText(`AI is vetting tasks (${classificationProgress}%)...`);
          setProgress(75 + (classificationProgress * 0.2));

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
        .eq('user_id', user.id)
        .order('start_time', { ascending: true });
        
      setEvents(finalEvents || []);
      setProgress(100);
      
      setTimeout(() => {
        if (forceVetRedirect || currentStep !== 'active_plan') {
          if (finalEvents && finalEvents.length > 0) {
            navigate('/vet');
          } else {
            showError("No calendar events found.");
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
    setIsProcessing(true);
    setProposal(null);
    setAppliedChanges([]);
    setCurrentStep('initial');
    setProgress(0);
    setStatusText('Performing full system sync...');
    try {
      const { error } = await supabase.rpc('full_reset_user_data');
      if (error) throw error;
      setProgress(20);
      await runAnalysis(false, true);
    } catch (err: any) {
      showError("Sync failed: " + err.message);
      setIsProcessing(false);
    }
  };

  const runOptimisation = async (isResuggest = false, overrideAppliedIds?: string[], range?: DateRange) => {
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
      const currentApplied = overrideAppliedIds !== undefined ? overrideAppliedIds : (isResuggest ? appliedChanges : []);

      const { data, error } = await supabase.functions.invoke('optimise-schedule', {
        body: {
          durationOverride: durationOverride === "original" ? null : parseInt(durationOverride),
          maxTasksOverride,
          maxHoursOverride,
          slotAlignment: parseInt(slotAlignment),
          selectedDays,
          placeholderDate,
          vettedEventIds: currentApplied,
          startDate: range?.from?.toISOString(),
          endDate: range?.to?.toISOString()
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
        metadata: { selectedDays, maxTasksOverride, maxHoursOverride, durationOverride, isResuggest, placeholderDate, range }
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

  const applyChanges = async (changesToApply: any[]) => {
    if (changesToApply.length === 0) return;
    
    setIsProcessing(true);
    setStatusText(`Syncing ${changesToApply.length} changes...`);
    setProgress(0);

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

      for (let i = 0; i < changesToApply.length; i++) {
        const change = changesToApply[i];
        
        if (!change.new_start) {
          if (!newAppliedIds.includes(change.event_id)) newAppliedIds.push(change.event_id);
          continue;
        }

        const eventIdx = updatedEvents.findIndex(e => e.event_id === change.event_id);
        if (eventIdx === -1) continue;
        const eventInCache = updatedEvents[eventIdx];

        setStatusText(`Syncing: ${change.title}...`);
        setProgress(Math.round((i / changesToApply.length) * 100));

        const { error: pushError } = await supabase.functions.invoke('push-to-provider', {
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
      setProgress(100);
      showSuccess(`Successfully synced ${changesToApply.length} changes`);
    } catch (err: any) {
      showError(err.message);
      throw err;
    } finally {
      setTimeout(() => setIsProcessing(false), 500);
    }
  };

  const handleApplyDay = async (dateChanges: any[]) => {
    await applyChanges(dateChanges);
  };

  const handleSyncAll = async () => {
    if (!proposal) return;
    const unappliedChanges = proposal.proposed_changes.filter((c: any) => !c.applied);
    if (unappliedChanges.length === 0) {
      showSuccess("All changes already applied");
      return;
    }
    await applyChanges(unappliedChanges);
  };

  const handleSyncRange = async () => {
    if (!proposal || !dateRange?.from || !dateRange?.to) return;
    
    const start = startOfDay(dateRange.from);
    const end = endOfDay(dateRange.to);

    const rangeChanges = proposal.proposed_changes.filter((c: any) => {
      if (c.applied || !c.new_start) return false;
      const changeDate = parseISO(c.new_start);
      // Use inclusive check for the range
      return isWithinInterval(changeDate, { start, end });
    });

    if (rangeChanges.length === 0) {
      showSuccess("No unapplied changes in this range");
      return;
    }
    await applyChanges(rangeChanges);
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
        
        if (!change.old_start) continue;
        const oldStart = parseISO(change.old_start);
        if (!isValid(oldStart)) continue;

        const oldDuration = change.old_duration || eventInCache.duration_minutes || 30;
        const oldEnd = addMinutes(oldStart, oldDuration).toISOString();

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
          .update({ start_time: change.old_start, end_time: oldEnd, duration_minutes: oldDuration, last_synced_at: new Date().toISOString() })
          .eq('event_id', change.event_id);

        updatedEvents[eventIdx] = { ...eventInCache, start_time: change.old_start, end_time: oldEnd, duration_minutes: oldDuration };
      }

      const updatedProposedChanges = proposal.proposed_changes.map((c: any) => ({ ...c, applied: newAppliedIds.includes(c.event_id) }));
      await supabase.from('optimisation_history').update({ proposed_changes: updatedProposedChanges }).eq('id', proposal.id);
      
      setEvents(updatedEvents);
      setAppliedChanges(newAppliedIds);
      setProposal({ ...proposal, proposed_changes: updatedProposedChanges });
      return newAppliedIds;
    } catch (err: any) { 
      showError("Failed to undo: " + err.message); 
      throw err;
    }
  };

  const handleUndoAndResuggest = async (dateChanges: any[]) => {
    try {
      const newAppliedIds = await handleUndoApplyDay(dateChanges);
      await runOptimisation(true, newAppliedIds);
      showSuccess("Day reverted and reshuffled.");
    } catch (err: any) {
      console.error("[Plan] handleUndoAndResuggest error:", err);
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
        dateRange={dateRange}
        setDateRange={setDateRange}
        onSyncAll={handleSyncAll}
        onSyncRange={handleSyncRange}
        onResuggestRange={() => runOptimisation(true, undefined, dateRange)}
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
              onUndoAndResuggestDay={handleUndoAndResuggest}
              onResuggestDay={() => runOptimisation(true)}
              onReinsertTask={handleReinsertTask}
              maxHours={maxHoursOverride}
              maxTasks={maxTasksOverride}
              workKeywords={settings?.work_keywords}
              selectedDays={selectedDays}
              dateRange={dateRange}
            />
          )}
        </>
      )}
    </Layout>
  );
};

export default Plan;