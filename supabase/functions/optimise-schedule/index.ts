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
    const authHeader = req.headers.get('Authorization')
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    
    const [settingsRes, eventsRes] = await Promise.all([
      supabaseClient.from('user_settings').select('*').eq('user_id', user.id).single(),
      supabaseClient.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true })
    ]);

    const settings = settingsRes.data || { day_start_time: '09:00', day_end_time: '17:00' };
    const allEvents = eventsRes.data || [];

    const proposedChanges = [];
    
    // Group events by day to ensure we only move things within the same day
    const eventsByDay = allEvents.reduce((acc, event) => {
      const day = event.start_time.split('T')[0];
      if (!acc[day]) acc[day] = [];
      acc[day].push(event);
      return acc;
    }, {});

    for (const day in eventsByDay) {
      const dayEvents = eventsByDay[day];
      const fixed = dayEvents.filter(e => e.is_locked);
      const movable = dayEvents.filter(e => !e.is_locked);

      if (movable.length === 0) continue;

      // Start pointer at the beginning of the work window for THIS day
      let currentPointer = new Date(`${day}T${settings.day_start_time}:00Z`);
      const dayEnd = new Date(`${day}T${settings.day_end_time}:00Z`);

      for (const event of movable) {
        const durationMs = event.duration_minutes * 60000;
        
        // Find a slot that doesn't collide with fixed events
        let foundSlot = false;
        while (!foundSlot && currentPointer < dayEnd) {
          const potentialEnd = new Date(currentPointer.getTime() + durationMs);
          
          const collision = fixed.find(f => {
            const fStart = new Date(f.start_time);
            const fEnd = new Date(f.end_time);
            return (currentPointer < fEnd && potentialEnd > fStart);
          });

          if (collision) {
            currentPointer = new Date(new Date(collision.end_time).getTime() + 10 * 60000); // 10 min buffer
          } else {
            foundSlot = true;
          }
        }

        if (foundSlot && currentPointer.toISOString() !== event.start_time) {
          proposedChanges.push({
            event_id: event.event_id,
            title: event.title,
            old_start: event.start_time,
            new_start: currentPointer.toISOString(),
            new_end: new Date(currentPointer.getTime() + durationMs).toISOString(),
            duration: event.duration_minutes
          });
          
          // Advance pointer for next task
          currentPointer = new Date(currentPointer.getTime() + durationMs + 10 * 60000);
        }
      }
    }

    return new Response(
      JSON.stringify({ 
        message: proposedChanges.length > 0 ? 'Optimisation complete' : 'Schedule is already optimal', 
        changes: proposedChanges 
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})