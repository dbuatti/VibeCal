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
    const { tasks, movableKeywords } = await req.json();
    const authHeader = req.headers.get('Authorization')
    
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      { global: { headers: { Authorization: authHeader } } }
    )

    const { data: { user } } = await supabaseClient.auth.getUser()
    
    // Fetch recent feedback for few-shot learning
    const { data: feedback } = await supabaseClient
      .from('task_classification_feedback')
      .select('task_name, is_movable')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(20);

    let classifications = tasks.map(() => false); // Default to fixed for safety

    try {
      const geminiKey = Deno.env.get('GEMINI_API_KEY');
      if (geminiKey) {
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash-lite" });

        const prompt = `
          You are a personal assistant helping to organize a calendar. 
          Classify the following tasks as either "movable" (can be rescheduled) or "fixed" (must happen at this specific time).
          
          General Rules:
          - Fixed: Meetings with others, appointments, live classes, rehearsals, ceremonies, specific deadlines.
          - Movable: Solo work, drafting, chores, practice, exploration, personal projects.
          
          User's Custom Movable Keywords: ${movableKeywords.join(', ')}
          
          User's Past Corrections (Learn from these!):
          ${feedback?.map(f => `- "${f.task_name}" is ${f.is_movable ? 'movable' : 'fixed'}`).join('\n')}
          
          Tasks to classify:
          ${tasks.map(t => `- "${t}"`).join('\n')}
          
          Return ONLY a JSON array of booleans where true means movable and false means fixed.
          Example: [true, false, true]
        `;

        const result = await model.generateContent(prompt);
        const response = await result.response;
        const text = response.text();
        const jsonMatch = text.match(/\[.*\]/s);
        if (jsonMatch) {
          classifications = JSON.parse(jsonMatch[0]);
        }
      }
    } catch (aiError) {
      console.error("[classify-tasks] AI classification failed. Defaulting to fixed.", aiError.message);
      // Fallback: check keywords manually if AI fails
      classifications = tasks.map(title => 
        movableKeywords.some(kw => title.toLowerCase().includes(kw.toLowerCase()))
      );
    }

    return new Response(JSON.stringify({ classifications }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error("[classify-tasks] Fatal Error:", error);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders })
  }
})