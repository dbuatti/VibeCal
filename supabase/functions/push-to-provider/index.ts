// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  const functionName = "push-to-provider";
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log(`[${functionName}] Request received`, { method: req.method });
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      console.error(`[${functionName}] Unauthorized: No auth header`);
      throw new Error("Unauthorized");
    }

    const body = await req.json().catch(() => ({}));
    const { eventId, provider, startTime, endTime, googleAccessToken, calendarId } = body;

    console.log(`[${functionName}] Processing event: ${eventId} for provider: ${provider}`);

    if (!eventId || !provider || !startTime || !endTime) {
      console.error(`[${functionName}] Missing parameters`, { eventId, provider, startTime, endTime });
      throw new Error("Missing required parameters");
    }

    if (provider === 'google') {
      let token = googleAccessToken;
      
      if (!token) {
        console.log(`[${functionName}] No token provided in body, fetching from database...`);
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        
        const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
          headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') }
        });
        const userData = await userRes.json();
        const userId = userData.id;

        if (userId) {
          const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=google_access_token`, {
            headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
          });
          const profiles = await profileRes.json();
          token = profiles[0]?.google_access_token;
        }
      }

      if (!token) {
        console.error(`[${functionName}] Missing Google Access Token`);
        throw new Error("Missing Google Access Token");
      }
      
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${eventId}`;
      console.log(`[${functionName}] Patching Google Calendar event...`, { url });
      
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: { dateTime: startTime },
          end: { dateTime: endTime }
        })
      });

      const data = await res.json();
      if (!res.ok) {
        console.error(`[${functionName}] Google API Error:`, data);
        throw new Error(`Google API Error: ${data.error?.message || 'Unknown'}`);
      }
      
      console.log(`[${functionName}] Successfully updated Google event`);
      return new Response(JSON.stringify({ success: true, data }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (provider === 'apple') {
      console.log(`[${functionName}] Apple provider sync is currently handled via local cache updates. Direct push coming soon.`);
      return new Response(JSON.stringify({ success: true, message: "Apple sync handled locally" }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    console.error(`[${functionName}] Unsupported provider: ${provider}`);
    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})