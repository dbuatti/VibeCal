// @ts-nocheck
import { serve } from "https://deno.land/std@0.190.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import { GoogleGenerativeAI } from "https://esm.sh/@google/generative-ai@0.21.0"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Improved semantic matching: more precise and handles noise better
function isSemanticMatch(title: string, pattern: string) {
  const clean = (s: string) => s.toLowerCase()
    .replace(/part\s*\d+|v\d+|copy|draft|final|[\(\)\[\]]/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
  
  const t = clean(title);
  const p = clean(pattern);
  
  if (t === p) return true;
  
  // Only allow partial matches if the pattern is significant enough
  if (p.length > 8) {
    return t.includes(p) || p.includes(t);
  }
  
  return false;
}

// Added 'statement' and 'foundations' to fixed patterns based on user feedback
const HARD_FIXED_PATTERNS = /flight|train|hotel|reservation|doctor|dentist|hospital|clinic|surgery|medical|wedding|funeral|performance|gig|concert|show|tech|dress|opening|closing|birthday|party|gala|anniversary|appointment|appt|interview|vs|meeting with|call with|zoom|teams|google meet|skype|facetime|session with|coaching|lesson|rehearsal|audition|workshop|seminar|webinar|conference|travel to|commute|drive to|dentist|physio|therapy|vet|haircut|dinner with|lunch with|brunch with|coffee with|statement|foundations|q & a/i;

const HARD_MOVABLE_PATTERNS = /solo|draft|research|tidy|clean|practice|read|study|admin|email|gym|workout|run|walk|meditate|yoga|journal|laundry|groceries|shopping|vacuum|mop|dust|organize|filing|backup|update|coding|programming|writing|blog|post|social media/i;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  const functionName = "classify-tasks";
  let isLocalMode = false;

  try {
    const { events, tasks, movableKeywords = [], lockedKeywords = [], naturalLanguageRules = '', persist = false } = await req.json();
    const authHeader = req.headers.get('Authorization');
    
    const taskList = events ? events.map(e => e.title) : (tasks || []);
    if (taskList.length === 0) return new Response(JSON.stringify({ classifications: [], isLocalMode: false }), { headers: corsHeaders });

    const supabaseAdmin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '');
    const supabaseUser = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_ANON_KEY') ?? '', { global: { headers: { Authorization: authHeader } } });

    const { data: { user } } = await supabaseUser.auth.getUser();
    if (!user) throw new Error("Unauthorized");

    // 1. STAGE 1: SEMANTIC MEMORY & USER RULES
    const { data: feedback } = await supabaseAdmin
      .from('task_classification_feedback')
      .select('task_name, is_movable')
      .eq('user_id', user.id);

    // Sort feedback by length descending so more specific matches take priority
    const sortedFeedback = (feedback || []).sort((a, b) => b.task_name.length - a.task_name.length);

    const results = taskList.map(title => {
      const t = title.toLowerCase();

      // A. Check manual feedback first (This is the "Memory" that ensures it remembers your choices)
      const match = sortedFeedback.find(f => isSemanticMatch(title, f.task_name));
      if (match) {
        return { 
          isMovable: match.is_movable, 
          explanation: `Memory: Matches your previous vetting of "${match.task_name}".`,
          confidence: 1.0,
          isPredefined: true 
        };
      }

      // B. Check User Keywords
      if (lockedKeywords.some(kw => t.includes(kw.toLowerCase()))) {
        return { isMovable: false, explanation: "User Rule: Found in your 'Locked' list.", confidence: 1.0, isPredefined: true };
      }
      if (movableKeywords.some(kw => t.includes(kw.toLowerCase()))) {
        return { isMovable: true, explanation: "User Rule: Found in your 'Movable' list.", confidence: 1.0, isPredefined: true };
      }

      // C. Check hard-coded fixed patterns
      if (HARD_FIXED_PATTERNS.test(title)) {
        return { isMovable: false, explanation: "Local Heuristic: Detected high-priority event pattern.", confidence: 0.9, isPredefined: true };
      }

      // D. Check hard-coded movable patterns
      if (HARD_MOVABLE_PATTERNS.test(title)) {
        return { isMovable: true, explanation: "Local Heuristic: Detected flexible solo task pattern.", confidence: 0.8, isPredefined: true };
      }

      return null;
    });

    const indicesToAI = results.map((r, i) => r === null ? i : null).filter(i => i !== null);

    // 2. STAGE 2: COGNITIVE AI ANALYSIS
    if (indicesToAI.length > 0) {
      const tasksForAI = indicesToAI.map(i => taskList[i]);
      
      try {
        const geminiKey = Deno.env.get('GEMINI_API_KEY');
        if (!geminiKey) throw new Error("Missing Gemini API Key");

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

        const genAI = new GoogleGenerativeAI(geminiKey);
        const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
        
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
        console.warn(`[${functionName}] Quota Exceeded or AI Error. Switching to Local Power-Saving Mode.`, aiError.message);
        isLocalMode = true;
        indicesToAI.forEach(idx => {
          const title = taskList[idx].toLowerCase();
          const likelyFixed = HARD_FIXED_PATTERNS.test(title);
          results[idx] = {
            isMovable: !likelyFixed,
            explanation: "Local Mode: Classified via heuristic (AI Unavailable).",
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

    return new Response(JSON.stringify({ classifications: results, isLocalMode }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  } catch (error) {
    console.error(`[${functionName}] FATAL ERROR:`, error.message);
    return new Response(JSON.stringify({ error: error.message, isLocalMode: true }), { status: 400, headers: corsHeaders });
  }
})