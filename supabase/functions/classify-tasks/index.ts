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
      console.log(`[${functionName}] Success on attempt ${i + 1}`);
      return response;
    } catch (err) {
      lastError = err;
      const errorMsg = err.message?.toLowerCase() || "";
      console.error(`[${functionName}] Attempt ${i + 1} failed:`, err.message);
      
      // Retry on Quota (429), Service Unavailable (503), or Internal Error (500)
      const isRetryable = errorMsg.includes('429') || 
                          errorMsg.includes('quota') || 
                          errorMsg.includes('503') || 
                          errorMsg.includes('500') ||
                          errorMsg.includes('service unavailable');
      
      if (isRetryable && i < maxRetries - 1) {
        const delay = Math.pow(2, i) * 2000 + Math.random() * 1000;
        console.log(`[${functionName}] Retryable error. Waiting ${Math.round(delay)}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
        continue;
      }
      break; // Not retryable or last attempt
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
    
    console.log(`[${functionName}] --- NEW REQUEST ---`);
    console.log(`[${functionName}] Tasks to classify: ${tasks?.length || 0}`);

    if (!tasks || tasks.length === 0) {
      console.log(`[${functionName}] No tasks provided, returning empty.`);
      return new Response(JSON.stringify({ classifications: [] }), { headers: corsHeaders });
    }

    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    if (!user) {
      console.error(`[${functionName}] Unauthorized access attempt`);
      throw new Error("Unauthorized");
    }

    console.log(`[${functionName}] Fetching user feedback for ${user.id}...`);
    const { data: feedback, error: feedbackError } = await supabaseClient
      .from('task_classification_feedback')
      .select('task_name, is_movable')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(30);

    if (feedbackError) {
      console.warn(`[${functionName}] Error fetching feedback:`, feedbackError.message);
    }

    let classifications = tasks.map(() => ({ isMovable: false, explanation: "Default fallback", dependsOn: null }));

    const prompt = `
      You are a high-precision calendar assistant. Your job is to classify tasks as "movable" or "fixed".
      
      CRITICAL INSTRUCTION: You MUST prioritize the "USER'S CUSTOM RULES" and "PAST CORRECTIONS" above all else. 
      If a task matches a pattern in the rules, you MUST follow that rule even if it contradicts general logic.

      PRIORITY 1: USER'S CUSTOM RULES (MANDATORY)
      ${naturalLanguageRules || 'No custom rules provided.'}
      
      Note: If a rule says "For tasks like 'X': ... (Classification: Movable)", any task containing 'X' or similar to 'X' MUST be Movable.

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
      Keep explanations under 12 words.
    `;

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!geminiKey) {
      console.error(`[${functionName}] CRITICAL: GEMINI_API_KEY is missing from environment`);
      throw new Error("AI Configuration Error");
    }

    const genAI = new GoogleGenerativeAI(geminiKey);
    let responseText = "";

    try {
      console.log(`[${functionName}] Initializing primary model: gemini-2.5-flash`);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
      const response = await generateWithRetry(model, prompt, functionName);
      responseText = response.text();
    } catch (primaryError) {
      console.warn(`[${functionName}] Primary model failed. Error:`, primaryError.message);
      console.log(`[${functionName}] Trying fallback model: gemini-2.0-flash`);
      
      try {
        const fallbackModel = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        const response = await generateWithRetry(fallbackModel, prompt, functionName);
        responseText = response.text();
      } catch (fallbackError) {
        console.error(`[${functionName}] Fallback model also failed:`, fallbackError.message);
        throw fallbackError;
      }
    }

    console.log(`[${functionName}] Parsing AI response...`);
    const jsonMatch = responseText.match(/\[.*\]/s);
    if (jsonMatch) {
      classifications = JSON.parse(jsonMatch[0]);
      console.log(`[${functionName}] Successfully parsed ${classifications.length} classifications`);
    } else {
      console.error(`[${functionName}] AI response did not contain a valid JSON array:`, responseText.substring(0, 200));
      throw new Error("Invalid AI response format");
    }

    return new Response(JSON.stringify({ classifications }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    
    // Final fallback to keyword matching if AI is totally down
    console.log(`[${functionName}] Executing keyword-only fallback...`);
    return new Response(JSON.stringify({ 
      error: error.message,
      isFallback: true
    }), { status: 200, headers: corsHeaders });
  }
})