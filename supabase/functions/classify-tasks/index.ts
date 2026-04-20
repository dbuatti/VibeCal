// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.1.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function generateWithRetry(model, prompt, maxRetries = 3) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      const result = await model.generateContent(prompt);
      return await result.response;
    } catch (err) {
      lastError = err;
      const isQuotaError = err.message?.includes('429') || err.message?.includes('quota');
      
      if (isQuotaError && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 1000 + Math.random() * 1000;
        console.log(`[classify-tasks] Quota exceeded (429). Retrying in ${Math.round(delay)}ms... (Attempt ${i + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      throw err;
    }
  }
  throw lastError;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  const functionName = "classify-tasks";

  try {
    const { tasks, movableKeywords, lockedKeywords, naturalLanguageRules } = await req.json();
    const authHeader = req.headers.get('Authorization')
    
    if (!tasks || tasks.length === 0) {
      return new Response(JSON.stringify({ classifications: [] }), { headers: corsHeaders });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) throw new Error("Unauthorized");

    const { data: feedback } = await supabaseClient
      .from('task_classification_feedback')
      .select('task_name, is_movable')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    let classifications = tasks.map(() => ({ isMovable: false, explanation: "Default fallback", dependsOn: null }));

    try {
      const geminiKey = Deno.env.get('GEMINI_API_KEY');
      if (geminiKey) {
        const genAI = new GoogleGenerativeAI(geminiKey);
        // Using 1.5 Flash as it often has more stable quotas than the experimental 2.0 Flash Lite
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
          You are a personal assistant helping to organize a calendar. 
          Classify the following tasks as either "movable" (can be rescheduled) or "fixed" (must happen at this specific time).
          
          NEW CAPABILITY: DEPENDENCY DETECTION
          Look for rules that imply one task must happen AFTER another.
          Example: "Post session notes should be scheduled after the session" -> "Post session notes" depends on "session".

          PRIORITY 1: USER'S CUSTOM RULES (Follow these strictly)
          ${naturalLanguageRules || 'No custom rules provided.'}
          Note: Look for patterns like 'For tasks like "NAME": DESCRIPTION (Classification: TYPE)' and apply them to similar task names.

          PRIORITY 2: USER'S PAST CORRECTIONS
          ${feedback?.map(f => `- "${f.task_name}" is ${f.is_movable ? 'movable' : 'fixed'}`).join('\n') || 'No past corrections.'}

          PRIORITY 3: STRICT KEYWORD RULES
          - FIXED: Any task containing these keywords: ${lockedKeywords?.join(', ') || 'none'}.
          - MOVABLE: Any task containing these keywords: ${movableKeywords?.join(', ') || 'none'}.
          
          GENERAL GUIDELINES (Use only if no specific rules apply):
          - Fixed: Meetings with others, appointments, live classes, rehearsals, ceremonies, specific deadlines.
          - Movable: Solo work, drafting, chores, practice, exploration, personal projects.
          
          Tasks to classify:
          ${tasks.map(t => `- "${t}"`).join('\n')}
          
          Return ONLY a JSON array of objects: { "isMovable": boolean, "explanation": string, "dependsOn": string | null }.
          "dependsOn" should be the title (or partial title) of the task this one must follow.
          The explanation should be short (max 10 words).
        `;

        const response = await generateWithRetry(model, prompt);
        const text = response.text();
        const jsonMatch = text.match(/\[.*\]/s);
        if (jsonMatch) {
          classifications = JSON.parse(jsonMatch[0]);
        }
      }
    } catch (aiError) {
      console.error(`[${functionName}] AI classification failed:`, aiError.message);
      // Fallback to keyword-based heuristic
      classifications = tasks.map(title => {
        const lowerTitle = title.toLowerCase();
        const isLocked = lockedKeywords?.some(kw => lowerTitle.includes(kw.toLowerCase()));
        const isMovable = movableKeywords?.some(kw => lowerTitle.includes(kw.toLowerCase()));
        const movable = isMovable && !isLocked;
        return {
          isMovable: movable,
          explanation: movable ? "Matched movable keyword (Fallback)" : "Defaulted to fixed (Fallback)",
          dependsOn: null
        };
      });
    }

    return new Response(JSON.stringify({ classifications }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})