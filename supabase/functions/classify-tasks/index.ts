// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  const functionName = "classify-tasks";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const { 
      events, 
      tasks, 
      movableKeywords = [], 
      lockedKeywords = [], 
      workKeywords = ['work', 'session', 'meeting', 'call', 'rehearsal', 'lesson', 'audition', 'coaching', 'appt', 'program', 'ceremony', 'gig', 'meetup', 'planning', 'workshop', 'presentation'],
      naturalLanguageRules = '', 
      persist = false 
    } = body;
    
    const taskList = events ? events.map(e => e.title) : (tasks || []);
    if (taskList.length === 0) return new Response(JSON.stringify({ classifications: [] }), { headers: corsHeaders });

    console.log(`[${functionName}] Processing ${taskList.length} tasks. Persist: ${persist}`);

    // 1. Heuristic Classification
    const HARD_FIXED = /flight|train|hotel|reservation|doctor|dentist|hospital|clinic|surgery|medical|wedding|funeral|performance|gig|concert|show|tech|dress|opening|closing|birthday|party|gala|anniversary|appointment|appt|interview|vs|meeting with|call with|zoom|teams|google meet|skype|facetime|session with|coaching|lesson|rehearsal|audition|workshop|seminar|webinar|conference|travel to|commute|drive to|haircut|dinner with|lunch with|brunch with|coffee with|statement|foundations|q & a|meetup/i;
    const HARD_MOVABLE = /solo|draft|research|tidy|clean|practice|read|study|admin|email|gym|workout|run|walk|meditate|yoga|journal|laundry|groceries|shopping|vacuum|mop|dust|organize|filing|backup|update|coding|programming|writing|blog|post|social media/i;

    const results = taskList.map(title => {
      const t = title.toLowerCase();
      
      // Check Work Keywords
      const isWork = workKeywords.some(kw => t.includes(kw.toLowerCase()));
      
      // Check Movable Keywords FIRST (User preference for flexibility)
      if (movableKeywords.some(kw => t.includes(kw.toLowerCase()))) {
        return { isMovable: true, isWork, explanation: "User Movable Rule", confidence: 1.0 };
      }
      
      // Check Locked Keywords
      if (lockedKeywords.some(kw => t.includes(kw.toLowerCase()))) {
        return { isMovable: false, isWork, explanation: "User Locked Rule", confidence: 1.0 };
      }
      
      // Heuristics
      if (HARD_FIXED.test(title)) return { isMovable: false, isWork, explanation: "Fixed Heuristic", confidence: 0.9 };
      if (HARD_MOVABLE.test(title)) return { isMovable: true, isWork, explanation: "Movable Heuristic", confidence: 0.8 };
      
      return { isMovable: null, isWork }; // Let AI decide
    });

    const indicesToAI = results.map((r, i) => r.isMovable === null ? i : null).filter(i => i !== null);

    // 2. Direct AI Call
    if (indicesToAI.length > 0) {
      const geminiKey = Deno.env.get('GEMINI_API_KEY');
      if (geminiKey) {
        try {
          const tasksForAI = indicesToAI.map(i => taskList[i]);
          const prompt = `Classify these tasks as MOVABLE (solo/flexible) or FIXED (meetings/appointments). 
          Rules: ${naturalLanguageRules}. 
          Tasks: ${JSON.stringify(tasksForAI)}. 
          Return ONLY a JSON array of objects: { "isMovable": boolean, "explanation": string, "dependsOn": string | null }`;
          
          const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { response_mime_type: "application/json" }
            })
          });

          const aiData = await aiRes.json();
          
          if (aiRes.status === 429) {
            console.warn(`[${functionName}] Gemini Quota Exceeded (429).`);
          } else {
            const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
            if (aiText) {
              const aiClassifications = JSON.parse(aiText.replace(/```json|```/g, ''));
              indicesToAI.forEach((originalIdx, aiIdx) => {
                if (aiClassifications[aiIdx]) {
                  results[originalIdx] = {
                    ...results[originalIdx],
                    ...aiClassifications[aiIdx],
                    confidence: 0.9
                  };
                }
              });
            }
          }
        } catch (e) {
          console.warn(`[${functionName}] AI Error:`, e.message);
        }
      }
    }

    // Final Fallback for anything still null
    results.forEach((r, i) => {
      if (r.isMovable === null) {
        results[i].isMovable = true;
        results[i].explanation = "Default (Flexible)";
        results[i].confidence = 0.5;
      }
    });

    // 3. Persistence (Direct REST)
    if (persist && events && events.length === results.length) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      // Get user ID from auth header
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') }
      });
      const userData = await userRes.json();
      const userId = userData.id;

      if (userId) {
        const updates = events.map((event, i) => ({
          event_id: event.event_id,
          user_id: userId,
          title: event.title,
          start_time: event.start_time,
          end_time: event.end_time,
          provider: event.provider,
          source_calendar: event.source_calendar,
          source_calendar_id: event.source_calendar_id,
          is_locked: !results[i].isMovable,
          is_work: results[i].isWork || false,
          last_synced_at: new Date().toISOString()
        }));

        console.log(`[${functionName}] Persisting ${updates.length} classifications for user ${userId}`);
        
        const persistRes = await fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?on_conflict=user_id,event_id`, {
          method: 'POST',
          headers: { 
            'apikey': supabaseKey, 
            'Authorization': `Bearer ${supabaseKey}`,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates'
          },
          body: JSON.stringify(updates)
        });

        if (!persistRes.ok) {
          const errorText = await persistRes.text();
          console.error(`[${functionName}] Persistence Error:`, errorText);
        }
      }
    }

    return new Response(JSON.stringify({ classifications: results }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})