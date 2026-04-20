// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { toDate, formatInTimeZone } from "https://esm.sh/date-fns-tz@3.1.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  const functionName = "optimise-schedule";

  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      console.error(`[${functionName}] Missing Authorization header`);
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const body = await req.json().catch(() => ({}));
    const { 
      durationOverride, 
      maxTasksOverride, 
      slotAlignment = 15, 
      selectedDays = [1, 2, 3, 4, 5], 
      placeholderDate,
      vettedEventIds = [] 
    } = body;
    
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseAnonKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

    const supabaseClient = createClient(supabaseUrl, supabaseAnonKey, { 
      global: { headers: { Authorization: authHeader } } 
    });

    const { data: { user }, error: authError } = await supabaseClient.auth.getUser();
    if (authError || !user) {
      console.error(`[${functionName}] Auth error:`, authError?.message || "User not found");
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    console.log(`[${functionName}] START - Optimizing schedule for user ${user.id}`);

    const [settingsRes, profileRes, eventsRes] = await Promise.all([
      supabaseClient.from('user_settings').select('*').eq('user_id', user.id).maybeSingle(),
      supabaseClient.from('profiles').select('timezone').eq('id', user.id).maybeSingle(),
      supabaseClient.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true })
    ]);

    const settings = settingsRes.data || { day_start_time: '09:00', day_end_time: '17:00', max_hours_per_day: 6, max_tasks_per_day: 5 };
    const userTimezone = profileRes.data?.timezone || 'Australia/Melbourne';
    const allEvents = eventsRes.data || [];
    
    const maxTasks = maxTasksOverride || settings.max_tasks_per_day || 5;
    const maxWorkHours = settings.max_hours_per_day || 24;

    const now = new Date();
    const todayStr = formatInTimeZone(now, userTimezone, 'yyyy-MM-dd');
    const localTodayStart = toDate(`${todayStr}T00:00:00`, { timeZone: userTimezone });

    // 1. CLASSIFY TASKS
    let classifications = [];
    try {
      console.log(`[${functionName}] Invoking classify-tasks for ${allEvents.length} events`);
      const { data: classificationData, error: invokeError } = await supabaseClient.functions.invoke('classify-tasks', {
        body: {
          tasks: allEvents.map(e => e.title),
          movableKeywords: settings.movable_keywords || [],
          lockedKeywords: settings.locked_keywords || [],
          naturalLanguageRules: settings.natural_language_rules || ''
        }
      });

      if (invokeError) {
        console.warn(`[${functionName}] classify-tasks invocation error:`, invokeError.message);
      } else {
        classifications = classificationData?.classifications || [];
      }
    } catch (e) {
      console.warn(`[${functionName}] Failed to classify tasks, falling back to defaults:`, e.message);
    }

    const processedEvents = allEvents.map((e, i) => {
      const classification = classifications[i];
      const isMovable = classification?.isMovable ?? !e.is_locked;
      const dependsOn = classification?.dependsOn || null;
      
      return { 
        ...e, 
        is_locked: !isMovable,
        dependsOn: dependsOn
      };
    });

    const fixedEvents = processedEvents.filter(e => e.is_locked || vettedEventIds.includes(e.event_id));
    const movableEvents = processedEvents.filter(e => !e.is_locked && !vettedEventIds.includes(e.event_id));

    console.log(`[${functionName}] Fixed: ${fixedEvents.length}, Movable: ${movableEvents.length}`);

    // 2. SORT MOVABLE TASKS (Prerequisites first)
    const sortedMovable = [...movableEvents].sort((a, b) => {
      if (!a.dependsOn && b.dependsOn) return -1;
      if (a.dependsOn && !b.dependsOn) return 1;
      return 0;
    });

    const alignTime = (date, alignmentMinutes) => {
      const ms = alignmentMinutes * 60 * 1000;
      return new Date(Math.ceil(date.getTime() / ms) * ms);
    };

    const dailyStats = new Map();
    const proposedChanges = [];
    let surplusCount = 0;

    for (const event of sortedMovable) {
      const effectiveDuration = durationOverride === "original" ? event.duration_minutes : (parseInt(durationOverride) || event.duration_minutes);
      const durationMs = effectiveDuration * 60000;
      let foundSlot = false;

      // Find dependency end time if it exists
      let dependencyEndTime = null;
      if (event.dependsOn) {
        const depTitle = event.dependsOn.toLowerCase();
        const fixedDep = fixedEvents.find(f => f.title.toLowerCase().includes(depTitle));
        if (fixedDep) {
          dependencyEndTime = new Date(fixedDep.end_time);
        } else {
          const scheduledDep = proposedChanges.find(p => p.title.toLowerCase().includes(depTitle));
          if (scheduledDep) {
            dependencyEndTime = new Date(scheduledDep.new_end);
          }
        }
      }

      // Try to find a slot in the next 14 days
      for (let pass = 0; pass <= 2; pass++) {
        if (foundSlot) break;
        
        let dayOffset = 0;
        while (!foundSlot && dayOffset <= 14) {
          const currentDay = new Date(localTodayStart.getTime() + (dayOffset * 86400000));
          const dayKey = formatInTimeZone(currentDay, userTimezone, 'yyyy-MM-dd');
          const isToday = (dayKey === todayStr);
          
          const isoDayStr = formatInTimeZone(currentDay, userTimezone, 'i');
          const isoDay = parseInt(isoDayStr);
          const dayOfWeek = isoDay === 7 ? 0 : isoDay;

          if (pass === 0 && !isToday) break; 
          if (!selectedDays.includes(dayOfWeek)) { dayOffset++; continue; }

          if (!dailyStats.has(dayKey)) dailyStats.set(dayKey, { tasks: 0, hours: 0, lastPointer: null });
          const stats = dailyStats.get(dayKey);
          
          if (stats.tasks >= maxTasks || stats.hours >= maxWorkHours) { dayOffset++; continue; }

          const dayStart = toDate(`${dayKey}T${settings.day_start_time}:00`, { timeZone: userTimezone });
          const dayEnd = toDate(`${dayKey}T${settings.day_end_time}:00`, { timeZone: userTimezone });

          if (!stats.lastPointer) {
            let initialPointer = alignTime(dayStart, slotAlignment);
            if (isToday) {
              const nowAligned = alignTime(new Date(), slotAlignment);
              if (nowAligned > initialPointer) initialPointer = nowAligned;
            }
            stats.lastPointer = initialPointer;
          }

          let searchPointer = new Date(stats.lastPointer);

          // Ensure we start after the dependency
          if (dependencyEndTime) {
            const depDayKey = formatInTimeZone(dependencyEndTime, userTimezone, 'yyyy-MM-dd');
            if (depDayKey === dayKey) {
              if (dependencyEndTime > searchPointer) {
                searchPointer = alignTime(dependencyEndTime, slotAlignment);
              }
            } else if (dependencyEndTime > new Date(dayEnd.getTime())) {
              // Dependency is in the future relative to this day
              dayOffset++; continue;
            }
          }

          while (searchPointer < dayEnd && !foundSlot) {
            const potentialEnd = new Date(searchPointer.getTime() + durationMs);
            if (potentialEnd > dayEnd) break;
            
            const collision = fixedEvents.find(f => {
              const fStart = new Date(f.start_time);
              const fEnd = new Date(f.end_time);
              return (searchPointer < fEnd && potentialEnd > fStart);
            });

            if (collision) {
              searchPointer = alignTime(new Date(new Date(collision.end_time).getTime()), slotAlignment);
            } else {
              foundSlot = true;
              stats.tasks += 1;
              stats.hours += (effectiveDuration / 60);
              stats.lastPointer = alignTime(new Date(potentialEnd.getTime()), slotAlignment);

              proposedChanges.push({
                event_id: event.event_id,
                title: event.title,
                old_start: event.start_time,
                old_duration: event.duration_minutes,
                new_start: searchPointer.toISOString(),
                new_end: potentialEnd.toISOString(),
                duration: effectiveDuration,
                is_surplus: false,
                dependsOn: event.dependsOn
              });
            }
          }
          if (!foundSlot) dayOffset++;
        }
      }

      if (!foundSlot && placeholderDate) {
        const pDate = toDate(`${placeholderDate}T${settings.day_start_time}:00`, { timeZone: userTimezone });
        const pStart = new Date(pDate.getTime() + (surplusCount * 60000));
        const pEnd = new Date(pStart.getTime() + durationMs);

        proposedChanges.push({
          event_id: event.event_id,
          title: event.title,
          old_start: event.start_time,
          old_duration: event.duration_minutes,
          new_start: pStart.toISOString(),
          new_end: pEnd.toISOString(),
          duration: effectiveDuration,
          is_surplus: true,
          dependsOn: event.dependsOn
        });
        surplusCount++;
      }
    }

    console.log(`[${functionName}] SUCCESS - Generated ${proposedChanges.length} proposed changes.`);
    return new Response(JSON.stringify({ changes: proposedChanges }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[${functionName}] Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
