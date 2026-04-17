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

  try {
    console.log("[optimise-schedule] Starting theme-aware redistribution with task grouping...");
    
    const authHeader = req.headers.get('Authorization')
    const { durationOverride, maxTasksOverride, slotAlignment = 15, selectedDays = [1, 2, 3, 4, 5] } = await req.json();
    
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
      group_similar_tasks: true 
    };
    const userTimezone = profileRes.data?.timezone || 'UTC';
    const allEvents = eventsRes.data || [];
    const dayThemes = themesRes.data || [];

    const fixedEvents = allEvents.filter(e => e.is_locked);
    const movableEvents = allEvents.filter(e => !e.is_locked);

    if (movableEvents.length === 0) {
      return new Response(JSON.stringify({ message: 'No movable events found.', changes: [] }), { headers: corsHeaders });
    }

    // 1. Categorize and Cluster tasks using AI
    let categories = movableEvents.map(() => "General");
    
    try {
      const geminiKey = Deno.env.get('GEMINI_API_KEY');
      if (geminiKey) {
        console.log("[optimise-schedule] Attempting AI clustering...");
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

        const themeList = dayThemes.map(t => t.theme).filter(Boolean);
        
        const prompt = `
          You are a scheduling assistant. Your goal is to group "like" tasks together to minimize context switching.
          
          Available Themes: [${themeList.join(', ')}]
          
          Common Clusters to look for:
          - "Admin/Communication": Emails, calls, planning, invoices.
          - "Deep Work/Coding": Programming, "vibe coding", debugging, architecture.
          - "Creative/Practice": Piano practice, music, writing, sketching.
          - "Chores/Personal": Cleaning, groceries, errands.
          
          Tasks to categorize:
          ${movableEvents.map(e => `- ${e.title}`).join('\n')}
          
          Instructions:
          1. Assign each task a category. 
          2. Prioritize matching the "Available Themes" if they fit.
          3. If a task doesn't fit a theme but fits a "Common Cluster", use that cluster name.
          4. Otherwise, use "General".
          
          Return ONLY a JSON array of strings representing the category for each task in order.
          Example: ["Admin", "Deep Work", "Deep Work", "Piano Practice"]
        `;

        const aiResult = await model.generateContent(prompt);
        const aiResponse = await aiResult.response;
        const text = aiResponse.text();
        const jsonMatch = text.match(/\[.*\]/s);
        if (jsonMatch) {
          categories = JSON.parse(jsonMatch[0]);
          console.log("[optimise-schedule] AI clustering successful.");
        }
      }
    } catch (aiError) {
      console.error("[optimise-schedule] AI clustering failed. Falling back to basic grouping.", aiError.message);
    }

    // Attach categories to events for sorting
    const categorizedEvents = movableEvents.map((event, index) => ({
      ...event,
      temp_category: categories[index] || "General"
    }));

    // 2. Sort events by category to ensure they are processed (and thus placed) together
    if (settings.group_similar_tasks !== false) {
      categorizedEvents.sort((a, b) => a.temp_category.localeCompare(b.temp_category));
    }

    const proposedChanges = [];
    const dailyStats = new Map();
    const maxTasks = maxTasksOverride || settings.max_tasks_per_day || 5;

    const getOffset = (date) => {
      const tzDate = new Date(date.toLocaleString('en-US', { timeZone: userTimezone }));
      const diff = tzDate.getTime() - date.getTime();
      return Math.round(diff / 3600000);
    };

    const alignTime = (date, alignmentMinutes) => {
      const ms = alignmentMinutes * 60 * 1000;
      return new Date(Math.ceil(date.getTime() / ms) * ms);
    };

    // 3. Redistribution Loop
    for (const event of categorizedEvents) {
      const taskTheme = event.temp_category;
      const effectiveDuration = durationOverride || event.duration_minutes;
      const durationMs = effectiveDuration * 60000;
      
      const preferredDays = dayThemes
        .filter(t => t.theme.toLowerCase() === taskTheme.toLowerCase())
        .map(t => t.day_of_week);

      let foundSlot = false;
      let dayOffset = 1;

      while (!foundSlot && dayOffset < 30) {
        let currentPointer = new Date();
        currentPointer.setDate(currentPointer.getDate() + dayOffset);
        currentPointer.setHours(0, 0, 0, 0);
        
        const dayOfWeek = currentPointer.getDay();
        const dayKey = currentPointer.toISOString().split('T')[0];
        
        if (!selectedDays.includes(dayOfWeek)) {
          dayOffset++;
          continue;
        }

        // If we have a theme match, try to stick to those days first (within the first week)
        if (preferredDays.length > 0 && !preferredDays.includes(dayOfWeek) && dayOffset < 8) {
          dayOffset++;
          continue;
        }

        const offset = getOffset(currentPointer);
        const [startH, startM] = settings.day_start_time.split(':').map(Number);
        const [endH, endM] = settings.day_end_time.split(':').map(Number);

        if (!dailyStats.has(dayKey)) {
          dailyStats.set(dayKey, { tasks: 0, hours: 0, lastPointer: null });
        }
        
        const stats = dailyStats.get(dayKey);
        
        if (!stats.lastPointer) {
          const dayStart = new Date(currentPointer);
          dayStart.setUTCHours(startH - offset, startM, 0, 0);
          stats.lastPointer = alignTime(dayStart, slotAlignment);
        }

        let searchPointer = new Date(stats.lastPointer);
        const dayEnd = new Date(currentPointer);
        dayEnd.setUTCHours(endH - offset, endM, 0, 0);

        while (searchPointer < dayEnd && !foundSlot) {
          const potentialEnd = new Date(searchPointer.getTime() + durationMs);
          
          const pastWorkday = potentialEnd > dayEnd;
          const pastHoursLimit = (stats.hours + (effectiveDuration / 60)) > (settings.max_hours_per_day || 24);
          const pastTasksLimit = stats.tasks >= maxTasks;

          if (pastWorkday || pastHoursLimit || pastTasksLimit) break;

          const collision = fixedEvents.find(f => {
            const fStart = new Date(f.start_time);
            const fEnd = new Date(f.end_time);
            return (searchPointer < fEnd && potentialEnd > fStart);
          });

          if (collision) {
            searchPointer = new Date(new Date(collision.end_time).getTime() + 1 * 60000);
            searchPointer = alignTime(searchPointer, slotAlignment);
          } else {
            foundSlot = true;
            stats.tasks += 1;
            stats.hours += (effectiveDuration / 60);
            // Place next task 5 mins after this one to keep them grouped
            stats.lastPointer = new Date(potentialEnd.getTime() + 5 * 60000);
            stats.lastPointer = alignTime(stats.lastPointer, slotAlignment);

            proposedChanges.push({
              event_id: event.event_id,
              title: event.title,
              old_start: event.start_time,
              old_duration: event.duration_minutes,
              new_start: searchPointer.toISOString(),
              new_end: potentialEnd.toISOString(),
              duration: effectiveDuration,
              theme_matched: taskTheme
            });
          }
        }

        if (!foundSlot) dayOffset++;
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