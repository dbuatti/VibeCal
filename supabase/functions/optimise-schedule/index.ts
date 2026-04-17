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
    console.log("[optimise-schedule] Starting intelligent redistribution with AI...");
    
    const authHeader = req.headers.get('Authorization')
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

    const settings = settingsRes.data || { day_start_time: '09:00', day_end_time: '17:00', max_hours_per_day: 6, max_tasks_per_day: 5 };
    const userTimezone = profileRes.data?.timezone || 'UTC';
    const allEvents = eventsRes.data || [];
    const themes = themesRes.data || [];

    const fixedEvents = allEvents.filter(e => e.is_locked);
    const movableEvents = allEvents.filter(e => !e.is_locked);

    if (movableEvents.length === 0) {
      return new Response(JSON.stringify({ message: 'No movable events found.', changes: [] }), { headers: corsHeaders });
    }

    // 1. AI Categorization using Gemini
    console.log("[optimise-schedule] Categorizing tasks with Gemini...");
    const genAI = new GoogleGenerativeAI(Deno.env.get('GEMINI_API_KEY') || '');
    const model = genAI.getGenerativeModel({ model: "gemini-pro" });

    const themeList = themes.map(t => t.theme).filter(Boolean).join(', ');
    const taskList = movableEvents.map(e => e.title).join('\n');

    const prompt = `
      You are a scheduling assistant. I have a list of tasks and a list of daily themes.
      Categorize each task into ONE of the themes. If a task doesn't fit any theme, categorize it as "General".
      
      Themes: ${themeList || 'General'}
      
      Tasks:
      ${taskList}
      
      Return ONLY a JSON object where keys are task titles and values are the category name.
    `;

    let taskCategories = {};
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      const text = response.text();
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        taskCategories = JSON.parse(jsonMatch[0]);
      }
    } catch (aiError) {
      console.error("[optimise-schedule] AI Categorization failed:", aiError);
    }

    // 2. Intelligent Redistribution
    const proposedChanges = [];
    const getOffset = (date) => {
      const tzDate = new Date(date.toLocaleString('en-US', { timeZone: userTimezone }));
      const diff = tzDate.getTime() - date.getTime();
      return Math.round(diff / 3600000);
    };

    // Start from tomorrow
    let currentDay = new Date();
    currentDay.setDate(currentDay.getDate() + 1);
    currentDay.setHours(0, 0, 0, 0);

    const [startH, startM] = settings.day_start_time.split(':').map(Number);
    const [endH, endM] = settings.day_end_time.split(':').map(Number);

    const dailyStats = new Map();

    // Sort movable events: prioritize those with categories that match a theme
    const sortedMovable = [...movableEvents].sort((a, b) => {
      const catA = taskCategories[a.title];
      const catB = taskCategories[b.title];
      if (catA && catA !== 'General') return -1;
      if (catB && catB !== 'General') return 1;
      return 0;
    });

    for (const event of sortedMovable) {
      const durationMs = event.duration_minutes * 60000;
      const targetCategory = taskCategories[event.title] || 'General';
      let foundSlot = false;
      let attempts = 0;
      
      // Try to find a day that matches the theme first
      let searchPointer = new Date(currentDay.getTime());

      while (!foundSlot && attempts < 14) {
        const dayOfWeek = searchPointer.getUTCDay();
        const dayTheme = themes.find(t => t.day_of_week === dayOfWeek)?.theme || 'General';
        const dayKey = searchPointer.toISOString().split('T')[0];
        const offset = getOffset(searchPointer);

        // If we are looking for a specific theme, skip days that don't match (for the first 7 attempts)
        if (targetCategory !== 'General' && dayTheme !== targetCategory && attempts < 7) {
          searchPointer.setUTCDate(searchPointer.getUTCDate() + 1);
          attempts++;
          continue;
        }

        if (!dailyStats.has(dayKey)) {
          dailyStats.set(dayKey, { tasks: 0, hours: 0, lastPointer: new Date(searchPointer) });
          dailyStats.get(dayKey).lastPointer.setUTCHours(startH - offset, startM, 0, 0);
        }
        
        const stats = dailyStats.get(dayKey);
        let currentPointer = new Date(stats.lastPointer);

        const dayEnd = new Date(searchPointer);
        dayEnd.setUTCHours(endH - offset, endM, 0, 0);

        const potentialEnd = new Date(currentPointer.getTime() + durationMs);
        const potentialHours = stats.hours + (event.duration_minutes / 60);

        // Check limits
        const pastWorkday = potentialEnd > dayEnd;
        const pastHoursLimit = potentialHours > (settings.max_hours_per_day || 24);
        const pastTasksLimit = stats.tasks >= (settings.max_tasks_per_day || 999);

        if (pastWorkday || pastHoursLimit || pastTasksLimit) {
          searchPointer.setUTCDate(searchPointer.getUTCDate() + 1);
          attempts++;
          continue;
        }

        // Collision detection with fixed events
        const collision = fixedEvents.find(f => {
          const fStart = new Date(f.start_time);
          const fEnd = new Date(f.end_time);
          return (currentPointer < fEnd && potentialEnd > fStart);
        });

        if (collision) {
          stats.lastPointer = new Date(new Date(collision.end_time).getTime() + 10 * 60000);
          // Don't increment attempts here, just try the next slot in the same day
          continue; 
        } else {
          foundSlot = true;
          proposedChanges.push({
            event_id: event.event_id,
            title: event.title,
            category: targetCategory,
            old_start: event.start_time,
            new_start: currentPointer.toISOString(),
            new_end: potentialEnd.toISOString(),
            duration: event.duration_minutes
          });
          
          stats.tasks += 1;
          stats.hours += (event.duration_minutes / 60);
          stats.lastPointer = new Date(potentialEnd.getTime() + 10 * 60000);
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
    console.error("[optimise-schedule] Error:", error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})