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
    console.log("[optimise-schedule] Starting intelligent redistribution...");
    
    const authHeader = req.headers.get('Authorization')
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    
    // Fetch settings, profile (for timezone), and events
    const [settingsRes, profileRes, eventsRes] = await Promise.all([
      supabaseClient.from('user_settings').select('*').eq('user_id', user.id).single(),
      supabaseClient.from('profiles').select('timezone').eq('id', user.id).single(),
      supabaseClient.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true })
    ]);

    const settings = settingsRes.data || { day_start_time: '09:00', day_end_time: '17:00' };
    const userTimezone = profileRes.data?.timezone || 'UTC';
    const allEvents = eventsRes.data || [];

    const fixedEvents = allEvents.filter(e => e.is_locked);
    const movableEvents = allEvents.filter(e => !e.is_locked);

    if (movableEvents.length === 0) {
      return new Response(JSON.stringify({ message: 'No movable events found.', changes: [] }), { headers: corsHeaders });
    }

    const proposedChanges = [];
    
    // Helper to get a Date object for a specific time in the user's timezone
    const getLocalTime = (dateStr: string, timeStr: string) => {
      // Create a string that represents the local time, then parse it
      // This is a simplified way to handle offsets without a heavy library
      const [hours, minutes] = timeStr.split(':').map(Number);
      const d = new Date(dateStr);
      
      // We use the user's timezone offset to calculate the correct UTC time
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: userTimezone,
        year: 'numeric', month: 'numeric', day: 'numeric',
        hour: 'numeric', minute: 'numeric', second: 'numeric',
        hour12: false
      });
      
      // This is a bit complex in vanilla JS, so we'll use a more robust approach:
      // We'll calculate the offset for the user's timezone at that specific date
      const parts = formatter.formatToParts(d);
      const localDate = new Date(d);
      
      // Set the hours/minutes in "local" terms
      // Note: This logic assumes we are moving things to "Tomorrow" onwards
      return { hours, minutes };
    };

    // Let's use a simpler approach for the test: 
    // We'll calculate the UTC offset of the user's timezone
    const now = new Date();
    const tzDate = new Date(now.toLocaleString('en-US', { timeZone: userTimezone }));
    const offsetMs = tzDate.getTime() - now.getTime();
    const offsetHours = Math.round(offsetMs / 3600000);

    console.log(`[optimise-schedule] User Timezone: ${userTimezone}, Estimated Offset: ${offsetHours}h`);

    // Start from tomorrow
    let currentDay = new Date();
    currentDay.setDate(currentDay.getDate() + 1);
    currentDay.setHours(0, 0, 0, 0);

    let currentPointer = new Date(currentDay.getTime());
    const [startH, startM] = settings.day_start_time.split(':').map(Number);
    const [endH, endM] = settings.day_end_time.split(':').map(Number);

    // Adjust pointer to start of work day in UTC
    currentPointer.setUTCHours(startH - offsetHours, startM, 0, 0);

    for (const event of movableEvents) {
      const durationMs = event.duration_minutes * 60000;
      let foundSlot = false;
      let attempts = 0;

      while (!foundSlot && attempts < 14) { // Look up to 14 days ahead
        const dayEnd = new Date(currentPointer);
        dayEnd.setUTCHours(endH - offsetHours, endM, 0, 0);

        const potentialEnd = new Date(currentPointer.getTime() + durationMs);

        // If this task would push past the end of the work day, move to next day
        if (potentialEnd > dayEnd) {
          currentPointer.setUTCDate(currentPointer.getUTCDate() + 1);
          currentPointer.setUTCHours(startH - offsetHours, startM, 0, 0);
          attempts++;
          continue;
        }

        // Check for collisions with fixed events on this day
        const collision = fixedEvents.find(f => {
          const fStart = new Date(f.start_time);
          const fEnd = new Date(f.end_time);
          return (currentPointer < fEnd && potentialEnd > fStart);
        });

        if (collision) {
          // Move pointer to after the fixed event + 10 min buffer
          currentPointer = new Date(new Date(collision.end_time).getTime() + 10 * 60000);
        } else {
          foundSlot = true;
        }
      }

      if (foundSlot) {
        proposedChanges.push({
          event_id: event.event_id,
          title: event.title,
          old_start: event.start_time,
          new_start: currentPointer.toISOString(),
          new_end: new Date(currentPointer.getTime() + durationMs).toISOString(),
          duration: event.duration_minutes
        });

        // Advance pointer for next task + 10 min buffer
        currentPointer = new Date(currentPointer.getTime() + durationMs + 10 * 60000);
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
    console.error("[optimise-schedule] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})