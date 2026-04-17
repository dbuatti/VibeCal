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
    const { durationOverride, maxTasksOverride, slotAlignment = 15 } = await req.json();
    
    console.log(`[optimise-schedule] Config: duration=${durationOverride}, maxTasks=${maxTasksOverride}, alignment=${slotAlignment}m`);

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    
    const [settingsRes, profileRes, eventsRes] = await Promise.all([
      supabaseClient.from('user_settings').select('*').eq('user_id', user.id).single(),
      supabaseClient.from('profiles').select('timezone').eq('id', user.id).single(),
      supabaseClient.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true })
    ]);

    const settings = settingsRes.data || { day_start_time: '09:00', day_end_time: '17:00', max_hours_per_day: 6, max_tasks_per_day: 5 };
    const userTimezone = profileRes.data?.timezone || 'UTC';
    const allEvents = eventsRes.data || [];

    const fixedEvents = allEvents.filter(e => e.is_locked);
    const movableEvents = allEvents.filter(e => !e.is_locked);

    if (movableEvents.length === 0) {
      console.log("[optimise-schedule] No movable events to process.");
      return new Response(JSON.stringify({ message: 'No movable events found.', changes: [] }), { headers: corsHeaders });
    }

    const proposedChanges = [];
    
    const getOffset = (date) => {
      const tzDate = new Date(date.toLocaleString('en-US', { timeZone: userTimezone }));
      const diff = tzDate.getTime() - date.getTime();
      return Math.round(diff / 3600000);
    };

    // Helper to snap time to alignment (e.g. 14:10 -> 14:15 or 14:30)
    const alignTime = (date, alignmentMinutes) => {
      const ms = alignmentMinutes * 60 * 1000;
      return new Date(Math.ceil(date.getTime() / ms) * ms);
    };

    // Start from tomorrow
    let currentDay = new Date();
    currentDay.setDate(currentDay.getDate() + 1);
    currentDay.setHours(0, 0, 0, 0);

    let currentPointer = new Date(currentDay.getTime());
    const [startH, startM] = settings.day_start_time.split(':').map(Number);
    const [endH, endM] = settings.day_end_time.split(':').map(Number);

    const dailyStats = new Map();
    const maxTasks = maxTasksOverride || settings.max_tasks_per_day || 5;

    for (const event of movableEvents) {
      const effectiveDuration = durationOverride || event.duration_minutes;
      const durationMs = effectiveDuration * 60000;
      
      let foundSlot = false;
      let attempts = 0;

      console.log(`[optimise-schedule] Processing task: "${event.title}" (${effectiveDuration}m)`);

      while (!foundSlot && attempts < 14) {
        const dayKey = currentPointer.toISOString().split('T')[0];
        const offset = getOffset(currentPointer);

        if (!dailyStats.has(dayKey)) {
          dailyStats.set(dayKey, { tasks: 0, hours: 0 });
          currentPointer.setUTCHours(startH - offset, startM, 0, 0);
          // Ensure start of day is aligned
          currentPointer = alignTime(currentPointer, slotAlignment);
        }
        
        const stats = dailyStats.get(dayKey);
        const dayEnd = new Date(currentPointer);
        dayEnd.setUTCHours(endH - offset, endM, 0, 0);

        const potentialEnd = new Date(currentPointer.getTime() + durationMs);
        const potentialHours = stats.hours + (effectiveDuration / 60);

        // Check limits
        const pastWorkday = potentialEnd > dayEnd;
        const pastHoursLimit = potentialHours > (settings.max_hours_per_day || 24);
        const pastTasksLimit = stats.tasks >= maxTasks;

        if (pastWorkday || pastHoursLimit || pastTasksLimit) {
          console.log(`[optimise-schedule] Day ${dayKey} full or past limit. Moving to next day.`);
          currentPointer.setUTCDate(currentPointer.getUTCDate() + 1);
          currentPointer.setUTCHours(startH - offset, startM, 0, 0);
          currentPointer = alignTime(currentPointer, slotAlignment);
          attempts++;
          continue;
        }

        // Collision detection
        const collision = fixedEvents.find(f => {
          const fStart = new Date(f.start_time);
          const fEnd = new Date(f.end_time);
          return (currentPointer < fEnd && potentialEnd > fStart);
        });

        if (collision) {
          console.log(`[optimise-schedule] Collision with "${collision.title}" at ${currentPointer.toISOString()}. Jumping past it.`);
          currentPointer = new Date(new Date(collision.end_time).getTime() + 1 * 60000); // 1 min buffer
          currentPointer = alignTime(currentPointer, slotAlignment);
        } else {
          foundSlot = true;
          stats.tasks += 1;
          stats.hours += (effectiveDuration / 60);
          console.log(`[optimise-schedule] Slot found: ${currentPointer.toISOString()} to ${potentialEnd.toISOString()}`);
        }
      }

      if (foundSlot) {
        proposedChanges.push({
          event_id: event.event_id,
          title: event.title,
          old_start: event.start_time,
          old_duration: event.duration_minutes,
          new_start: currentPointer.toISOString(),
          new_end: new Date(currentPointer.getTime() + durationMs).toISOString(),
          duration: effectiveDuration
        });
        // Move pointer for next task and align it
        currentPointer = new Date(currentPointer.getTime() + durationMs + 5 * 60000); // 5 min gap
        currentPointer = alignTime(currentPointer, slotAlignment);
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
    console.error("[optimise-schedule] Fatal Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})