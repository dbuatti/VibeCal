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
import { format, nextSaturday, parseISO, addMinutes, isAfter } from 'date-fns';
import { AlertCircle, LogIn, Sparkles, Calendar, RefreshCw } from 'lucide-react';
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
      
      // If we have a fresh provider token from the session, update the profile immediately
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

  const runAnalysis = async (skipSync = false) => {
    setIsProcessing(true);
    setTokenMissing(false);
    
    try {
      let totalSynced = 0;

      if (!skipSync) {
        setStatusText('Authenticating...');
        const { data: { session } } = await supabase.auth.getSession();
        const { data: { user } } = await supabase.auth.getUser();
        
        let token = session?.provider_token;

        // If session token is missing, try to get the cached one from the profile
        if (!token && user) {
          const { data: profile } = await supabase
            .from('profiles')
            .select('google_access_token')
            .eq('id', user.id)
            .single();
          token = profile?.google_access_token;
        }

        setStatusText('Syncing calendars...');
        
        const syncPromises = [
          supabase.functions.invoke('sync-calendar', { body: { googleAccessToken: token } }),
          supabase.functions.invoke('sync-apple-calendar')
        ];

        const results = await Promise.allSettled(syncPromises);
        
        const googleResult = results[0];
        if (googleResult.status === 'fulfilled') {
          const { data, error } = googleResult.value;
          
          // Check for 401 or specific Google auth errors
          if (error || data?.error) {
            const errorMsg = (error?.message || data?.error || "").toLowerCase();
            const isAuthError = errorMsg.includes("401") || 
                               errorMsg.includes("unauthorized") || 
                               errorMsg.includes("invalid credentials") ||
                               errorMsg.includes("missing google access token");

            if (isAuthError) {
              setTokenMissing(true);
              setIsProcessing(false);
              showError("Google session expired. Please reconnect.");
              return;
            }
            
            // If it's not an auth error but still an error, show it
            if (errorMsg) showError(`Google Sync: ${errorMsg}`);
          } else {
            totalSynced += (data?.count || 0);
          }
        }

        const appleResult = results[1];
        if (appleResult.status === 'fulfilled') {
          const { data } = appleResult.value;
          totalSynced += (data?.count || 0);
        }
      } else {
        setStatusText('Loading cached data...');
      }
      
      setStatusText('Updating local view...');
      const { data: { user } } = await supabase.auth.getUser();
      const { data: fetchedEvents } = await supabase
        .from('calendar_events_cache')
        .select('*')
        .eq('user_id', user?.id)
        .order('start_time', { ascending: true });
        
      const newEvents = fetchedEvents || [];
      setEvents(newEvents);
      
      if (newEvents.length === 0 && !skipSync) {
        showError("Sync complete, but no events were found. Check your calendar settings.");
      } else {
        showSuccess(skipSync ? 'Loaded from cache!' : `Sync complete! Found ${newEvents.length} events.`);
        
        if (currentStep !== 'active_plan') {
          if (newEvents.length > 0) {
            navigate('/vet');
          } else {
            setCurrentStep('initial');
          }
        }
      }
    } catch (err: any) { 
      showError(err.message); 
    }
    finally { 
      setIsProcessing(false); 
    }
  };

  const handleReauth = async () => {
    // Force a sign out to clear all session data and force a fresh Google login
    await supabase.auth.signOut();
    navigate('/login');
  };

  const handleFullReset = async () => {
    setIsProcessing(true);
    setStatusText('Performing atomic system reset...');
    try {
      const { error } = await supabase.rpc('full_reset_user_data');
      if (error) throw error;
      
      setEvents([]);
      setProposal(null);
      setAppliedChanges([]);
      setCurrentStep('initial');
      
      showSuccess("System reset complete. Starting fresh sync...");
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
    
    const dayEvents = [
      ...events.filter(e => format(parseISO(e.start_time), 'yyyy-MM-dd') === targetDateStr),
      ...proposal.proposed_changes.filter((c: any) => 
        c.event_id !== eventId && 
        format(parseISO(c.new_start), 'yyyy-MM-dd') === targetDateStr
      )
    ];

    let lastEnd = new Date(targetDate);
    const [startH, startM] = (settings?.day_start_time || '09:00').split(':').map(Number);
    lastEnd.setHours(startH, startM, 0, 0);

    dayEvents.forEach(e => {
      const end = parseISO(e.end_time || e.new_end);
      if (isAfter(end, lastEnd)) lastEnd = end;
    });

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
        <Card className="border-none shadow-2xl rounded-[2.5rem] overflow-hidden bg-white mb-10 animate-in zoom-in-95 duration-500 border-l-8 border-l-amber-400">
          <div className="p-12 text-center space-y-8">
            <div className="w-20 h-20 bg-amber-50 rounded-3xl flex items-center justify-center mx-auto shadow-inner">
              <AlertCircle className="text-amber-500" size={40} />
            </div>
            <div className="space-y-3">
              <h2 className="text-3xl font-black text-gray-900 tracking-tight">Google Connection Expired</h2>
              <p className="text-gray-500 font-medium max-w-md mx-auto leading-relaxed">
                Your Google session has timed out or the credentials are no longer valid. Please reconnect to continue syncing your calendar.
              </p>
            </div>
            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Button onClick={handleReauth} className="w-full sm:w-auto bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-10 py-8 text-lg font-black shadow-xl shadow-indigo-100 transition-all hover:scale-[1.02] active:scale-[0.98]">
                <LogIn className="mr-3" size={20} /> Reconnect Google
              </Button>
              <Button variant="ghost" onClick={() => setTokenMissing(false)} className="text-gray-400 font-black text-xs uppercase tracking-widest hover:bg-gray-50 rounded-xl">
                Dismiss
              </Button>
            </div>
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
            />
          )}
          
          {currentStep === 'active_plan' && !proposal && events.length > 0 && (
            <div className="text-center py-20">
              <Calendar className="mx-auto text-gray-200 mb-4" size={48} />
              <h3 className="text-xl font-black text-gray-900">No Active Plan</h3>
              <p className="text-gray-500 mb-8">You have events synced, but no plan has been generated yet.</p>
              <Button onClick={() => setCurrentStep('requirements')} className="bg-indigo-600 text-white rounded-xl px-8 py-6 font-black">
                Generate Plan
              </Button>
            </div>
          )}
        </>
      )}
    </Layout>
  );
};

export default Plan;