// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    console.log("[optimise-schedule] Starting optimisation...");
    
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) throw new Error('No authorization header');

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user }, error: userError } = await supabaseClient.auth.getUser()
    if (userError || !user) throw userError || new Error('User not found');

    // 1. Fetch User Settings & Cached Events
    const [settingsRes, eventsRes] = await Promise.all([
      supabaseClient.from('user_settings').select('*').eq('user_id', user.id).single(),
      supabaseClient.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true })
    ]);

    const settings = settingsRes.data || { day_start_time: '09:00', day_end_time: '17:00' };
    const allEvents = eventsRes.data || [];

    // 2. Identify Movable vs Fixed
    const fixedEvents = allEvents.filter(e => e.is_locked);
    const movableEvents = allEvents.filter(e => !e.is_locked);

    if (movableEvents.length === 0) {
      return new Response(
        JSON.stringify({ message: 'No movable events found to optimise.', changes: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // 3. Simple Redistribution Logic: "Pack to Morning"
    // We'll look at tomorrow's schedule as a test
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);
    
    const proposedChanges = [];
    let currentPointer = new Date(tomorrow);
    const [startH, startM] = settings.day_start_time.split(':').map(Number);
    currentPointer.setHours(startH, startM, 0, 0);

    for (const event of movableEvents) {
      const durationMs = event.duration_minutes * 60000;
      
      // Check for collisions with fixed events (simplified for test)
      const collision = fixedEvents.find(f => {
        const fStart = new Date(f.start_time);
        const fEnd = new Date(f.end_time);
        return (currentPointer < fEnd && new Date(currentPointer.getTime() + durationMs) > fStart);
      });

      if (collision) {
        // Move pointer to after the collision
        currentPointer = new Date(new Date(collision.end_time).getTime() + 15 * 60000); // 15 min buffer
      }

      const newStart = new Date(currentPointer);
      const newEnd = new Date(currentPointer.getTime() + durationMs);

      proposedChanges.push({
        event_id: event.event_id,
        title: event.title,
        old_start: event.start_time,
        new_start: newStart.toISOString(),
        new_end: newEnd.toISOString(),
        duration: event.duration_minutes
      });

      // Advance pointer for next task
      currentPointer = new Date(newEnd.getTime() + 15 * 60000);
    }

    return new Response(
      JSON.stringify({ 
        message: 'Optimisation complete', 
        changes: proposedChanges,
        summary: `Redistributed ${proposedChanges.length} movable events.`
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    console.error("[optimise-schedule] Fatal error:", error.message)
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})