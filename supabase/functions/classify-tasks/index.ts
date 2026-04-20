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
      console.log(`[${functionName}] Attempt ${i + 1}/${maxRetries} for model: ${model.model}`);
      const result = await model.generateContent(prompt);
      const response = await result.response;
      return response;
    } catch (err) {
      lastError = err;
      const errorMsg = err.message?.toLowerCase() || "";
      const isRetryable = errorMsg.includes('429') || errorMsg.includes('quota') || errorMsg.includes('503') || errorMsg.includes('500');
      
      if (isRetryable && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 2000 + Math.random() * 1000;
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
    const { events, tasks, movableKeywords, lockedKeywords, naturalLanguageRules, persist = false } = await req.json();
    const authHeader = req.headers.get('Authorization');
    
    // Support both old 'tasks' array and new 'events' array
    const taskList = events ? events.map(e => e.title) : (tasks || []);
    
    if (taskList.length === 0) {
      return new Response(JSON.stringify({ classifications: [] }), { headers: corsHeaders });
    }

    const supabaseAdmin = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const supabaseUser = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    );

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    const { data: feedback } = await supabaseAdmin
      .from('task_classification_feedback')
      .select('task_name, is_movable')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    const prompt = `
      You are a high-precision calendar assistant. Your job is to classify tasks as "movable" or "fixed".
      
      PRIORITY 1: USER'S CUSTOM RULES
      ${naturalLanguageRules || 'No custom rules provided.'}
      
      PRIORITY 2: USER'S PAST CORRECTIONS
      ${feedback?.map(f => `- "${f.task_name}" is ${f.is_movable ? 'movable' : 'fixed'}`).join('\n') || 'No past corrections.'}

      PRIORITY 3: KEYWORD RULES
      - FIXED: ${lockedKeywords?.join(', ') || 'none'}.
      - MOVABLE: ${movableKeywords?.join(', ') || 'none'}.
      
      Tasks to classify:
      ${taskList.map(t => `- "${t}"`).join('\n')}
      
      Return ONLY a JSON array of objects: { "isMovable": boolean, "explanation": string, "dependsOn": string | null }.
    `;

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    const genAI = new GoogleGenerativeAI(geminiKey);
    const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
    
    const response = await generateWithRetry(model, prompt, functionName);
    const responseText = response.text();
    const jsonMatch = responseText.match(/\[.*\]/s);
    
    if (!jsonMatch) throw new Error("Invalid AI response");
    const classifications = JSON.parse(jsonMatch[0]);

    // BACKGROUND PERSISTENCE
    if (persist && events && events.length === classifications.length) {
      console.log(`[${functionName}] Persisting ${events.length} classifications to DB...`);
      const updates = events.map((event, i) => ({
        event_id: event.event_id,
        user_id: user.id,
        is_locked: !classifications[i].isMovable
      }));

      await supabaseAdmin.from('calendar_events_cache').upsert(updates, { onConflict: 'user_id, event_id' });
    }

    return new Response(JSON.stringify({ classifications }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})