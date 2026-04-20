// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { 
  parseISO, 
  addMinutes, 
  isBefore, 
  isAfter, 
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

    // Fetch both settings and profile to get the most accurate timezone
    const [settingsRes, profileRes, eventsRes] = await Promise.all([
      supabase.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
      supabase.from('profiles').select('timezone').eq('id', user.id).maybeSingle(),
      supabase.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true })
    ]);

    const settings = settingsRes.data || {};
    const profile = profileRes.data || {};
    
    // Priority: Settings > Profile > Default Melbourne
    const userTimezone = settings.timezone || profile.timezone || 'Australia/Melbourne';
    const allEvents = eventsRes.data || [];
    const workKeywords = settings.work_keywords || ['work', 'session', 'meeting', 'call', 'rehearsal', 'lesson', 'audition', 'coaching', 'appt'];

    const isWorkEvent = (event) => {
      if (event.is_work === true) return true;
      const title = (event.title || '').toLowerCase();
      return workKeywords.some(kw => title.includes(kw.toLowerCase()));
    };

    const proposedChanges = [];
    const fixedEvents = allEvents.filter(e => e.is_locked === true || vettedEventIds.includes(e.event_id));
    const movableEvents = allEvents.filter(e => e.is_locked !== true && !vettedEventIds.includes(e.event_id));

    console.log(`[${functionName}] User: ${user.id} | TZ: ${userTimezone} | Movable: ${movableEvents.length}`);

    const now = new Date();
    const todayStr = formatInTimeZone(now, userTimezone, 'yyyy-MM-dd');
    
    let currentMovableIdx = 0;
    const daysToProcess = targetDate ? 1 : 14;
    const startDayStr = targetDate || todayStr;

    for (let d = 0; d < daysToProcess; d++) {
      const baseDate = toDate(`${startDayStr}T00:00:00`, { timeZone: userTimezone });
      const currentDayDate = addMinutes(baseDate, d * 24 * 60);
      const dayOfWeek = currentDayDate.getDay();
      
      if (!targetDate && !selectedDays.includes(dayOfWeek)) continue;

      const dayStr = formatInTimeZone(currentDayDate, userTimezone, 'yyyy-MM-dd');
      
      // CRITICAL: Ensure window is created in the user's local timezone
      const dayStart = toDate(`${dayStr}T${settings.day_start_time || '09:00'}:00`, { timeZone: userTimezone });
      const dayEnd = toDate(`${dayStr}T${settings.day_end_time || '17:00'}:00`, { timeZone: userTimezone });
      
      console.log(`[${functionName}] Day: ${dayStr} | Window: ${formatInTimeZone(dayStart, userTimezone, 'HH:mm')} - ${formatInTimeZone(dayEnd, userTimezone, 'HH:mm')}`);

      const dayFixedEvents = fixedEvents.filter(e => {
        const start = parseISO(e.start_time);
        return isValid(start) && formatInTimeZone(start, userTimezone, 'yyyy-MM-dd') === dayStr;
      });

      let dailyWorkMinutes = 0;
      let lastWorkEnd = new Date(0);
      
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
      const maxDailyTasks = Number(maxTasksOverride || settings.max_tasks_per_day) || 50; // Default to 50 if not specified

      while (currentTime < dayEnd && currentMovableIdx < movableEvents.length) {
        if (dailyWorkMinutes >= maxDailyMinutes) {
          console.log(`[${functionName}] ${dayStr}: Max work hours reached (${maxDailyMinutes/60}h)`);
          break;
        }
        if (dailyTaskCount >= maxDailyTasks) {
          console.log(`[${functionName}] ${dayStr}: Max task count reached (${maxDailyTasks})`);
          break;
        }

        const event = movableEvents[currentMovableIdx];
        const duration = durationOverride === "original" || !durationOverride ? (event.duration_minutes || 30) : parseInt(durationOverride);

        let slotStart = currentTime;
        let slotEnd = addMinutes(slotStart, duration);

        const collision = dayFixedEvents.find(f => {
          const fStart = parseISO(f.start_time), fEnd = parseISO(f.end_time);
          return (isBefore(slotStart, fEnd) && isAfter(slotEnd, fStart));
        });

        if (collision) {
          currentTime = parseISO(collision.end_time);
          const alignment = parseInt(slotAlignment) || 15;
          const remainder = currentTime.getMinutes() % alignment;
          if (remainder !== 0) currentTime = addMinutes(currentTime, alignment - remainder);
          continue;
        }

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
        } else { 
          break; 
        }
      }
    }

    // Handle overflow
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