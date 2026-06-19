// @ts-nocheck
// Classifies calendar events into appointment-type categories using Gemini.
// Categories: buffer, mtt, performance, fnh, coaching, workshop, personal, other
// Deploy with: supabase functions deploy classify-event-types --project-ref <ref>
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CATEGORIES = [
  'buffer',
  'mtt',
  'performance',
  'fnh',
  'coaching',
  'workshop',
  'personal',
  'other',
];

// Heuristic fallback (mirrors the client-side classifier) used when no Gemini key
// is configured or the AI call fails.
const HEURISTICS: Array<{ category: string; re: RegExp }> = [
  { category: 'buffer', re: /🚫|🔒|🌿|buffer|day off|rest|recovery|break/i },
  { category: 'fnh', re: /fnh|functional neuro|neuro.?health|peace framework|cranial|vestibular|primitive reflex|neuro assessment/i },
  { category: 'coaching', re: /voice|piano|coaching|lesson|singing|vocal/i },
  { category: 'performance', re: /seussical|paw patrol|cabaret|carey|show|gig|concert|opening night|closing|tech rehears|dress rehears|performance|ceremony|cast call|cue to cue/i },
  { category: 'workshop', re: /mtfest|mt fest|workshop|masterclass|master class|seminar| intensive /i },
  { category: 'mtt', re: /\bmtt\b|melbourne theatre|pitch yourself|mtt masterclass|mtt class|mtt session/i },
  { category: 'personal', re: /lunch|dinner|brunch|coffee|gym|workout|walk|meditate|yoga|appointment|haircut|doctor|dentist|affirmat|daily affirm|journal|grocer/i },
];

const heuristicClassify = (title: string): { category: string; confidence: number } => {
  for (const h of HEURISTICS) {
    if (h.re.test(title)) return { category: h.category, confidence: 0.8 };
  }
  return { category: 'other', confidence: 0.4 };
};

Deno.serve(async (req) => {
  const functionName = "classify-event-types";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const { events = [], persist = false } = body;

    if (!events || events.length === 0) {
      return new Response(JSON.stringify({ classifications: [] }), { headers: corsHeaders });
    }

    console.log(`[${functionName}] Classifying ${events.length} events. Persist: ${persist}`);

    const titles = events.map((e: any) => e.title);
    let classifications: Array<{ category: string; confidence: number; explanation: string }> = titles.map(heuristicClassify).map((c) => ({ ...c, explanation: 'Heuristic' }));

    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (geminiKey) {
      try {
        const prompt = `You are classifying a music teacher / performer / functional-neuro practitioner's calendar events into appointment types.
Assign exactly ONE category to each event from this list: ${CATEGORIES.join(', ')}.

Category definitions:
- buffer: recovery / transition blocks the user created around other events (titles often contain 🚫, 🔒, 🌿, "Buffer", "Day off", "Rest")
- mtt: Melbourne Theatre Troupe classes, masterclasses, sessions (titles contain "MTT", "Pitch Yourself")
- performance: shows, gigs, concerts, musicals, rehearsals tied to a production (Seussical, Paw Patrol, cabaret, opening/closing night, tech/dress rehearsal, cast call)
- fnh: Functional Neuro Health clinical assessments (PEACE Framework, cranial nerve, vestibular, primitive reflex)
- coaching: Voice or piano coaching / lessons / singing
- workshop: standalone workshops, intensives, MTFest
- personal: personal life (lunch, dinner, gym, doctor, haircut, day off)
- other: anything that does not fit

Return ONLY a JSON array of objects, one per input event, in the same order:
[{ "category": "<one of the categories>", "confidence": 0.0-1.0, "explanation": "<short reason>" }]

Events: ${JSON.stringify(titles)}`;

        const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { response_mime_type: "application/json" }
          })
        });

        if (aiRes.status === 429) {
          console.warn(`[${functionName}] Gemini quota exceeded (429). Using heuristics.`);
        } else {
          const aiData = await aiRes.json();
          const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;
          if (aiText) {
            const parsed = JSON.parse(aiText.replace(/```json|```/g, ''));
            if (Array.isArray(parsed) && parsed.length === titles.length) {
              classifications = parsed.map((c: any) => ({
                category: CATEGORIES.includes(c.category) ? c.category : 'other',
                confidence: typeof c.confidence === 'number' ? c.confidence : 0.8,
                explanation: c.explanation || 'AI',
              }));
            }
          }
        }
      } catch (e) {
        console.warn(`[${functionName}] AI error, falling back to heuristics:`, e.message);
      }
    } else {
      console.log(`[${functionName}] No GEMINI_API_KEY, using heuristics only.`);
    }

    // Persist categories onto calendar_events_cache via a category column if present.
    if (persist && events.length === classifications.length) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') }
      });
      const userData = await userRes.json();
      const userId = userData.id;

      if (userId) {
        // Upsert category per event_id using PATCHes (safe whether or not column exists).
        await Promise.all(events.map((event: any, i: number) =>
          fetch(`${supabaseUrl}/rest/v1/calendar_events_cache?event_id=eq.${encodeURIComponent(event.event_id)}&user_id=eq.${encodeURIComponent(userId)}`, {
            method: 'PATCH',
            headers: {
              'apikey': supabaseKey,
              'Authorization': `Bearer ${supabaseKey}`,
              'Content-Type': 'application/json',
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({ appointment_type: classifications[i].category }),
          }).catch((e) => console.warn(`[${functionName}] persist error:`, e.message))
        ));
      }
    }

    return new Response(JSON.stringify({ classifications }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
});
