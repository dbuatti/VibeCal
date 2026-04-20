// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Advanced fuzzy matching: strips noise and checks for core similarity
function isSemanticMatch(title: string, pattern: string) {
  const clean = (s: string) => s.toLowerCase()
    .replace(/part\s*\d+|v\d+|copy|draft|final|[\(\)\[\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const t = clean(title);
  const p = clean(pattern);
  
  if (t === p) return true;
  if (t.length > 5 && p.length > 5) {
    return t.includes(p) || p.includes(t);
  }
  return false;
}

const HARD_FIXED_PATTERNS = /flight|train|hotel|check-in|check-out|reservation|doctor|dentist|hospital|wedding|funeral|performance|gig|concert|show|tech|dress|opening|closing|birthday|party|gala|anniversary|dentist|appointment|appt|interview|vs|meeting with/i;

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

    // 1. STAGE 1: SEMANTIC MEMORY & HEURISTIC PRE-FILTER
    const { data: feedback } = await supabaseAdmin
      .from('task_classification_feedback')
      .select('task_name, is_movable')
      .eq('user_id', user.id);

    const results = taskList.map(title => {
      // Check manual feedback first
      const match = feedback?.find(f => isSemanticMatch(title, f.task_name));
      if (match) {
        return { 
          isMovable: match.is_movable, 
          explanation: `Semantic match: Similar to "${match.task_name}" which you previously vetted.`,
          confidence: 1.0,
          isPredefined: true 
        };
      }

      // Check hard-coded fixed patterns
      if (HARD_FIXED_PATTERNS.test(title)) {
        return {
          isMovable: false,
          explanation: "Heuristic: Detected high-priority event pattern (Travel/Medical/Event).",
          confidence: 0.9,
          isPredefined: true
        };
      }

      // Check user keywords
      const t = title.toLowerCase();
      if (lockedKeywords.some(kw => t.includes(kw.toLowerCase()))) {
        return { isMovable: false, explanation: "Keyword match: Found in your 'Locked' list.", confidence: 1.0, isPredefined: true };
      }
      if (movableKeywords.some(kw => t.includes(kw.toLowerCase()))) {
        return { isMovable: true, explanation: "Keyword match: Found in your 'Movable' list.", confidence: 1.0, isPredefined: true };
      }

      return null;
    });

    const indicesToAI = results.map((r, i) => r === null ? i : null).filter(i => i !== null);

    // 2. STAGE 2: COGNITIVE AI ANALYSIS (Only for unknown tasks)
    if (indicesToAI.length > 0) {
      const tasksForAI = indicesToAI.map(i => taskList[i]);
      
      try {
        const prompt = `
          You are an elite executive assistant. Classify these calendar tasks with high precision.
          
          CONTEXT:
          - MOVABLE: Solo work, drafts, research, chores, or "flexible" blocks.
          - FIXED: Meetings, calls, appointments, hard deadlines, travel, or events involving others.
          
          USER PREFERENCES:
          ${naturalLanguageRules || 'No custom rules provided.'}
          
          TASKS TO ANALYZE:
          ${tasksForAI.map((t, idx) => `${idx}: "${t}"`).join('\n')}
          
          Return ONLY a JSON array of objects: 
          { "isMovable": boolean, "explanation": string, "confidence": number, "dependsOn": string | null }
        `;

        const geminiKey = Deno.env.get('GEMINI_API_KEY');
        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });
        
        const result = await model.generateContent(prompt);
        const response = await result.response;
        const responseText = response.text();
        
        const jsonMatch = responseText.match(/\[\s*\{.*\}\s*\]/s);
        if (jsonMatch) {
          const aiClassifications = JSON.parse(jsonMatch[0]);
          indicesToAI.forEach((originalIdx, aiIdx) => {
            results[originalIdx] = aiClassifications[aiIdx];
          });
        }
      } catch (aiError) {
        console.warn(`[${functionName}] AI Quota/Error, using Smart Fallback:`, aiError.message);
        
        // 3. STAGE 3: SMART HEURISTIC FALLBACK (AI Busy/Quota)
        indicesToAI.forEach(idx => {
          const title = taskList[idx].toLowerCase();
          const likelyFixed = /with|call|meeting|vs|interview|appointment|doctor|dentist|flight|zoom|teams|rehearsal|lesson|performance|gig|show|tech|dress|opening|closing|birthday|party|gala|anniversary/i.test(title);
          
          results[idx] = {
            isMovable: !likelyFixed,
            explanation: "Classified via Smart Heuristic (AI Power Saving Mode).",
            confidence: 0.6,
            dependsOn: null
          };
        });
      }
    }

    // 4. PERSISTENCE
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
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})