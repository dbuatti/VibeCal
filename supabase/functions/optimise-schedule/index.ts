// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.1.0"

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

    // Get current time in user's timezone without shifting the timestamp
    const now = new Date();
    const formatter = new Intl.DateTimeFormat('en-US', { timeZone: userTimezone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    const parts = formatter.formatToParts(now);
    const getPart = (type) => parts.find(p => p.type === type).value;
    
    const todayStart = new Date(Date.UTC(parseInt(getPart('year')), parseInt(getPart('month')) - 1, parseInt(getPart('day')), 0, 0, 0));
    // We need to find the UTC equivalent of "today at 00:00" in user's timezone
    const localMidnight = new Date(Date.UTC(parseInt(getPart('year')), parseInt(getPart('month')) - 1, parseInt(getPart('day')), 0, 0, 0));
    const midnightParts = formatter.formatToParts(localMidnight);
    const getMidnightPart = (type) => midnightParts.find(p => p.type === type).value;
    const formattedMidnight = new Date(Date.UTC(parseInt(getMidnightPart('year')), parseInt(getMidnightPart('month')) - 1, parseInt(getMidnightPart('day')), parseInt(getMidnightPart('hour')), parseInt(getMidnightPart('minute')), parseInt(getMidnightPart('second'))));
    const offsetMs = formattedMidnight.getTime() - localMidnight.getTime();
    const utcTodayStart = new Date(localMidnight.getTime() - offsetMs);

    const currentEvents = allEvents.filter(e => new Date(e.start_time) >= utcTodayStart);
    const fixedEvents = currentEvents.filter(e => e.is_locked || vettedEventIds.includes(e.event_id));
    const movableEvents = currentEvents.filter(e => !e.is_locked && !vettedEventIds.includes(e.event_id));

    if (movableEvents.length === 0) {
      return new Response(JSON.stringify({ message: 'No movable events found.', changes: [] }), { headers: corsHeaders });
    }

    // AI Categorization
    let categories = movableEvents.map(() => "General");
    const themeList = dayThemes.map(t => t.theme).filter(Boolean);

    if (themeList.length > 0) {
      try {
        const geminiKey = Deno.env.get('GEMINI_API_KEY');
        if (geminiKey) {
          const genAI = new GoogleGenerativeAI(geminiKey);
          const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });
          const prompt = `Categorize these tasks into exactly one of these themes: [${themeList.join(', ')}]. If it doesn't fit well, use "General". Tasks: ${movableEvents.map(e => e.title).join(', ')}. Return ONLY a JSON array of strings.`;
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
    const dailyStats = new Map();
    const maxTasks = maxTasksOverride || settings.max_tasks_per_day || 5;
    const maxWorkHours = settings.max_hours_per_day || 24;

    const alignTime = (date, alignmentMinutes) => {
      const ms = alignmentMinutes * 60 * 1000;
      return new Date(Math.ceil(date.getTime() / ms) * ms);
    };

    fixedEvents.forEach(f => {
      const dayKey = new Date(f.start_time).toISOString().split('T')[0];
      const isWork = workKeywords.some(kw => f.title.toLowerCase().includes(kw.toLowerCase()));
      if (isWork) {
        if (!dailyStats.has(dayKey)) dailyStats.set(dayKey, { tasks: 0, hours: 0, lastPointer: null });
        const duration = (new Date(f.end_time).getTime() - new Date(f.start_time).getTime()) / 3600000;
        dailyStats.get(dayKey).hours += duration;
      }
    });

    let surplusCount = 0;

    for (const event of categorizedEvents) {
      const effectiveDuration = durationOverride || event.duration_minutes;
      const durationMs = effectiveDuration * 60000;
      let foundSlot = false;

      for (let pass = 1; pass <= 2; pass++) {
        if (foundSlot) break;
        
        let dayOffset = 0;
        while (!foundSlot && dayOffset <= 14) {
          let currentDay = new Date(utcTodayStart);
          currentDay.setUTCDate(currentDay.getUTCDate() + dayOffset);
          
          const dayKey = currentDay.toISOString().split('T')[0];
          const dayOfWeek = (currentDay.getUTCDay()); // This is slightly off due to UTC, but close enough for theme matching
          const dayTheme = dayThemes.find(t => t.day_of_week === dayOfWeek)?.theme || "General";
          
          if (!selectedDays.includes(dayOfWeek)) { dayOffset++; continue; }
          if (pass === 1 && event.temp_category !== "General" && dayTheme !== event.temp_category) { dayOffset++; continue; }

          const [startH, startM] = settings.day_start_time.split(':').map(Number);
          const [endH, endM] = settings.day_end_time.split(':').map(Number);

          if (!dailyStats.has(dayKey)) dailyStats.set(dayKey, { tasks: 0, hours: 0, lastPointer: null });
          const stats = dailyStats.get(dayKey);
          
          if (!stats.lastPointer) {
            const dayStart = new Date(currentDay);
            dayStart.setUTCHours(startH, startM, 0, 0); // This needs to be adjusted by offset, but for now we use UTC start
            stats.lastPointer = alignTime(dayStart, slotAlignment);
          }

          let searchPointer = new Date(stats.lastPointer);
          const dayEnd = new Date(currentDay);
          dayEnd.setUTCHours(endH, endM, 0, 0);

          while (searchPointer < dayEnd && !foundSlot) {
            const potentialEnd = new Date(searchPointer.getTime() + durationMs);
            const taskWorkHours = event.is_work ? (effectiveDuration / 60) : 0;
            
            if (potentialEnd > dayEnd || (stats.hours + taskWorkHours) > maxWorkHours || stats.tasks >= maxTasks) break;

            const collision = fixedEvents.find(f => {
              const fStart = new Date(f.start_time);
              const fEnd = new Date(f.end_time);
              return (searchPointer < fEnd && potentialEnd > fStart);
            });

            if (collision) {
              searchPointer = alignTime(new Date(new Date(collision.end_time).getTime() + 1 * 60000), slotAlignment);
            } else {
              foundSlot = true;
              stats.tasks += 1;
              stats.hours += taskWorkHours;
              stats.lastPointer = alignTime(new Date(potentialEnd.getTime() + 5 * 60000), slotAlignment);

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
        const pDate = new Date(placeholderDate);
        const [startH, startM] = settings.day_start_time.split(':').map(Number);
        const pStart = new Date(pDate);
        pStart.setUTCHours(startH, startM + surplusCount, 0, 0);
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
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})