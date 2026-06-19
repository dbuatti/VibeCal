// @ts-nocheck
// Parses pasted conversation/message text and extracts structured calendar events using Gemini.
// Deploy with: supabase functions deploy parse-clipboard-events --project-ref <ref>
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  const functionName = "parse-clipboard-events";
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const { text, timezone = 'Australia/Melbourne' } = body;

    if (!text || text.trim().length < 5) {
      return new Response(JSON.stringify({ events: [], error: 'Text too short' }), { headers: corsHeaders });
    }

    const now = new Date().toISOString();
    const geminiKey = Deno.env.get('GEMINI_API_KEY');

    if (!geminiKey) {
      return new Response(JSON.stringify({ events: [], error: 'No Gemini API key configured' }), { headers: corsHeaders });
    }

    const prompt = `You are a calendar assistant. Today is ${now} (timezone: ${timezone}).
The user has pasted a conversation or message about potential appointments/gigs/sessions.
Extract ALL confirmed or likely calendar events from this text.

For each event, determine:
- title: A clear, concise event title (e.g. "Corporate Choir — Coles", "Elf Dance Auditions")
- startDateTime: ISO 8601 datetime in the user's timezone (${timezone}). If a time is approximate ("morning"), use 09:00. If "from midday", use 12:00. If "all day" or no time given and it seems like a full-day thing, use 09:00 start.
- endDateTime: ISO 8601 datetime. If duration mentioned ("for an hour"), calculate end. If "10-6", use 10:00-18:00. If unknown, default to 1 hour after start.
- location: The venue/location if mentioned, otherwise null
- notes: Any relevant details (pay rate, contact person, what to bring, context)
- status: "confirmed" if the user agreed/accepted, "tentative" if still being discussed or times aren't final

Handle these patterns:
- "Wednesday March 19 and 26" → two separate events on those dates
- "Sunday July 5" → single event on that date
- "10-6" → 10:00 to 18:00
- "from midday for an hour" → 12:00 to 13:00
- "half day on Monday" → tentative, 09:00 to 13:00
- Relative dates: resolve them to actual dates based on today being ${now}

IMPORTANT: Only extract events that the user (Daniele/Orpheus — the person being offered work) has accepted or seems likely to do. Don't extract events they turned down.

Return ONLY a JSON array:
[
  {
    "title": "string",
    "startDateTime": "ISO string",
    "endDateTime": "ISO string",
    "location": "string or null",
    "notes": "string or null",
    "status": "confirmed" | "tentative"
  }
]

If no events found, return [].

Text to parse:
"""
${text}
"""`;

    const aiRes = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { response_mime_type: "application/json" }
      })
    });

    if (aiRes.status === 429) {
      return new Response(JSON.stringify({ events: [], error: 'Gemini quota exceeded' }), { headers: corsHeaders });
    }

    const aiData = await aiRes.json();
    const aiText = aiData.candidates?.[0]?.content?.parts?.[0]?.text;

    if (!aiText) {
      return new Response(JSON.stringify({ events: [], error: 'No response from AI' }), { headers: corsHeaders });
    }

    const events = JSON.parse(aiText.replace(/```json|```/g, ''));

    if (!Array.isArray(events)) {
      return new Response(JSON.stringify({ events: [], error: 'Invalid AI response' }), { headers: corsHeaders });
    }

    return new Response(JSON.stringify({ events }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });
  } catch (error) {
    console.error(`[${functionName}] Fatal:`, error.message);
    return new Response(JSON.stringify({ events: [], error: error.message }), { status: 400, headers: corsHeaders });
  }
});
