// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.1.0"
import { toDate, formatInTimeZone } from "https://esm.sh/date-fns-tz@3.1.1"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const functionName = "optimise-schedule";

  try {
    const authHeader = req.headers.get('Authorization')
    const { 
      durationOverride, 
      maxTasksOverride, 
      slotAlignment = 15, 
      selectedDays = [1, 2, 3, 4, 5], 
      placeholderDate,
      vettedEventIds = [] 
    } = await req.json();
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    
    const [settingsRes, profileRes, eventsRes, themesRes] = await Promise.all([
      supabaseClient.from('user_settings').select('*').eq('user_id', user.id).single(),
      supabaseClient.from('profiles').select('timezone').eq('id', user.id).single(),
      supabaseClient.from('calendar_events_cache').select('*').eq('user_id', user.id).order('start_time', { ascending: true }),
      supabaseClient.from('day_themes').select('*').eq('user_id', user.id)
    ]);

    const settings = settingsRes.data || { 
      day_start_time: '09:00', 
      day_end_time: '17:00', 
      max_hours_per_day: 6, 
      max_tasks_per_day: 5,
      group_similar_tasks: true,
      work_keywords: ['meeting', 'call', 'lesson', 'audition', 'rehearsal']
    };
    const userTimezone = profileRes.data?.timezone || 'Australia/Melbourne';
    const allEvents = eventsRes.data || [];
    const dayThemes = themesRes.data || [];
    const workKeywords = settings.work_keywords || [];

    const maxTasks = maxTasksOverride || settings.max_tasks_per_day || 5;
    const maxWorkHours = settings.max_hours_per_day || 24;

    const now = new Date();
    const todayStr = formatInTimeZone(now, userTimezone, 'yyyy-MM-dd');
    const localTodayStart = toDate(`${todayStr}T00:00:00`, { timeZone: userTimezone });

    console.log(`[${functionName}] --- DIAGNOSTIC START ---`);
    console.log(`[${functionName}] TODAY: ${todayStr} | TZ: ${userTimezone}`);
    console.log(`[${functionName}] SELECTED DAYS: ${JSON.stringify(selectedDays)}`);

    const seenIds = new Set();
    const uniqueEvents = allEvents.filter(e => {
      if (seenIds.has(e.event_id)) return false;
      seenIds.add(e.event_id);
      return new Date(e.start_time) >= localTodayStart;
    });

    const fixedEvents = uniqueEvents.filter(e => e.is_locked || vettedEventIds.includes(e.event_id));
    const movableEvents = uniqueEvents.filter(e => !e.is_locked && !vettedEventIds.includes(e.event_id));

    const alignTime = (date, alignmentMinutes) => {
      const ms = alignmentMinutes * 60 * 1000;
      return new Date(Math.ceil(date.getTime() / ms) * ms);
    };

    const dailyStats = new Map();
    dailyStats.set(todayStr, { tasks: 0, hours: 0, lastPointer: null });

    fixedEvents.forEach(f => {
      const dayKey = formatInTimeZone(new Date(f.start_time), userTimezone, 'yyyy-MM-dd');
      if (!dailyStats.has(dayKey)) dailyStats.set(dayKey, { tasks: 0, hours: 0, lastPointer: null });
      const stats = dailyStats.get(dayKey);
      
      const isWork = workKeywords.some(kw => f.title.toLowerCase().includes(kw.toLowerCase()));
      if (isWork) {
        const duration = (new Date(f.end_time).getTime() - new Date(f.start_time).getTime()) / 3600000;
        stats.hours += duration;
      }
      
      const isTask = !f.title?.toLowerCase().includes('lunch') && 
                     !f.title?.toLowerCase().includes('break') && 
                     !f.title?.toLowerCase().includes('dinner');
      if (isTask) stats.tasks += 1;
    });

    let categories = movableEvents.map(() => "General");
    const themeList = dayThemes.map(t => t.theme).filter(Boolean);
    if (themeList.length > 0) {
      try {
        const geminiKey = Deno.env.get('GEMINI_API_KEY');
        if (geminiKey) {
          const genAI = new GoogleGenerativeAI(geminiKey);
          const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
          const prompt = `Categorize these tasks into exactly one of these themes: [${themeList.join(', ')}]. Tasks: ${movableEvents.map(e => e.title).join(', ')}. Return ONLY a JSON array of strings.`;
          const aiResult = await model.generateContent(prompt);
          const text = (await aiResult.response).text();
          const jsonMatch = text.match(/\[.*\]/s);
          if (jsonMatch) categories = JSON.parse(jsonMatch[0]);
        }
      } catch (e) { 
        categories = movableEvents.map(event => {
          const title = event.title.toLowerCase();
          const matchedTheme = themeList.find(theme => title.includes(theme.toLowerCase()));
          return matchedTheme || "General";
        });
      }
    }

    const categorizedEvents = movableEvents.map((event, index) => ({
      ...event,
      temp_category: categories[index] || "General",
      is_work: workKeywords.some(kw => event.title.toLowerCase().includes(kw.toLowerCase()))
    }));

    if (settings.group_similar_tasks !== false) {
      categorizedEvents.sort((a, b) => a.temp_category.localeCompare(b.temp_category));
    }

    const proposedChanges = [];
    let surplusCount = 0;

    for (const event of categorizedEvents) {
      const effectiveDuration = durationOverride === "original" ? event.duration_minutes : (parseInt(durationOverride) || event.duration_minutes);
      const durationMs = effectiveDuration * 60000;
      let foundSlot = false;

      for (let pass = 0; pass <= 2; pass++) {
        if (foundSlot) break;
        
        let dayOffset = 0;
        while (!foundSlot && dayOffset <= 14) {
          const currentDay = new Date(localTodayStart.getTime() + (dayOffset * 86400000));
          const dayKey = formatInTimeZone(currentDay, userTimezone, 'yyyy-MM-dd');
          const isToday = (dayKey === todayStr);
          
          // FIX: Use getDay() on the timezone-adjusted date to get 0 (Sun) to 6 (Sat)
          // This ensures Monday is always 1, matching your selectedDays [1,2,3,4,5]
          const dayOfWeek = toDate(currentDay, { timeZone: userTimezone }).getDay();

          if (pass === 0 && !isToday) break; 

          if (!selectedDays.includes(dayOfWeek)) {
            if (isToday) console.log(`[${functionName}] TODAY SKIP: Day ${dayOfWeek} not in selectedDays ${JSON.stringify(selectedDays)}`);
            dayOffset++; continue; 
          }

          if (!dailyStats.has(dayKey)) dailyStats.set(dayKey, { tasks: 0, hours: 0, lastPointer: null });
          const stats = dailyStats.get(dayKey);
          
          if (stats.tasks >= maxTasks || stats.hours >= maxWorkHours) {
            dayOffset++; continue;
          }

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
              if (event.is_work) stats.hours += (effectiveDuration / 60);
              stats.lastPointer = alignTime(new Date(potentialEnd.getTime()), slotAlignment);

              proposedChanges.push({
                event_id: event.event_id,
                title: event.title,
                old_start: event.start_time,
                old_duration: event.duration_minutes,
                new_start: searchPointer.toISOString(),
                new_end: potentialEnd.toISOString(),
                duration: effectiveDuration,
                is_work: event.is_work,
                is_surplus: false,
                category: event.temp_category
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
          is_work: event.is_work,
          is_surplus: true,
          category: event.temp_category
        });
        surplusCount++;
      }
    }

    return new Response(JSON.stringify({ changes: proposedChanges }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (error) {
    console.error(`[${functionName}] Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})