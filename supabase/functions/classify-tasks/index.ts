// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function generateWithRetry(model, prompt, functionName, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response;
    } catch (err) {
      lastError = err;
      const errorMsg = err.message?.toLowerCase() || "";
      const isRetryable = errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('503') || errorMsg.includes('500');
      
      if (isRetryable && i < maxRetries - 1) {
        const delay = 1500 * (i + 1);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      break;
    }
  }
  throw lastError;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const functionName = "classify-tasks";

  try {
    const { events, tasks, movableKeywords = [], lockedKeywords = [], naturalLanguageRules = '', persist = false } = await req.json();
    const authHeader = req.headers.get('Authorization');
    
    const taskList = events ? events.map(e => e.title) : (tasks || []);
    if (taskList.length === 0) return new Response(JSON.stringify({ classifications: [] }), { headers: corsHeaders });

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // 1. MEMORY LOOKUP (Exact & Pattern Match)
    const { data: feedback } = await supabaseAdmin
      .from('task_classification_feedback')
      .select('task_name, is_movable')
      .eq('user_id', user.id);

    const feedbackMap = new Map(feedback?.map(f => [f.task_name.toLowerCase(), f.is_movable]));

    const results = taskList.map(title => {
      const lowerTitle = title.toLowerCase();
      if (feedbackMap.has(lowerTitle)) {
        return { 
          isMovable: feedbackMap.get(lowerTitle), 
          explanation: "Matched your previous manual correction.",
          confidence: 1.0,
          isPredefined: true 
        };
      }
      return null;
    });

    const indicesToAI = results.map((r, i) => r === null ? i : null).filter(i => i !== null);

    // 2. ADVANCED AI CLASSIFICATION
    if (indicesToAI.length > 0) {
      const tasksForAI = indicesToAI.map(i => taskList[i]);
      
      try {
        const prompt = `
          You are an elite executive assistant. Classify these calendar tasks.
          
          CONTEXT:
          - MOVABLE: Tasks that can be done anytime (e.g., "Draft email", "Research", "Solo practice").
          - FIXED: Appointments with others, hard deadlines, or time-sensitive events (e.g., "Meeting with Bob", "Flight", "Live Performance").
          
          USER RULES:
          ${naturalLanguageRules || 'No custom rules.'}
          
          KEYWORDS:
          - FIXED: ${lockedKeywords.join(', ') || 'none'}
          - MOVABLE: ${movableKeywords.join(', ') || 'none'}
          
          TASKS TO ANALYZE:
          ${tasksForAI.map((t, idx) => `${idx}: "${t}"`).join('\n')}
          
          INSTRUCTIONS:
          1. Determine if movable.
          2. Detect dependencies: If task B mentions task A (e.g., "Part 2", "Follow up on X"), note that B depends on A.
          3. Provide a brief, logical explanation.
          
          Return ONLY a JSON array of objects: 
          { "isMovable": boolean, "explanation": string, "confidence": number (0-1), "dependsOn": string | null (title of prerequisite task) }
        `;

        const geminiKey = Deno.env.get('GEMINI_API_KEY');
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const response = await generateWithRetry(model, prompt, functionName);
        const responseText = response.text();
        const jsonMatch = responseText.match(/\[.*\]/s);
        
        if (jsonMatch) {
          const aiClassifications = JSON.parse(jsonMatch[0]);
          indicesToAI.forEach((originalIdx, aiIdx) => {
            results[originalIdx] = aiClassifications[aiIdx];
          });
        }
      } catch (aiError) {
        console.error(`[${functionName}] AI Quota/Error, using Smart Fallback:`, aiError.message);
        
        // SMART REGEX FALLBACK
        indicesToAI.forEach(idx => {
          const title = taskList[idx].toLowerCase();
          const isMovableKeyword = movableKeywords.some(kw => title.includes(kw.toLowerCase()));
          const isLockedKeyword = lockedKeywords.some(kw => title.includes(kw.toLowerCase()));
          
          // Heuristic: If it has "with", "call", "meeting", "vs" it's likely fixed
          const likelyFixed = /with|call|meeting|vs|interview|appointment|doctor|dentist|flight|zoom|teams/.test(title);
          
          results[idx] = {
            isMovable: isMovableKeyword || (!isLockedKeyword && !likelyFixed),
            explanation: "Classified via Smart Fallback (AI busy).",
            confidence: 0.7,
            dependsOn: null
          };
        });
      }
    }

    // 3. PERSISTENCE
    if (persist && events && events.length === results.length) {
      const updates = events.map((event, i) => ({
        event_id: event.event_id,
        user_id: user.id,
        is_locked: !results[i].isMovable
      }));
      await supabaseAdmin.from('calendar_events_cache').upsert(updates, { onConflict: 'user_id, event_id' });
    }

    return new Response(JSON.stringify({ classifications: results }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})