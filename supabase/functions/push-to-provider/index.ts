// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const { eventId, provider, startTime, endTime, googleAccessToken, calendarId } = body;

    if (!eventId || !provider || !startTime || !endTime) {
      throw new Error("Missing required parameters");
    }

    if (provider === 'google') {
      let token = googleAccessToken;
      
      // If no token provided, we'd usually fetch from DB, but to keep this zero-dep, 
      // we expect the client to provide it or we'll need a simple fetch to Supabase REST API.
      if (!token) {
        const supabaseUrl = Deno.env.get('SUPABASE_URL');
        const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
        
        // Get user ID from auth header (simple JWT decode or fetch user)
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

      if (!token) throw new Error("Missing Google Access Token");
      
      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${eventId}`;
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          start: { dateTime: startTime },
          end: { dateTime: endTime }
        })
      });

      const data = await res.json();
      if (!res.ok) throw new Error(`Google API Error: ${data.error?.message || 'Unknown'}`);
      
      return new Response(JSON.stringify({ success: true, data }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})
