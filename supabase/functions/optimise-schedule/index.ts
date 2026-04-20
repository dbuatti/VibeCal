// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { 
  format, 
  parseISO, 
  addMinutes, 
  isBefore, 
  isAfter, 
  startOfDay, 
  differenceInMinutes,
  isValid
} from 'https://esm.sh/date-fns@3.6.0'
import { 
  formatInTimeZone, 
  toDate 
} from 'https://esm.sh/date-fns-tz@3.2.0?deps=date-fns@3.6.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  const functionName = "optimise-schedule";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: { user }, error: userError } = await supabase.auth.getUser(authHeader.replace('Bearer ', ''));
    if (userError || !user) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const { 
      durationOverride, 
      maxTasksOverride, 
      maxHoursOverride,
      slotAlignment = 15, 
      selectedDays = [1, 2, 3, 4, 5],
      placeholderDate,
      vettedEventIds = [],
      targetDate 
    } = body;

    const [settingsRes, eventsRes] = await Promise.all([
      supabase.from('user_settings').select('*').eq('user_id', user.id).single(),
      supabase.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true })
    ]);

    const settings = settingsRes.data || { 
      day_start_time: '09:00', 
      day_end_time: '17:00', 
      max_hours_per_day: 6, 
      max_tasks_per_day: 5,
      timezone: 'Australia/Melbourne',
      work_keywords: ['work', 'session', 'meeting', 'call', 'rehearsal', 'lesson', 'audition', 'coaching', 'appt']
    };
    
    const userTimezone = settings.timezone || 'Australia/Melbourne';
    const allEvents = eventsRes.data || [];
    const workKeywords = settings.work_keywords || [];

    const isWorkEvent = (event) => {
      if (event.is_work === true) return true;
      const title = (event.title || '').toLowerCase();
      return workKeywords.some(kw => title.includes(kw.toLowerCase()));
    };

    const proposedChanges = [];
    // Fixed events are anchors that cannot be moved
    const fixedEvents = allEvents.filter(e => e.is_locked === true || vettedEventIds.includes(e.event_id));
    // Movable events are the ones we are trying to fit into slots
    const movableEvents = allEvents.filter(e => e.is_locked !== true && !vettedEventIds.includes(e.event_id));

    console.log(`[${functionName}] Starting optimisation for user ${user.id}. Movable tasks: ${movableEvents.length}`);

    const now = new Date();
    const todayStr = formatInTimeZone(now, userTimezone, 'yyyy-MM-dd');
    
    let currentMovableIdx = 0;
    const daysToProcess = targetDate ? 1 : 14;
    const startDayStr = targetDate || todayStr;

    for (let d = 0; d < daysToProcess; d++) {
      const currentDayDate = addMinutes(toDate(`${startDayStr}T00:00:00`, { timeZone: userTimezone }), d * 24 * 60);
      const dayOfWeek = currentDayDate.getDay();
      
      // Skip days not in the allowed list unless it's a specific target date request
      if (!targetDate && !selectedDays.includes(dayOfWeek)) continue;

      const dayStr = formatInTimeZone(currentDayDate, userTimezone, 'yyyy-MM-dd');
      const dayStart = toDate(`${dayStr}T${settings.day_start_time || '09:00'}:00`, { timeZone: userTimezone });
      const dayEnd = toDate(`${dayStr}T${settings.day_end_time || '17:00'}:00`, { timeZone: userTimezone });
      
      console.log(`[${functionName}] Processing ${dayStr}. Window: ${format(dayStart, 'HH:mm')} - ${format(dayEnd, 'HH:mm')}`);

      // Get fixed events for this specific day
      const dayFixedEvents = fixedEvents.filter(e => {
        const start = parseISO(e.start_time);
        return isValid(start) && formatInTimeZone(start, userTimezone, 'yyyy-MM-dd') === dayStr;
      });

      let dailyWorkMinutes = 0;
      let lastWorkEnd = new Date(0);
      
      // Calculate existing work load from fixed events
      dayFixedEvents.filter(isWorkEvent).forEach(e => {
        const start = parseISO(e.start_time), end = parseISO(e.end_time);
        if (isAfter(end, lastWorkEnd)) {
          const effectiveStart = isBefore(start, lastWorkEnd) ? lastWorkEnd : start;
          dailyWorkMinutes += differenceInMinutes(end, effectiveStart);
          lastWorkEnd = end;
        }
      });

      let dailyTaskCount = dayFixedEvents.filter(e => {
        const t = e.title?.toLowerCase() || '';
        return !t.includes('lunch') && !t.includes('break') && !t.includes('dinner');
      }).length;

      let currentTime = dayStart;
      const maxDailyMinutes = (Number(maxHoursOverride || settings.max_hours_per_day) || 6) * 60;
      const maxDailyTasks = Number(maxTasksOverride || settings.max_tasks_per_day) || 5;

      // Try to fit movable tasks into the remaining slots
      while (currentTime < dayEnd && currentMovableIdx < movableEvents.length) {
        if (dailyWorkMinutes >= maxDailyMinutes) {
          console.log(`[${functionName}] ${dayStr}: Max work hours reached (${dailyWorkMinutes}m)`);
          break;
        }
        if (dailyTaskCount >= maxDailyTasks) {
          console.log(`[${functionName}] ${dayStr}: Max task count reached (${dailyTaskCount})`);
          break;
        }

        const event = movableEvents[currentMovableIdx];
        const duration = durationOverride === "original" || !durationOverride ? (event.duration_minutes || 30) : parseInt(durationOverride);

        let slotStart = currentTime;
        let slotEnd = addMinutes(slotStart, duration);

        // Check for collisions with fixed events
        const collision = dayFixedEvents.find(f => {
          const fStart = parseISO(f.start_time), fEnd = parseISO(f.end_time);
          return (isBefore(slotStart, fEnd) && isAfter(slotEnd, fStart));
        });

        if (collision) {
          // If there's a collision, move currentTime to the end of the fixed event and align it
          currentTime = parseISO(collision.end_time);
          const alignment = parseInt(slotAlignment) || 15;
          const remainder = currentTime.getMinutes() % alignment;
          if (remainder !== 0) currentTime = addMinutes(currentTime, alignment - remainder);
          
          console.log(`[${functionName}] Collision with "${collision.title}". Moving cursor to ${format(currentTime, 'HH:mm')}`);
          continue;
        }

        // STRICT CHECK: Does the task fit entirely within the work window?
        if (isBefore(slotEnd, dayEnd) || slotEnd.getTime() === dayEnd.getTime()) {
          proposedChanges.push({
            event_id: event.event_id,
            title: event.title,
            old_start: event.start_time,
            new_start: slotStart.toISOString(),
            new_end: slotEnd.toISOString(),
            duration: duration,
            is_surplus: false
          });
          
          if (isWorkEvent(event)) dailyWorkMinutes += duration;
          dailyTaskCount++;
          currentMovableIdx++;
          currentTime = slotEnd;
          
          console.log(`[${functionName}] Scheduled "${event.title}" at ${format(slotStart, 'HH:mm')}`);
        } else { 
          console.log(`[${functionName}] Task "${event.title}" would end at ${format(slotEnd, 'HH:mm')}, which is past dayEnd ${format(dayEnd, 'HH:mm')}. Stopping day.`);
          break; 
        }
      }
    }

    // Any tasks that couldn't be scheduled are marked as surplus
    for (let i = currentMovableIdx; i < movableEvents.length; i++) {
      const event = movableEvents[i];
      proposedChanges.push({
        event_id: event.event_id,
        title: event.title,
        old_start: event.start_time,
        new_start: null,
        new_end: null,
        duration: durationOverride === "original" || !durationOverride ? (event.duration_minutes || 30) : parseInt(durationOverride),
        is_surplus: true
      });
    }

    console.log(`[${functionName}] Optimisation complete. Changes: ${proposedChanges.length}`);

    return new Response(JSON.stringify({ changes: proposedChanges }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})