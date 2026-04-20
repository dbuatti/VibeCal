// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    const body = await req.json().catch(() => ({}));
    const { events, tasks, movableKeywords = [], lockedKeywords = [], naturalLanguageRules = '' } = body;
    
    const taskList = events ? events.map(e => e.title) : (tasks || []);
    if (taskList.length === 0) return new Response(JSON.stringify({ classifications: [] }), { headers: corsHeaders });

    // 1. Heuristic Classification (No dependencies)
    const HARD_FIXED = /flight|train|hotel|reservation|doctor|dentist|hospital|clinic|surgery|medical|wedding|funeral|performance|gig|concert|show|tech|dress|opening|closing|birthday|party|gala|anniversary|appointment|appt|interview|vs|meeting with|call with|zoom|teams|google meet|skype|facetime|session with|coaching|lesson|rehearsal|audition|workshop|seminar|webinar|conference|travel to|commute|drive to|haircut|dinner with|lunch with|brunch with|coffee with|statement|foundations|q & a/i;
    const HARD_MOVABLE = /solo|draft|research|tidy|clean|practice|read|study|admin|email|gym|workout|run|walk|meditate|yoga|journal|laundry|groceries|shopping|vacuum|mop|dust|organize|filing|backup|update|coding|programming|writing|blog|post|social media/i;

    const results = taskList.map(title => {
      const t = title.toLowerCase();
      if (lockedKeywords.some(kw => t.includes(kw.toLowerCase()))) return { isMovable: false, explanation: "User Locked Rule" };
      if (movableKeywords.some(kw => t.includes(kw.toLowerCase()))) return { isMovable: true, explanation: "User Movable Rule" };
      if (HARD_FIXED.test(title)) return { isMovable: false, explanation: "Fixed Heuristic" };
      if (HARD_MOVABLE.test(title)) return { isMovable: true, explanation: "Movable Heuristic" };
      return null;
    });

    const indicesToAI = results.map((r, i) => r === null ? i : null).filter(i => i !== null);

    // 2. Direct AI Call
    if (indicesToAI.length > 0) {
      const geminiKey = Deno.env.get('GEMINI_API_KEY');
      if (geminiKey) {
        try {
          const tasksForAI = indicesToAI.map(i => taskList[i]);
          const prompt = `Classify these tasks as MOVABLE (solo/flexible) or FIXED (meetings/appointments). Rules: ${naturalLanguageRules}. Tasks: ${JSON.stringify(tasksForAI)}. Return JSON array of {isMovable: boolean, explanation: string, dependsOn: string|null}`;
          
          const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { response_mime_type: "application/json" }
            })
          });

          const aiData = await aiRes.json();
          const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (aiText) {
            const aiClassifications = JSON.parse(aiText.replace(/```json|```/g, ''));
            indicesToAI.forEach((originalIdx, aiIdx) => {
              if (aiClassifications[aiIdx]) results[originalIdx] = aiClassifications[aiIdx];
            });
          }
        } catch (e) {
          console.warn("[classify-tasks] AI Error:", e.message);
        }
      }
    }

    // Final Fallback
    results.forEach((r, i) => {
      if (!r) results[i] = { isMovable: true, explanation: "Default" };
    });

    return new Response(JSON.stringify({ classifications: results }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
