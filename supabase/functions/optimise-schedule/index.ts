// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { format, parseISO, addMinutes, isBefore, isAfter, startOfDay, endOfDay, differenceInMinutes } from 'https://esm.sh/date-fns@2.30.0'
import { formatInTimeZone, zonedTimeToUtc } from 'https://esm.sh/date-fns-tz@2.0.0'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const supabase = createClient(supabaseUrl, supabaseKey);

    // 1. Get User
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
      vettedEventIds = []
    } = body;

    // 2. Fetch Data
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

    // 3. Scheduling Logic
    const proposedChanges = [];
    const fixedEvents = allEvents.filter(e => e.is_locked || vettedEventIds.includes(e.event_id));
    const movableEvents = allEvents.filter(e => !e.is_locked && !vettedEventIds.includes(e.event_id));

    // Start from today in user's timezone
    const now = new Date();
    const todayStr = formatInTimeZone(now, userTimezone, 'yyyy-MM-dd');
    
    let currentMovableIdx = 0;

    // Iterate through each day for the next 14 days
    for (let d = 0; d < 14; d++) {
      const currentDayDate = addMinutes(zonedTimeToUtc(`${todayStr}T00:00:00`, userTimezone), d * 24 * 60);
      const dayOfWeek = (currentDayDate.getDay() + 6) % 7; // 0 = Monday
      
      if (!selectedDays.includes(dayOfWeek)) continue;

      const dayStr = formatInTimeZone(currentDayDate, userTimezone, 'yyyy-MM-dd');
      
      // Create boundaries in UTC but based on user's local time
      const dayStart = zonedTimeToUtc(`${dayStr}T${settings.day_start_time || '09:00'}:00`, userTimezone);
      const dayEnd = zonedTimeToUtc(`${dayStr}T${settings.day_end_time || '17:00'}:00`, userTimezone);
      
      const dayFixedEvents = fixedEvents.filter(e => {
        const start = parseISO(e.start_time);
        return formatInTimeZone(start, userTimezone, 'yyyy-MM-dd') === dayStr;
      });

      // Calculate existing work duration for this day
      let dailyWorkMinutes = 0;
      let lastWorkEnd = new Date(0);
      dayFixedEvents.filter(isWorkEvent).forEach(e => {
        const start = parseISO(e.start_time);
        const end = parseISO(e.end_time);
        if (isAfter(end, lastWorkEnd)) {
          const effectiveStart = isBefore(start, lastWorkEnd) ? lastWorkEnd : start;
          dailyWorkMinutes += differenceInMinutes(end, effectiveStart);
          lastWorkEnd = end;
        }
      });

      let dailyTaskCount = dayFixedEvents.filter(e => {
        const title = e.title?.toLowerCase() || '';
        return !title.includes('lunch') && !title.includes('break') && !title.includes('dinner');
      }).length;

      let currentTime = dayStart;
      const maxDailyMinutes = (maxHoursOverride || settings.max_hours_per_day || 6) * 60;
      const maxDailyTasks = maxTasksOverride || settings.max_tasks_per_day || 5;

      // Try to fit movable events into slots
      while (currentTime < dayEnd && currentMovableIdx < movableEvents.length) {
        // Check if we've hit limits
        if (dailyWorkMinutes >= maxDailyMinutes || dailyTaskCount >= maxDailyTasks) break;

        const event = movableEvents[currentMovableIdx];
        const duration = durationOverride === "original" || !durationOverride ? (event.duration_minutes || 30) : parseInt(durationOverride);

        // Find next available slot
        let slotStart = currentTime;
        let slotEnd = addMinutes(slotStart, duration);

        // Check for collisions with fixed events
        const collision = dayFixedEvents.find(f => {
          const fStart = parseISO(f.start_time);
          const fEnd = parseISO(f.end_time);
          return (isBefore(slotStart, fEnd) && isAfter(slotEnd, fStart));
        });

        if (collision) {
          currentTime = parseISO(collision.end_time);
          // Align to slot
          const minutes = currentTime.getMinutes();
          const alignment = parseInt(slotAlignment) || 15;
          const remainder = minutes % alignment;
          if (remainder !== 0) {
            currentTime = addMinutes(currentTime, alignment - remainder);
          }
          continue;
        }

        // If slot is within day boundaries
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

          if (isWorkEvent(event)) {
            dailyWorkMinutes += duration;
          }
          dailyTaskCount++;
          currentMovableIdx++;
          currentTime = slotEnd;
        } else {
          // No more room today
          break;
        }
      }
    }

    // Mark remaining movable events as surplus
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

    return new Response(JSON.stringify({ changes: proposedChanges }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error("[optimise-schedule] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})