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
      .limit(30);

    let classifications = tasks.map(() => ({ isMovable: false, explanation: "Default fallback", dependsOn: null }));

    try {
      const geminiKey = Deno.env.get('GEMINI_API_KEY');
      if (geminiKey) {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash" });

        const prompt = `
          You are a high-precision calendar assistant. Your job is to classify tasks as "movable" or "fixed".
          
          CRITICAL INSTRUCTION: You MUST prioritize the "USER'S CUSTOM RULES" and "PAST CORRECTIONS" above all else. 
          If a task matches a pattern in the rules, you MUST follow that rule even if it contradicts general logic.

          PRIORITY 1: USER'S CUSTOM RULES (MANDATORY)
          ${naturalLanguageRules || 'No custom rules provided.'}
          
          Note: If a rule says "For tasks like 'X': ... (Classification: Movable)", any task containing 'X' or similar to 'X' MUST be Movable.
          Example: "Voice Coaching is always fixed" means any task with "Voice Coaching" MUST be isMovable: false.

          PRIORITY 2: USER'S PAST CORRECTIONS
          ${feedback?.map(f => `- "${f.task_name}" is ${f.is_movable ? 'movable' : 'fixed'}`).join('\n') || 'No past corrections.'}

          PRIORITY 3: KEYWORD RULES
          - FIXED: ${lockedKeywords?.join(', ') || 'none'}.
          - MOVABLE: ${movableKeywords?.join(', ') || 'none'}.
          
          DEPENDENCY DETECTION:
          Look for rules implying sequence (e.g., "X after Y"). Set "dependsOn" to the title of the prerequisite task.

          Tasks to classify:
          ${tasks.map(t => `- "${t}"`).join('\n')}
          
          Return ONLY a JSON array of objects: { "isMovable": boolean, "explanation": string, "dependsOn": string | null }.
          The explanation MUST state which rule or keyword was matched (e.g., "Matched rule: Voice Coaching is fixed").
          Keep explanations under 12 words.
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