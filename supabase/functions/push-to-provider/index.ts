// @ts-nocheck
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

async function refreshGoogleToken(refreshToken, supabaseUrl, supabaseKey, userId) {
  console.log(`[push-to-provider] Attempting to refresh token for user: ${userId}`);
  
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: Deno.env.get('GOOGLE_CLIENT_ID'),
      client_secret: Deno.env.get('GOOGLE_CLIENT_SECRET'),
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
    }),
  });
  
  const data = await res.json();
  
  if (!res.ok) {
    console.error(`[push-to-provider] Refresh Failed:`, data);
    throw new Error("AUTH_EXPIRED");
  }

  const newAccessToken = data.access_token;

  // Persist the new token immediately
  await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}`, {
    method: 'PATCH',
    headers: { 
      'apikey': supabaseKey, 
      'Authorization': `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ google_access_token: newAccessToken })
  });

  return newAccessToken;
}

Deno.serve(async (req) => {
  const functionName = "push-to-provider";
  
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) throw new Error("Unauthorized");

    const body = await req.json().catch(() => ({}));
    const { eventId, provider, startTime, endTime, googleAccessToken, calendarId } = body;

    if (!eventId || !provider || !startTime || !endTime) {
      throw new Error("Missing required parameters");
    }

    if (provider === 'google') {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
      
      // Get user ID
      const userRes = await fetch(`${supabaseUrl}/auth/v1/user`, {
        headers: { 'Authorization': authHeader, 'apikey': Deno.env.get('SUPABASE_ANON_KEY') }
      });
      const userData = await userRes.json();
      const userId = userData.id;

      // Get Profile for tokens
      const profileRes = await fetch(`${supabaseUrl}/rest/v1/profiles?id=eq.${userId}&select=google_access_token,google_refresh_token`, {
        headers: { 'apikey': supabaseKey, 'Authorization': `Bearer ${supabaseKey}` }
      });
      const profiles = await profileRes.json();
      const profile = profiles[0];

      let token = googleAccessToken || profile?.google_access_token;
      
      const patchEvent = async (t) => {
        const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId || 'primary')}/events/${eventId}`;
        return fetch(url, {
          method: 'PATCH',
          headers: { 'Authorization': `Bearer ${t}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            start: { dateTime: startTime },
            end: { dateTime: endTime }
          })
        });
      };

      let res = await patchEvent(token);

      // If unauthorized, try refreshing
      if (res.status === 401 && profile?.google_refresh_token) {
        token = await refreshGoogleToken(profile.google_refresh_token, supabaseUrl, supabaseKey, userId);
        res = await patchEvent(token);
      }

      const data = await res.json();
      if (!res.ok) {
        console.error(`[${functionName}] Google API Error:`, data);
        throw new Error(`Google API Error: ${data.error?.message || 'Unknown'}`);
      }
      
      return new Response(JSON.stringify({ success: true, data }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    if (provider === 'apple') {
      return new Response(JSON.stringify({ success: true, message: "Apple sync handled locally" }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    throw new Error(`Unsupported provider: ${provider}`);
  } catch (error) {
    console.error(`[${functionName}] Fatal Error:`, error.message);
    return new Response(JSON.stringify({ error: error.message }), { status: 400, headers: corsHeaders });
  }
})