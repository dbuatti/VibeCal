"use client";

import React, { useEffect, useState } from 'react';
import Layout from '@/components/Layout';
import { supabase } from '@/lib/supabase';
import { showSuccess, showError } from '@/utils/toast';
import DayByDayPlanner from '@/components/DayByDayPlanner';
import { Card, CardContent } from '@/components/ui/card';
import { Brain, RefreshCw, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';

const Plan = () => {
  const [loading, setLoading] = useState(true);
  const [proposal, setProposal] = useState<any>(null);
  const [events, setEvents] = useState<any[]>([]);
  const [appliedChanges, setAppliedChanges] = useState<string[]>([]);
  const [settings, setSettings] = useState<any>(null);

  const fetchData = async () => {
    setLoading(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      // Get latest proposed optimisation
      const { data: history } = await supabase
        .from('optimisation_history')
        .select('*')
        .eq('user_id', user.id)
        .eq('status', 'proposed')
        .order('run_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      // Get current events and settings
      const [eventsRes, settingsRes] = await Promise.all([
        supabase.from('calendar_events_cache').select('*').eq('user_id', user.id),
        supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle()
      ]);

      if (history) setProposal(history);
      if (eventsRes.data) setEvents(eventsRes.data);
      if (settingsRes.data) setSettings(settingsRes.data);
    } catch (err: any) {
      showError("Failed to load your plan");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleApplyDay = async (dateChanges: any[]) => {
    try {
      const { data: { session } } = await supabase.auth.getSession();
      
      for (const change of dateChanges) {
        const eventInCache = events.find(e => e.event_id === change.event_id);
        if (!eventInCache) continue;

        // Sync to provider
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

        // Update cache
        await supabase.from('calendar_events_cache')
          .update({ 
            start_time: change.new_start, 
            end_time: change.new_end, 
            duration_minutes: change.duration,
            last_synced_at: new Date().toISOString() 
          })
          .eq('event_id', change.event_id);
        
        setAppliedChanges(prev => [...prev, change.event_id]);
      }
    } catch (err: any) {
      showError(err.message);
      throw err;
    }
  };

  if (loading) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-[60vh]">
          <RefreshCw className="animate-spin text-indigo-600 w-12 h-12 mb-4" />
          <p className="text-gray-500 font-bold">Loading your daily plan...</p>
        </div>
      </Layout>
    );
  }

  if (!proposal) {
    return (
      <Layout>
        <div className="max-w-2xl mx-auto text-center py-20">
          <div className="w-20 h-20 bg-indigo-50 rounded-3xl flex items-center justify-center mx-auto mb-8">
            <Brain className="text-indigo-600" size={40} />
          </div>
          <h1 className="text-3xl font-black text-gray-900 mb-4">No Active Plan Found</h1>
          <p className="text-gray-500 text-lg mb-10">
            You haven't generated a proposed schedule yet. Head over to the Optimiser to align your tasks.
          </p>
          <Link to="/optimise">
            <Button className="bg-indigo-600 hover:bg-indigo-700 text-white rounded-2xl px-10 py-8 text-xl font-black shadow-xl shadow-indigo-100">
              Go to Optimiser
            </Button>
          </Link>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <div className="mb-10">
        <div className="flex items-center gap-3 mb-2">
          <Badge className="bg-indigo-100 text-indigo-700 border-none px-3 py-1 rounded-lg font-bold flex gap-2">
            <Brain size={14} /> ADHD Focus Mode
          </Badge>
        </div>
        <h1 className="text-4xl font-black text-gray-900">Daily Plan</h1>
        <p className="text-gray-500 mt-2">Review and confirm your schedule one day at a time.</p>
      </div>

      <DayByDayPlanner 
        events={events}
        changes={proposal.proposed_changes}
        appliedChanges={appliedChanges}
        onApplyDay={handleApplyDay}
        maxHours={settings?.max_hours_per_day || 6}
        maxTasks={settings?.max_tasks_per_day || 5}
      />
    </Layout>
  );
};

export default Plan;